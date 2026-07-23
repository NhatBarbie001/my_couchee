'use strict';

const OpenAI = require('openai');
const {MoleculerClientError} = require('moleculer').Errors;

module.exports = {
  name: 'embedding',

  settings: {
    openai: {
      apiKey:
        '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',
    },
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },

  actions: {
    createEmbedding: {
      params: {
        text: {type: 'string'},
        model: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {text, model} = ctx.params;
        const embeddingModel = model || this.settings.model;

        if (!text || text.trim().length === 0) {
          throw new MoleculerClientError('Text cannot be empty', 400, 'EMPTY_TEXT');
        }

        try {
          const response = await this.openai.embeddings.create({
            model: embeddingModel,
            input: text,
            dimensions: this.settings.dimensions,
          });

          return {
            embedding: response.data[0].embedding,
            model: embeddingModel,
            dimensions: response.data[0].embedding.length,
          };
        } catch (error) {
          throw new MoleculerClientError('Failed to create embedding', 500, 'EMBEDDING_ERROR', {
            error: error.message,
          });
        }
      },
    },

    createBatchEmbeddings: {
      params: {
        texts: {type: 'array', items: 'string', min: 1, max: 100},
        model: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {texts, model} = ctx.params;
        const embeddingModel = model || this.settings.model;

        const validTexts = texts.filter(text => text && text.trim().length > 0);

        if (validTexts.length === 0) {
          throw new MoleculerClientError('No valid texts provided', 400, 'NO_VALID_TEXTS');
        }

        try {
          const response = await this.openai.embeddings.create({
            model: embeddingModel,
            input: validTexts,
            dimensions: this.settings.dimensions,
          });

          return {
            embeddings: response.data.map(item => item.embedding),
            model: embeddingModel,
            count: response.data.length,
          };
        } catch (error) {
          this.logger.error('Error creating batch embeddings:', error);
          throw new MoleculerClientError('Failed to create batch embeddings', 500, 'BATCH_EMBEDDING_ERROR', {
            error: error.message,
          });
        }
      },
    },
  },

  methods: {},

  async created() {
    if (!this.settings.openai.apiKey) {
      this.logger.warn('OpenAI API key not configured. Embedding service may not work properly.');
    }

    this.openai = new OpenAI({
      apiKey: this.settings.openai.apiKey,
    });
  },

  async started() {},

  async stopped() {},
};
