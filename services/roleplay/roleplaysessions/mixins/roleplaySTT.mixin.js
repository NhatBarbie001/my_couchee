'use strict';

const audioUtils = require('../ultils/audioUtils');
const AUDIO_PROCESSING_DEFAULTS = {
  silenceThreshold: 100, // Tăng lên 3 giây để giảm thiểu AI chen ngang khi người dùng tạm dừng
  maxTurnDuration: 240000, // Thời gian tối đa cho một turn (2 phút)
};

module.exports = {
  name: 'roleplaySTTMixin',
  methods: {
    async _handleStudentAudioChunk(state, audioChunk, format, socket) {
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
          await this.processVoiceActivityAndStreamSTT(state, currentAudioChunk, socket);
        }
      } catch (err) {
        this.logger.error(`_handleStudentAudioChunk error for session ${state.sessionId}:`, err);
        if (socket) socket.emit('server:error', { message: 'Lỗi xử lý audio chunk phía server.' });
      } finally {
        state.isHandlingChunk = false;
      }
    },

    async processVoiceActivityAndStreamSTT(state, audioChunk, socket) {
      const self = this;
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
              await initStudentTurn(this.broker);
              for (const preSpeechSample of state.preBuffer) {
                await pushAudioToSTT(this.broker, preSpeechSample);
              }
              state.preBuffer = [];
            }
          }
          if (state.isStudentSpeaking) {
            await pushAudioToSTT(this.broker, audioBufferForSTT);
          } else {
            const frameDuration = (windowSamples / sampleRate) * 1000;
            const keepSampleNumber = ((audioUtils.VAD_DEFAULTS.minSpeechDuration * 2) / frameDuration) * 1000;
            state.preBuffer.push(audioBufferForSTT);
            if (state.preBuffer.length > keepSampleNumber) {
              state.preBuffer = state.preBuffer.slice(state.preBuffer.length - keepSampleNumber);
            }
          }
          while (!state.sherpaVad.isEmpty()) {
            console.log('#######VAD lastVoiceActivity', new Date(state.lastVoiceActivity));
            state.sherpaVad.pop();
            console.log('#######VAD End turn', new Date());
            if (state.sttStreamId) {
              await this.broker.call('roleplay.speechprocessing.closeSpeechStream', { streamId: state.sttStreamId });
              state.sttStreamId = null;
            }
          }
        }
        // Kiểm tra thời gian silence để quyết định kết thúc turn
        const silenceTime = Date.now() - state.lastVoiceActivity;
        const maxTurnTime = Date.now() - (state.startTurnTime?.getTime() || Date.now());

        if (state.isStudentSpeaking) {
          // Kiểm tra nếu đã vượt quá thời gian tối đa cho một turn
          if (maxTurnTime > AUDIO_PROCESSING_DEFAULTS.maxTurnDuration) {
            this.logger.warn(`Turn exceeded maximum duration for session ${state.sessionId}, forcing end`);
            state.isStudentSpeaking = false;
            state.isAiInterruptedByStudent = false;
            if (state.sttStreamId) {
              await this.broker.call('roleplay.speechprocessing.closeSpeechStream', { streamId: state.sttStreamId });
              state.sttStreamId = null;
            }
          } else if (silenceTime > AUDIO_PROCESSING_DEFAULTS.silenceThreshold) {
            state.isStudentSpeaking = false;
            state.isAiInterruptedByStudent = false;
          } else {
            return;
          }
        } else {
          return; // Không phải đang trong turn của student
        }

        // Chỉ xử lý turn khi thực sự kết thúc (không còn isStudentSpeaking)
        if (!state.isStudentSpeaking) {
          if (state.currentStudentTranscript && state.currentStudentTranscript.trim()) {
            console.log('##########endTurn', new Date());
            console.log('##########state.currentStudentTranscript', state.currentStudentTranscript);
            state.audioBuffer = Buffer.alloc(0);
            // Xử lý turn vừa xong
            const tempTurnAudioId = `temp_audio_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            let turnAudioId = tempTurnAudioId;
            
            const audioChunksToSave = [...(state.currentStudentAudioChunks || [])];
            // Luôn reset currentStudentAudioChunks sau khi đã copy (để rỗng cho lượt sau)
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
            const wordCount = state.currentStudentTranscript.trim().split(/\s+/).filter(Boolean).length;
            const speakSpeed = durationInSeconds > 0 ? wordCount / durationInSeconds : 0;

            state.conversationHistory.push({
              role: 'user',
              content: state.currentStudentTranscript.trim(),
              turnAudioId: turnAudioId, // Thêm ID audio của lượt nói
              duration: durationInSeconds,
              speakSpeed: speakSpeed,
            });

            if (state.socket) {
              state.socket.emit('server:student_text_response', {
                sessionId: state.sessionId,
                text: state.currentStudentTranscript.trim(),
                role: 'user',
                isFinal: true,
                turnAudioId: turnAudioId, // Có thể gửi kèm về client nếu cần
              });
            }

            // Reset transcript sau khi đã xử lý
            state.currentStudentTranscript = '';
            // console.log('#######state.conversationHistory', state.conversationHistory);
            await this.triggerOrchestratorRun(state, {source: 'legacy_stt_finalize_turn'});
          } else {
            // Transcript rỗng (tiếng thở, nhiễu ngắn) -> check bù LLM
            const lastConv = state.conversationHistory && state.conversationHistory[state.conversationHistory.length - 1];
            if (lastConv && lastConv.role === 'user' && !state.isAiResponding) {
              this.logger.info(`[${state.sessionId}] Bù lại lần gọi LLM bị skip do isStudentSpeaking trước đó (STT Azure).`);
              await this.triggerOrchestratorRun(state, {source: 'legacy_stt_empty_transcript_recovery'});
            }
          }
        }
      } catch (err) {
        console.error(`processVoiceActivityAndStreamSTT error for session ${state.sessionId}:`, err);
        if (state.sttStreamId)
          await this.broker.call('roleplay.speechprocessing.closeSpeechStream', { streamId: state.sttStreamId });
        state.isStudentSpeaking = false;
        state.audioBuffer = Buffer.alloc(0);
        if (socket) socket.emit('server:error', { message: 'Lỗi xử lý giọng nói của bạn.' });
      }

      async function pushAudioToSTT(service, audioBufferForSTT) {
        if (audioBufferForSTT.length > 0) {
          state.currentStudentAudioChunks.push(audioBufferForSTT);
          if (state.sttStreamId) {
            await service.call('roleplay.speechprocessing.pushAudioToStream', {
              streamId: state.sttStreamId,
              audioChunk: audioBufferForSTT,
            });
          }
        }
      }

      async function initStudentTurn(service) {
        state.isStudentSpeaking = true;
        state.currentStudentTranscript = '';
        await self.requestOrchestratorCancel(state, 'student_speaking').catch(() => {});
        if (!state.sttStreamId) {
          const { streamId } = await service.call('roleplay.speechprocessing.initializeSpeechStream', {
            language: 'vi-VN',
            sessionId: state.sessionId,
          });
          state.sttStreamId = streamId;
        }
        // Bắt đầu turn
        state.startTurnTime = new Date();
        console.log('#####################startTurnTime', state.startTurnTime);
      }
    },
  },
};
