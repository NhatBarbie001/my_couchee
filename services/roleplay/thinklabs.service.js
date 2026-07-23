const WebSocket = require("ws");
const functionsCommonMixin = require("../../mixins/functionsCommon.mixin");
const fileMixin = require("../../mixins/file.mixin");
const baseServiceMixin = require("../../mixins/baseService.mixin");
const { v4: uuidv4 } = require('uuid');
const { MoleculerClientError } = require('moleculer').Errors;

// Map: streamId → { ws, sessionId }
const thinklabsStreams = new Map();

module.exports = {
  name: 'roleplay.thinklabs',
  mixins: [functionsCommonMixin, fileMixin, baseServiceMixin],
  
  actions: {
    /**
     * Mở 1 WS connection duy nhất cho toàn bộ session tới ThinkLabs.
     */
    initializeSpeechStream: {
      params: {
        language: { type: "string", optional: true, default: "vi-VN" },
        sessionId: { type: "string" },
      },
      async handler(ctx) {
        const { sessionId } = ctx.params;
        const streamId = uuidv4();

        const ws = new WebSocket("wss://speech2text.thinklabs.com.vn/ws");

        ws.on("open", () => {
          this.logger.info(`[ThinkLabs] WS opened: ${streamId} (session: ${sessionId})`);
        });

        ws.on("message", (msg) => {
          try {
            const msgStr = msg.toString();
            const data = JSON.parse(msgStr);

            if (data.status === "processing") {
              // Server đang nhận buffer
              return;
            } else if (data.text && data.is_final) {
              // Data Text Tức thời (Raw) -> Phát sự kiện recognizing để hiển thị realtime trên UI
              this.broker.emit("speech.stream.recognizing", {
                streamId,
                sessionId,
                text: data.text,
                isFinal: false,
              });
            } else if (data.action === "text_update") {
              if (data.error) {
                this.logger.error(`[ThinkLabs] Normalization error (stream: ${streamId}):`, data.error);
                return;
              }

              // updated_text là TÍCH LUỸ (toàn bộ text từ đầu session)
              // Cần trừ đi phần đã finalize để lấy text MỚI cho turn hiện tại
              const fullText = data.updated_text || '';
              const lastFinalized = streamData?.lastFinalizedText || '';
              let newText = fullText;
              if (lastFinalized && fullText.startsWith(lastFinalized)) {
                newText = fullText.slice(lastFinalized.length).trim();
              }

              if (streamData?.pendingCommit) {
                // text_update SAU lệnh correct_text (pendingCommit=true)
                // → Đây là lần chốt thật sự, phát recognized(isFinal=true) để finalize
                streamData.pendingCommit = false;
                streamData.lastFinalizedText = fullText; // Ghi nhớ để diff lần sau
                this.logger.info(`[ThinkLabs] text_update (committed): "${newText}" (stream: ${streamId})`);
                this.broker.emit("speech.stream.recognized", {
                  streamId,
                  sessionId,
                  text: newText,
                  isFinal: true,
                });
              } else {
                // text_update TỰ ĐỘNG (ThinkLabs server VAD tự cắt câu)
                // → Chỉ cập nhật preview text, KHÔNG finalize
                this.logger.info(`[ThinkLabs] text_update (auto): "${newText}" (stream: ${streamId})`);
                this.broker.emit("speech.stream.recognizing", {
                  streamId,
                  sessionId,
                  text: newText,
                  isFinal: false,
                });
              }
            } else if (data.action === "hints_updated") {
              this.logger.info(`[ThinkLabs] hints_updated: ${data.keyword_count} keywords, ${data.mapping_count} mappings (stream: ${streamId})`);
              // Resolve pending hints promise nếu có
              if (streamData && streamData._hintsResolve) {
                streamData._hintsResolve({ keywordCount: data.keyword_count, mappingCount: data.mapping_count });
                streamData._hintsResolve = null;
              }
            } else if (data.action === "correct_text_result") {
              if (data.error) {
                this.logger.warn(`[ThinkLabs] correct_text_result error (stream: ${streamId}): ${data.error}`);
              }
            } else if (data.action === "form_fill_result") {
              this.logger.info(`[ThinkLabs] form_fill_result: (stream: ${streamId})`, data.filled_form);
            }

          } catch (err) {
            this.logger.error(`[ThinkLabs] Parse error (stream: ${streamId}):`, err);
          }
        });

        ws.on("close", (code, reason) => {
          this.logger.info(`[ThinkLabs] WS closed: ${streamId} (code=${code}, reason=${reason?.toString() || ''})`);
          thinklabsStreams.delete(streamId);
        });

        ws.on("error", (err) => {
          this.logger.error(`[ThinkLabs] WS error (stream: ${streamId}):`, err);
        });

        const streamData = {
          ws,
          sessionId,
          _hintsResolve: null, // resolve function cho pending hints
          pendingCommit: false, // true khi đã gửi correct_text, chờ text_update final
          lastFinalizedText: '', // tích luỹ text đã finalize (để diff updated_text)
        };
        thinklabsStreams.set(streamId, streamData);

        return new Promise((resolve, reject) => {
          ws.on("open", () => resolve({ streamId }));
          ws.on("error", reject);
        });
      },
    },

    /**
     * Push audio chunk (PCM 16-bit 16kHz Mono) dạng buffer.
     */
    pushAudioToStream: {
      params: {
        streamId: "string",
        audioChunk: "any",
      },
      async handler(ctx) {
        const { streamId, audioChunk } = ctx.params;
        const streamData = thinklabsStreams.get(streamId);

        if (!streamData) return { success: false, reason: 'stream_not_found' };

        const buffer = Buffer.isBuffer(audioChunk)
          ? audioChunk
          : Buffer.from(audioChunk);

        try {
          if (streamData.ws.readyState === WebSocket.OPEN) {
            // Khác với ElevenLabs, ThinkLabs nhận Buffer Binary trực tiếp thay vì base64 JSON
            streamData.ws.send(buffer);
          }
          return { success: true };
        } catch (error) {
          throw new MoleculerClientError(`Failed to push audio: ${error.message}`, 500);
        }
      },
    },

    /**
     * Ép chốt turn thủ công (vd: khi VAD báo ngừng nói lâu).
     */
    commitTurn: {
      params: {
        streamId: "string",
      },
      async handler(ctx) {
        const { streamId } = ctx.params;
        const streamData = thinklabsStreams.get(streamId);

        if (!streamData) {
          this.logger.warn(`[ThinkLabs] commitTurn: stream ${streamId} not found`);
          return { success: false };
        }

        try {
          if (streamData.ws.readyState === WebSocket.OPEN) {
            streamData.pendingCommit = true; // Đánh dấu chờ text_update final
            streamData.ws.send(JSON.stringify({ action: "correct_text" }));
          }
          this.logger.info(`[ThinkLabs] send action: correct_text for stream: ${streamId} (pendingCommit=true)`);
          return { success: true };
        } catch (err) {
          this.logger.error(`[ThinkLabs] commitTurn error (stream: ${streamId}):`, err);
          return { success: false };
        }
      },
    },

    /**
     * Gửi normalization hints (từ khoá chuyên ngành + bảng ánh xạ) cho phiên hiện tại.
     * Nên gọi ngay sau khi WS mở và TRƯỚC khi bắt đầu gửi audio.
     */
    setNormalizationHints: {
      params: {
        streamId: "string",
        keywordHints: { type: "array", items: "string", optional: true, default: [] },
        mappingHints: { type: "object", optional: true, default: {} },
      },
      async handler(ctx) {
        const { streamId, keywordHints, mappingHints } = ctx.params;
        const streamData = thinklabsStreams.get(streamId);

        if (!streamData) {
          this.logger.warn(`[ThinkLabs] setNormalizationHints: stream ${streamId} not found`);
          return { success: false, reason: 'stream_not_found' };
        }

        // Bỏ qua nếu không có hints nào
        if ((!keywordHints || keywordHints.length === 0) && (!mappingHints || Object.keys(mappingHints).length === 0)) {
          this.logger.info(`[ThinkLabs] setNormalizationHints: no hints to send (stream: ${streamId})`);
          return { success: true, keywordCount: 0, mappingCount: 0 };
        }

        try {
          if (streamData.ws.readyState !== WebSocket.OPEN) {
            this.logger.warn(`[ThinkLabs] setNormalizationHints: WS not open (stream: ${streamId})`);
            return { success: false, reason: 'ws_not_open' };
          }

          // Gửi hints qua Text frame
          streamData.ws.send(JSON.stringify({
            action: "set_normalization_hints",
            keyword_hints: keywordHints || [],
            mapping_hints: mappingHints || {},
          }));

          // Chờ server xác nhận hints_updated (timeout 5s)
          const hintsResult = await new Promise((resolve) => {
            streamData._hintsResolve = resolve;
            setTimeout(() => {
              if (streamData._hintsResolve) {
                streamData._hintsResolve = null;
                resolve({ keywordCount: keywordHints?.length || 0, mappingCount: Object.keys(mappingHints || {}).length, timedOut: true });
              }
            }, 5000);
          });

          this.logger.info(`[ThinkLabs] setNormalizationHints done: ${JSON.stringify(hintsResult)} (stream: ${streamId})`);
          return { success: true, ...hintsResult };
        } catch (err) {
          this.logger.error(`[ThinkLabs] setNormalizationHints error (stream: ${streamId}):`, err);
          return { success: false };
        }
      },
    },

    /**
     * Đóng session an toàn. (action: stop)
     */
    closeStream: {
      params: {
        streamId: "string",
      },
      async handler(ctx) {
        const { streamId } = ctx.params;
        const streamData = thinklabsStreams.get(streamId);

        if (!streamData) {
          return { success: false, reason: 'stream_not_found' };
        }

        try {
          if (streamData.ws.readyState === WebSocket.OPEN) {
            streamData.ws.send(JSON.stringify({ action: "stop" }));
            // Có thể đợi một lúc trước khi close cứng, nhưng close() vẫn an toàn
            streamData.ws.close();
          }
          thinklabsStreams.delete(streamId);
          this.logger.info(`[ThinkLabs] closeStream: stream ${streamId} closed`);
          return { success: true };
        } catch (err) {
          this.logger.error(`[ThinkLabs] closeStream error (stream: ${streamId}):`, err);
          thinklabsStreams.delete(streamId);
          return { success: false };
        }
      },
    },

    /**
     * Mở lại stream nếu bị văng
     */
    reopenStream: {
      params: {
        streamId: "string",
        sessionId: "string",
      },
      async handler(ctx) {
        const { streamId, sessionId } = ctx.params;

        if (thinklabsStreams.has(streamId)) {
          return { streamId, reopened: false };
        }

        const ws = new WebSocket("wss://speech2text.thinklabs.com.vn/silero/ws");

        ws.on("message", (msg) => {
          try {
            const data = JSON.parse(msg.toString());
            const streamData = thinklabsStreams.get(streamId);
            if (data.status === "processing") return;
            if (data.text && data.is_final) {
              this.broker.emit("speech.stream.recognizing", {
                streamId, sessionId, text: data.text, isFinal: false,
              });
            } else if (data.action === "text_update") {
              if (data.error) return;
              const fullText = data.updated_text || '';
              const lastFinalized = streamData?.lastFinalizedText || '';
              let newText = fullText;
              if (lastFinalized && fullText.startsWith(lastFinalized)) {
                newText = fullText.slice(lastFinalized.length).trim();
              }
              if (streamData?.pendingCommit) {
                streamData.pendingCommit = false;
                streamData.lastFinalizedText = fullText;
                this.broker.emit("speech.stream.recognized", {
                  streamId, sessionId, text: newText, isFinal: true,
                });
              } else {
                this.broker.emit("speech.stream.recognizing", {
                  streamId, sessionId, text: newText, isFinal: false,
                });
              }
            } else if (data.action === "hints_updated") {
              if (streamData && streamData._hintsResolve) {
                streamData._hintsResolve({ keywordCount: data.keyword_count, mappingCount: data.mapping_count });
                streamData._hintsResolve = null;
              }
            }
          } catch (err) {
            this.logger.error(`[ThinkLabs] Parse error (reopened stream: ${streamId}):`, err);
          }
        });

        ws.on("close", (code, reason) => {
          this.logger.info(`[ThinkLabs] WS closed (reopened): ${streamId} (code=${code}, reason=${reason?.toString() || ''})`);
          thinklabsStreams.delete(streamId);
        });

        ws.on("error", (err) => {
          this.logger.error(`[ThinkLabs] WS error (reopened stream: ${streamId}):`, err);
        });

        thinklabsStreams.set(streamId, { ws, sessionId, _hintsResolve: null, pendingCommit: false, lastFinalizedText: '' });

        return new Promise((resolve, reject) => {
          ws.on("open", () => {
            this.logger.info(`[ThinkLabs] WS reopened: ${streamId} (session: ${sessionId})`);
            resolve({ streamId, reopened: true });
          });
          ws.on("error", reject);
        });
      },
    },
  },
};
