'use strict';

/**
 * ThinkLabs STT Provider Strategy.
 * WebSocket stream mở suốt session. Khi kết thúc turn gửi lệnh {"action": "correct_text"}.
 * Chờ speech.stream.recognized(isFinal=true) mới finalize.
 */
module.exports = {
  name: 'thinklabs',
  silenceThreshold: 500, // ms im lặng để coi là kết thúc turn
  deferFinalize: true, // Chờ speech.stream.recognized(isFinal=true) mới finalize

  async initStream(_broker, _state) {
    // No-op: ThinkLabs WS opened at session start
  },

  async pushAudio(broker, state, audioBuffer, logger) {
    if (!state.sttStreamId) return;

    const result = await broker.call('roleplay.thinklabs.pushAudioToStream', {
      streamId: state.sttStreamId,
      audioChunk: audioBuffer,
    });

    if (result && result.reason === 'stream_not_found') {
      logger.warn(`[ThinkLabs] Stream ${state.sttStreamId} not found, attempting reopen...`);
      try {
        await broker.call('roleplay.thinklabs.reopenStream', {
          streamId: state.sttStreamId,
          sessionId: state.sessionId,
        });
        await broker.call('roleplay.thinklabs.pushAudioToStream', {
          streamId: state.sttStreamId,
          audioChunk: audioBuffer,
        });
        logger.info(`[ThinkLabs] Stream ${state.sttStreamId} reopened successfully`);
      } catch (reopenErr) {
        logger.error(`[ThinkLabs] Failed to reopen stream for session ${state.sessionId}:`, reopenErr);
      }
    }
  },

  async onVADPop(_broker, _state) {
    // No-op: stream remains open
  },

  async onTurnEnd(broker, state, logger) {
    if (!state.sttStreamId) {
      logger.warn(`[ThinkLabs] commitTurn: không có sttStreamId cho session ${state.sessionId}`);
      return;
    }
    try {
      await broker.call('roleplay.thinklabs.commitTurn', {
        streamId: state.sttStreamId,
      });
      console.log(`#####################commitTurn (correct_text) sent for session ${state.sessionId}`);
    } catch (err) {
      logger.error(`[ThinkLabs] commitTurn error for session ${state.sessionId}:`, err);
    }
  },

  async cleanup(_broker, _state) {
    // Session-level managed
  },

  /**
   * Gửi normalization hints (từ khoá chuyên ngành + bảng ánh xạ) cho ThinkLabs.
   * Lấy hints từ state.scenario.sttKeywordHints và state.scenario.sttMappingHints.
   */
  async sendHints(broker, state, logger) {
    if (!state.sttStreamId) return;

    const scenario = state.scenario || state.aiScenario;
    if (!scenario) return;

    const keywordHints = scenario.sttKeywordHints || [];
    // sttMappingHints có thể là Mongoose Map → convert sang plain object
    let mappingHints = scenario.sttMappingHints || {};
    if (mappingHints instanceof Map || typeof mappingHints.toJSON === 'function') {
      mappingHints = Object.fromEntries(mappingHints);
    }

    if (keywordHints.length === 0 && Object.keys(mappingHints).length === 0) {
      logger.info(`[ThinkLabs] sendHints: không có hints trong scenario, bỏ qua (session ${state.sessionId})`);
      return;
    }

    try {
      logger.info(`[ThinkLabs] sendHints: gửi ${keywordHints.length} keywords, ${Object.keys(mappingHints).length} mappings (session ${state.sessionId})`);
      await broker.call('roleplay.thinklabs.setNormalizationHints', {
        streamId: state.sttStreamId,
        keywordHints,
        mappingHints,
      });
    } catch (err) {
      logger.error(`[ThinkLabs] sendHints error (session ${state.sessionId}):`, err);
    }
  },
};
