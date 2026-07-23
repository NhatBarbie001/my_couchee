'use strict';

let LoadedGoogleGenAIClass = null;
let LoadedModalityEnum = null;

module.exports = {
  name: 'roleplayGeminiLiveMixin',

  created: async function () {
    try {
      const genaiModule = await import('@google/genai');
      if (genaiModule && genaiModule.GoogleGenAI) {
        LoadedGoogleGenAIClass = genaiModule.GoogleGenAI;
        LoadedModalityEnum = genaiModule.Modality;
        this.logger.info('Successfully dynamically imported @google/genai for Gemini Live.');
      } else {
        LoadedGoogleGenAIClass = null;
        LoadedModalityEnum = null;
        this.logger.warn('@google/genai loaded, but GoogleGenAI or Modality not found within the module.');
      }
    } catch (e) {
      LoadedGoogleGenAIClass = null;
      LoadedModalityEnum = null;
      this.logger.warn(`Failed to dynamically import @google/genai for Gemini Live. Error: ${e.message}`);
    }
  },

  methods: {
    isGeminiLiveVoiceChatEnabled(state) {
      const provider = state?.persona?.voiceProvider;
      return provider === 'google_gemini_live';
    },

    async _getGeminiLiveApiKey(state) {
      if (state && state.llmApiKey && state.llmApiKey.apiKey) {
        return state.llmApiKey.apiKey;
      }
      const settings = await this.broker.call('settings.findOne');
      return settings?.googleApiKey;
    },

    async _buildGeminiLiveSystemInstruction(state) {
      const messages = await this.generateConversationPrompt(state);
      if (!messages || !Array.isArray(messages) || messages.length === 0) return '';
      return messages
        .filter(m => m && typeof m.content === 'string' && m.content.trim())
        .map(m => `${m.role}: ${m.content.trim()}`)
        .join('\n');
    },

    async ensureGeminiLiveSession(state, socket) {
      if (state.geminiLive && state.geminiLive.session) return state.geminiLive.session;

      if (!LoadedGoogleGenAIClass || !LoadedModalityEnum) {
        throw new Error('Gemini Live SDK is not available.');
      }

      const apiKey = await this._getGeminiLiveApiKey(state);
      if (!apiKey) {
        throw new Error('Missing Google API Key for Gemini Live.');
      }

      const systemInstructionText = await this._buildGeminiLiveSystemInstruction(state);

      const ai = new LoadedGoogleGenAIClass({
        apiKey,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      const model = 'gemini-2.5-flash-native-audio-preview-12-2025';

      if (!state.geminiLive) {
        state.geminiLive = {};
      }

      state.geminiLive.userAudioBuffers = [];
      state.geminiLive.aiAudioBuffers = [];
      state.geminiLive.silenceCount = 0;
      state.geminiLive.aiChunkIndex = 0;
      state.geminiLive.aiByteOffset = 0;
      state.geminiLive.aiTtsStarted = false;
      state.geminiLive.aiProcessingStarted = false;
      state.geminiLive.turnId = `geminiLive_${state.sessionId}_${Date.now()}`;
      state.geminiLive.currentUserTranscript = '';
      state.geminiLive.currentAiTranscript = '';

      const session = await ai.live.connect({
        model,
        config: {
          responseModalities: [LoadedModalityEnum.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
          systemInstruction: systemInstructionText
            ? {
                parts: [{ text: systemInstructionText }],
              }
            : undefined,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            this.logger.info(`[${state.sessionId}] Gemini Live connected.`);
          },
          onmessage: msg => {
            try {
              this._handleGeminiLiveServerMessage(state, socket, msg);
            } catch (e) {
              this.logger.error(`[${state.sessionId}] Gemini Live message handling error: ${e.message}`);
            }
          },
          onerror: err => {
            this.logger.error(`[${state.sessionId}] Gemini Live error:`, err);
            if (socket) {
              socket.emit('server:error', {
                sessionId: state.sessionId,
                message: 'Lỗi kết nối Gemini Live.',
              });
            }
          },
          onclose: e => {
            this.logger.info(`[${state.sessionId}] Gemini Live closed: ${e?.reason || 'unknown'}`);
            if (state.geminiLive) {
              state.geminiLive.session = null;
            }
          },
        },
      });

      state.geminiLive.session = session;
      state.voiceProvider = 'google_gemini';
      return session;
    },

    _handleGeminiLiveServerMessage(state, socket, msg) {
      if (!state || !state.geminiLive) return;

      if (msg?.serverContent?.inputTranscription?.text) {
        const userText = msg.serverContent.inputTranscription.text;
        // Emit student_speech_started lần đầu khi Gemini Live nhận diện user đang nói
        if (!state.geminiLive._studentSpeechStartedEmitted) {
          state.geminiLive._studentSpeechStartedEmitted = true;
          if (socket) {
            socket.emit('server:student_speech_started', {
              sessionId: state.sessionId,
            });
          }
        }
        state.geminiLive.currentUserTranscript = userText;
        if (socket) {
          socket.emit('server:student_text_response', {
            sessionId: state.sessionId,
            text: userText,
            role: 'user',
            isFinal: false,
          });
        }
      }

      if (msg?.serverContent?.modelTurn?.parts) {
        if (socket && !state.geminiLive.aiProcessingStarted) {
          state.geminiLive.aiProcessingStarted = true;
          socket.emit('server:ai_processing_started', { sessionId: state.sessionId });
        }
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part?.inlineData?.data) {
            const audioChunk = Buffer.from(part.inlineData.data, 'base64');
            state.geminiLive.aiAudioBuffers.push(audioChunk);
            if (Array.isArray(state.allAiAudioChunksForSession)) {
              state.allAiAudioChunksForSession.push(audioChunk);
            }

            if (socket) {
              if (!state.geminiLive.aiTtsStarted) {
                state.geminiLive.aiTtsStarted = true;
                socket.emit('server:ai_tts_started', { sessionId: state.sessionId });
              }

              socket.emit('server:ai_speech_chunk', {
                sessionId: state.sessionId,
                audioChunk,
                chunkIndex: state.geminiLive.aiChunkIndex,
                offset: state.geminiLive.aiByteOffset,
                totalSize: state.geminiLive.aiByteOffset + audioChunk.length,
                isLast: false,
                turnId: state.geminiLive.turnId,
                sampleRate: 24000,
              });
            }

            state.geminiLive.aiByteOffset += audioChunk.length;
            state.geminiLive.aiChunkIndex += 1;
          }
        }
      }

      if (msg?.serverContent?.outputTranscription?.text) {
        const aiText = msg.serverContent.outputTranscription.text;
        state.geminiLive.currentAiTranscript = aiText;
        if (socket) {
          if (!state.geminiLive.aiProcessingStarted) {
            state.geminiLive.aiProcessingStarted = true;
            socket.emit('server:ai_processing_started', { sessionId: state.sessionId });
          }
          socket.emit('server:ai_text_chunk_response', {
            sessionId: state.sessionId,
            textChunk: aiText,
            role: 'assistant',
            turnId: state.geminiLive.turnId,
          });
        }
      }

      if (msg?.serverContent?.turnComplete) {
        if (socket) {
          socket.emit('server:ai_speech_chunk', {
            sessionId: state.sessionId,
            audioChunk: Buffer.alloc(0),
            chunkIndex: state.geminiLive.aiChunkIndex,
            offset: state.geminiLive.aiByteOffset,
            totalSize: state.geminiLive.aiByteOffset,
            isLast: true,
            turnId: state.geminiLive.turnId,
            sampleRate: 24000,
          });
        }

        this._finalizeGeminiLiveTurn(state, socket).catch(err => {
          this.logger.error(`[${state.sessionId}] finalizeGeminiLiveTurn error: ${err.message}`);
        });
      }
    },

    async _finalizeGeminiLiveTurn(state, socket) {
      if (!state || !state.geminiLive) return;

      const userText = (state.geminiLive.currentUserTranscript || '').trim();
      let aiText = (state.geminiLive.currentAiTranscript || '').trim();

      // Detect marker [END_CONVERSATION] trong AI transcript
      const endConversationMarker = '[END_CONVERSATION]';
      let aiInitiatedEnd = false;
      if (aiText.includes(endConversationMarker)) {
        this.logger.info(`[${state.sessionId}] Gemini Live AI initiated end conversation via marker`);
        aiInitiatedEnd = true;
        aiText = aiText.replace(endConversationMarker, '').trim();
      }

      let studentTurnAudioId = null;
      let studentTurnDuration = 0;
      if (state.geminiLive.userAudioBuffers && state.geminiLive.userAudioBuffers.length > 0) {
        try {
          const info = await this.saveStudentTurnAudio(state, state.geminiLive.userAudioBuffers);
          studentTurnAudioId = info?.fileId || null;
          studentTurnDuration = info?.duration || 0;
        } catch (e) {
          this.logger.error(`[${state.sessionId}] saveStudentTurnAudio error:`, e);
        }
      }

      if (userText) {
        const wordCount = userText.split(/\s+/).filter(Boolean).length;
        const speakSpeed = studentTurnDuration > 0 ? wordCount / studentTurnDuration : 0;
        state.conversationHistory.push({
          role: 'user',
          content: userText,
          turnAudioId: studentTurnAudioId,
          duration: studentTurnDuration,
          speakSpeed,
        });

        if (socket) {
          socket.emit('server:student_text_response', {
            sessionId: state.sessionId,
            text: userText,
            role: 'user',
            isFinal: true,
            turnAudioId: studentTurnAudioId,
          });
        }
      }

      let aiTurnAudioId = null;
      let aiTurnDuration = 0;
      if (state.geminiLive.aiAudioBuffers && state.geminiLive.aiAudioBuffers.length > 0) {
        try {
          const info = await this.saveAiTurnAudio(state, state.geminiLive.aiAudioBuffers);
          aiTurnAudioId = info?.fileId || null;
          aiTurnDuration = info?.duration || 0;
        } catch (e) {
          this.logger.error(`[${state.sessionId}] saveAiTurnAudio error:`, e);
        }
      }

      if (aiText) {
        const wordCount = aiText.split(/\s+/).filter(Boolean).length;
        const speakSpeed = aiTurnDuration > 0 ? wordCount / aiTurnDuration : 0;
        state.conversationHistory.push({
          role: 'assistant',
          content: aiText,
          turnAudioId: aiTurnAudioId,
          duration: aiTurnDuration,
          speakSpeed,
        });

        if (socket) {
          socket.emit('server:ai_text_response', {
            sessionId: state.sessionId,
            text: aiText,
            role: 'assistant',
            isFinal: true,
            turnId: state.geminiLive.turnId,
          });
          socket.emit('server:ai_response_completed', {
            sessionId: state.sessionId,
            fullText: aiText,
            turnAudioId: aiTurnAudioId,
            duration: aiTurnDuration,
          });
        }
      }

      if (socket && state.geminiLive.aiTtsStarted) {
        socket.emit('server:ai_tts_completed', { sessionId: state.sessionId });
      }

      // Emit ai_end_conversation SAU khi TTS hoàn tất
      if (aiInitiatedEnd && socket) {
        this.logger.info(`[${state.sessionId}] Emitting server:ai_end_conversation from Gemini Live`);
        socket.emit('server:ai_end_conversation', {
          sessionId: state.sessionId,
          reason: 'conversation_complete',
          summary: aiText,
          timestamp: new Date(),
        });
      }

      state.geminiLive.userAudioBuffers = [];
      state.geminiLive.aiAudioBuffers = [];
      state.geminiLive.silenceCount = 0;
      state.geminiLive.aiChunkIndex = 0;
      state.geminiLive.aiByteOffset = 0;
      state.geminiLive.aiTtsStarted = false;
      state.geminiLive.aiProcessingStarted = false;
      state.geminiLive.turnId = `geminiLive_${state.sessionId}_${Date.now()}`;
      state.geminiLive.currentUserTranscript = '';
      state.geminiLive.currentAiTranscript = '';
      state.geminiLive._studentSpeechStartedEmitted = false;
    },

    async _handleStudentAudioChunkGeminiLive(state, audioChunk, format, socket) {
      if (!state || !state.isSessionActive) return;

      if (format) {
        state.clientAudioFormat = {
          sampleRate: format.sampleRate || state.clientAudioFormat.sampleRate,
          channels: format.channels || state.clientAudioFormat.channels,
          bitDepth: format.bitsPerSample || state.clientAudioFormat.bitDepth,
        };
      }

      const session = await this.ensureGeminiLiveSession(state, socket);

      const bufferChunk = Buffer.isBuffer(audioChunk) ? audioChunk : Buffer.from(audioChunk);
      if (Array.isArray(state.allAudioChunksForSession)) {
        state.allAudioChunksForSession.push(bufferChunk);
      }

      if (!state.geminiLive.userAudioBuffers) {
        state.geminiLive.userAudioBuffers = [];
      }

      const int16Data = new Int16Array(bufferChunk.buffer, bufferChunk.byteOffset, bufferChunk.length / 2);
      let sum = 0;
      for (let i = 0; i < int16Data.length; i++) {
        const sample = int16Data[i] / 32768.0;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / (int16Data.length || 1));

      if (rms > 0.01) {
        state.geminiLive.silenceCount = 0;
        state.geminiLive.userAudioBuffers.push(bufferChunk);
      } else if (state.geminiLive.userAudioBuffers.length > 0 && state.geminiLive.silenceCount < 10) {
        state.geminiLive.userAudioBuffers.push(bufferChunk);
        state.geminiLive.silenceCount++;
      }

      session.sendRealtimeInput({
        audio: {
          data: bufferChunk.toString('base64'),
          mimeType: `audio/pcm;rate=${state.clientAudioFormat.sampleRate || 16000}`,
        },
      });
    },

    closeGeminiLiveSession(state) {
      if (!state || !state.geminiLive || !state.geminiLive.session) return;
      try {
        state.geminiLive.session.close();
      } catch (e) {
        this.logger.warn(`[${state.sessionId}] Error closing Gemini Live session: ${e.message}`);
      } finally {
        state.geminiLive.session = null;
      }
    },
  },
};
