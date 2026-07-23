'use strict';

const {MoleculerClientError} = require('moleculer').Errors;
const {createLLMProvider, normalizeProviderName} = require('./llm');
const {stripAudioTags, appendAudioTagInstructions, isElevenLabsV3} = require('./utils/audioTagUtils');

const END_CONVERSATION_MARKER = '[END_CONVERSATION]';
const LLM_END_MARKER_DETECTED_CODE = 'LLM_END_MARKER_DETECTED';

function buildModelConfig(meta = {}) {
  const modelInterfaceRaw = meta.modelInterface || process.env.VOICE_LLM_MODEL_INTERFACE || 'azureopenai';
  const modelInterface = normalizeProviderName(modelInterfaceRaw);

  return {
    providerName: modelInterface,
    modelConfig: {
      model: meta.model,
      temperature: typeof meta.temperature === 'number' ? meta.temperature : undefined,
      maxTokens: Number(meta.maxTokens || process.env.VOICE_LLM_MAX_TOKENS || 300),
      apiKey: meta.apiKey,
      endpoint: meta.endpoint,
    },
  };
}

module.exports = {
  name: 'roleplay.llm',

  actions: {
    generate: {
      params: {
        sessionId: {type: 'string'},
        transcript: {type: 'string', optional: true},
        history: {type: 'array', optional: true},
        turnId: {type: 'string', optional: true},
        runId: {type: 'string', optional: true},
        meta: {type: 'object', optional: true},
      },
      async handler(ctx) {
        const {
          sessionId,
          transcript = '',
          history = [],
          turnId = `turn_${Date.now()}`,
          runId = null,
          meta = {},
        } = ctx.params;
        const activeRunId = runId || meta.runId || null;

        const timerKey = `voice:llm.first_token:${sessionId}:${turnId}`;
        const sourceHistory = Array.isArray(history) ? history : [];
        const messages = [...sourceHistory];
        if (transcript && String(transcript).trim()) {
          messages.push({
            role: 'user',
            content: String(transcript).trim(),
          });
        }

        const {providerName, modelConfig} = buildModelConfig(meta);
        const provider = createLLMProvider({
          broker: this.broker,
          logger: this.logger,
          providerName,
          config: modelConfig,
        });

        const useAudioTags = isElevenLabsV3(meta.ttsMeta || {});
        const systemPrompt = useAudioTags ? appendAudioTagInstructions(meta.system || '') : meta.system || '';
        this.logger.info('[roleplay.llm] generate.start', {
          sessionId,
          turnId,
          providerName,
          useAudioTags,
        });

        let fullResponse = '';
        let sentenceBuffer = '';
        let firstTokenLogged = false;
        let sentenceIndex = 0;
        let aiInitiatedEnd = false;
        let markerScanBuffer = '';
        const sentenceDispatchQueue = Promise.resolve();
        let queueTail = sentenceDispatchQueue;
        let queueError = null;

        const ensureRunActive = async () => {
          if (!activeRunId) return;
          const state = await this.broker
            .call('roleplay.orchestrator.isRunActive', {
              sessionId,
              runId: activeRunId,
            })
            .catch(() => ({active: true}));

          if (!state || state.active === false) {
            const abortedError = new Error('LLM generation cancelled by orchestrator');
            abortedError.code = 'LLM_ABORTED';
            throw abortedError;
          }
        };

        const enqueueSentenceForSpeech = (sentence, currentIndex) => {
          if (!sentence || queueError) return;
          queueTail = queueTail
            .then(async () => {
              if (queueError) return null;

              await ensureRunActive();

              const ttsResult = await this.broker.call('roleplay.tts.synthesize', {
                sessionId,
                text: sentence,
                meta: meta.ttsMeta || {},
              });

              await ensureRunActive();

              return this.broker.call('roleplaysessions.pushTTSAudioFromLLM', {
                sessionId,
                sentence: stripAudioTags(sentence),
                turnId,
                sentenceIndex: currentIndex,
                runId: activeRunId,
                audio: ttsResult?.audio || ttsResult,
                sampleRate: ttsResult?.sampleRate || 0,
              });
            })
            .catch(error => {
              if (!queueError) {
                queueError = error;
              }
              return null;
            });
        };

        const appendChunkToResponse = chunk => {
          if (!chunk) return;

          fullResponse += chunk;
          sentenceBuffer += chunk;

          if (/[.?!…]\s*$/.test(sentenceBuffer)) {
            const sentence = sentenceBuffer.trim();
            sentenceBuffer = '';

            if (sentence) {
              const currentIndex = sentenceIndex;
              sentenceIndex += 1;
              enqueueSentenceForSpeech(sentence, currentIndex);
            }
          }
        };

        console.time(timerKey);

        try {
          await ensureRunActive();

          try {
            await provider.streamTokens(
              {
                messages,
                system: systemPrompt,
                modelConfig,
              },
              async token => {
                const normalizedToken = typeof token === 'string' ? token : token ? String(token) : '';
                if (!normalizedToken) return;

                markerScanBuffer += normalizedToken;

                const markerIndex = markerScanBuffer.indexOf(END_CONVERSATION_MARKER);
                if (markerIndex >= 0) {
                  aiInitiatedEnd = true;

                  const beforeMarker = markerScanBuffer.slice(0, markerIndex);
                  if (beforeMarker) {
                    appendChunkToResponse(beforeMarker);
                  }

                  markerScanBuffer = '';

                  const markerStopError = new Error('LLM stream stopped at end-of-conversation marker');
                  markerStopError.code = LLM_END_MARKER_DETECTED_CODE;
                  throw markerStopError;
                }

                const markerReserveLength = END_CONVERSATION_MARKER.length - 1;
                if (markerScanBuffer.length > markerReserveLength) {
                  const safeChunkLength = markerScanBuffer.length - markerReserveLength;
                  const safeChunk = markerScanBuffer.slice(0, safeChunkLength);
                  markerScanBuffer = markerScanBuffer.slice(safeChunkLength);
                  appendChunkToResponse(safeChunk);
                }
              },
              {
                onFirstToken: () => {
                  if (!firstTokenLogged) {
                    console.timeEnd(timerKey);
                    firstTokenLogged = true;
                  }
                },
              },
            );
          } catch (streamError) {
            if (streamError?.code !== LLM_END_MARKER_DETECTED_CODE) {
              throw streamError;
            }
          }

          if (markerScanBuffer) {
            appendChunkToResponse(markerScanBuffer);
            markerScanBuffer = '';
          }

          const trailingSentence = sentenceBuffer.trim();
          if (trailingSentence) {
            const currentIndex = sentenceIndex;
            sentenceIndex += 1;

            enqueueSentenceForSpeech(trailingSentence, currentIndex);
          }

          await queueTail;

          if (queueError) {
            throw queueError;
          }
          console.log('fullResponse', fullResponse);
          const sanitizedResponse = fullResponse.split(END_CONVERSATION_MARKER).join('').trim();

          const updatedHistory = [...messages];
          if (sanitizedResponse) {
            updatedHistory.push({
              role: 'assistant',
              content: stripAudioTags(sanitizedResponse),
            });
          }

          return {
            response: stripAudioTags(sanitizedResponse),
            updatedHistory,
            sentencesDispatched: sentenceIndex,
            provider: providerName,
            aiInitiatedEnd,
          };
        } catch (error) {
          if (!firstTokenLogged) {
            console.timeEnd(timerKey);
            firstTokenLogged = true;
          }

          this.logger.error('[roleplay.llm] generate.failed', {
            sessionId,
            turnId,
            providerName,
            error: error?.message,
          });

          if (error?.code === 'LLM_ABORTED') {
            throw new MoleculerClientError('LLM generation cancelled', 499, 'LLM_GENERATION_CANCELLED');
          }

          throw new MoleculerClientError(error?.message || 'LLM generation failed', 500, 'LLM_GENERATION_FAILED');
        }
      },
    },
  },
};
