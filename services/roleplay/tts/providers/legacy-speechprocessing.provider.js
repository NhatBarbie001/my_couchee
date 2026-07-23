'use strict';

const BaseTTSProvider = require('./base.provider');

class LegacySpeechprocessingProvider extends BaseTTSProvider {
  async synthesize(payload = {}) {
    const {text, meta = {}} = payload;

    return this.broker.call('roleplay.speechprocessing.textToSpeech', {
      text,
      stream: true,
      voiceId: meta.voiceId,
      voiceData: meta.voiceData,
      paramInstructions: meta.paramInstructions,
      format: meta.format || 'pcm',
    });
  }
}

module.exports = LegacySpeechprocessingProvider;
