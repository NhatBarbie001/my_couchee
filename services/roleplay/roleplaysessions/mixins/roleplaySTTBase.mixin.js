'use strict';

const audioUtils = require('../ultils/audioUtils');
const azureProvider = require('./sttProviders/azure');
const elevenlabsProvider = require('./sttProviders/elevenlabs');
const thinklabsProvider = require('./sttProviders/thinklabs');
const {createSTTProvider} = require('../../stt');

const MAX_TURN_DURATION = 240000; // Thời gian tối đa cho một turn (4 phút)

const STT_PROVIDERS = {
  azure: azureProvider,
  elevenlabs: elevenlabsProvider,
  thinklabs: thinklabsProvider,
};

module.exports = {
  name: 'roleplaySTTBaseMixin',
  methods: {
    _isSTTV2Enabled(state) {
      return this.isVoiceFlagEnabled('VOICE_STT_V2_ENABLED', false, state);
    },

    /**
     * Trả về provider strategy dựa trên state.sttProvider.
     * Mặc định là Azure nếu không xác định.
     */
    _getSTTProvider(state) {
      return STT_PROVIDERS[state.sttProvider] || STT_PROVIDERS.azure;
    },

    _getSTTProviderV2Instance(state) {
      if (!state.sttProviderInstance) {
        state.sttProviderInstance = createSTTProvider({
          providerName: state.sttProvider,
          broker: this.broker,
          logger: this.logger,
        });
      }
      return state.sttProviderInstance;
    },

    async _ensureSTTV2Handle(state) {
      if (state.sttProviderV2Handle) {
        return state.sttProviderV2Handle;
      }

      const providerV2 = this._getSTTProviderV2Instance(state);
      state.sttProviderV2Handle = await providerV2.openStream({state});
      return state.sttProviderV2Handle;
    },

    _buildSTTProviderV2Adapter(state, providerV2) {
      return {
        silenceThreshold: providerV2.silenceThreshold,
        deferFinalize: providerV2.deferFinalize,
        initStream: async () => {
          await this._ensureSTTV2Handle(state);
        },
        pushAudio: async (_broker, _state, audioBuffer) => {
          const handle = await this._ensureSTTV2Handle(state);
          if (handle && typeof handle.send === 'function') {
            await handle.send(audioBuffer);
          }
        },
        onVADPop: async () => {
          const handle = await this._ensureSTTV2Handle(state);
          if (handle && typeof handle.onVADPop === 'function') {
            await handle.onVADPop();
          }
        },
        onTurnEnd: async () => {
          const handle = await this._ensureSTTV2Handle(state);
          if (handle && typeof handle.commitTurn === 'function') {
            await handle.commitTurn();
          }
        },
        cleanup: async () => {
          if (state.sttProviderV2Handle && typeof state.sttProviderV2Handle.cleanup === 'function') {
            await state.sttProviderV2Handle.cleanup();
          }
        },
        sendHints: async () => {
          const handle = await this._ensureSTTV2Handle(state);
          if (handle && typeof handle.setHints === 'function') {
            await handle.setHints();
          }
        },
      };
    },

    _getProviderForStreaming(state) {
      if (!this._isSTTV2Enabled(state)) {
        return this._getSTTProvider(state);
      }

      const providerV2 = this._getSTTProviderV2Instance(state);
      return this._buildSTTProviderV2Adapter(state, providerV2);
    },

    /**
     * Entry point duy nhất để xử lý audio chunk từ client.
     * Thay thế cả _handleStudentAudioChunk (Azure) và _handleStudentAudioChunkElevenLabs.
     * Tự chọn provider dựa trên state.sttProvider.
     */
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
          const useVadService = this.isVoiceFlagEnabled('VOICE_VAD_SERVICE_ENABLED', false, state);
          if (useVadService && state.sessionId) {
            await this.processVoiceActivityViaVADService(state, currentAudioChunk, socket);
          } else {
            await this.processVoiceActivityAndStreamSTT(state, currentAudioChunk, socket);
          }
        }
      } catch (err) {
        this.logger.error(`_handleStudentAudioChunk error for session ${state.sessionId}:`, err);
        if (socket) socket.emit('server:error', { message: 'Lỗi xử lý audio chunk phía server.' });
      } finally {
        state.isHandlingChunk = false;
      }
    },

    /**
     * VAD v2 path: chuyển VAD state + speech detection sang roleplay.vad service,
     * còn roleplaysessions tiếp tục giữ flow STT/finalize hiện tại để đảm bảo contract.
     */
    async processVoiceActivityViaVADService(state, audioChunk, socket) {
      const provider = this._getProviderForStreaming(state);

      try {
        const result = await this.broker.call('roleplay.vad.process', {
          sessionId: state.sessionId,
          audio: audioChunk,
          format: {
            sampleRate: state.clientAudioFormat.sampleRate,
            channels: state.clientAudioFormat.channels,
            bitDepth: state.clientAudioFormat.bitDepth,
          },
          silenceThreshold: provider.silenceThreshold,
          maxTurnDuration: MAX_TURN_DURATION,
        });

        if (typeof result.lastVoiceActivity === 'number') {
          state.lastVoiceActivity = result.lastVoiceActivity;
        }

        if (result.speechStarted) {
          state.isStudentSpeaking = true;
          state.currentStudentTranscript = '';
          state.startTurnTime = new Date(result.startTurnTimestamp || Date.now());
          this.nextTurnId(state);
          await this.requestOrchestratorCancel(state, 'student_speaking').catch(() => {});
          await provider.initStream(this.broker, state);
        }

        if (Array.isArray(result.providerAudioChunks) && result.providerAudioChunks.length > 0) {
          for (const audioBufferForSTT of result.providerAudioChunks) {
            await this._pushAudioToProvider(provider, state, audioBufferForSTT);
          }
        }

        const vadPopCount = Number(result.vadPopCount || 0);
        if (vadPopCount > 0) {
          for (let i = 0; i < vadPopCount; i += 1) {
            await provider.onVADPop(this.broker, state);
          }
        }

        if (result.speechEnded) {
          state.isStudentSpeaking = false;
          state.isAiInterruptedByStudent = false;
          this.startVoicePhaseTimer(state, 'stt.final');
          await provider.onTurnEnd(this.broker, state, this.logger);

          if (!provider.deferFinalize) {
            await this.finalizeStudentTurn(state);
          }
        }
      } catch (err) {
        console.error(`processVoiceActivityViaVADService error for session ${state.sessionId}:`, err);
        try {
          await provider.cleanup(this.broker, state);
        } catch (_cleanupErr) {
          // Ignore cleanup error
        }
        state.isStudentSpeaking = false;
        if (socket) socket.emit('server:error', { message: 'Lỗi xử lý giọng nói của bạn.' });
      }
    },

    /**
     * Xử lý VAD (Voice Activity Detection) và đẩy audio lên STT provider.
     * Logic chung cho tất cả provider, delegate hành động cụ thể qua provider strategy.
     */
    async processVoiceActivityAndStreamSTT(state, audioChunk, socket) {
      const provider = this._getProviderForStreaming(state);

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
              this.nextTurnId(state);
              await this.requestOrchestratorCancel(state, 'student_speaking').catch(() => {});
              console.log('#####################startTurnTime', state.startTurnTime);

              // Emit event ngay khi VAD detect giọng nói để frontend đánh dấu video turn marker chính xác
              if (state.socket) {
                state.socket.emit('server:student_speech_started', {
                  sessionId: state.sessionId,
                });
              }

              // Provider-specific: Azure mở stream mới, ElevenLabs no-op (stream mở sẵn)
              await provider.initStream(this.broker, state);

              // Flush pre-buffer (âm thanh trước khi phát hiện giọng)
              for (const preSpeechSample of state.preBuffer) {
                await this._pushAudioToProvider(provider, state, preSpeechSample);
              }
              state.preBuffer = [];
            }
          }

          if (state.isStudentSpeaking) {
            await this._pushAudioToProvider(provider, state, audioBufferForSTT);
          } else {
            // Gom pre-buffer (âm thanh trước khi phát hiện giọng)
            const frameDuration = (windowSamples / sampleRate) * 1000;
            const keepSampleNumber = ((audioUtils.VAD_DEFAULTS.minSpeechDuration * 2) / frameDuration) * 1000;
            state.preBuffer.push(audioBufferForSTT);
            if (state.preBuffer.length > keepSampleNumber) {
              state.preBuffer = state.preBuffer.slice(state.preBuffer.length - keepSampleNumber);
            }
          }

          // VAD pop: provider-specific (Azure đóng stream, ElevenLabs chỉ log)
          while (!state.sherpaVad.isEmpty()) {
            console.log('#######VAD lastVoiceActivity', new Date(state.lastVoiceActivity));
            state.sherpaVad.pop();
            console.log('#######VAD End segment', new Date());
            await provider.onVADPop(this.broker, state);
          }
        }

        // Kiểm tra thời gian silence để quyết định kết thúc turn
        const silenceTime = Date.now() - state.lastVoiceActivity;
        const maxTurnTime = Date.now() - (state.startTurnTime?.getTime() || Date.now());

        if (state.isStudentSpeaking) {
          if (maxTurnTime > MAX_TURN_DURATION) {
            // Kiểm tra nếu đã vượt quá thời gian tối đa cho một turn
            this.logger.warn(`Turn exceeded maximum duration for session ${state.sessionId}, forcing end`);
            state.isStudentSpeaking = false;
            state.isAiInterruptedByStudent = false;
            this.startVoicePhaseTimer(state, 'stt.final');
            await provider.onTurnEnd(this.broker, state, this.logger);
          } else if (silenceTime > provider.silenceThreshold) {
            state.isStudentSpeaking = false;
            state.isAiInterruptedByStudent = false;
            this.startVoicePhaseTimer(state, 'stt.final');
            await provider.onTurnEnd(this.broker, state, this.logger);
          } else {
            return; // Vẫn đang nói, tiếp tục nhận audio
          }

          // Azure (deferFinalize=false): finalize ngay lập tức
          // ElevenLabs (deferFinalize=true): chờ speech.stream.recognized(isFinal=true) mới finalize
          if (!provider.deferFinalize) {
            await this.finalizeStudentTurn(state);
          }
        }
        // else: chưa bắt đầu nói, không làm gì
      } catch (err) {
        console.error(`processVoiceActivityAndStreamSTT error for session ${state.sessionId}:`, err);
        try {
          await provider.cleanup(this.broker, state);
        } catch (_cleanupErr) {
          // Ignore cleanup error
        }
        state.isStudentSpeaking = false;
        state.audioBuffer = Buffer.alloc(0);
        if (socket) socket.emit('server:error', { message: 'Lỗi xử lý giọng nói của bạn.' });
      }
    },

    /**
     * Helper: push audio vào currentStudentAudioChunks + gọi provider.pushAudio.
     */
    async _pushAudioToProvider(provider, state, audioBuffer) {
      if (!audioBuffer || audioBuffer.length === 0) return;
      state.currentStudentAudioChunks.push(audioBuffer);
      await provider.pushAudio(this.broker, state, audioBuffer, this.logger);
    },

    /**
     * Finalize student turn: lưu audio, tính metrics, push history, emit socket, gọi LLM.
     * Thay thế cả logic inline của Azure và finalizeStudentTurnElevenLabs.
     * Có guard chống double-finalize.
     */
    async finalizeStudentTurn(state) {
      // Guard chống double-finalize
      if (state.isFinalizingTurn) {
        this.logger.warn(`finalizeStudentTurn: đang finalize, bỏ qua lần gọi này (session ${state.sessionId})`);
        return;
      }

      const transcript = state.currentStudentTranscript ? state.currentStudentTranscript.trim() : '';
      if (!state.currentTurnId) {
        this.nextTurnId(state);
      }
      if (!transcript) {
        this.logger.info(`finalizeStudentTurn: transcript rỗng, bỏ qua (session ${state.sessionId})`);

        // Cứu vãn: Nếu transcript rỗng (tiếng thở, nhiễu ngắn, VAD ảo)
        // nhưng history cuối cùng là user chưa có AI reply → vẫn gọi LLM
        const lastConv = state.conversationHistory && state.conversationHistory[state.conversationHistory.length - 1];
        if (lastConv && lastConv.role === 'user' && !state.isStudentSpeaking && !state.isAiResponding) {
          this.logger.info(`[${state.sessionId}] Bù lại lần gọi LLM bị skip do isStudentSpeaking trước đó.`);
          await this.triggerOrchestratorRun(state, {source: 'stt_empty_transcript_recovery'});
        }

        return;
      }

      state.isFinalizingTurn = true;
      try {
        const sttLatency = this.endVoicePhaseTimer(state, 'stt.final');
        if (typeof sttLatency === 'number') {
          this.recordVoiceBaselineMetric('stt.final.latency', sttLatency, state.sessionId, state.currentTurnId);
        }

        console.log('##########endTurn', new Date());
        console.log('##########state.currentStudentTranscript', transcript);

        state.audioBuffer = Buffer.alloc(0);

        // Lưu audio của lượt nói ngầm (Fire-and-forget) để không block AI phản hồi
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
        const wordCount = transcript.split(/\s+/).filter(Boolean).length;
        const speakSpeed = durationInSeconds > 0 ? wordCount / durationInSeconds : 0;

        state.conversationHistory.push({
          role: 'user',
          content: transcript,
          turnAudioId: turnAudioId,
          duration: durationInSeconds,
          speakSpeed: speakSpeed,
        });

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
        this.startVoicePhaseTimer(state, 'turn.e2e', state.currentTurnId);
        // console.log('#######state.conversationHistory', state.conversationHistory);
        await this.triggerOrchestratorRun(state, {source: 'stt_finalize_turn'});
      } finally {
        state.isFinalizingTurn = false;
      }
    },
  },
};
