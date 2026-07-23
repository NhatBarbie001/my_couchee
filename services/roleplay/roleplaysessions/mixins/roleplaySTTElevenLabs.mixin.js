'use strict';

const audioUtils = require('../ultils/audioUtils');
const AUDIO_PROCESSING_DEFAULTS = {
  silenceThreshold: 500, // ms im lặng để coi là kết thúc turn (tăng từ 100ms để tránh commit sớm khi nói nhanh)
  maxTurnDuration: 240000, // Thời gian tối đa cho một turn (4 phút)
};

module.exports = {
  name: 'roleplaySTTElevenLabsMixin',
  methods: {
    async _handleStudentAudioChunkElevenLabs(state, audioChunk, format, socket) {
      state.chunkQueue.push({ audioChunk, format });
      if (state.isHandlingChunk) return;
      state.isHandlingChunk = true;
      try {
        while (state.chunkQueue.length > 0) {
          const { audioChunk: currentAudioChunk, format: currentFormat } = state.chunkQueue.shift();
          if (currentFormat) {
            state.clientAudioFormat = {
              sampleRate: currentFormat.sampleRate || state.clientAudioFormat.sampleRate,
              channels: currentFormat.channels || state.clientAudioFormat.channels,
              bitDepth: currentFormat.bitsPerSample || state.clientAudioFormat.bitDepth,
            };
          }
          state.allAudioChunksForSession.push(currentAudioChunk);
          await this.processVoiceActivityAndStreamSTTElevenLabs(state, currentAudioChunk, socket);
        }
      } catch (err) {
        this.logger.error(`_handleStudentAudioChunk error for session ${state.sessionId}:`, err);
        if (socket) socket.emit('server:error', { message: 'Lỗi xử lý audio chunk phía server.' });
      } finally {
        state.isHandlingChunk = false;
      }
    },

    async processVoiceActivityAndStreamSTTElevenLabs(state, audioChunk, socket) {
      try {
        state.audioBuffer = Buffer.concat([state.audioBuffer, audioChunk]);
        const { sampleRate, channels, bitDepth } = state.clientAudioFormat;

        const windowSamples = state.sherpaVad.config?.sileroVad?.windowSize || audioUtils.VAD_DEFAULTS.windowSize;
        const frameBytes = windowSamples * (bitDepth / 8) * channels;

        while (state.audioBuffer.length >= frameBytes) {
          const frame = state.audioBuffer.slice(0, frameBytes);
          state.audioBuffer = state.audioBuffer.slice(frameBytes);
          const floatFrame = audioUtils.pcm16ToFloat32(frame);
          state.sherpaVad.acceptWaveform(floatFrame);
          const audioBufferForSTT = audioUtils.float32ToPcm16(floatFrame);

          if (state.sherpaVad.isDetected()) {
            state.lastVoiceActivity = Date.now();
            if (!state.isStudentSpeaking) {
              // Bắt đầu turn mới
              state.isStudentSpeaking = true;
              state.currentStudentTranscript = '';
              state.startTurnTime = new Date();
              await this.requestOrchestratorCancel(state, 'student_speaking').catch(() => {});
              console.log('#####################startTurnTime', state.startTurnTime);

              // Flush pre-buffer vào stream đang mở sẵn
              for (const preSpeechSample of state.preBuffer) {
                await this._pushAudioToElevenLabs(state, preSpeechSample);
              }
              state.preBuffer = [];
            }
          }

          if (state.isStudentSpeaking) {
            await this._pushAudioToElevenLabs(state, audioBufferForSTT);
          } else {
            // Gom pre-buffer (âm thanh trước khi phát hiện giọng)
            const frameDuration = (windowSamples / sampleRate) * 1000;
            const keepSampleNumber = ((audioUtils.VAD_DEFAULTS.minSpeechDuration * 2) / frameDuration) * 1000;
            state.preBuffer.push(audioBufferForSTT);
            if (state.preBuffer.length > keepSampleNumber) {
              state.preBuffer = state.preBuffer.slice(state.preBuffer.length - keepSampleNumber);
            }
          }

          // VAD pop: chỉ log, không cần đóng stream ở đây nữa
          while (!state.sherpaVad.isEmpty()) {
            console.log('#######VAD lastVoiceActivity', new Date(state.lastVoiceActivity));
            state.sherpaVad.pop();
            console.log('#######VAD End segment', new Date());
          }
        }

        // Kiểm tra silence để commit turn
        const silenceTime = Date.now() - state.lastVoiceActivity;
        const maxTurnTime = Date.now() - (state.startTurnTime?.getTime() || Date.now());

        if (state.isStudentSpeaking) {
          if (maxTurnTime > AUDIO_PROCESSING_DEFAULTS.maxTurnDuration) {
            this.logger.warn(`Turn exceeded maximum duration for session ${state.sessionId}, forcing commit`);
            state.isStudentSpeaking = false;
            state.isAiInterruptedByStudent = false;
            await this._commitElevenLabsTurn(state);
          } else if (silenceTime > AUDIO_PROCESSING_DEFAULTS.silenceThreshold) {
            state.isStudentSpeaking = false;
            state.isAiInterruptedByStudent = false;
            await this._commitElevenLabsTurn(state);
          }
          // else: vẫn đang nói, tiếp tục nhận audio
        }
        // else: chưa bắt đầu nói, không làm gì
      } catch (err) {
        console.error(`processVoiceActivityAndStreamSTT error for session ${state.sessionId}:`, err);
        state.isStudentSpeaking = false;
        state.audioBuffer = Buffer.alloc(0);
        if (socket) socket.emit('server:error', { message: 'Lỗi xử lý giọng nói của bạn.' });
      }
    },

    /**
     * Push audio lên WS ElevenLabs đang mở.
     * Stream ID được giữ trong state.sttStreamId suốt session.
     * Nếu WS bị đóng từ phía ElevenLabs giữa các turn → tự reopen.
     */
    async _pushAudioToElevenLabs(state, audioBuffer) {
      if (!audioBuffer || audioBuffer.length === 0) return;
      state.currentStudentAudioChunks.push(audioBuffer);
      if (!state.sttStreamId) return;

      // Kiểm tra stream còn sống không, nếu không thì reopen
      const streamExists = await this.broker.call('roleplay.elevenlabs.pushAudioToStream', {
        streamId: state.sttStreamId,
        audioChunk: audioBuffer,
      });

      if (streamExists && streamExists.reason === 'stream_not_found') {
        this.logger.warn(`[ElevenLabs] Stream ${state.sttStreamId} not found, attempting reopen...`);
        try {
          await this.broker.call('roleplay.elevenlabs.reopenStream', {
            streamId: state.sttStreamId,
            sessionId: state.sessionId,
          });
          // Push lại lần nữa sau khi reopen
          await this.broker.call('roleplay.elevenlabs.pushAudioToStream', {
            streamId: state.sttStreamId,
            audioChunk: audioBuffer,
          });
          this.logger.info(`[ElevenLabs] Stream ${state.sttStreamId} reopened successfully`);
        } catch (reopenErr) {
          this.logger.error(`[ElevenLabs] Failed to reopen stream for session ${state.sessionId}:`, reopenErr);
        }
      }
    },

    /**
     * Commit turn: thông báo ElevenLabs kết thúc lượt nói.
     * WS vẫn mở – ElevenLabs sẽ trả về committed_transcript.
     */
    async _commitElevenLabsTurn(state) {
      if (!state.sttStreamId) {
        this.logger.warn(`_commitElevenLabsTurn: không có sttStreamId cho session ${state.sessionId}`);
        return;
      }
      try {
        await this.broker.call('roleplay.elevenlabs.commitTurn', {
          streamId: state.sttStreamId,
        });
        console.log(`#####################commitTurn sent for session ${state.sessionId}`);
      } catch (err) {
        this.logger.error(`_commitElevenLabsTurn error for session ${state.sessionId}:`, err);
      }
    },

    /**
     * Finalize turn sau khi nhận committed_transcript từ ElevenLabs.
     * Được gọi từ speech.stream.recognized event.
     */
    async finalizeStudentTurnElevenLabs(state) {
      // Guard chống double-finalize
      if (state.isFinalizingTurn) {
        this.logger.warn(`finalizeStudentTurnElevenLabs: đang finalize, bỏ qua lần gọi này (session ${state.sessionId})`);
        return;
      }

      const transcript = state.currentStudentTranscript ? state.currentStudentTranscript.trim() : '';
      if (!transcript) {
        this.logger.info(`finalizeStudentTurnElevenLabs: transcript rỗng, bỏ qua (session ${state.sessionId})`);
        
        // Cứu vãn: Nếu transcript lượt trước đó rỗng (ví dụ: tiếng thở/VAD ảo), nhưng history cuối cùng là user chưa có AI reply, 
        // thì ta vẫn phải gọi processLLMAndResponse để AI trả lời cho câu trước đó.
        const lastConv = state.conversationHistory && state.conversationHistory[state.conversationHistory.length - 1];
        if (lastConv && lastConv.role === 'user' && !state.isStudentSpeaking && !state.isAiResponding) {
          this.logger.info(`[${state.sessionId}] Bù lại lần gọi LLM bị skip do isStudentSpeaking trước đó.`);
          await this.triggerOrchestratorRun(state, {source: 'legacy_elevenlabs_empty_transcript_recovery'});
        }
        
        return;
      }

      state.isFinalizingTurn = true;
      try {
        console.log('##########endTurn', new Date());
        console.log('##########state.currentStudentTranscript', transcript);

        state.audioBuffer = Buffer.alloc(0);

        // Lưu audio của lượt nói ngầm (Fire-and-forget) để không block AI phản hồi
        const tempTurnAudioId = `temp_audio_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        let turnAudioId = tempTurnAudioId;
        
        const audioChunksToSave = [...(state.currentStudentAudioChunks || [])];
        state.currentStudentAudioChunks = [];

        if (audioChunksToSave.length > 0) {
          state.pendingAudioSaves = state.pendingAudioSaves || [];
          const savePromise = this.saveStudentTurnAudio(state, audioChunksToSave)
            .then(audioInfo => {
              if (audioInfo && audioInfo.fileId) {
                const targetTurn = state.conversationHistory.find(turn => turn.turnAudioId === tempTurnAudioId);
                if (targetTurn) {
                  targetTurn.turnAudioId = audioInfo.fileId;
                }
              }
            })
            .catch(saveError => {
              this.logger.error(`Lỗi khi chạy background lưu audio lượt nói học sinh session ${state.sessionId}:`, saveError);
            });
          state.pendingAudioSaves.push(savePromise);
        } else {
          turnAudioId = null;
        }

        const durationInSeconds = (Date.now() - state.startTurnTime) / 1000.0;
        const wordCount = transcript.split(/\s+/).filter(Boolean).length;
        const speakSpeed = durationInSeconds > 0 ? wordCount / durationInSeconds : 0;

        state.conversationHistory.push({
          role: 'user',
          content: transcript,
          turnAudioId: turnAudioId,
          duration: durationInSeconds,
          speakSpeed: speakSpeed,
        });

        // console.log('#######state.conversationHistory', state.conversationHistory);

        if (state.socket) {
          state.socket.emit('server:student_text_response', {
            sessionId: state.sessionId,
            text: transcript,
            role: 'user',
            isFinal: true,
            turnAudioId: turnAudioId,
          });
        }

        // Reset transcript cho turn tiếp theo
        state.currentStudentTranscript = '';

        await this.triggerOrchestratorRun(state, {source: 'legacy_elevenlabs_finalize_turn'});
      } finally {
        state.isFinalizingTurn = false;
      }
    },
  },
};