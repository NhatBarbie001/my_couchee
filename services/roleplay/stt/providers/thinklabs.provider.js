'use strict';

const BaseSTTProvider = require('./base.provider');

class ThinkLabsSTTProvider extends BaseSTTProvider {
  constructor({broker, logger}) {
    super({broker, logger});
    this.name = 'thinklabs';
    this.supportsStreaming = true;
    this.silenceThreshold = 500;
    this.deferFinalize = true;
  }

  async openStream({state}) {
    const provider = this;

    if (!state.sttStreamId) {
      const {streamId} = await this.broker.call('roleplay.thinklabs.initializeSpeechStream', {
        language: 'vi-VN',
        sessionId: state.sessionId,
      });
      state.sttStreamId = streamId;
      this.logger?.info?.(`[${state.sessionId}] ThinkLabs WS opened (v2): ${streamId}`);
    }

    const handle = {
      async send(audioBuffer) {
        if (!state.sttStreamId) return;

        const result = await provider.broker.call('roleplay.thinklabs.pushAudioToStream', {
          streamId: state.sttStreamId,
          audioChunk: audioBuffer,
        });

        if (result && result.reason === 'stream_not_found') {
          provider.logger?.warn?.(`[ThinkLabs] Stream ${state.sttStreamId} not found, attempting reopen...`);
          try {
            await provider.broker.call('roleplay.thinklabs.reopenStream', {
              streamId: state.sttStreamId,
              sessionId: state.sessionId,
            });

            await provider.broker.call('roleplay.thinklabs.pushAudioToStream', {
              streamId: state.sttStreamId,
              audioChunk: audioBuffer,
            });

            provider.logger?.info?.(`[ThinkLabs] Stream ${state.sttStreamId} reopened successfully`);
          } catch (reopenErr) {
            provider.logger?.error?.(`[ThinkLabs] Failed to reopen stream for session ${state.sessionId}:`, reopenErr);
          }
        }
      },

      async onVADPop() {
        // No-op: session-level stream.
      },

      async commitTurn() {
        if (!state.sttStreamId) {
          provider.logger?.warn?.(`[ThinkLabs] commitTurn: không có sttStreamId cho session ${state.sessionId}`);
          return;
        }

        try {
          await provider.broker.call('roleplay.thinklabs.commitTurn', {
            streamId: state.sttStreamId,
          });
        } catch (err) {
          provider.logger?.error?.(`[ThinkLabs] commitTurn error for session ${state.sessionId}:`, err);
        }
      },

      async cleanup() {
        // No-op: session-level stream managed by closeSession.
      },

      async closeSession() {
        if (!state.sttStreamId) return;
        try {
          await provider.broker.call('roleplay.thinklabs.closeStream', {streamId: state.sttStreamId});
        } finally {
          state.sttStreamId = null;
        }
      },

      async setHints() {
        if (!state.sttStreamId) return;

        const scenario = state.scenario || state.aiScenario;
        if (!scenario) return;

        const keywordHints = scenario.sttKeywordHints || [];
        let mappingHints = scenario.sttMappingHints || {};
        if (mappingHints instanceof Map || typeof mappingHints.toJSON === 'function') {
          mappingHints = Object.fromEntries(mappingHints);
        }

        if (keywordHints.length === 0 && Object.keys(mappingHints).length === 0) {
          provider.logger?.info?.(
            `[ThinkLabs] sendHints: không có hints trong scenario, bỏ qua (session ${state.sessionId})`,
          );
          return;
        }

        try {
          await provider.broker.call('roleplay.thinklabs.setNormalizationHints', {
            streamId: state.sttStreamId,
            keywordHints,
            mappingHints,
          });
        } catch (err) {
          provider.logger?.error?.(`[ThinkLabs] sendHints error (session ${state.sessionId}):`, err);
        }
      },
    };

    return handle;
  }

  async closeSessionStream({state}) {
    if (!state?.sttStreamId) return;
    try {
      await this.broker.call('roleplay.thinklabs.closeStream', {streamId: state.sttStreamId});
    } finally {
      state.sttStreamId = null;
    }
  }

  async sendHints({state}) {
    if (!state?.sttProviderV2Handle || typeof state.sttProviderV2Handle.setHints !== 'function') {
      return;
    }
    await state.sttProviderV2Handle.setHints();
  }

  async transcribe() {
    throw new Error('ThinkLabsSTTProvider.transcribe() is not implemented yet.');
  }
}

module.exports = ThinkLabsSTTProvider;
