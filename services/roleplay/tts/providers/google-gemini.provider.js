'use strict';

const BaseTTSProvider = require('./base.provider');

class GoogleGeminiTTSProvider extends BaseTTSProvider {
  async synthesize(payload = {}) {
    const {text, meta = {}} = payload;

    return this.broker.call('roleplay.speechprocessing.textToSpeech', {
      text,
      provider: 'google_gemini',
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

module.exports = GoogleGeminiTTSProvider;
