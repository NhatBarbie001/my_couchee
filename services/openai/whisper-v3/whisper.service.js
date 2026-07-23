"use strict";

const fs = require("fs");
const { OpenAI } = require("openai");
const Groq = require("groq-sdk");
const configuration = {
  apiKey: "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",
};
const { USER_CODES } = require("../../../constants/constant");

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

/** @type {ServiceSchema} */
module.exports = {
  name: "whisperV3",
  hooks: {
    before: {
      "*": "getAPIKey",
    }
  },
  /**
   * Settings
   */
  settings: {},

  /**
   * Dependencies
   */
  dependencies: [],

  /**
   * Actions
   */
  actions: {
    /**
     * Say a 'Hello' action.
     *
     * @returns
     */
    transcriptAudio: {
      timeout: 2 * 60 * 1000,
      rest: {
        method: "GET",
        path: "/transcript",
      },
      role: USER_CODES.SYSTEM_ADMIN,
      // visibility: "protected",
      async handler(ctx) {
        const { audioPath, model = "whisper-large-v3" } = ctx.params;
        try {
          const sizeCheck = await this.checkSize(audioPath);
          if (sizeCheck > 20) {
            return {
              error: "File size is greater than 20MB, try smaller video",
            };
          }
          const groq = new Groq({ apiKey: configuration.apiKey });
          // New
          const transcription = await groq.audio.transcriptions.create({
            model: model,
            file: fs.createReadStream(audioPath),
            prompt: "Specify context or spelling",
          });
          console.log("transcription.text", transcription.text);
          return transcription
        } catch (err) {
          return err;
        }
      },
    },
  },

  /**
   * Events
   */
  events: {},

  /**
   * Methods
   */
  methods: {
    checkSize: async (filePath) => {
      try {
        let stats = fs.statSync(filePath);
        let fileSizeInBytes = stats.size;
        // Convert the file size to megabytes (optional)
        let fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
        return fileSizeInMegabytes;
      } catch (error) {
        return error;
      }
    },
    async getAPIKey(ctx) {
      return ctx.meta.apiKey = this.settings.apiKey || process.env.OPENAI_API_KEY;
    },
  },

  /**
   * Service created lifecycle event handler
   */
  created() {
  },

  /**
   * Service started lifecycle event handler
   */
  async started() {
  },

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() {
  },
};
