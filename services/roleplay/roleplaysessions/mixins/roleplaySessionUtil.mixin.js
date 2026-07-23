'use strict';

/**
 * Mixin chứa helper cho xử lý lifecycle của roleplay session.
 */
module.exports = {
  name: 'roleplaySessionUtilMixin',
  methods: {
    /**
     * Tính duration (giây) giữa startAt và endAt.
     */
    calculateSessionDuration(startAt, endAt) {
      if (startAt instanceof Date && !isNaN(startAt.getTime())) {
        return Math.round((endAt.getTime() - startAt.getTime()) / 1000);
      } else {
        this.logger.warn(
          `Không thể tính thời lượng phiên. startAt không hợp lệ: ${startAt}`
        );
        return null;
      }
    },

    /**
     * Chuyển đổi conversationHistory thành transcripts phù hợp lưu DB.
     */
    buildSessionTranscripts(state) {
      if (!state || !state.conversationHistory || state.conversationHistory.length === 0) {
        return [];
      }
      return state.conversationHistory
        .filter(item => item.role === 'user' || item.role === 'assistant')
        .map(item => ({
          role: item.role === 'user' ? 'student' : 'ai',
          content: item.content,
          timestamp: item.timestamp || new Date(),
          audioId: item.turnAudioId || null,
          duration: item.duration || 0,
          speakSpeed: item.speakSpeed || 0,
        }));
    },
  },
};
