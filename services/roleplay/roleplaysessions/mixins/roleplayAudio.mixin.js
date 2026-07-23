'use strict';

/**
 * Mixin chứa các phương thức xử lý và lưu audio cho phiên roleplay.
 */
module.exports = {
  name: 'roleplayAudioMixin',
  methods: {
    /**
     * Lưu các audio chunks thành 1 file duy nhất và tạo entity file trong service files.
     */
    async _saveAudioChunksToFile(state, audioChunks, audioType, specificAudioFormat = null) {
      const saveAudioFileId = `_saveAudioChunksToFile_${state.sessionId || 'unknownSession'}_${audioType}_${Date.now()}`;
      console.time(saveAudioFileId);

      const { sessionId, studentId, courseId } = state;
      const userId = studentId;

      try {
        if (!userId || !sessionId) {
          this.logger.error(
            `_saveAudioChunksToFile: userId (${userId}) hoặc sessionId (${sessionId}) không hợp lệ. Không thể lưu file. AudioType: ${audioType}`
          );
          return null;
        }

        if (!audioChunks || audioChunks.length === 0) {
          this.logger.warn(
            `_saveAudioChunksToFile: Không có audio chunks để lưu cho session: ${sessionId}, audioType: ${audioType}.`
          );
          return null;
        }

        const combinedBuffer = Buffer.concat(audioChunks);
        if (combinedBuffer.length === 0) {
          this.logger.warn(
            `_saveAudioChunksToFile: combinedBuffer rỗng sau khi concat cho session ${sessionId}, audioType: ${audioType}. Bỏ qua lưu file.`
          );
          return null;
        }

        const audioFormatToUse = specificAudioFormat || state.clientAudioFormat || {
          sampleRate: 16000,
          channels: 1,
          bitDepth: 16,
        };

        let audioDurationSeconds = 0;
        if (
          combinedBuffer.length > 0 &&
          audioFormatToUse.sampleRate &&
          audioFormatToUse.channels &&
          audioFormatToUse.bitDepth
        ) {
          const bytesPerSample = audioFormatToUse.bitDepth / 8;
          if (bytesPerSample > 0 && audioFormatToUse.sampleRate > 0 && audioFormatToUse.channels > 0) {
            audioDurationSeconds =
              combinedBuffer.length / (audioFormatToUse.sampleRate * audioFormatToUse.channels * bytesPerSample);
          } else {
            this.logger.warn(
              `_saveAudioChunksToFile: Invalid audio format properties for duration calculation. SR: ${audioFormatToUse.sampleRate}, CH: ${audioFormatToUse.channels}, BD: ${audioFormatToUse.bitDepth}`
            );
          }
        }

        const timestamp = Date.now();
        const baseOutputFileName = `roleplay_${audioType}_${userId}_${sessionId}_${timestamp}`;
        const storageFolder = 'roleplay_audio_sessions';

        this.logger.info(
          `_saveAudioChunksToFile: Gọi files.createAudioSessionFile cho ${baseOutputFileName}, audioType: ${audioType}`
        );

        const fileEntity = await this.broker.call('files.createAudioSessionFile', {
          audioChunks: [combinedBuffer],
          userId: userId,
          baseOutputFileName: baseOutputFileName,
          clientAudioFormat: audioFormatToUse,
          storageFolder: storageFolder,
          metadata: {
            roleplaySessionId: sessionId,
            audioType: audioType,
            courseId,
          },
        });

        if (!fileEntity || !fileEntity._id) {
          this.logger.error(
            `_saveAudioChunksToFile: files.createAudioSessionFile không trả về file entity hợp lệ cho ${baseOutputFileName}.`
          );
          throw new Error(`File entity not created or invalid for audioType ${audioType}.`);
        }

        this.logger.info(
          `_saveAudioChunksToFile: File audio đã được xử lý, fileId: ${fileEntity._id}, audioType: ${audioType}`
        );

        return {
          fileId: fileEntity._id,
          audioUrl: await this.broker.call('files.filePath', { id: fileEntity._id }),
          duration: audioDurationSeconds,
        };
      } catch (e) {
        this.logger.error(
          `Lỗi trong _saveAudioChunksToFile khi gọi file.service cho session ${state.sessionId}, audioType: ${audioType}:`,
          e
        );
        throw e;
      } finally {
        console.timeEnd(saveAudioFileId);
      }
    },

    async saveAudioFile(state) {
      const saveAudioFileId = `saveAudioFile_${state.sessionId || 'unknownSession'}`;
      console.time(saveAudioFileId);

      const { allAudioChunksForSession, sessionId, clientAudioFormat, studentId } = state;
      const userId = studentId; // userId được suy ra từ studentId

      try {
        if (!userId || !sessionId) {
          this.logger.error(
            `saveAudioFile (roleplaysessions): userId (${userId}) hoặc sessionId (${sessionId}) không hợp lệ. Không thể gọi lưu file.`,
          );
          if (allAudioChunksForSession && allAudioChunksForSession.length > 0) {
            state.allAudioChunksForSession = [];
          }
          return;
        }

        if (!allAudioChunksForSession || allAudioChunksForSession.length === 0) {
          this.logger.warn(
            `saveAudioFile (roleplaysessions): Không có audio chunks để lưu cho sessionId: ${sessionId} hoặc đã được xử lý.`,
          );
          return;
        }

        const chunksToSave = [...allAudioChunksForSession];
        state.allAudioChunksForSession = [];

        const baseOutputFileName = `roleplay_${userId}_${sessionId}`;
        const storageFolder = 'roleplay_audio_sessions';

        this.logger.info(
          `saveAudioFile (roleplaysessions): Gọi files.createAudioSessionFile cho ${baseOutputFileName}`,
        );

        const fileEntity = await this.broker.call('files.createAudioSessionFile', {
          audioChunks: chunksToSave,
          userId: userId,
          baseOutputFileName: baseOutputFileName,
          clientAudioFormat: clientAudioFormat,
          storageFolder: storageFolder,
        });

        if (!fileEntity || !fileEntity._id) {
          this.logger.error(
            `saveAudioFile (roleplaysessions): files.createAudioSessionFile không trả về file entity hợp lệ cho ${baseOutputFileName}.`,
          );
          throw new Error('File entity not created or invalid.');
        }

        this.logger.info(
          `saveAudioFile (roleplaysessions): File đã được xử lý bởi file.service, fileId: ${fileEntity._id}`,
        );

        if (sessionId) {
          await this.adapter.updateById(sessionId, { $set: { recordingId: fileEntity._id } });
          this.logger.info(
            `saveAudioFile (roleplaysessions): Đã cập nhật session ${sessionId} với recordingId: ${fileEntity._id}`,
          );
        }

        return {
          fileId: fileEntity._id,
          audioUrl: await this.broker.call('files.filePath', { id: fileEntity._id }),
        };
      } catch (e) {
        this.logger.error(
          `Lỗi trong saveAudioFile (roleplaysessions) khi gọi file.service cho session ${state.sessionId || sessionId}:`,
          e,
        );
        throw e;
      } finally {
        console.timeEnd(saveAudioFileId);
      }
    },

    getAiAudioConfig(state) {
      const provider = state.voiceProvider || state.persona?.provider || state.persona?.voiceId?.apiKeyId?.serviceProvider || 'default';

      // Default configurations matching roleplayLLM.mixin.js
      const configs = {
        openai: { sampleRate: 24000, channels: 1, bitDepth: 16 },
        microsoft: { sampleRate: 16000, channels: 1, bitDepth: 16 },
        google_gemini: { sampleRate: 24000, channels: 1, bitDepth: 16 },
        default: { sampleRate: 24000, channels: 1, bitDepth: 16 },
      };

      // Handle specific cases if provider string is complex or missing
      if (configs[provider]) {
        return configs[provider];
      }

      return configs.default;
    },

    async saveAiAudioFile(state) {
      const saveAiAudioFileId = `saveAiAudioFile_${state.sessionId || 'unknownSession'}`;
      console.time(saveAiAudioFileId);

      const { allAiAudioChunksForSession } = state;
      const sessionId = state.sessionId;

      try {
        if (!sessionId) {
          this.logger.error(`saveAiAudioFile: sessionId (${sessionId}) không hợp lệ.`);
          if (allAiAudioChunksForSession && allAiAudioChunksForSession.length > 0) {
            state.allAiAudioChunksForSession = [];
          }
          return null;
        }
        if (!allAiAudioChunksForSession || allAiAudioChunksForSession.length === 0) {
          this.logger.warn(`saveAiAudioFile: Không có audio chunks của AI để lưu cho sessionId: ${sessionId}.`);
          return null;
        }
        const chunks = [...allAiAudioChunksForSession];
        state.allAiAudioChunksForSession = [];

        // Dynamic audio format
        const aiAudioFormat = this.getAiAudioConfig(state);

        const result = await this._saveAudioChunksToFile(state, chunks, 'ai_full', aiAudioFormat);
        console.timeEnd(saveAiAudioFileId);
        return result;
      } catch (e) {
        console.timeEnd(saveAiAudioFileId);
        this.logger.error(`Lỗi saveAiAudioFile cho session ${state.sessionId}:`, e);
        throw e;
      }
    },

    async saveStudentTurnAudio(state, audioChunks) {
      // Lưu audio từng lượt nói của học sinh
      return this._saveAudioChunksToFile(state, audioChunks, 'student_turn', state.clientAudioFormat);
    },

    async saveAiTurnAudio(state, audioChunks) {
      // Lưu audio từng lượt nói của AI
      const aiAudioFormat = this.getAiAudioConfig(state);
      return this._saveAudioChunksToFile(state, audioChunks, 'ai_turn', aiAudioFormat);
    },
  },
};
