"use strict";

const fs = require("fs");
const {OpenAI} = require("openai");
const FunctionsCommon = require("../../../mixins/functionsCommon.mixin");
const {USER_CODES} = require("../../../constants/constant");
/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

/** @type {ServiceSchema} */
module.exports = {
  name: "chatgpt",
  mixins: [FunctionsCommon],
  /**
   * Settings
   */
  settings: {
    apiKey: process.env.OPENAI_API_KEY || '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',
  },
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
    transcriptAudio: {
      timeout: 5 * 60 * 1000,
      // visibility: "protected",
      rest: {
        method: "GET",
        path: "/transcript",
      },
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const audioPath = ctx.params.audioPath;
        try {
          const sizeCheck = await this.checkSize(audioPath);
          if (sizeCheck > 20) {
            return {
              error: "File size is greater than 20MB, try smaller video",
            };
          }
          const {apiKey} = ctx.meta;
          const openai = new OpenAI({apiKey});
          // New
          return await openai.audio.transcriptions.create({
            model: "whisper-1",
            file: fs.createReadStream(audioPath),
          });
        } catch (err) {
          return err;
        }
      },
    },
    chatCompletion: {
      timeout: 5 * 60 * 1000,
      rest: {
        method: "POST",
        path: "/chatCompletion",
      },
      role: USER_CODES.SYSTEM_ADMIN,
      // visibility: "protected",
      async handler(ctx) {
        try {
          const {
            messages,
            model,
            schema,
            responseFormat,
            responseId,
            temperature,
            max_tokens = 500,
            responseId: llmResponseId,
            apiKey,
            endpoint,
          } = ctx.params;
          // console.log("messages", messages);
          const openai = new OpenAI({apiKey: apiKey || this.settings.apiKey, baseURL: endpoint});
          const maxTokenParrams = model.includes('gpt-5.4') ? {max_completion_tokens: max_tokens} : {max_tokens: max_tokens};
          let body = {
            model: model || "gpt-4o-mini-2024-07-18",
            messages: [...messages],
            ...maxTokenParrams
          };
          if (responseFormat === 'json_object') {
            body = {
              ...body,
              messages: [...messages],
              tools: [{
                type: "function",
                function: {name: "show_response", description: "Show the response", parameters: schema}
              }],
              tool_choice: {type: "function", function: {name: "show_response"}},
              temperature
            };
          }
          const completion = await openai.chat.completions.create(body);
          const {completion_tokens, prompt_tokens, total_tokens} = completion.usage;
          this.broker.emit("llmGenerateCompleted", {
            id: responseId,
            completionTokens: completion_tokens,
            promptTokens: prompt_tokens,
            totalTokens: total_tokens,
            gptModel: model
          })
          if (responseFormat === 'json_object') {
            const generatedText = completion.choices[0].message.tool_calls[0].function.arguments;
            // console.log("generatedText", JSON.parse(generatedText));
            return JSON.parse(generatedText);
          }
          return completion.choices[0].message.content;

        } catch (err) {
          console.log(err);
          return err;
        }
      }
    },
    chatCompletionStream: {
      timeout: 5 * 60 * 1000,
      rest: {
        method: "POST",
        path: "/chatCompletionStream",
      },
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        try {
          const {
            messages,
            model,
            temperature,
            max_tokens = 500,
            apiKey,
            endpoint,
          } = ctx.params;

          const openai = new OpenAI({apiKey: apiKey || this.settings.apiKey, baseURL: endpoint});
          const maxTokenParrams = model && model.includes('gpt-5.4')
            ? {max_completion_tokens: max_tokens}
            : {max_tokens: max_tokens};

          const stream = await openai.chat.completions.create({
            model: model || "gpt-4o-mini-2024-07-18",
            messages: [...messages],
            ...maxTokenParrams,
            temperature: typeof temperature === 'number' ? temperature : undefined,
            stream: true,
          });

          return stream;
        } catch (err) {
          console.log(err);
          return err;
        }
      },
    },
    completion: {
      timeout: 5 * 60 * 1000,
      rest: {
        method: "POST",
        path: "/completion",
      },
      role: USER_CODES.SYSTEM_ADMIN,
      // visibility: "protected",
      async handler(ctx) {
        const {model, max_tokens, prompt} = ctx.params;

        let body = {
          model: model || "gpt-4o-mini",
          prompt,
          max_tokens: max_tokens || 4000
        };
        const {apiKey} = ctx.meta;
        const openai = new OpenAI({apiKey});
        // New
        const completion = await openai.chat.completions.create(body);
        return completion.choices[0].message.content;
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
