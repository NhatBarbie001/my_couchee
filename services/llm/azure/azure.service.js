const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');

const {AzureOpenAI} = require('openai');

/** @type {ServiceSchema} */
module.exports = {
  name: 'azureopenai',

  mixins: [FunctionsCommon],
  settings: {
    apiKey: '9a1LHL50ihVc6AXkyl6gQnh3b8hurbjB8gFZoxbTQpmSaNLi5rK5JQQJ99BJACqBBLyXJ3w3AAABACOG5pVe',
    region: 'southeastasia',
    endpoint: 'https://clickeesea.openai.azure.com/',
  },
  hooks: {} /**
   * Dependencies
   */,
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

    chatCompletion: {
      timeout: 5 * 60 * 1000,
      rest: {
        method: 'POST',
        path: '/chatCompletion',
      }, // visibility: "protected",
      async handler(ctx) {
        try {
          let {
            messages,
            model,
            schema,
            responseFormat,
            responseId,
            temperature,
            max_tokens = 10000,
            apiKey,
            endpoint,
          } = ctx.params;
          const connectConfig = {
            endpoint: endpoint || this.settings.endpoint,
            apiKey: apiKey || this.settings.apiKey,
            deployment: model || 'gpt-4.1',
            apiVersion: '2025-01-01-preview',
          };
          const client = new AzureOpenAI(connectConfig);
          const maxTokenParrams = model.includes('gpt-5.4')
            ? {max_completion_tokens: max_tokens}
            : {max_tokens: max_tokens};
          let body = {
            model: model || 'gpt-4.1',
            messages: [...messages],
            ...maxTokenParrams,
            temperature: parseFloat(temperature) || 0.7,
          };
          if (responseFormat === 'json_object') {
            body = {
              ...body,
              messages: [...messages],
              tools: [
                {
                  type: 'function',
                  function: {name: 'show_response', description: 'Show the response in JSON', parameters: schema},
                },
              ],
              tool_choice: {type: 'function', function: {name: 'show_response'}},
            };
          }
          const completion = await client.chat.completions.create(body);
          const {completion_tokens, prompt_tokens, total_tokens} = completion.usage;
          this.broker.emit('llmGenerateCompleted', {
            id: responseId,
            completionTokens: completion_tokens,
            promptTokens: prompt_tokens,
            totalTokens: total_tokens,
            gptModel: model,
          });

          if (responseFormat === 'json_object') {
            const generatedText = completion.choices[0].message.tool_calls[0].function.arguments;
            return JSON.parse(generatedText);
          }
          return completion.choices[0].message.content;
        } catch (err) {
          console.log(err);
          return '';
        }
      },
    },

    chatCompletionStream: {
      timeout: 5 * 60 * 1000,
      rest: {
        method: 'POST',
        path: '/chatCompletionStream',
      },
      async handler(ctx) {
        try {
          let {messages, model, temperature, max_tokens = 10000, apiKey, endpoint} = ctx.params;
          const connectConfig = {
            endpoint: endpoint || this.settings.endpoint,
            apiKey: apiKey || this.settings.apiKey,
            deployment: model || 'gpt-4.1',
            apiVersion: '2025-01-01-preview',
          };
          const client = new AzureOpenAI(connectConfig);
          const maxTokenParrams =
            model && model.includes('gpt-5.4') ? {max_completion_tokens: max_tokens} : {max_tokens: max_tokens};

          const stream = await client.chat.completions.create({
            model: model || 'gpt-4.1',
            messages: [...messages],
            ...maxTokenParrams,
            temperature: typeof temperature === 'number' ? temperature : 0.7,
            stream: true,
          });

          return stream;
        } catch (err) {
          console.log(err);
          return '';
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
      ctx.meta.apiKey = this.settings.apiKey || process.env.OPENAI_API_KEY;
      return ctx.meta.apiKey;
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
