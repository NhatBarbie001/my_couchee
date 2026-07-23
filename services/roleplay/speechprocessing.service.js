'use strict';

const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const FileMixin = require('../../mixins/file.mixin');
const BaseService = require('../../mixins/baseService.mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const path = require('path');
const fs = require('fs');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const ffmpeg = require('fluent-ffmpeg');
const wav = require('wav');
const { v4: uuidv4 } = require('uuid');
const i18next = require('i18next');
const OpenAI = require('openai');
const axios = require('axios');
// const WebSocket = require('ws');
// const {ElevenLabsClient, RealtimeEvents, AudioFormat} = require('@elevenlabs/elevenlabs-js');

let LoadedGoogleGenAIClass = null;

const storageDir = path.join(__dirname, 'storage');

const speechStreams = new Map();

module.exports = {
  name: 'roleplay.speechprocessing',
  mixins: [FunctionsCommon, FileMixin, BaseService],

  settings: {
    tts: {
      provider: 'openai',
      speed: 1.0,
    },
    stt: {
      provider: 'openai',
      language: 'vi-VN',
      model: 'whisper',
    },
    microsoft: {
      speechKey:
        process.env.AZURE_SPEECH_KEY ||
        '3kMNMe8bjqwJuV0pJGVC5nWSHidbsn6USi65hXM1AuiZuIxtACAJJQQJ99BDACqBBLyXJ3w3AAAYACOGLupz',
      serviceRegion: process.env.AZURE_SPEECH_REGION || 'southeastasia',
    },
    // elevenlabs: {
    //   apiKey: process.env.ELEVENLABS_API_KEY || 'sk_c82b95c64bace1db6037b303d7b4d7837cb33172825e3dea',
    // },
  },

  actions: {
    textToSpeech: {
      params: {
        text: 'string',
        voice: { type: 'string', optional: true },
        voiceId: { type: 'string', optional: true },
        speed: { type: 'number', optional: true },
        provider: { type: 'string', optional: true },
        format: { type: 'string', optional: true, default: 'pcm' },
        model: { type: 'string', optional: true },
        paramInstructions: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const {
          text,
          voice: paramVoice,
          voiceId: paramVoiceId,
          speed: paramSpeed,
          provider: paramProvider,
          format = 'pcm',
          model: paramModel,
          paramInstructions: paramInstructions,
          voiceData,
        } = ctx.params;
        let finalProvider = paramProvider || this.settings.tts.provider;

        if (voiceData && voiceData.apiKeyId && voiceData.apiKeyId.serviceProvider) {
          finalProvider = voiceData.apiKeyId.serviceProvider;
        }

        // console.log('#####################finalProvider', finalProvider);
        if (finalProvider === 'openai') {
          return this.openaiTTS(text, paramVoice, paramSpeed, format, paramModel, paramInstructions, voiceData);
        } else if (finalProvider === 'eleven_labs') {
          return this.elevenlabsTTS(
            text,
            paramVoice || voiceData?.configName || paramVoiceId,
            paramSpeed,
            format,
            paramModel,
            paramInstructions,
            voiceData,
          );
        } else if (finalProvider === 'microsoft') {
          return this.microsoftTTS(text, paramVoice, paramSpeed, format, voiceData);
        } else if (finalProvider === 'google_gemini') {
          if (!LoadedGoogleGenAIClass) {
            throw new MoleculerClientError(
              'Google Gemini SDK (@google/genai) is not installed or failed to load. Please check installation and server logs.',
              500,
              'MISSING_GEMINI_SDK',
            );
          }
          return this.googleGeminiTTS(text, paramVoice, paramSpeed, format, voiceData);
        } else {
          throw new MoleculerClientError(`Provider TTS không hỗ trợ: ${finalProvider}`, 400);
        }
      },
    },

    /**
     * textToSpeechStream: Trả về Node.js Readable Stream cho ElevenLabs streaming.
     * Chỉ hỗ trợ provider eleven_labs. Các provider khác sẽ fallback về textToSpeech (blocking).
     */
    textToSpeechStream: {
      params: {
        text: 'string',
        voice: {type: 'string', optional: true},
        voiceId: {type: 'string', optional: true},
        speed: {type: 'number', optional: true},
        model: {type: 'string', optional: true},
        paramInstructions: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {
          text,
          voice: paramVoice,
          speed: paramSpeed,
          model: paramModel,
          paramInstructions,
          voiceData,
        } = ctx.params;

        let finalProvider = null;
        if (voiceData && voiceData.apiKeyId && voiceData.apiKeyId.serviceProvider) {
          finalProvider = voiceData.apiKeyId.serviceProvider;
        }

        if (finalProvider !== 'eleven_labs') {
          throw new MoleculerClientError(
            `textToSpeechStream chỉ hỗ trợ ElevenLabs. Provider hiện tại: ${finalProvider}`,
            400,
            'UNSUPPORTED_STREAM_PROVIDER',
          );
        }

        return this.elevenlabsTTSStream(text, paramVoice, paramSpeed, paramModel, paramInstructions, voiceData);
      },
    },

    speechToText: {
      params: {
        audioBuffer: { type: 'any', optional: true },
        audioPath: { type: 'string', optional: true },
        language: { type: 'string', optional: true },
        provider: { type: 'string', optional: true },
        voiceId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const {
          audioBuffer,
          audioPath,
          language = this.settings.stt.language,
          provider = this.settings.stt.provider,
          voiceId,
        } = ctx.params;

        if (!audioBuffer && !audioPath) {
          throw new MoleculerClientError('Cần cung cấp audioBuffer hoặc audioPath', 400);
        }
        console.log('provider', provider);
        if (provider === 'openai') {
          return this.openaiSTT(audioBuffer, audioPath, language);
        } else if (provider === 'microsoft') {
          return this.microsoftSTT(audioBuffer, audioPath, language, voiceId);
        } else {
          throw new MoleculerClientError(`Provider STT không hỗ trợ: ${provider}`, 400);
        }
      },
    },

    analyzeSpeech: {
      params: {
        transcript: 'string',
        audioLength: 'number',
      },
      async handler(ctx) {
        const { transcript, audioLength } = ctx.params;

        try {
          const words = transcript.trim().split(/\s+/);
          const wordCount = words.length;
          const minuteLength = audioLength / 60;
          const wordsPerMinute = Math.round(wordCount / minuteLength);

          const fillerWords = ['ừm', 'ừ', 'à', 'vậy đó', 'thì là', 'kiểu như', 'kiểu', 'nói chung là'];
          const fillerWordCounts = {};
          let totalFillerWords = 0;

          fillerWords.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            const matches = transcript.match(regex);
            const count = matches ? matches.length : 0;
            if (count > 0) {
              fillerWordCounts[word] = count;
              totalFillerWords += count;
            }
          });

          const sentences = transcript.split(/[.!?]+/).filter(s => s.trim().length > 0);
          const sentenceLengths = sentences.map(s => s.trim().split(/\s+/).length);
          const avgSentenceLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;

          return {
            wordsPerMinute,
            totalWords: wordCount,
            duration: audioLength,
            fillerWords: {
              total: totalFillerWords,
              details: fillerWordCounts,
              percentage: (totalFillerWords / wordCount) * 100,
            },
            sentences: {
              count: sentences.length,
              averageLength: avgSentenceLength,
              lengthDistribution: sentenceLengths,
            },
          };
        } catch (error) {
          throw new MoleculerClientError('Không thể phân tích giọng nói', 500);
        }
      },
    },

    initializeSpeechStream: {
      params: {
        language: { type: 'string', optional: true, default: 'vi-VN' },
        sessionId: { type: 'string' },
      },
      async handler(ctx) {
        const { language, sessionId } = ctx.params;
        const streamId = uuidv4();

        try {
          const { speechKey, serviceRegion } = this.settings.microsoft;
          if (!speechKey || !serviceRegion) {
            throw new MoleculerClientError('Thiếu cấu hình Microsoft Speech SDK.', 500, 'MISSING_SPEECH_CONFIG');
          }

          const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, serviceRegion);
          speechConfig.speechRecognitionLanguage = language;

          speechConfig.outputFormat = sdk.OutputFormat.Simple;

          speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '300000'); // 5 phút
          speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '300000'); // 5 phút

          speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '2000'); // 2 giây silence để segment
          speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_RecoMode, 'CONVERSATION');

          speechConfig.setProperty(sdk.PropertyId.Speech_LogFilename, '');
          if (
            !sdk ||
            !sdk.AudioStreamFormat ||
            typeof sdk.AudioStreamFormat.getWaveFormat !== 'function' ||
            !sdk.AudioFormatTag ||
            !sdk.AudioFormatTag.PCM
          ) {
            this.logger.error('Microsoft Speech SDK AudioStreamFormat or AudioFormatTag.PCM is not available.');
            throw new MoleculerClientError(
              'Microsoft Speech SDK AudioStreamFormat or AudioFormatTag.PCM not available.',
              500,
              'SDK_STREAMFORMAT_ERROR',
            );
          }
          const audioFormat = sdk.AudioStreamFormat.getWaveFormat(16000, 16, 1, sdk.AudioFormatTag.PCM); // PCM 16kHz, 16-bit, mono
          const pushStream = sdk.AudioInputStream.createPushStream(audioFormat);

          const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
          const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

          recognizer.recognizing = (s, e) => {
            if (e.result.reason === sdk.ResultReason.RecognizingSpeech) {
              this.broker.emit('speech.stream.recognizing', {
                streamId,
                sessionId,
                text: e.result.text,
                isFinal: false,
              });
            }
          };

          recognizer.recognized = (s, e) => {
            if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
              this.broker.emit('speech.stream.recognized', {
                streamId,
                sessionId,
                text: e.result.text,
                isFinal: true,
                duration: e.result.duration,
                offset: e.result.offset,
              });
            } else if (e.result.reason === sdk.ResultReason.NoMatch) {
              this.broker.emit('speech.stream.nomatch', {
                streamId,
                sessionId,
                reason: 'No speech could be recognized.',
              });
            }
          };

          recognizer.canceled = (s, e) => {
            let reason = e.reason;
            if (reason === sdk.CancellationReason.Error) {
              this.broker.emit('speech.stream.error', {
                streamId,
                sessionId,
                errorCode: e.errorCode,
                errorDetails: e.errorDetails,
              });
            }
          };

          recognizer.sessionStarted = (s, e) => {
            console.log(`Speech stream session started: ${e.sessionId}, StreamId: ${streamId}`);
          };

          recognizer.sessionStopped = (s, e) => {
            console.log(`Speech stream session stopped: ${e.sessionId}, StreamId: ${streamId}`);
          };

          recognizer.startContinuousRecognitionAsync(
            () => {
              console.log(`Continuous recognition started for stream: ${streamId}`);
            },
            err => {
              this.logger.error(`Error starting continuous recognition for stream ${streamId}: ${err}`);
              speechStreams.delete(streamId);
              throw new MoleculerClientError(
                `Failed to start speech recognition stream: ${err}`,
                500,
                'STREAM_START_ERROR',
              );
            },
          );

          speechStreams.set(streamId, { recognizer, pushStream, sessionId });
          return { streamId, success: true };
        } catch (error) {
          if (error instanceof MoleculerClientError) throw error;
          throw new MoleculerClientError('Failed to initialize speech stream.', 500, 'STREAM_INIT_ERROR');
        }
      },
    },

    pushAudioToStream: {
      params: {
        streamId: 'string',
        audioChunk: 'any',
      },
      async handler(ctx) {
        const { streamId, audioChunk } = ctx.params;
        const streamData = speechStreams.get(streamId);

        if (!streamData) {
          throw new MoleculerClientError(`Speech stream not found: ${streamId}`, 404, 'STREAM_NOT_FOUND');
        }

        const buffer = Buffer.isBuffer(audioChunk) ? audioChunk : Buffer.from(audioChunk);

        try {
          if (streamData.pushStream && !streamData.pushStream.isClosed) {
            streamData.pushStream.write(buffer);

            if (!streamData.stats) {
              streamData.stats = { totalBytes: 0, chunkCount: 0, startTime: Date.now() };
            }
            streamData.stats.totalBytes += buffer.length;
            streamData.stats.chunkCount++;

            return { success: true, bytesWritten: buffer.length, totalBytes: streamData.stats.totalBytes };
          } else {
            return { success: false, message: 'Stream is closed' };
          }
        } catch (error) {
          throw new MoleculerClientError(
            `Failed to write audio to stream: ${error.message}`,
            500,
            'STREAM_WRITE_ERROR',
          );
        }
      },
    },

    closeSpeechStream: {
      params: {
        streamId: 'string',
      },
      async handler(ctx) {
        const { streamId } = ctx.params;
        const streamData = speechStreams.get(streamId);

        if (!streamData) {
          this.logger.warn(`Attempted to close non-existent or already closed stream: ${streamId}`);
          return { success: false, message: 'Stream not found or already closed.' };
        }

        try {
          if (streamData.stats) {
            const duration = (Date.now() - streamData.stats.startTime) / 1000;
            console.log(
              `Stream ${streamId} stats: ${streamData.stats.totalBytes} bytes, ${streamData.stats.chunkCount} chunks, ${duration.toFixed(2)}s duration`,
            );
          }

          if (streamData.pushStream && !streamData.pushStream.isClosed) {
            streamData.pushStream.close();
          }

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              this.logger.warn(`Timeout stopping recognizer for stream ${streamId}`);
              resolve();
            }, 5000);

            streamData.recognizer.stopContinuousRecognitionAsync(
              () => {
                clearTimeout(timeout);
                resolve();
              },
              error => {
                clearTimeout(timeout);
                this.logger.error(`Error in stopContinuousRecognitionAsync for stream ${streamId}:`, error);
                resolve();
              },
            );
          });
        } catch (error) {
          this.logger.error(`Error stopping recognizer for stream ${streamId}:`, error);
        } finally {
          speechStreams.delete(streamId); // Xóa khỏi map
        }
        return { success: true };
      },
    },
  },

  methods: {
    ensureStorageDir() {
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
    },

    async getSpeechConfigFromVoiceId(voiceId) {
      if (!voiceId) {
        const settings = await this.broker.call('settings.findOne');
        const { speechKey, serviceRegion } = settings;
        return { speechKey, serviceRegion, configName: null };
      }
      try {
        const aiVoice = await this.broker.call('aivoice.get', {
          id: voiceId,
        });

        if (!aiVoice || aiVoice.isDeleted) {
          throw new Error(`AI Voice với ID ${voiceId} không tồn tại`);
        }

        if (!aiVoice.apiKeyId) {
          throw new Error(`AI Voice ${aiVoice.displayName} chưa được cấu hình apiKeyId`);
        }

        const apiKeyId = aiVoice.apiKeyId._id || aiVoice.apiKeyId;
        const apiKeyData = await this.broker.call('apikeys.getOne', {
          id: apiKeyId.toString(),
        });

        if (!apiKeyData.apiKey || !apiKeyData.serviceRegion) {
          throw new Error(`API Key cho voice ${aiVoice.displayName} thiếu speechKey hoặc serviceRegion`);
        }

        const result = {
          speechKey: apiKeyData.apiKey,
          serviceRegion: apiKeyData.serviceRegion,
          serviceProvider: apiKeyData.serviceProvider,
          configName: aiVoice.configName,
          displayName: aiVoice.displayName,
        };
        return result;
      } catch (error) {
        this.logger.error('Lỗi khi lấy speech config từ voiceId:', error);
        const { speechKey, serviceRegion } = await this.broker.call('settings.findOne');
        return { speechKey, serviceRegion, configName: null };
      }
    },

    async openaiTTS(text, pVoice, pSpeed, pFormat, pModel, pInstructions, voiceData = {}) {
      try {
        const apiKey = voiceData.apiKeyId?.apiKey;
        const configName = voiceData.configName;
        if (!apiKey) {
          throw new MoleculerClientError(
            i18next.t(
              'tts.missingOpenAIKey',
              'OpenAI API key is not configured. Please set OPENAI_API_KEY in environment or settings.',
            ),
            500,
            'MISSING_OPENAI_KEY',
          );
        }

        const openai = new OpenAI({ apiKey });

        const model = pModel || 'gpt-4o-mini-tts';
        const voice = configName || 'alloy';
        const speed = pSpeed || 1.25;
        const format = pFormat || 'pcm';

        const requestPayload = {
          model: model,
          input: text,
          voice: voice,
          response_format: format,
          speed: speed,
        };

        if (pInstructions) {
          requestPayload.instructions = pInstructions;
        }

        const response = await openai.audio.speech.create(requestPayload);

        const audioArrayBuffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(audioArrayBuffer);
        return { audio: audioBuffer, sampleRate: 24000 };
      } catch (error) {
        this.logger.error('Lỗi khi gọi OpenAI TTS trực tiếp:', error.message);
        let errorMessage = i18next.t('tts.openaiError', 'Không thể tạo giọng nói từ OpenAI.');
        let statusCode = 500;
        let errorCode = 'OPENAI_TTS_ERROR';

        if (error instanceof OpenAI.APIError) {
          statusCode = error.status || 500;
          errorMessage = `OpenAI API Error (${statusCode}): ${error.message || 'Unknown API Error'}`;
          if (error.code) {
            errorCode = `OPENAI_API_${String(error.code).toUpperCase()}`;
          }
          if (error.error && error.error.message) {
            this.logger.error(`OpenAI API detailed error: ${error.error.message}`, error.error);
            errorMessage = `OpenAI API Error (${statusCode}): ${error.error.message}`;
          } else if (error.message) {
            // errorMessage đã được gán từ error.message rồi
          }
        } else if (error.response) {
          statusCode = error.response.status;
          if (error.response.data && error.response.data.error && error.response.data.error.message) {
            errorMessage = `OpenAI API Error (${statusCode}): ${error.response.data.error.message}`;
          } else {
            errorMessage = `OpenAI API Error (${statusCode}): ${error.response.statusText || 'Unknown API response error'}`;
          }
        } else if (error.message) {
          errorMessage = error.message;
        }
        this.logger.error(
          `Detailed OpenAI Error: Status ${statusCode}, Message: "${errorMessage}", Code: ${errorCode}`,
          { originalErrorStack: error.stack },
        );
        throw new MoleculerClientError(errorMessage, statusCode, errorCode, { originalErrorMessage: error.message });
      }
    },

    async microsoftTTS(text, voice, speed, format, voiceData = {}) {
      try {
        const speechKey = voiceData.apiKeyId?.apiKey;
        const serviceRegion = voiceData.apiKeyId?.serviceRegion;
        const configName = voiceData.configName;
        if (!speechKey || !serviceRegion) {
          throw new Error('Thiếu cấu hình Microsoft Speech SDK');
        }

        const voiceName = configName || voice;
        console.log('voiceName', voiceName);
        return new Promise((resolve, reject) => {
          const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, serviceRegion);
          speechConfig.speechSynthesisVoiceName = voiceName || 'vi-VN-HoaiMyNeural';

          const outputFilePath = path.join(storageDir, `tts_${Date.now()}.wav`);
          const audioConfig = sdk.AudioConfig.fromAudioFileOutput(outputFilePath);
          const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

          synthesizer.speakTextAsync(
            text,
            result => {
              synthesizer.close();
              if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                if (format.toLowerCase() === 'mp3') {
                  const mp3Path = outputFilePath.replace('.wav', '.mp3');
                  ffmpeg(outputFilePath)
                    .toFormat('mp3')
                    .on('end', () => {
                      const buffer = fs.readFileSync(mp3Path);
                      fs.unlinkSync(outputFilePath);
                      fs.unlinkSync(mp3Path);
                      resolve(buffer);
                    })
                    .on('error', err => reject(err))
                    .save(mp3Path);
                } else if (format.toLowerCase() === 'pcm') {
                  const buffer = fs.readFileSync(outputFilePath);
                  fs.unlinkSync(outputFilePath);
                  const pcmData = buffer.slice(44);
                  resolve({ audio: pcmData, sampleRate: 16000 });
                } else {
                  const buffer = fs.readFileSync(outputFilePath);
                  fs.unlinkSync(outputFilePath);
                  resolve(buffer);
                }
              } else {
                reject(new Error(`Lỗi tổng hợp giọng nói: ${result.reason}`));
              }
            },
            error => {
              synthesizer.close();
              reject(error);
            },
          );
        });
      } catch (error) {
        this.logger.error('Lỗi khi sử dụng Microsoft TTS:', error);
        throw new MoleculerClientError('Không thể tạo giọng nói từ Microsoft', 500);
      }
    },

    async googleGeminiTTS(text, voice, speed, format, voiceData = {}) {
      this.ensureStorageDir(); // Đảm bảo thư mục storage tồn tại
      try {
        const geminiApiKey = voiceData.apiKeyId?.apiKey;
        const geminiTtsModel = 'gemini-2.5-flash-preview-tts';
        const geminiDefaultVoice = voiceData.configName || 'Zephyr';

        if (!geminiApiKey) {
          throw new Error('Thiếu cấu hình Gemini API Key trong settings.');
        }

        if (!LoadedGoogleGenAIClass) {
          throw new MoleculerClientError(
            'Google Gemini SDK (@google/genai) is not available or not loaded. Please check installation and server logs.',
            500,
            'GEMINI_SDK_UNAVAILABLE',
          );
        }

        const client = new LoadedGoogleGenAIClass({ apiKey: geminiApiKey });

        const supportedVoices = [
          'Zephyr',
          'Puck',
          'Charon',
          'Kore',
          'Fenrir',
          'Leda',
          'Orus',
          'Aoede',
          'Callirhoe',
          'Autonoe',
          'Enceladus',
          'Iapetus',
          'Umbriel',
          'Algieba',
          'Despina',
          'Erinome',
          'Algenib',
          'Rasalgethi',
          'Laomedeia',
          'Achernar',
          'Alnilam',
          'Schedar',
          'Gacrux',
          'Pulcherrima',
          'Achird',
          'Zubenelgenubi',
          'Vindemiatrix',
          'Sadachbia',
          'Sadaltager',
          'Sulafar',
        ];

        const finalVoice = voice || geminiDefaultVoice;
        const selectedVoice = supportedVoices.includes(finalVoice) ? finalVoice : geminiDefaultVoice;

        const streamResponse = await client.models.generateContentStream({
          model: geminiTtsModel,
          contents: [{ parts: [{ text: text }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          ],
        });

        const pcmChunks = [];
        for await (const chunk of streamResponse) {
          const inlineData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (inlineData?.data) {
            pcmChunks.push(Buffer.from(inlineData.data, 'base64'));
          }
        }

        const pcmBuffer = Buffer.concat(pcmChunks);
        console.log(`Gemini TTS: Đã thu thập ${pcmChunks.length} chunks, tổng ${pcmBuffer.length} bytes PCM data`);

        if (format.toLowerCase() === 'pcm') {
          return { audio: pcmBuffer, sampleRate: 24000 };
        } else if (format.toLowerCase() === 'mp3') {
          return new Promise((resolve, reject) => {
            const tempPcmPath = path.join(storageDir, `gemini_pcm_${Date.now()}.raw`);
            const tempMp3Path = path.join(storageDir, `gemini_mp3_${Date.now()}.mp3`);

            try {
              fs.writeFileSync(tempPcmPath, pcmBuffer);

              ffmpeg(tempPcmPath)
                .inputFormat('s16le')
                .audioChannels(1)
                .audioFrequency(24000)
                .toFormat('mp3')
                .on('end', () => {
                  try {
                    const mp3Buffer = fs.readFileSync(tempMp3Path);
                    if (fs.existsSync(tempPcmPath)) fs.unlinkSync(tempPcmPath);
                    if (fs.existsSync(tempMp3Path)) fs.unlinkSync(tempMp3Path);
                    console.log(`Gemini TTS: Đã chuyển đổi thành công sang MP3, size: ${mp3Buffer.length} bytes`);
                    resolve(mp3Buffer);
                  } catch (err) {
                    this.logger.error('Lỗi khi đọc file MP3:', err);
                    reject(err);
                  }
                })
                .on('error', err => {
                  this.logger.error('Lỗi khi chuyển đổi PCM sang MP3 cho Gemini:', err);
                  if (fs.existsSync(tempPcmPath)) fs.unlinkSync(tempPcmPath);
                  if (fs.existsSync(tempMp3Path)) fs.unlinkSync(tempMp3Path);
                  reject(err);
                })
                .save(tempMp3Path);
            } catch (err) {
              this.logger.error('Lỗi khi lưu file PCM tạm:', err);
              reject(err);
            }
          });
        } else {
          return new Promise((resolve, reject) => {
            const tempWavPath = path.join(storageDir, `gemini_wav_${Date.now()}.wav`);
            const fileStream = fs.createWriteStream(tempWavPath);
            const wavWriter = new wav.Writer({ sampleRate: 24000, channels: 1, bitDepth: 16, sampleWidth: 2 });

            wavWriter.pipe(fileStream);
            wavWriter.write(pcmBuffer);
            wavWriter.end();

            fileStream.on('finish', () => {
              try {
                const wavBuffer = fs.readFileSync(tempWavPath);
                // Xóa file tạm
                if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath);
                console.log(`Gemini TTS: Đã tạo WAV buffer thành công, size: ${wavBuffer.length} bytes`);
                resolve(wavBuffer);
              } catch (err) {
                this.logger.error('Lỗi khi đọc file WAV:', err);
                reject(err);
              }
            });

            fileStream.on('error', error => {
              this.logger.error('Lỗi khi ghi WAV file:', error);
              if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath);
              reject(error);
            });
          });
        }
      } catch (error) {
        this.logger.error('Lỗi khi sử dụng Google Gemini TTS:', error);
        if (error instanceof MoleculerClientError) throw error;
        if (error.message && (error.message.includes('API Key') || error.message.includes('permission denied'))) {
          throw new MoleculerClientError(
            'Lỗi cấu hình hoặc xác thực Google Gemini: ' + error.message,
            500,
            'GEMINI_AUTH_ERROR',
            { originalError: error.message },
          );
        }
        throw new MoleculerClientError('Không thể tạo giọng nói từ Google Gemini.', 500, 'GEMINI_TTS_ERROR', {
          originalError: error.message,
        });
      }
    },

    async elevenlabsTTS(text, pVoice, pSpeed, pFormat, pModel, pInstructions, voiceData = {}) {
      try {
        const apiKey = voiceData.apiKeyId?.apiKey;
        const configVoiceId = voiceData.configName; // voiceId ElevenLabs
        if (!apiKey) {
          throw new MoleculerClientError('ElevenLabs API key chưa cấu hình', 500, 'MISSING_ELEVENLABS_KEY');
        }

        const mongoLikeVoiceIdRegex = /^[a-f0-9]{24}$/i;
        let voiceId = pVoice || configVoiceId;
        if (voiceId && configVoiceId && mongoLikeVoiceIdRegex.test(String(voiceId))) {
          voiceId = configVoiceId;
        }
        console.log('voiceId', voiceId);
        if (!voiceId) {
          throw new MoleculerClientError('Thiếu voiceId ElevenLabs', 400, 'MISSING_VOICE_ID');
        }

        const model = pModel || voiceData.modelId || 'eleven_v3';
        const format = pFormat || 'mp3';
        const speed = pSpeed || 1.0;

        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_24000`;

        const payload = {
          text,
          model_id: model,
          voice_settings: {
            stability: 1,
            similarity_boost: 0.80,
            style: 0.05,
            use_speaker_boost: true,
            speed: speed,
          },
        };

        const response = await axios.post(url, payload, {
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            // Accept: 'audio/mpeg',
          },
          responseType: 'arraybuffer',
        });

        const audioBuffer = Buffer.from(response.data);

        return {
          audio: audioBuffer,
          sampleRate: 24000,
          format: 'pcm',
        };
      } catch (error) {
        let statusCode = 500;
        let errorMessage = 'Không thể tạo giọng nói từ ElevenLabs';
        let errorCode = 'ELEVENLABS_TTS_ERROR';
        let errorDetails = null;

        if (error.response) {
          statusCode = error.response.status;

          const rawData = error.response.data;
          if (Buffer.isBuffer(rawData)) {
            const rawText = rawData.toString('utf8');
            try {
              errorDetails = JSON.parse(rawText);
            } catch (_parseErr) {
              errorDetails = {raw: rawText};
            }
          } else if (typeof rawData === 'string') {
            try {
              errorDetails = JSON.parse(rawData);
            } catch (_parseErr) {
              errorDetails = {raw: rawData};
            }
          } else if (rawData && typeof rawData === 'object') {
            errorDetails = rawData;
          }

          errorMessage =
            errorDetails?.detail?.message ||
            errorDetails?.detail ||
            errorDetails?.message ||
            error.response.statusText ||
            errorMessage;
        } else if (error.message) {
          errorMessage = error.message;
        }

        this?.logger?.error?.('ElevenLabs TTS request failed', {
          statusCode,
          errorMessage,
          voiceId: pVoice || voiceData.configName,
          model: pModel || voiceData.modelId || 'eleven_flash_v2_5',
          details: errorDetails,
          stack: error.stack,
        });

        throw new MoleculerClientError(errorMessage, statusCode, errorCode, {
          originalErrorMessage: error.message,
          details: errorDetails,
        });
      }
    },

    /**
     * ElevenLabs TTS Streaming — Trả về Node.js Readable stream (PCM 24kHz S16LE).
     * Dùng endpoint /stream với responseType: 'stream' thay vì 'arraybuffer'.
     */
    async elevenlabsTTSStream(text, pVoice, pSpeed, pModel, pInstructions, voiceData = {}) {
      const apiKey = voiceData.apiKeyId?.apiKey;
      const configVoiceId = voiceData.configName;

      if (!apiKey) {
        throw new MoleculerClientError('ElevenLabs API key chưa cấu hình', 500, 'MISSING_ELEVENLABS_KEY');
      }

      const voiceId = pVoice || configVoiceId;
      if (!voiceId) {
        throw new MoleculerClientError('Thiếu voiceId ElevenLabs', 400, 'MISSING_VOICE_ID');
      }

      // Dùng eleven_flash_v2_5 cho latency thấp nhất khi streaming
      const model = pModel || 'eleven_flash_v2_5';
      const speed = pSpeed || 1.0;

      // Endpoint /stream trả về chunked transfer encoding
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=pcm_24000&optimize_streaming_latency=3`;

      const payload = {
        text,
        model_id: model,
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.80,
          style: 0.05,
          use_speaker_boost: true,
          speed: speed,
        },
      };

      if (pInstructions) {
        payload.text = `${pInstructions}\n${text}`;
      }

      this.logger.info(`[ElevenLabs Stream] Starting stream TTS for voiceId=${voiceId}, model=${model}`);

      try {
        const response = await axios.post(url, payload, {
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          responseType: 'stream', // KEY: stream thay vì arraybuffer
        });

        this.logger.info('[ElevenLabs Stream] Stream connection established, receiving chunks...');
        return response.data; // Node.js Readable Stream
      } catch (error) {
        let statusCode = 500;
        let errorMessage = 'ElevenLabs stream TTS error';
        let errorCode = 'ELEVENLABS_STREAM_TTS_ERROR';

        if (error.response) {
          statusCode = error.response.status;
          // Khi responseType là 'stream', error.response.data là stream, cần đọc
          try {
            const chunks = [];
            for await (const chunk of error.response.data) {
              chunks.push(chunk);
            }
            const body = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(body);
            errorMessage = parsed.detail?.message || parsed.detail || errorMessage;
          } catch (_) {
            errorMessage = `ElevenLabs HTTP ${statusCode}`;
          }
        } else if (error.message) {
          errorMessage = error.message;
        }

        this.logger.error(`[ElevenLabs Stream] Error: ${statusCode} - ${errorMessage}`);
        throw new MoleculerClientError(errorMessage, statusCode, errorCode, {
          originalErrorMessage: error.message,
        });
      }
    },

    async openaiSTT(audioBuffer, audioPath, language) {
      let finalAudioPath = audioPath;
      let tempFileCreated = false;
      try {
        console.log(
          `openaiSTT: Bắt đầu xử lý. Language: ${language}. audioPath: ${audioPath}, audioBuffer exists: ${!!audioBuffer}`,
        );

        if (audioBuffer && !finalAudioPath) {
          const tempFileName = `stt_openai_${uuidv4()}.wav`;
          finalAudioPath = path.join(storageDir, tempFileName);
          console.log(`openaiSTT: Tạo file tạm từ buffer: ${finalAudioPath}`);

          fs.writeFileSync(finalAudioPath, audioBuffer);
          tempFileCreated = true;
        }

        if (!finalAudioPath) {
          this.logger.error('openaiSTT: Không có đường dẫn âm thanh hợp lệ.');
          throw new MoleculerClientError('Không có đường dẫn âm thanh hợp lệ để xử lý.', 400);
        }

        console.log(`openaiSTT: Gọi whisper.transcriptAudio với audioPath: ${finalAudioPath}`);
        const result = await this.broker.call('whisper.transcriptAudio', {
          audioPath: finalAudioPath,
        });
        console.log('openaiSTT: Kết quả từ whisper.transcriptAudio:', result);

        if (tempFileCreated && fs.existsSync(finalAudioPath)) {
          console.log(`openaiSTT: Xóa file tạm: ${finalAudioPath}`);
          fs.unlinkSync(finalAudioPath);
        }

        if (result && typeof result.text === 'string') {
          return {
            text: result.text,
            language: language,
          };
        } else if (result && result.error) {
          this.logger.error(`openaiSTT: Lỗi từ whisper.transcriptAudio (có cấu trúc error): ${result.error}`);
          throw new MoleculerClientError(`Lỗi từ Whisper service: ${result.error}`, 500);
        } else if (result && result.message && result.stack) {
          throw new MoleculerClientError(`Lỗi Exception từ Whisper service: ${result.message}`, 500);
        } else {
          throw new MoleculerClientError(
            'Không thể nhận dạng giọng nói, kết quả không hợp lệ hoặc lỗi không xác định từ Whisper.',
            500,
          );
        }
      } catch (error) {
        if (tempFileCreated && finalAudioPath && fs.existsSync(finalAudioPath)) {
          console.log(`openaiSTT: Dọn dẹp file tạm ${finalAudioPath} do lỗi.`);
          fs.unlinkSync(finalAudioPath);
        }
        if (error instanceof MoleculerClientError) throw error;
        throw new MoleculerClientError(
          `Lỗi xử lý Speech-to-Text với OpenAI: ${error.message}`,
          500,
          'STT_PROCESSING_ERROR',
          { originalError: error.message },
        );
      }
    },

    async microsoftSTT(audioBuffer, audioPath, language, voiceId = null) {
      try {
        const { speechKey, serviceRegion } = await this.getSpeechConfigFromVoiceId(voiceId);

        if (!speechKey || !serviceRegion) {
          throw new Error('Thiếu cấu hình Microsoft Speech SDK');
        }

        return new Promise((resolve, reject) => {
          const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, serviceRegion);
          speechConfig.speechRecognitionLanguage = language || 'vi-VN';

          let audioConfig;
          let tempFilePath;

          if (audioBuffer) {
            tempFilePath = path.join(storageDir, `stt_${Date.now()}.wav`);
            fs.writeFileSync(tempFilePath, audioBuffer);
            audioConfig = sdk.AudioConfig.fromWavFileInput(tempFilePath);
          } else if (audioPath) {
            audioConfig = sdk.AudioConfig.fromWavFileInput(audioPath);
          } else {
            return reject(new Error('Cần cung cấp audioBuffer hoặc audioPath'));
          }

          const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

          recognizer.recognizeOnceAsync(
            result => {
              recognizer.close();

              if (tempFilePath) {
                fs.unlinkSync(tempFilePath);
              }

              if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                resolve({
                  text: result.text,
                  language: language,
                });
              } else {
                reject(new Error(`Lỗi nhận dạng giọng nói: ${result.reason}`));
              }
            },
            error => {
              recognizer.close();
              if (tempFilePath) {
                fs.unlinkSync(tempFilePath);
              }
              reject(error);
            },
          );
        });
      } catch (error) {
        this.logger.error('Lỗi khi sử dụng Microsoft STT:', error);
        throw new MoleculerClientError('Không thể nhận dạng giọng nói bằng Microsoft', 500);
      }
    },

    async saveAudioChunksToFile(audioChunks, sessionId) {
      return new Promise((resolve, reject) => {
        try {
          const fileName = `roleplay_${sessionId}_${Date.now()}.wav`;
          const filePath = path.join(storageDir, fileName);

          // Tạo file WAV
          const fileStream = fs.createWriteStream(filePath);
          const wavWriter = new wav.Writer({
            sampleRate: 16000,
            channels: 1,
            bitDepth: 16,
          });

          wavWriter.pipe(fileStream);

          // Ghi các chunk vào file
          audioChunks.forEach(chunk => {
            wavWriter.write(Buffer.from(chunk));
          });

          wavWriter.end();

          // Khi ghi xong
          fileStream.on('finish', () => {
            resolve(filePath);
          });

          fileStream.on('error', error => {
            reject(error);
          });
        } catch (error) {
          reject(error);
        }
      });
    },

    async transcribeWithTimestamps(audioPath, language) {
      try {
        // Gọi Whisper API với yêu cầu dấu thời gian
        const result = await this.broker.call('whisper.segmentTranscript', {
          audioPath,
          language,
        });

        return {
          text: result.text,
          segments: result.segments,
          duration: result.duration,
          language: result.language || language,
        };
      } catch (error) {
        this.logger.error('Lỗi khi phiên mã với dấu thời gian:', error);
        throw error;
      }
    },
  },

  async created() {
    try {
      const genaiModule = await import('@google/genai');
      if (genaiModule && genaiModule.GoogleGenAI) {
        LoadedGoogleGenAIClass = genaiModule.GoogleGenAI;
        console.log('Successfully dynamically imported @google/genai. GoogleGenAI class is loaded.');
      } else {
        this.logger.warn('@google/genai loaded, but GoogleGenAI class not found within the module.');
        LoadedGoogleGenAIClass = null;
      }
    } catch (e) {
      this.logger.warn(
        `Failed to dynamically import @google/genai. Google Gemini TTS provider will not be available. Error: ${e.message}`,
      );
      LoadedGoogleGenAIClass = null;
    }
  },

  async started() {
    this.ensureStorageDir();
    if (!LoadedGoogleGenAIClass) {
      this.logger.warn('@google/genai was not loaded. Google Gemini TTS provider is non-functional.');
    }
  },

  async stopped() { },
};
