'use strict';

module.exports = {
  name: 'sparsevector',

  settings: {},

  actions: {
    createSparseVector: {
      params: {
        text: {type: 'string'},
      },
      async handler(ctx) {
        const {text} = ctx.params;

        if (!text || text.trim().length === 0) {
          return {indices: [], values: []};
        }

        const {indices, values} = this.generateBM25Vector(text);

        return {
          indices,
          values,
        };
      },
    },

    createBatchSparseVectors: {
      params: {
        texts: {type: 'array', items: 'string'},
      },
      async handler(ctx) {
        const {texts} = ctx.params;

        const sparseVectors = texts.map(text => {
          if (!text || text.trim().length === 0) {
            return {indices: [], values: []};
          }
          return this.generateBM25Vector(text);
        });

        return {
          sparseVectors,
          count: sparseVectors.length,
        };
      },
    },
  },

  methods: {
    generateBM25Vector(text) {
      const normalizedText = text.toLowerCase();

      const tokens = normalizedText
        .replace(/[^\wàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ\s]/gi, ' ')
        .split(/\s+/)
        .filter(token => token.length > 1);

      const termFrequency = {};
      tokens.forEach(token => {
        termFrequency[token] = (termFrequency[token] || 0) + 1;
      });

      for (let i = 0; i < tokens.length - 1; i++) {
        const bigram = tokens[i] + '_' + tokens[i + 1];
        termFrequency[bigram] = (termFrequency[bigram] || 0) + 0.8;
      }

      for (let i = 0; i < tokens.length - 2; i++) {
        const trigram = tokens[i] + '_' + tokens[i + 1] + '_' + tokens[i + 2];
        termFrequency[trigram] = (termFrequency[trigram] || 0) + 0.6;
      }

      const k1 = 1.5;
      const b = 0.75;
      const avgDocLength = 100;
      const docLength = tokens.length;

      const bm25Scores = {};
      for (const [term, tf] of Object.entries(termFrequency)) {
        const normalization = 1 - b + b * (docLength / avgDocLength);
        const score = (tf * (k1 + 1)) / (tf + k1 * normalization);
        bm25Scores[term] = score;
      }

      const sortedTerms = Object.entries(bm25Scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100);

      const indices = [];
      const values = [];

      sortedTerms.forEach(([term, score]) => {
        const hash = this.hashString(term);
        indices.push(hash);
        values.push(parseFloat(score.toFixed(4)));
      });

      return {indices, values};
    },

    hashString(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash) % 10000000;
    },
  },

  async started() {},

  async stopped() {},
};
