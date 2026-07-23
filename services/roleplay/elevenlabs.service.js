const WebSocket = require("ws");
const functionsCommonMixin = require("../../mixins/functionsCommon.mixin");
const fileMixin = require("../../mixins/file.mixin");
const baseServiceMixin = require("../../mixins/baseService.mixin");
const { v4: uuidv4 } = require('uuid');
const { MoleculerClientError } = require('moleculer').Errors;

// Map: streamId → { ws, sessionId, tempBuffer }
const elevenStreams = new Map();

module.exports = {
  name: 'roleplay.elevenlabs',
  mixins: [functionsCommonMixin, fileMixin, baseServiceMixin],
  settings: {
    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY || "sk_50b164d55f842fa39e0a27cafffb33a6e90e426e4402972f",
    },
  },
  actions: {
    /**
     * Mở 1 WS connection duy nhất cho toàn bộ session.
     * Gọi 1 lần khi start session.
     */
    initializeSpeechStream: {
      params: {
        language: { type: "string", optional: true, default: "vi-VN" },
        sessionId: { type: "string" },
      },
      async handler(ctx) {
        const { sessionId } = ctx.params;
        const streamId = uuidv4();

        const ws = new WebSocket(
          "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=vi",
          {
            headers: {
              "xi-api-key": this.settings.elevenlabs.apiKey,
            },
          }
        );

        ws.on("open", () => {
          console.log(`[ElevenLabs] WS opened: ${streamId} (session: ${sessionId})`);
        });

        ws.on("message", (msg) => {
          try {
            const data = JSON.parse(msg.toString());

            if (data.message_type === "partial_transcript") {
              // Interim result – gửi về để hiển thị realtime
              this.broker.emit("speech.stream.recognizing", {
                streamId,
                sessionId,
                text: data.text,
                isFinal: false,
              });
            }

            if (data.message_type === "committed_transcript") {
              // Turn đã committed – emit final transcript
              console.log(`[ElevenLabs] committed_transcript: "${data.text}" (stream: ${streamId})`);
              this.broker.emit("speech.stream.recognized", {
                streamId,
                sessionId,
                text: data.text,
                isFinal: true,
                duration: data.duration,
              });
              // WS vẫn mở cho turn tiếp theo – không đóng ở đây
            }

          } catch (err) {
            this.logger.error(`[ElevenLabs] Parse error (stream: ${streamId}):`, err);
          }
        });

        ws.on("close", (code, reason) => {
          console.log(`[ElevenLabs] WS closed: ${streamId} (code=${code}, reason=${reason?.toString() || ''})`);
          elevenStreams.delete(streamId);
        });

        ws.on("error", (err) => {
          this.logger.error(`[ElevenLabs] WS error (stream: ${streamId}):`, err);
        });

        elevenStreams.set(streamId, {
          ws,
          sessionId,
          tempBuffer: Buffer.alloc(0),
        });

        return new Promise((resolve, reject) => {
          ws.on("open", () => resolve({ streamId }));
          ws.on("error", reject);
        });
      },
    },

    /**
     * Push audio chunk vào WS đang mở.
     */
    pushAudioToStream: {
      params: {
        streamId: "string",
        audioChunk: "any",
      },
      async handler(ctx) {
        const { streamId, audioChunk } = ctx.params;
        const streamData = elevenStreams.get(streamId);

        if (!streamData) return { success: false, reason: 'stream_not_found' };

        const buffer = Buffer.isBuffer(audioChunk)
          ? audioChunk
          : Buffer.from(audioChunk);

        try {
          streamData.tempBuffer = Buffer.concat([streamData.tempBuffer, buffer]);

          // Gửi mỗi ~100ms (~3200 bytes với 16kHz 16bit mono)
          if (streamData.tempBuffer.length >= 3200) {
            const base64Audio = streamData.tempBuffer.toString("base64");
            streamData.ws.send(
              JSON.stringify({
                message_type: "input_audio_chunk",
                audio_base_64: base64Audio,
                commit: false,
                sample_rate: 16000,
              })
            );
            streamData.tempBuffer = Buffer.alloc(0);
          }

          return { success: true };
        } catch (error) {
          throw new MoleculerClientError(`Failed to push audio: ${error.message}`, 500);
        }
      },
    },

    /**
     * Commit turn hiện tại: flush buffer còn lại + gửi commit:true.
     * WS vẫn MỞ để nhận audio cho turn tiếp theo.
     * Gọi mỗi khi VAD phát hiện silence (kết thúc lượt nói của student).
     */
    commitTurn: {
      params: {
        streamId: "string",
      },
      async handler(ctx) {
        const { streamId } = ctx.params;
        const streamData = elevenStreams.get(streamId);

        if (!streamData) {
          this.logger.warn(`[ElevenLabs] commitTurn: stream ${streamId} not found`);
          return { success: false };
        }

        try {
          // Flush buffer còn lại trước khi commit
          if (streamData.tempBuffer && streamData.tempBuffer.length > 0) {
            const base64Audio = streamData.tempBuffer.toString("base64");
            streamData.ws.send(
              JSON.stringify({
                message_type: "input_audio_chunk",
                audio_base_64: base64Audio,
                commit: false,
                sample_rate: 16000,
              })
            );
            streamData.tempBuffer = Buffer.alloc(0);
          }

          // Gửi commit – ElevenLabs sẽ trả về committed_transcript
          streamData.ws.send(
            JSON.stringify({
              message_type: "input_audio_chunk",
              audio_base_64: "",
              commit: true,
              sample_rate: 16000,
            })
          );

          console.log(`[ElevenLabs] commitTurn sent for stream: ${streamId}`);
          return { success: true };
        } catch (err) {
          this.logger.error(`[ElevenLabs] commitTurn error (stream: ${streamId}):`, err);
          return { success: false };
        }
      },
    },

    /**
     * Đóng WS thật sự khi kết thúc session.
     * Gọi 1 lần khi end/disconnect session.
     */
    closeStream: {
      params: {
        streamId: "string",
      },
      async handler(ctx) {
        const { streamId } = ctx.params;
        const streamData = elevenStreams.get(streamId);

        if (!streamData) {
          return { success: false, reason: 'stream_not_found' };
        }

        try {
          if (streamData.ws.readyState === WebSocket.OPEN) {
            streamData.ws.close();
          }
          elevenStreams.delete(streamId);
          console.log(`[ElevenLabs] closeStream: stream ${streamId} closed`);
          return { success: true };
        } catch (err) {
          this.logger.error(`[ElevenLabs] closeStream error (stream: ${streamId}):`, err);
          elevenStreams.delete(streamId);
          return { success: false };
        }
      },
    },

    /**
     * Mở lại WS cho cùng streamId (dùng khi ElevenLabs đóng conn sau committed_transcript).
     * Giữ nguyên streamId để state.sttStreamId không cần thay đổi.
     */
    reopenStream: {
      params: {
        streamId: "string",
        sessionId: "string",
      },
      async handler(ctx) {
        const { streamId, sessionId } = ctx.params;

        // Nếu stream vẫn còn tồn tại thì không cần mở lại
        if (elevenStreams.has(streamId)) {
          return { streamId, reopened: false };
        }

        const ws = new WebSocket(
          "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=vi",
          {
            headers: {
              "xi-api-key": this.settings.elevenlabs.apiKey,
            },
          }
        );

        ws.on("message", (msg) => {
          try {
            const data = JSON.parse(msg.toString());
            if (data.message_type === "partial_transcript") {
              this.broker.emit("speech.stream.recognizing", {
                streamId, sessionId, text: data.text, isFinal: false,
              });
            }
            if (data.message_type === "committed_transcript") {
              console.log(`[ElevenLabs] (reopened) committed_transcript: "${data.text}" (stream: ${streamId})`);
              this.broker.emit("speech.stream.recognized", {
                streamId, sessionId, text: data.text, isFinal: true, duration: data.duration,
              });
            }
          } catch (err) {
            this.logger.error(`[ElevenLabs] Parse error (reopened stream: ${streamId}):`, err);
          }
        });

        ws.on("close", (code, reason) => {
          console.log(`[ElevenLabs] WS closed (reopened): ${streamId} (code=${code}, reason=${reason?.toString() || ''})`);
          elevenStreams.delete(streamId);
        });

        ws.on("error", (err) => {
          this.logger.error(`[ElevenLabs] WS error (reopened stream: ${streamId}):`, err);
        });

        elevenStreams.set(streamId, { ws, sessionId, tempBuffer: Buffer.alloc(0) });

        return new Promise((resolve, reject) => {
          ws.on("open", () => {
            console.log(`[ElevenLabs] WS reopened: ${streamId} (session: ${sessionId})`);
            resolve({ streamId, reopened: true });
          });
          ws.on("error", reject);
        });
      },
    },
  },
};
