'use strict';

const OpenAITTSProvider = require('./providers/openai.provider');
const ElevenLabsTTSProvider = require('./providers/elevenlabs.provider');
const MicrosoftTTSProvider = require('./providers/microsoft.provider');
const GoogleGeminiTTSProvider = require('./providers/google-gemini.provider');
const LegacySpeechprocessingProvider = require('./providers/legacy-speechprocessing.provider');

const PROVIDERS = {
  openai: OpenAITTSProvider,
  eleven_labs: ElevenLabsTTSProvider,
  microsoft: MicrosoftTTSProvider,
  google_gemini: GoogleGeminiTTSProvider,
  legacy_speechprocessing: LegacySpeechprocessingProvider,
};

function createTTSProvider({broker, logger, finalProvider = 'openai'}) {
  const providerName = finalProvider || 'openai';
  const ProviderClass = PROVIDERS[providerName] || PROVIDERS.legacy_speechprocessing;
  return new ProviderClass({broker, logger});
}

module.exports = {
  createTTSProvider,
};
