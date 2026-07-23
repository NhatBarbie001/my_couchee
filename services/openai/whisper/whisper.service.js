'use strict';

const fs = require('fs');
const {OpenAI} = require('openai');

const configuration = {
  apiKey:
    process.env.OPENAI_API_KEY ||
    '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',
};
const {USER_CODES} = require('../../../constants/constant');

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

/** @type {ServiceSchema} */
module.exports = {
  name: 'whisper',
  hooks: {
    before: {
      '*': 'getAPIKey',
    },
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
        method: 'GET',
        path: '/transcript',
      },
      role: USER_CODES.SYSTEM_ADMIN,
      // visibility: "protected",
      async handler(ctx) {
        const {audioPath, model = 'whisper-1'} = ctx.params;
        try {
          const sizeCheck = await this.checkSize(audioPath);
          if (sizeCheck > 20) {
            return {
              error: 'File size is greater than 20MB, try smaller video',
            };
          }
          const openai = new OpenAI({apiKey: configuration.apiKey});
          // New
          return await openai.audio.transcriptions.create({
            model: model,
            file: fs.createReadStream(audioPath),
            prompt: 'Hello, welcome to my lecture.',
          });
        } catch (err) {
          return err;
        }
      },
    },
    streamTranscript: {
      timeout: 2 * 60 * 1000,
      rest: {
        method: 'GET',
        path: '/transcript',
      },
      role: USER_CODES.SYSTEM_ADMIN,
      // visibility: "protected",
      async handler(ctx) {
        const {audioPath, model = 'gpt-4o-mini-transcribe', socket} = ctx.params;
        const {apiKey} = ctx.meta;
        const {apiKey: configApiKey} = await this.broker.call('llmsmodel.getOneByModel', {gptModel: model});
        try {
          const sizeCheck = await this.checkSize(audioPath);
          if (sizeCheck > 20) {
            return {
              error: 'File size is greater than 20MB, try smaller video',
            };
          }
          const openai = new OpenAI({apiKey: configApiKey || apiKey});
          // New
          const stream = await openai.audio.transcriptions.create({
            model: 'gpt-4o-mini-transcribe',
            file: fs.createReadStream(audioPath),
            response_format: 'json',
            stream: true,
            include: ['logprobs'],
          });
          let accumulatedText = '';
          const standardResults = [];
          for await (const event of stream) {
            console.log('event', event);
            if (event.type === 'transcript.text.delta') {
              standardResults.push({
                word: event.delta,
                accuracy: this.logprobToPercentage(event.logprobs[0].logprob),
              });
            }
            accumulatedText += event.delta || '';
            socket.send({state: 'recognizing', recognizing: accumulatedText});
          }
          console.log('standardResults', standardResults);
          return {transcript: accumulatedText, standardResults};
        } catch (err) {
          return err;
        }
      },
    },

    segmentTranscript: {
      timeout: 2 * 60 * 1000,
      rest: {
        method: 'GET',
        path: '/segmentTranscript',
      },
      async handler(ctx) {
        const {audioPath, model = 'whisper-1'} = ctx.params;
        const {apiKey} = ctx.meta;
        const {apiKey: configApiKey} = await this.broker.call('llmsmodel.getOneByModel', {gptModel: model});
        console.log('configApiKey', configApiKey);
        try {
          const sizeCheck = await this.checkSize(audioPath);
          if (sizeCheck > 20) {
            return {
              error: 'File size is greater than 20MB, try smaller video',
            };
          }
          const openai = new OpenAI({apiKey: configApiKey || apiKey});
          // New
          return await openai.audio.transcriptions.create({
            model: model,
            file: fs.createReadStream(audioPath),
            prompt: 'Hello, welcome to my lecture.',
            response_format: 'verbose_json',
            timestamp_granularities: ['segment'],
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
    checkSize: async filePath => {
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
      return (ctx.meta.apiKey = this.settings.apiKey || process.env.OPENAI_API_KEY);
    },

    logprobToPercentage(logprob) {
      // Kiểm tra đầu vào hợp lệ (logprob phải là số)
      if (typeof logprob !== 'number' || isNaN(logprob)) {
        console.error('Đầu vào không hợp lệ: logprob phải là một số.');
        return NaN; // Trả về Not-a-Number nếu đầu vào không hợp lệ
      }

      // Bước 1: Tính toán xác suất p = e ^ logprob
      // Math.exp(x) tính e^x trong JavaScript
      const probability = Math.exp(logprob);

      // Bước 2: Chuyển đổi xác suất (0 đến 1) thành phần trăm (0 đến 100)
      const percentage = probability * 100;

      return percentage;
    },
  },

  /**
   * Service created lifecycle event handler
   */
  created() {},

  /**
   * Service started lifecycle event handler
   */
  async started() {},

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() {},
};
