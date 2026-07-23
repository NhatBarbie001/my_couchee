'use strict';

const OpenAILLMProvider = require('./providers/openai.provider');
const AzureLLMProvider = require('./providers/azure.provider');

const PROVIDERS = {
  openai: OpenAILLMProvider,
  azure_openai: AzureLLMProvider,
};

function normalizeProviderName(providerName = '') {
  const value = String(providerName || '').trim().toLowerCase();

  if (!value) return 'azure_openai';
  if (value === 'azureopenai' || value === 'azure-openai' || value === 'azure_openai') return 'azure_openai';
  if (value === 'openai' || value === 'chatgpt') return 'openai';
  return value;
}

function createLLMProvider({broker, logger, providerName, config = {}}) {
  const normalized = normalizeProviderName(providerName || process.env.VOICE_LLM_PROVIDER || 'azure_openai');
  const ProviderClass = PROVIDERS[normalized] || PROVIDERS.azure_openai;

  return new ProviderClass({
    broker,
    logger,
    config,
  });
}

module.exports = {
  createLLMProvider,
  normalizeProviderName,
};
