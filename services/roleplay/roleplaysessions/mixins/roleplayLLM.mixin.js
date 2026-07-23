'use strict';

const axios = require('axios');
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const {stripAudioTags, appendAudioTagInstructions} = require('../../utils/audioTagUtils');

const AUDIO_CONFIGS = {
  openai: { sampleRate: 24000, channels: 1, bitDepth: 16 },
  microsoft: { sampleRate: 16000, channels: 1, bitDepth: 16 },
  google_gemini: { sampleRate: 24000, channels: 1, bitDepth: 16 },
  default: { sampleRate: 24000, channels: 1, bitDepth: 16 },
};

const LEGACY_LLM_RUNTIME_GUARD_LOG =
  '[roleplayLLMMixin] Legacy LLM runtime path skipped because VOICE_LLM_V2_ENABLED=true';

module.exports = {
  name: 'roleplayLLMMixin',
  methods: {
    /**
     * Legacy runtime guard:
     * - Checkpoint 5+ uses roleplay.orchestrator + roleplay.llm service path.
     * - Methods in this mixin are retained for fallback path only.
     */
    shouldUseLegacyLLMRuntimePath(state) {
      return !this.isVoiceFlagEnabled('VOICE_LLM_V2_ENABLED', true, state);
    },

    getAudioConfig(provider) {
      if (provider && AUDIO_CONFIGS[provider]) {
        return AUDIO_CONFIGS[provider];
      }
      return AUDIO_CONFIGS.default;
    },
    async timeout(delay) {
      return new Promise(res => setTimeout(res, delay));
    },
    async synthesizeTTSWithDualPath(state, text) {
      const payload = {
        text,
        stream: true,
        voiceId: state.persona?.voiceId?._id?.toString(),
        voiceData: state.persona?.voiceId,
        paramInstructions: state.persona?.conversationStyle,
        format: 'pcm',
      };

      if (this.isVoiceFlagEnabled('VOICE_TTS_V2_ENABLED', false, state)) {
        return this.broker.call('roleplay.tts.synthesize', {
          sessionId: state.sessionId,
          text,
          meta: {
            voiceId: payload.voiceId,
            voiceData: payload.voiceData,
            paramInstructions: payload.paramInstructions,
            format: payload.format,
          },
        });
      }

      return this.broker.call('roleplay.speechprocessing.textToSpeech', payload);
    },

    async processSingleSentenceToSpeech(state, sentence, socket) {
      const ttsId = `ttsSentence_${state.sessionId}_${Date.now()}`;
      let ttfbEnded = false;
      try {
        if (!sentence || !sentence.trim()) return null;

        this.startVoicePhaseTimer(state, 'tts.ttfb', ttsId);

        const ttsResult = await this.synthesizeTTSWithDualPath(state, sentence);

        let audioBuff = ttsResult;
        let sampleRate = 0;

        if (ttsResult && !Buffer.isBuffer(ttsResult) && ttsResult.audio) {
          audioBuff = ttsResult.audio;
          sampleRate = ttsResult.sampleRate;
          if (audioBuff && audioBuff.type === 'Buffer' && Array.isArray(audioBuff.data)) {
            audioBuff = Buffer.from(audioBuff.data);
          }
        }

        if (audioBuff && audioBuff.length > 0) {
          const ttfbLatency = this.endVoicePhaseTimer(state, 'tts.ttfb', ttsId);
          ttfbEnded = true;
          if (typeof ttfbLatency === 'number') {
            this.recordVoiceBaselineMetric('tts.ttfb.latency', ttfbLatency, state.sessionId, ttsId);
          }

          const ref = { value: false };

          let providerConfig = null;
          if (sampleRate) {
            providerConfig = { sampleRate: sampleRate, channels: 1, bitDepth: 16 };
          } else {
            const provider = state.voiceProvider || state.persona?.provider || 'default';
            providerConfig = this.getAudioConfig(provider);
          }

          // Emit text response đúng lúc audio sẵn sàng phát để đồng bộ text và audio
          socket.emit('server:ai_text_response', {
            sessionId: state.sessionId,
            text: stripAudioTags(sentence.trim()),
            role: 'assistant',
            isFinal: true,
            turnId: ttsId,
          });

          await this.streamAudioWithRateControl(state, audioBuff, socket, ttsId, ref, providerConfig);
          return audioBuff;
        }
        return null;
      } catch (err) {
        this.logger.error(`Lỗi TTS cho câu '${sentence}' trong session ${state.sessionId}:`, err);
        socket.emit('server:error', { sessionId: state.sessionId, message: `Lỗi TTS: ${sentence}` });
        return null;
      } finally {
        if (!ttfbEnded) {
          this.endVoicePhaseTimer(state, 'tts.ttfb', ttsId);
        }
      }
    },

    calculateAudioChunkDelay(chunkSize, audioFormat) {
      const { sampleRate = 16000, channels = 1, bitDepth = 16 } = audioFormat;
      const bytesPerSample = bitDepth / 8;
      const samplesInChunk = chunkSize / (channels * bytesPerSample);
      const durationMs = (samplesInChunk / sampleRate) * 1000;
      return Math.max(durationMs * 0.7, 30);
    },

    async streamAudioWithRateControl(
      state,
      audioBuffer,
      socket,
      turnId,
      wasInterruptedRef,
      audioConfigOrProvider = null,
    ) {
      const chunkSize = 2048;

      let audioFormat;
      if (typeof audioConfigOrProvider === 'object' && audioConfigOrProvider !== null) {
        audioFormat = audioConfigOrProvider;
      } else {
        audioFormat = this.getAudioConfig(audioConfigOrProvider);
      }

      let offset = 0;
      let chunkIndex = 0;

      while (offset < audioBuffer.length) {
        if (state.isAiInterruptedByStudent) {
          if (wasInterruptedRef && typeof wasInterruptedRef === 'object') wasInterruptedRef.value = true;
          this.markInterruptAttempt(state);
          this.markInterruptSuccess(state);
          console.log(`[${turnId}] AI bị ngắt lời tại chunk ${chunkIndex}`);
          socket.emit('server:ai_speech_interrupted', {
            sessionId: state.sessionId,
            turnId,
            bytesSent: offset,
            totalBytes: audioBuffer.length,
          });
          break;
        }
        const end = Math.min(offset + chunkSize, audioBuffer.length);
        const audioChunkData = audioBuffer.slice(offset, end);
        const isLast = end >= audioBuffer.length;
        socket.emit('server:ai_speech_chunk', {
          sessionId: state.sessionId,
          audioChunk: audioChunkData,
          chunkIndex,
          offset,
          totalSize: audioBuffer.length,
          isLast,
          turnId,
          sampleRate: audioFormat.sampleRate,
        });
        offset = end;
        chunkIndex++;
        if (!isLast) {
          const delay = this.calculateAudioChunkDelay(chunkSize, audioFormat);
          await this.timeout(delay);

          // Kiểm tra cả isAiInterruptedByStudent và isStudentSpeaking
          if (state.isAiInterruptedByStudent || state.isStudentSpeaking) {
            if (wasInterruptedRef && typeof wasInterruptedRef === 'object') wasInterruptedRef.value = true;
            this.markInterruptAttempt(state);
            this.markInterruptSuccess(state);
            socket.emit('server:ai_speech_interrupted', {
              sessionId: state.sessionId,
              turnId,
              bytesSent: offset,
              totalBytes: audioBuffer.length,
              reason: state.isStudentSpeaking ? 'student_speaking' : 'interrupted',
            });
            this.logger.info(
              `[${state.sessionId}] AI speech interrupted: ${state.isStudentSpeaking ? 'student speaking' : 'interrupted'}`,
            );
            break;
          }
        }
      }
      if (!state.isAiInterruptedByStudent) {
        this.logger.info(`[${turnId}] Hoàn thành stream audio: ${offset} bytes, ${chunkIndex} chunks`);
      }
    },

    async processLLMAndResponse(state, socket) {
      // ===== LEGACY PATH (fallback) =====
      // Kept for rollback/fallback when VOICE_LLM_V2_ENABLED=false.
      // Primary path for checkpoint 5+: roleplay.orchestrator -> roleplay.llm -> roleplay.tts.
      if (!this.shouldUseLegacyLLMRuntimePath(state)) {
        this.logger.warn(LEGACY_LLM_RUNTIME_GUARD_LOG, {
          sessionId: state?.sessionId,
          turnId: state?.currentTurnId,
        });
        return;
      }

      const llmId = `llmStreamAll_${state.sessionId}_${Date.now()}`;
      console.time(llmId);
      let fullText = '';
      let didStartResponding = false; // Track whether this invocation owns the AI responding state

      try {
        if (state.isStudentSpeaking) {
          this.logger.warn(`[${state.sessionId}] Skipping AI response - student is still speaking`, new Date());
          return;
        }

        if (state.isAiResponding) {
          this.logger.warn(`[${state.sessionId}] Skipping AI response - AI is already responding`, new Date());
          return;
        }

        if (state.isAiInterruptedByStudent) {
          this.logger.warn(`[${state.sessionId}] Skipping AI response - AI was interrupted by student`, new Date());
          return;
        }

        didStartResponding = true;
        state.isAiResponding = true;
        state.currentAiTurnAudioChunks = [];
        const messages = state.conversationHistory;
        // console.log('################################################### Coach messages',messages);
        const llmResponseId = `llmResponse_${state.sessionId}_${Date.now()}`;
        socket.emit('server:ai_processing_started', { sessionId: state.sessionId });

        const apiKey = state.persona?.llmModelId?.apiKeyId?.apiKey;
        const model = state.persona?.llmModelId?.gptModel;
        const modelInterface = state.persona?.llmModelId?.apiKeyId?.modelInterface || 'AzureOpenAI';
        const endpoint = state.persona?.llmModelId?.apiKeyId?.endpoint;
        const maxTokenParrams = model.includes('gpt-5.4') ? {max_completion_tokens: 300} : {max_tokens: 300};

        const ttsModel = state.persona?.voiceId?.modelId;
        const useAudioTags = this._isElevenLabsProvider(state) && (ttsModel === 'eleven_v3' || !ttsModel);
        let llmMessages = messages;
        if (useAudioTags) {
          const sysIdx = messages.findIndex(m => m.role === 'system');
          llmMessages = messages.map((m, i) =>
            i === sysIdx ? {...m, content: appendAudioTagInstructions(m.content || '')} : m,
          );
          if (sysIdx < 0) {
            llmMessages = [{role: 'system', content: appendAudioTagInstructions('')}, ...messages];
          }
        }

        this.startVoicePhaseTimer(state, 'llm.first_token', llmId);
        const text = await this.broker.call(
          modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
          {
            messages: llmMessages,
            model: model || 'gpt-4.1',
            temperature: 1,
            ...maxTokenParrams,
            responseId: llmResponseId,
            apiKey,
            endpoint,
          },
        );
        const llmFirstTokenLatency = this.endVoicePhaseTimer(state, 'llm.first_token', llmId);
        if (typeof llmFirstTokenLatency === 'number') {
          this.recordVoiceBaselineMetric('llm.first_token.latency', llmFirstTokenLatency, state.sessionId, llmId);
        }
        if (state.isAiInterruptedByStudent || state.isStudentSpeaking) {
          this.logger.warn(
            `[${state.sessionId}] Skipping AI response after delay check - student started speaking`,
            new Date(),
          );
          return;
        }
        const responseText = typeof text === 'string' ? text : text ? JSON.stringify(text) : '';
        let delta = responseText || '';
        console.log('################################################### delta0000',delta);
        // Detect marker [END_CONVERSATION] trong response của AI
        const endConversationMarker = '[END_CONVERSATION]';
        if (delta.includes(endConversationMarker)) {
          this.logger.info(`[${state.sessionId}] AI initiated end conversation via marker`);
          state.aiInitiatedEnd = true;
          // Strip marker khỏi text để không hiển thị/TTS
          delta = delta.replace(endConversationMarker, '').trim();
        }
        console.log('################################################### delta1111',delta);
        if (delta) {
          fullText = delta;
          socket.emit('server:ai_text_chunk_response', {
            sessionId: state.sessionId,
            textChunk: stripAudioTags(delta), // audio tags stripped — only for voice synthesis
            role: 'assistant',
            turnId: llmId,
          });
        }
        await this.processTTS(state, socket, llmId, fullText);
      } catch (err) {
        this.endVoicePhaseTimer(state, 'llm.first_token', llmId);
        console.error(`Lỗi LLM trong session ${state.sessionId}:`, err);
        socket.emit('server:error', { sessionId: state.sessionId, message: 'Lỗi xử lý phản hồi AI.' });
      } finally {
        // CHỈ cleanup nếu invocation này là owner của state (đã set isAiResponding = true)
        // Nếu không, invocation bị skip bởi guard → KHÔNG được phá hủy state của instance đang chạy
        if (didStartResponding) {
          state.isAiResponding = false;
          state.isAiInterruptedByStudent = false; // Reset để student có thể trigger turn tiếp theo
          state.currentAiTurnAudioChunks = [];
          // NOTE: server:ai_tts_completed đã được emit bởi processTTS(), không emit lại ở đây
          // NOTE: server:ai_end_conversation cũng được emit bởi processTTS() ngay SAU ai_tts_completed
        }
        console.timeEnd(llmId);
      }
    },

    /**
     * Kiểm tra xem provider hiện tại có phải ElevenLabs không
     */
    _isElevenLabsProvider(state) {
      const provider =
        state.persona?.voiceId?.apiKeyId?.serviceProvider ||
        state.voiceProvider ||
        state.persona?.provider;
      return provider === 'eleven_labs';
    },

    /**
     * ElevenLabs streaming TTS path: gọi HTTP stream trực tiếp (bypass broker.call),
     * đọc chunks → emit về FE ngay.
     * Trả về {wasInterrupted, totalBytes} để caller xử lý tiếp.
     */
    async _processElevenLabsStreamTTS(state, socket, llmId, fullText) {
      const streamTtsId = `elevenLabsStreamTTS_${state.sessionId}_${Date.now()}`;
      console.time(streamTtsId);
      let wasInterrupted = false;
      let totalBytes = 0;
      let chunkIndex = 0;
      let firstChunkReceived = false;
      let leftoverByte = null; // Đệm cho lẻ byte

      try {
        // Lấy thông tin voice trực tiếp từ state (không cần qua broker.call)
        const voiceData = state.persona?.voiceId;
        const apiKey = voiceData?.apiKeyId?.apiKey;
        const voiceId = voiceData?.configName;

        if (!apiKey) {
          throw new Error('ElevenLabs API key chưa cấu hình');
        }
        if (!voiceId) {
          throw new Error('Thiếu voiceId ElevenLabs');
        }

        // Lấy model từ thiết lập hoặc dùng mặc định giống luồng cũ (eleven_v3)
        const model = voiceData?.modelId || 'eleven_v3';
        const speed = 1.0;

        let inputText = fullText.trim();

        const elevenlabs = new ElevenLabsClient({
          apiKey: apiKey,
        });

        this.logger.info(`[ElevenLabs Stream] Starting: voiceId=${voiceId}, model=${model}, session=${state.sessionId}`);
        console.time('elevenLabsStreamTTS start call');
        this.startVoicePhaseTimer(state, 'tts.ttfb', llmId);
        // Sử dụng ElevenLabsClient thay cho axios
        const audioStream = await elevenlabs.textToSpeech.stream(voiceId, {
          modelId: model,
          text: inputText,
          outputFormat: 'pcm_24000',
          voiceSettings: {
            stability: 1,
            similarityBoost: 0.80,
            style: 0.05,
            useSpeakerBoost: true,
            speed: speed,
          },
        });

        socket.emit('server:ai_text_response', {
          sessionId: state.sessionId,
          text: stripAudioTags(fullText.trim()), // audio tags stripped — only for voice synthesis
          role: 'assistant',
          isFinal: true,
          turnId: llmId,
        });

        // Đọc từng chunk từ ElevenLabs SDK stream
        for await (const chunk of audioStream) {
          if (!firstChunkReceived) {
            firstChunkReceived = true;
            console.log(`[ElevenLabs Stream] First chunk received for session ${state.sessionId}`);
            console.timeEnd('elevenLabsStreamTTS start call');
            const ttfbLatency = this.endVoicePhaseTimer(state, 'tts.ttfb', llmId);
            if (typeof ttfbLatency === 'number') {
              this.recordVoiceBaselineMetric('tts.ttfb.latency', ttfbLatency, state.sessionId, llmId);
            }
          }

          // Kiểm tra barge-in trước khi emit mỗi chunk
          if (state.isAiInterruptedByStudent || state.isStudentSpeaking) {
            console.log(
              `[ElevenLabs Stream] Interrupted at chunk ${chunkIndex}, ${totalBytes} bytes sent`,
            );
            wasInterrupted = true;
            this.markInterruptAttempt(state);
            this.markInterruptSuccess(state);
            audioStream.destroy();
            socket.emit('server:ai_speech_interrupted', {
              sessionId: state.sessionId,
              turnId: llmId,
              bytesSent: totalBytes,
              reason: state.isStudentSpeaking ? 'student_speaking' : 'interrupted',
            });
            break;
          }

          let audioChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

          // Nối byte thừa từ chunk trước (nếu có)
          if (leftoverByte !== null) {
            audioChunk = Buffer.concat([Buffer.from([leftoverByte]), audioChunk]);
            leftoverByte = null;
          }

          // Kiểm tra chẵn/lẻ để tránh lỗi ở FE (Int16Array cần chẵn byte)
          if (audioChunk.length % 2 !== 0) {
            leftoverByte = audioChunk[audioChunk.length - 1]; // Giữ lại byte cuối
            audioChunk = audioChunk.slice(0, audioChunk.length - 1); // Cắt bỏ byte cuối
          }

          if (audioChunk.length === 0) continue; // Nếu chunk ban đầu chỉ có 1 byte và giờ bị giữ lại

          state.currentAiTurnAudioChunks.push(audioChunk);
          totalBytes += audioChunk.length;

          socket.emit('server:ai_speech_chunk', {
            sessionId: state.sessionId,
            audioChunk: audioChunk,
            chunkIndex,
            totalSize: -1,
            isLast: false,
            turnId: llmId,
            sampleRate: 24000,
          });

          chunkIndex++;
        }

        // Nếu không bị interrupt, gửi marker chunk cuối
        if (!wasInterrupted) {
          // Xử lý nốt byte thừa nếu stream kết thúc mà vẫn còn 1 byte lẻ (rất hiếm khi xảy ra với định dạng PCM 16-bit)
          if (leftoverByte !== null) {
            const finalChunk = Buffer.from([leftoverByte, 0]); // Thêm 1 byte 0 để tròn 16-bit padding
            state.currentAiTurnAudioChunks.push(finalChunk);
            totalBytes += 2;
            socket.emit('server:ai_speech_chunk', {
              sessionId: state.sessionId,
              audioChunk: finalChunk,
              chunkIndex,
              totalSize: -1,
              isLast: false,
              turnId: llmId,
              sampleRate: 24000,
            });
            chunkIndex++;
          }

          if (chunkIndex > 0) {
            socket.emit('server:ai_speech_chunk', {
              sessionId: state.sessionId,
              audioChunk: Buffer.alloc(2), // FE bỏ qua chunk length === 0, dùng 2 bytes silence để trigger onended
              chunkIndex,
              totalSize: totalBytes,
              isLast: true,
              turnId: llmId,
              sampleRate: 24000,
            });
          }

          this.logger.info(
            `[ElevenLabs Stream] Completed: ${chunkIndex} chunks, ${totalBytes} bytes for session ${state.sessionId}`,
          );
        }
      } catch (err) {
        console.log(err);
        this.logger.error(`[ElevenLabs Stream] Error in session ${state.sessionId}:`, err.message || err);
        throw err;
      } finally {
        this.endVoicePhaseTimer(state, 'tts.ttfb', llmId);
        console.timeEnd(streamTtsId);
      }

      return { wasInterrupted, totalBytes };
    },

    async processTTS(state, socket, llmId, fullText) {
      const ttsId = `tts_${state.sessionId}_${Date.now()}`;
      console.time(ttsId);
      let wasInterrupted = false;
      state.currentAiTurnAudioChunks = [];

      try {
        if (state.isAiInterruptedByStudent || state.isStudentSpeaking) {
          wasInterrupted = true;
          return;
        }

        if (fullText.trim()) {
          socket.emit('server:ai_tts_started', { sessionId: state.sessionId });

          if (state.isAiInterruptedByStudent || state.isStudentSpeaking) {
            wasInterrupted = true;
            return;
          }

          // ===== ElevenLabs Streaming Path =====
          if (this._isElevenLabsProvider(state)) {
            this.logger.info(`[${state.sessionId}] Using ElevenLabs streaming TTS path`);
            try {
              const result = await this._processElevenLabsStreamTTS(state, socket, llmId, fullText);
              wasInterrupted = result.wasInterrupted;
            } catch (streamErr) {
              // Fallback: nếu streaming lỗi, dùng path blocking cũ
              this.logger.warn(
                `[${state.sessionId}] ElevenLabs stream failed, falling back to blocking TTS: ${streamErr.message}`,
              );
              state.currentAiTurnAudioChunks = [];
              wasInterrupted = await this._processBlockingTTS(state, socket, llmId, fullText);
            }
          } else {
            // ===== Blocking Path (OpenAI, Microsoft, Google Gemini) =====
            wasInterrupted = await this._processBlockingTTS(state, socket, llmId, fullText);
          }
        }

        // Lưu audio và cập nhật conversation history
        let turnAudioId = null;
        let turnDuration = 0;
        if (!wasInterrupted && state.currentAiTurnAudioChunks.length > 0) {
          const info = await this.saveAiTurnAudio(state, [...state.currentAiTurnAudioChunks]);
          if (info && info.fileId) {
            turnAudioId = info.fileId;
            turnDuration = info.duration || 0;
          }
        }
        if (!wasInterrupted) {
          const cleanText = stripAudioTags(fullText.trim());
          state.conversationHistory.push({
            role: 'assistant',
            content: cleanText, // audio tags stripped so next LLM turn has clean context
            turnAudioId,
            duration: turnDuration,
            speakSpeed: turnDuration > 0 ? cleanText.split(/\s+/).length / turnDuration : 0,
          });
          socket.emit('server:ai_response_completed', {
            sessionId: state.sessionId,
            fullText: cleanText,
            turnAudioId,
            duration: turnDuration,
          });
        }
      } catch (err) {
        this.logger.error(`Lỗi TTS trong session ${state.sessionId}:`, err);
        socket.emit('server:error', { sessionId: state.sessionId, message: 'Lỗi xử lý phản hồi TTS.' });
      } finally {
        socket.emit('server:ai_tts_completed', { sessionId: state.sessionId });

        const e2eLatency = this.endVoicePhaseTimer(state, 'turn.e2e', state.currentTurnId || llmId);
        if (typeof e2eLatency === 'number') {
          this.recordVoiceBaselineMetric('turn.e2e.latency', e2eLatency, state.sessionId, state.currentTurnId || llmId, {
            interrupted: wasInterrupted,
          });
        }

        // Emit ai_end_conversation ngay SAU ai_tts_completed để client nhận đúng thứ tự
        if (state.aiInitiatedEnd) {
          this.logger.info(`[${state.sessionId}] Emitting server:ai_end_conversation after TTS completed`);
          socket.emit('server:ai_end_conversation', {
            sessionId: state.sessionId,
            reason: 'conversation_complete',
            summary: fullText,
            timestamp: new Date(),
          });
          state.aiInitiatedEnd = false; // Reset flag
        }

        console.timeEnd(ttsId);
      }
    },

    /**
     * Blocking TTS path — logic cũ cho OpenAI, Microsoft, Google Gemini, và ElevenLabs fallback.
     * Trả về wasInterrupted (boolean).
     */
    async _processBlockingTTS(state, socket, llmId, fullText) {
      let wasInterrupted = false;
      const ttsAudioBuffId = `ttsAudioBuff_${state.sessionId}_${Date.now()}`;
      this.startVoicePhaseTimer(state, 'tts.ttfb', llmId);

      try {
        const ttsResult = await this.synthesizeTTSWithDualPath(state, fullText.trim());

        let audioBuff = ttsResult;
        let sampleRate = 0;

        if (ttsResult && !Buffer.isBuffer(ttsResult) && ttsResult.audio) {
          audioBuff = ttsResult.audio;
          sampleRate = ttsResult.sampleRate;
          if (audioBuff && audioBuff.type === 'Buffer' && Array.isArray(audioBuff.data)) {
            audioBuff = Buffer.from(audioBuff.data);
          }
        }

        if (state.isAiInterruptedByStudent || state.isStudentSpeaking) {
          return true; // wasInterrupted = true để caller không push incomplete message vào history
        }

        if (audioBuff && audioBuff.length > 0) {
          state.currentAiTurnAudioChunks.push(audioBuff);
          socket.emit('server:ai_text_response', {
            sessionId: state.sessionId,
            text: stripAudioTags(fullText.trim()), // audio tags stripped — only for voice synthesis
            role: 'assistant',
            isFinal: true,
            turnId: llmId,
          });
          const ref = { value: false };

          let providerConfig = null;
          if (sampleRate) {
            providerConfig = { sampleRate: sampleRate, channels: 1, bitDepth: 16 };
          } else {
            const provider = state.voiceProvider || state.persona?.provider || 'default';
            providerConfig = this.getAudioConfig(provider);
          }

          await this.streamAudioWithRateControl(state, audioBuff, socket, llmId, ref, providerConfig);
          wasInterrupted = ref.value;
        }

        return wasInterrupted;
      } finally {
        console.timeEnd(ttsAudioBuffId);
        const ttfbLatency = this.endVoicePhaseTimer(state, 'tts.ttfb', llmId);
        if (typeof ttfbLatency === 'number') {
          this.recordVoiceBaselineMetric('tts.ttfb.latency', ttfbLatency, state.sessionId, llmId);
        }
      }
    },
  },
};
