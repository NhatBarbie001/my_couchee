'use strict';

const AzureSTTProvider = require('./providers/azure.provider');
const ElevenLabsSTTProvider = require('./providers/elevenlabs.provider');
const ThinkLabsSTTProvider = require('./providers/thinklabs.provider');

const PROVIDERS = {
  azure: AzureSTTProvider,
  elevenlabs: ElevenLabsSTTProvider,
  thinklabs: ThinkLabsSTTProvider,
};

function createSTTProvider({providerName = 'azure', broker, logger}) {
  const finalProviderName = providerName || 'azure';
  const ProviderClass = PROVIDERS[finalProviderName] || PROVIDERS.azure;
  return new ProviderClass({broker, logger});
}

module.exports = {
  createSTTProvider,
};
