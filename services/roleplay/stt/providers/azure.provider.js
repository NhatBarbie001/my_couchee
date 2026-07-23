'use strict';

const BaseSTTProvider = require('./base.provider');

class AzureSTTProvider extends BaseSTTProvider {
  constructor({broker, logger}) {
    super({broker, logger});
    this.name = 'azure';
    this.supportsStreaming = true;
    this.silenceThreshold = 100;
    this.deferFinalize = false;
  }

  async openStream({state}) {
    const provider = this;

    const handle = {
      async send(audioBuffer) {
        if (!state.sttStreamId) {
          const {streamId} = await provider.broker.call('roleplay.speechprocessing.initializeSpeechStream', {
            language: 'vi-VN',
            sessionId: state.sessionId,
          });
          state.sttStreamId = streamId;
        }

        if (state.sttStreamId) {
          await provider.broker.call('roleplay.speechprocessing.pushAudioToStream', {
            streamId: state.sttStreamId,
            audioChunk: audioBuffer,
          });
        }
      },

      async onVADPop() {
        if (!state.sttStreamId) return;

        await provider.broker.call('roleplay.speechprocessing.closeSpeechStream', {
          streamId: state.sttStreamId,
        });
        state.sttStreamId = null;
      },

      async commitTurn() {
        if (!state.sttStreamId) return;

        await provider.broker.call('roleplay.speechprocessing.closeSpeechStream', {
          streamId: state.sttStreamId,
        });
        state.sttStreamId = null;
      },

      async cleanup() {
        if (!state.sttStreamId) return;

        await provider.broker.call('roleplay.speechprocessing.closeSpeechStream', {
          streamId: state.sttStreamId,
        });
        state.sttStreamId = null;
      },

      async closeSession() {
        if (!state.sttStreamId) return;

        await provider.broker.call('roleplay.speechprocessing.closeSpeechStream', {
          streamId: state.sttStreamId,
        });
        state.sttStreamId = null;
      },

      async setHints() {
        // Azure not supported currently.
      },
    };

    return handle;
  }

  async closeSessionStream({state}) {
    if (!state?.sttStreamId) return;
    await this.broker.call('roleplay.speechprocessing.closeSpeechStream', {streamId: state.sttStreamId});
    state.sttStreamId = null;
  }

  async sendHints() {
    // No-op for Azure.
  }

  async transcribe() {
    throw new Error('AzureSTTProvider.transcribe() is not implemented yet.');
  }
}

module.exports = AzureSTTProvider;
