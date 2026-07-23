'use strict';

const BaseTTSProvider = require('./base.provider');

class OpenAITTSProvider extends BaseTTSProvider {
  async synthesize(payload = {}) {
    const {text, meta = {}} = payload;

    return this.broker.call('roleplay.speechprocessing.textToSpeech', {
      text,
      provider: 'openai',
      voice: meta.voice,
      voiceId: meta.voiceId,
      speed: meta.speed,
      format: meta.format || 'pcm',
      model: meta.model,
      paramInstructions: meta.paramInstructions,
      voiceData: meta.voiceData,
    });
  }
}

module.exports = OpenAITTSProvider;
