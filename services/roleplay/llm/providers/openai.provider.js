'use strict';

const BaseLLMProvider = require('./base.provider');

class OpenAILLMProvider extends BaseLLMProvider {
  async streamTokens(payload, onToken, options = {}) {
    const {messages = [], system = '', modelConfig = {}} = payload || {};
    const {abortSignal, onFirstToken, onComplete} = options;

    const finalMessages = [];
    if (system && String(system).trim()) {
      finalMessages.push({
        role: 'system',
        content: String(system),
      });
    }
    finalMessages.push(...messages);

    this.ensureNotAborted(abortSignal);

    const stream = await this.broker.call('chatgpt.chatCompletionStream', {
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
  }
}

module.exports = OpenAILLMProvider;
