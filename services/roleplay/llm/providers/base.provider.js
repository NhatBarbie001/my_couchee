'use strict';

class BaseLLMProvider {
  constructor({broker, logger, config = {}}) {
    this.broker = broker;
    this.logger = logger;
    this.config = config;
  }

  ensureNotAborted(abortSignal) {
    if (abortSignal && abortSignal.aborted) {
      const abortErr = new Error('LLM stream aborted');
      abortErr.code = 'LLM_ABORTED';
      throw abortErr;
    }
  }

  isAbortError(error) {
    return error?.code === 'LLM_ABORTED' || error?.name === 'AbortError';
  }

  async streamTokens(_payload, _onToken, _options = {}) {
    throw new Error('streamTokens() must be implemented by subclass');
  }
}

module.exports = BaseLLMProvider;
