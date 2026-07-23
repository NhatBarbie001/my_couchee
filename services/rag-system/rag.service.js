module.exports = {
  name: 'rag',

  settings: {
    defaultLimit: 10,
    defaultScoreThreshold: 0.5,
    useHybridSearch: true,
    useRerank: true,
    rerankTopN: 5,
  },

  actions: {
    search: {
      rest: 'POST /search',
      params: {
        query: {type: 'string', min: 1},
        limit: {type: 'number', optional: true, default: 3, min: 1, max: 20},
        scoreThreshold: {type: 'number', optional: true, default: 0.5, min: 0, max: 1},
        organizationId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {query, limit, scoreThreshold, organizationId} = ctx.params;
        const useHybrid = ctx.params.useHybrid ?? this.settings.useHybridSearch;
        const useRerank = ctx.params.useRerank ?? this.settings.useRerank;

        const orgId = organizationId || ctx.meta.user?.organizationId;
        let filter;

        if (orgId) {
          let orgIds = [orgId];
          try {
            const scopeIds = await ctx.call('organizations.getScopeOrganizationIds', {id: orgId});
            if (scopeIds && scopeIds.length > 0) {
              orgIds = scopeIds;
            }
          } catch (error) {
            console.log('Failed to fetch organization scope for', orgId, error.message);
          }
          filter = {
            must: [
              {
                key: 'organizationId',
                match: {any: orgIds},
              },
            ],
          };
        }
        const enhancedQuery = this.enhanceQuery(query);
        const fetchLimit = useRerank ? limit * 3 : limit * 2;
        const minScore = scoreThreshold;

        let searchResults;

        if (useHybrid) {
          const [embeddingResult, sparseVector] = await Promise.all([
            ctx.call('embedding.createEmbedding', {text: enhancedQuery}),
            ctx.call('sparsevector.createSparseVector', {text: enhancedQuery}),
          ]);

          searchResults = await ctx.call('qdrant.searchHybrid', {
            collectionName: 'training_data',
            denseVector: embeddingResult.embedding,
            sparseVector,
            query: enhancedQuery,
            filter,
            limit: fetchLimit,
            scoreThreshold: minScore,
          });
        } else {
          const embeddingResult = await ctx.call('embedding.createEmbedding', {text: enhancedQuery});

          searchResults = await ctx.call('qdrant.searchPoints', {
            collectionName: 'training_data',
            vector: embeddingResult.embedding,
            filter,
            limit: fetchLimit,
            scoreThreshold: minScore,
          });
        }

        if (!searchResults || searchResults.length === 0) {
          return [];
        }

        if (useRerank) {
          const rerankResult = await ctx.call('rerank.rerankResults', {
            query: enhancedQuery,
            documents: searchResults,
            topN: Math.min(this.settings.rerankTopN, limit),
          });

          return rerankResult.results
            .filter(item => item.relevance_score >= scoreThreshold)
            .map(item => ({
              ...item.document,
              relevance_score: Math.round(item.relevance_score * 100) / 100,
              reranked: !rerankResult.fallback,
            }));
        }

        return searchResults.slice(0, limit).map(result => ({
          ...result,
          score: Math.round(result.score * 100) / 100,
        }));
      },
    },
  },

  methods: {
    enhanceQuery(query) {
      const normalizedQuery = query.trim().toLowerCase();

      const allKeywords = {
        'tư vấn': 'tư vấn hỗ trợ giải đáp',
        'khiếu nại': 'khiếu nại phàn nàn không hài lòng',
        'bán hàng': 'bán hàng chào hàng giới thiệu sản phẩm',
        'phỏng vấn': 'phỏng vấn tuyển dụng đánh giá ứng viên',
        'hướng dẫn': 'hướng dẫn chỉ dẫn giải thích',
        'xử lý': 'xử lý giải quyết khắc phục',
        'dịch vụ': 'dịch vụ chăm sóc hỗ trợ khách hàng',
        'khó tính': 'khó tính khó chịu thất vọng',
        'trung niên': 'trung niên 35-50 tuổi',
        trẻ: 'trẻ tuổi 20-30 tuổi',
        'lớn tuổi': 'lớn tuổi cao tuổi 50-70 tuổi',
        'vui vẻ': 'vui vẻ hòa đồng thân thiện',
        'khách hàng': 'khách hàng người mua người tiêu dùng',
        'chuyên nghiệp': 'chuyên nghiệp công việc văn phòng',
        'thẻ tín dụng': 'thẻ tín dụng credit card visa mastercard',
        'bảo hiểm': 'bảo hiểm bảo vệ quyền lợi',
        'tiết kiệm': 'tiết kiệm gửi tiền lãi suất',
        'chuyển tiền': 'chuyển tiền giao dịch thanh toán',
      };

      let enhanced = query;

      for (const [key, expansion] of Object.entries(allKeywords)) {
        if (normalizedQuery.includes(key)) {
          enhanced = `${query} ${expansion}`;
          break;
        }
      }

      return enhanced;
    },
  },

  async started() {},

  async stopped() {},
};
