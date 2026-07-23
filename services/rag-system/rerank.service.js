'use strict';

const {MoleculerClientError} = require('moleculer').Errors;
const axios = require('axios');

module.exports = {
  name: 'rerank',

  settings: {
    cohere: {
      apiKey: process.env.COHERE_API_KEY || 'paAgeO2aVSrRm5pZVsGEEzCLqMKN6uUjaYRc5Zvz',
      model: 'rerank-multilingual-v3.0',
      apiUrl: 'https://api.cohere.ai/v1/rerank',
    },
    fallbackEnabled: true,
  },

  actions: {
    rerankResults: {
      params: {
        query: {type: 'string'},
        documents: {type: 'array'},
        topN: {type: 'number', optional: true},
        returnDocuments: {type: 'boolean', optional: true, default: true},
      },
      async handler(ctx) {
        const {query, documents, topN, returnDocuments} = ctx.params;

        if (!documents || documents.length === 0) {
          return {results: [], fallback: false};
        }

        if (!this.settings.cohere.apiKey && this.settings.fallbackEnabled) {
          return {
            results: documents.slice(0, topN || documents.length).map((doc, index) => ({
              index,
              relevance_score: 1 - index * 0.1,
              document: doc,
            })),
            fallback: true,
          };
        }

        try {
          const docTexts = documents.map(doc => {
            if (typeof doc === 'string') return doc;
            if (doc.text) return doc.text;
            if (doc.payload) {
              const parts = [];
              if (doc.payload.scenario?.name) parts.push(doc.payload.scenario.name);
              if (doc.payload.scenario?.description) parts.push(doc.payload.scenario.description);
              if (doc.payload.persona?.name) parts.push(doc.payload.persona.name);
              if (doc.payload.persona?.role) parts.push(doc.payload.persona.role);
              return parts.join('. ') || JSON.stringify(doc.payload);
            }
            return JSON.stringify(doc);
          });

          const response = await axios.post(
            this.settings.cohere.apiUrl,
            {
              model: this.settings.cohere.model,
              query: query,
              documents: docTexts,
              top_n: topN || documents.length,
              return_documents: returnDocuments,
            },
            {
              headers: {
                Authorization: `Bearer ${this.settings.cohere.apiKey}`,
                'Content-Type': 'application/json',
              },
              timeout: 10000,
            },
          );

          const rerankedResults = response.data.results.map(result => ({
            index: result.index,
            relevance_score: result.relevance_score,
            document: documents[result.index],
          }));

          return {
            results: rerankedResults,
            fallback: false,
          };
        } catch (error) {
          if (this.settings.fallbackEnabled) {
            return {
              results: documents.slice(0, topN || documents.length).map((doc, index) => ({
                index,
                relevance_score: 1 - index * 0.1,
                document: doc,
              })),
              fallback: true,
            };
          }

          throw new MoleculerClientError('Failed to rerank results', 500, 'RERANK_ERROR', {
            error: error.message,
          });
        }
      },
    },
  },

  async started() {},

  async stopped() {},
};
