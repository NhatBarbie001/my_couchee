'use strict';

/**
 * Azure Speech Services STT Provider Strategy.
 * Mỗi turn tạo stream mới, đóng stream khi VAD pop hoặc kết thúc turn.
 * Finalize ngay sau silence (không defer).
 */
module.exports = {
  name: 'azure',
  silenceThreshold: 100, // ms im lặng để coi là kết thúc turn
  deferFinalize: false, // Azure finalize ngay sau silence, không chờ event

  /**
   * Mở stream STT mới cho mỗi turn.
   */
  async initStream(broker, state) {
    if (!state.sttStreamId) {
      const { streamId } = await broker.call('roleplay.speechprocessing.initializeSpeechStream', {
        language: 'vi-VN',
        sessionId: state.sessionId,
      });
      state.sttStreamId = streamId;
    }
  },

  /**
   * Push audio chunk lên Azure stream.
   */
  async pushAudio(broker, state, audioBuffer, _logger) {
    if (state.sttStreamId) {
      await broker.call('roleplay.speechprocessing.pushAudioToStream', {
        streamId: state.sttStreamId,
        audioChunk: audioBuffer,
      });
    }
  },

  /**
   * Khi VAD phát hiện end-of-speech segment: đóng stream Azure.
   */
  async onVADPop(broker, state) {
    if (state.sttStreamId) {
      await broker.call('roleplay.speechprocessing.closeSpeechStream', {
        streamId: state.sttStreamId,
      });
      state.sttStreamId = null;
    }
  },

  /**
   * Khi kết thúc turn (silence timeout hoặc maxTurnDuration): đóng stream nếu còn mở.
   */
  async onTurnEnd(broker, state, _logger) {
    if (state.sttStreamId) {
      await broker.call('roleplay.speechprocessing.closeSpeechStream', {
        streamId: state.sttStreamId,
      });
      state.sttStreamId = null;
    }
  },

  /**
   * Cleanup khi có lỗi: đóng stream nếu còn.
   */
  async cleanup(broker, state) {
    if (state.sttStreamId) {
      await broker.call('roleplay.speechprocessing.closeSpeechStream', {
        streamId: state.sttStreamId,
      });
      state.sttStreamId = null;
    }
  },

  /**
   * Gửi normalization hints cho STT provider.
   * Azure chưa hỗ trợ — placeholder cho tương lai.
   */
  async sendHints(_broker, _state, _logger) {
    // No-op: Azure Speech Services chưa hỗ trợ normalization hints
  },
};
