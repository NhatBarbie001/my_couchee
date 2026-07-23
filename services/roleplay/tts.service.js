'use strict';

const {MoleculerClientError} = require('moleculer').Errors;
const {createTTSProvider} = require('./tts');

function normalizeAudioResult(ttsResult) {
  let audio = ttsResult;
  let sampleRate = 0;

  if (ttsResult && !Buffer.isBuffer(ttsResult) && ttsResult.audio) {
    audio = ttsResult.audio;
    sampleRate = ttsResult.sampleRate || 0;
    if (audio && audio.type === 'Buffer' && Array.isArray(audio.data)) {
      audio = Buffer.from(audio.data);
    }
  }

  return {
    audio,
    sampleRate,
  };
}

module.exports = {
  name: 'roleplay.tts',

  settings: {
    timeoutMs: Number(process.env.VOICE_TTS_TIMEOUT_MS || 15000),
    retryCount: Number(process.env.VOICE_TTS_RETRY_COUNT || 1),
    retryDelayMs: Number(process.env.VOICE_TTS_RETRY_DELAY_MS || 250),
  },

  actions: {
    synthesize: {
      params: {
        sessionId: {type: 'string'},
        text: {type: 'string', min: 1},
        meta: {type: 'object', optional: true},
      },
      async handler(ctx) {
        const {sessionId, text, meta = {}} = ctx.params;
        console.log('text', text);
        let finalProvider = meta.provider || 'openai';

        if (meta.voiceData && meta.voiceData.apiKeyId && meta.voiceData.apiKeyId.serviceProvider) {
          finalProvider = meta.voiceData.apiKeyId.serviceProvider;
        }

        const provider = createTTSProvider({
          broker: this.broker,
          logger: this.logger,
          finalProvider,
        });

        let attempt = 0;
        let lastError = null;

        while (attempt <= this.settings.retryCount) {
          try {
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('TTS provider timeout')), this.settings.timeoutMs);
            });

            const providerPromise = provider.synthesize({
              text,
              sessionId,
              meta,
            });

            const rawResult = await Promise.race([providerPromise, timeoutPromise]);
            const normalized = normalizeAudioResult(rawResult);

            return {
              ...normalized,
              provider: finalProvider,
            };
          } catch (err) {
            lastError = err;
            attempt += 1;
            if (attempt <= this.settings.retryCount) {
              await new Promise(resolve => setTimeout(resolve, this.settings.retryDelayMs));
            }
          }
        }

        this.logger.error('[roleplay.tts] synthesize failed', {
          sessionId,
          provider: finalProvider,
          error: lastError?.message,
        });

        throw new MoleculerClientError(lastError?.message || 'TTS synthesis failed', 500, 'TTS_SYNTHESIS_FAILED');
      },
    },
  },
};
