'use strict';

class BaseSTTProvider {
  constructor({broker, logger}) {
    this.broker = broker;
    this.logger = logger;
    this.supportsStreaming = true;
    this.silenceThreshold = 500;
    this.deferFinalize = false;
  }

  async openStream() {
    throw new Error('openStream() must be implemented by subclass');
  }

  async transcribe() {
    throw new Error('transcribe() must be implemented by subclass');
  }

  async closeSessionStream() {
    // Optional for session-level providers.
  }

  async sendHints() {
    // Optional provider capability.
  }
}

module.exports = BaseSTTProvider;
