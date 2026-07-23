'use strict';

class BaseTTSProvider {
  constructor({broker, logger}) {
    this.broker = broker;
    this.logger = logger;
  }

  async synthesize() {
    throw new Error('synthesize() must be implemented by subclass');
  }
}

module.exports = BaseTTSProvider;
