'use strict';

/**
 * ElevenLabs STT Provider Strategy.
 * WebSocket stream mở suốt session (từ start_session), không đóng giữa các turn.
 * Khi kết thúc turn chỉ gửi commitTurn, chờ speech.stream.recognized(isFinal=true) mới finalize.
 */
module.exports = {
  name: 'elevenlabs',
  silenceThreshold: 500, // ms im lặng để coi là kết thúc turn (cao hơn Azure do latency WS)
  deferFinalize: true, // Chờ speech.stream.recognized(isFinal=true) mới finalize

  /**
   * Không cần mở stream — ElevenLabs WS đã mở từ khi start_session.
   */
  async initStream(_broker, _state) {
    // No-op: ElevenLabs WS opened at session start (roleplaysessions.service.js)
  },

  /**
   * Push audio lên ElevenLabs WS. Tự reopen nếu stream bị mất giữa chừng.
   */
  async pushAudio(broker, state, audioBuffer, logger) {
    if (!state.sttStreamId) return;

    const result = await broker.call('roleplay.elevenlabs.pushAudioToStream', {
      streamId: state.sttStreamId,
      audioChunk: audioBuffer,
    });

    if (result && result.reason === 'stream_not_found') {
      logger.warn(`[ElevenLabs] Stream ${state.sttStreamId} not found, attempting reopen...`);
      try {
        await broker.call('roleplay.elevenlabs.reopenStream', {
          streamId: state.sttStreamId,
          sessionId: state.sessionId,
        });
        // Push lại lần nữa sau khi reopen
        await broker.call('roleplay.elevenlabs.pushAudioToStream', {
          streamId: state.sttStreamId,
          audioChunk: audioBuffer,
        });
        logger.info(`[ElevenLabs] Stream ${state.sttStreamId} reopened successfully`);
      } catch (reopenErr) {
        logger.error(`[ElevenLabs] Failed to reopen stream for session ${state.sessionId}:`, reopenErr);
      }
    }
  },

  /**
   * Khi VAD pop: không làm gì — stream ElevenLabs mở suốt session.
   */
  async onVADPop(_broker, _state) {
    // No-op: ElevenLabs stream stays open throughout the session
  },

  /**
   * Khi kết thúc turn: gửi commitTurn để ElevenLabs trả committed_transcript.
   * WS vẫn mở — finalize sẽ được gọi từ speech.stream.recognized(isFinal=true).
   */
  async onTurnEnd(broker, state, logger) {
    if (!state.sttStreamId) {
      logger.warn(`commitTurn: không có sttStreamId cho session ${state.sessionId}`);
      return;
    }
    try {
      await broker.call('roleplay.elevenlabs.commitTurn', {
        streamId: state.sttStreamId,
      });
      console.log(`#####################commitTurn sent for session ${state.sessionId}`);
    } catch (err) {
      logger.error(`commitTurn error for session ${state.sessionId}:`, err);
    }
  },

  /**
   * Cleanup khi có lỗi: không đóng stream (session-level).
   */
  async cleanup(_broker, _state) {
    // No-op: ElevenLabs stream is session-level, managed by service
  },

  /**
   * Gửi normalization hints cho STT provider.
   * ElevenLabs chưa hỗ trợ — placeholder cho tương lai.
   */
  async sendHints(_broker, _state, _logger) {
    // No-op: ElevenLabs chưa hỗ trợ normalization hints
  },
};
