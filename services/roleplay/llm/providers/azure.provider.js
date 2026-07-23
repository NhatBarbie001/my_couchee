'use strict';

const BaseLLMProvider = require('./base.provider');

class AzureLLMProvider extends BaseLLMProvider {
  async streamTokens(payload, onToken, options = {}) {
    console.log('AzureLLMProvider Payload ---->>>', payload);
    const { messages = [], system = '', modelConfig = {} } = payload || {};
    const { abortSignal, onFirstToken, onComplete } = options;

    // Validate required credentials — missing values mean state.persona was not fully populated
    if (!modelConfig.apiKey) {
      throw new Error(
        '[AzureLLMProvider] apiKey is required but not provided. ' +
        'Ensure persona.llmModelId.apiKeyId is fully populated when loading session state.',
      );
    }
    if (!modelConfig.endpoint) {
      throw new Error(
        '[AzureLLMProvider] endpoint is required but not provided. ' +
        'Ensure persona.llmModelId.apiKeyId is fully populated when loading session state.',
      );
    }

    const finalMessages = [];
    if (system && String(system).trim()) {
      finalMessages.push({
        role: 'system',
        content: String(system),
      });
    }
    finalMessages.push(...messages);

    this.ensureNotAborted(abortSignal);

    const stream = await this.broker.call('azureopenai.chatCompletionStream', {
      messages: finalMessages,
      model: modelConfig.model || 'gpt-4.1',
      temperature: typeof modelConfig.temperature === 'number' ? modelConfig.temperature : 1,
      max_tokens: Number(modelConfig.maxTokens || 300),
      apiKey: modelConfig.apiKey,
      endpoint: modelConfig.endpoint,
    });

    let responseText = '';
    let firstTokenSeen = false;

    for await (const chunk of stream) {
      this.ensureNotAborted(abortSignal);

      const token = chunk?.choices?.[0]?.delta?.content;
      if (!token || typeof token !== 'string') {
        continue;
      }

      if (!firstTokenSeen) {
        firstTokenSeen = true;
        if (typeof onFirstToken === 'function') {
          onFirstToken(token);
        }
      }

      responseText += token;
      await onToken(token);
    }

    if (typeof onComplete === 'function') {
      onComplete(responseText);
    }

    return responseText;
    // NOTE: Không bắt lỗi ở đây — lỗi sẽ bubble up đúng cách lên llm.service.js
    // để được log và emit server:error đến client.
  }
}

module.exports = AzureLLMProvider;
