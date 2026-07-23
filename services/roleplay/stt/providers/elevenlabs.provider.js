'use strict';

const BaseSTTProvider = require('./base.provider');

class ElevenLabsSTTProvider extends BaseSTTProvider {
  constructor({broker, logger}) {
    super({broker, logger});
    this.name = 'elevenlabs';
    this.supportsStreaming = true;
    this.silenceThreshold = 500;
    this.deferFinalize = true;
  }

  async openStream({state}) {
    const provider = this;

    if (!state.sttStreamId) {
      const {streamId} = await this.broker.call('roleplay.elevenlabs.initializeSpeechStream', {
        language: 'vi-VN',
        sessionId: state.sessionId,
      });
      state.sttStreamId = streamId;
      this.logger?.info?.(`[${state.sessionId}] ElevenLabs WS opened (v2): ${streamId}`);
    }

    const handle = {
      async send(audioBuffer) {
        if (!state.sttStreamId) return;

        const result = await provider.broker.call('roleplay.elevenlabs.pushAudioToStream', {
          streamId: state.sttStreamId,
          audioChunk: audioBuffer,
        });

        if (result && result.reason === 'stream_not_found') {
          provider.logger?.warn?.(`[ElevenLabs] Stream ${state.sttStreamId} not found, attempting reopen...`);
          try {
            await provider.broker.call('roleplay.elevenlabs.reopenStream', {
              streamId: state.sttStreamId,
              sessionId: state.sessionId,
            });

            await provider.broker.call('roleplay.elevenlabs.pushAudioToStream', {
              streamId: state.sttStreamId,
              audioChunk: audioBuffer,
            });

            provider.logger?.info?.(`[ElevenLabs] Stream ${state.sttStreamId} reopened successfully`);
          } catch (reopenErr) {
            provider.logger?.error?.(
              `[ElevenLabs] Failed to reopen stream for session ${state.sessionId}:`,
              reopenErr,
            );
          }
        }
      },

      async onVADPop() {
        // No-op: session-level stream.
      },

      async commitTurn() {
        if (!state.sttStreamId) {
          provider.logger?.warn?.(`commitTurn: không có sttStreamId cho session ${state.sessionId}`);
          return;
        }

        try {
          await provider.broker.call('roleplay.elevenlabs.commitTurn', {
            streamId: state.sttStreamId,
          });
        } catch (err) {
          provider.logger?.error?.(`commitTurn error for session ${state.sessionId}:`, err);
        }
      },

      async cleanup() {
        // No-op: session-level stream managed by closeSession.
      },

      async closeSession() {
        if (!state.sttStreamId) return;
        try {
          await provider.broker.call('roleplay.elevenlabs.closeStream', {streamId: state.sttStreamId});
        } finally {
          state.sttStreamId = null;
        }
      },

      async setHints() {
        // ElevenLabs not supported currently.
      },
    };

    return handle;
  }

  async closeSessionStream({state}) {
    if (!state?.sttStreamId) return;
    try {
      await this.broker.call('roleplay.elevenlabs.closeStream', {streamId: state.sttStreamId});
    } finally {
      state.sttStreamId = null;
    }
  }

  async sendHints() {
    // No-op for ElevenLabs.
  }

  async transcribe() {
    throw new Error('ElevenLabsSTTProvider.transcribe() is not implemented yet.');
  }
}

module.exports = ElevenLabsSTTProvider;
