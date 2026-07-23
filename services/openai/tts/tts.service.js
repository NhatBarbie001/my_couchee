"use strict";

const fs = require("fs");
const {OpenAI} = require("openai");

const configuration = {
  apiKey:
    process.env.OPENAI_API_KEY ||
    "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",
};
const {USER_CODES} = require("../../../constants/constant");

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

/** @type {ServiceSchema} */
module.exports = {
  name: "tts",

  /**
   * Settings
   */
  settings: {},
  hooks: {
    before: {
      "*": "getAPIKey",
    }
  },
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
    textToSpeech: {
      timeout: 6 * 60 * 1000,
      rest: {
        method: "GET",
        path: "/textToSpeech",
      },
      role: USER_CODES.SYSTEM_ADMIN,
      // visibility: "protected",
      async handler(ctx) {
        const {text, voice = "alloy", model = "tts-1", speed = 1} = ctx.params;
        const {apiKey} = ctx.meta;
        const {apiKey: configApiKey} = await this.broker.call("llmsmodel.getOneByModel", {gptModel: model});

        try {
          console.log(text, voice, model, speed);
          const openai = new OpenAI({apiKey: configApiKey || apiKey});

          return await openai.audio.speech.create({
            model: model,
            voice: voice || "alloy",
            speed,
            input: text,
          });
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
