'use strict';

const {QdrantClient} = require('@qdrant/js-client-rest');
const {MoleculerClientError} = require('moleculer').Errors;

module.exports = {
  name: 'qdrant',

  settings: {
    qdrant: {
      url: process.env.QDRANT_URL || 'http://4.144.174.22:6333',
      apiKey: process.env.QDRANT_API_KEY || '2125d3e4a4dea3cb297acda46c0e30c6673fdbcbf72a77fa9d15a2d987be9ef8',
    },
    collections: {
      training_data: 'training_data',
    },
    vectorSize: 1536,
  },

  dependencies: ['settings'],

  actions: {
    createCollection: {
      params: {
        collectionName: {type: 'string'},
        vectorSize: {type: 'number', optional: true, default: 1536},
      },
      async handler(ctx) {
        const {collectionName, vectorSize} = ctx.params;
        const config = await this.getConfig(ctx);
        const client = this.getClient(config);
        const targetCollection = this.resolveTargetCollection(collectionName, config);

        try {
          const existsResult = await client.collectionExists(targetCollection);

          const exists = existsResult?.exists === true;

          if (!exists) {
            this.logger.info(`Creating collection ${targetCollection} with vectorSize ${vectorSize}`);

            const result = await client.createCollection(targetCollection, {
              vectors: {
                size: vectorSize,
                distance: 'Cosine',
              },
              sparse_vectors: {
                text: {},
              },
            });

            const verifyResult = await client.collectionExists(targetCollection);
            const verified = verifyResult?.exists === true;

            return {success: true, collectionName: targetCollection, created: true, verified};
          } else {
            return {success: true, collectionName: targetCollection, created: false, alreadyExists: true};
          }
        } catch (error) {
          console.error(`Full error creating collection ${targetCollection}:`, error);
          throw new MoleculerClientError('Failed to create collection', 500, 'COLLECTION_CREATE_ERROR', {
            error: error.message,
            stack: error.stack,
          });
        }
      },
    },

    upsertPoints: {
      params: {
        collectionName: {type: 'string'},
        points: {type: 'array'},
      },
      async handler(ctx) {
        const {collectionName, points} = ctx.params;
        const config = await this.getConfig(ctx);
        const client = this.getClient(config);
        const targetCollection = this.resolveTargetCollection(collectionName, config);

        if (!Array.isArray(points) || points.length === 0) {
          throw new MoleculerClientError('Points must be a non-empty array', 400);
        }

        for (const point of points) {
          if (!point.id || !point.vector) {
            throw new MoleculerClientError('Each point must have id and vector', 400);
          }
        }

        try {
          await client.upsert(targetCollection, {
            wait: true,
            points: points,
          });

          this.logger.info(`Upserted ${points.length} points to ${targetCollection}`);
          return {success: true, count: points.length};
        } catch (error) {
          this.logger.error(`Error upserting points to ${targetCollection}:`, error);
          throw new MoleculerClientError('Failed to upsert points', 500, 'UPSERT_ERROR', {error: error.message});
        }
      },
    },

    searchPoints: {
      async handler(ctx) {
        const {collectionName, vector, limit, filter, scoreThreshold} = ctx.params;
        const config = await this.getConfig(ctx);
        const client = this.getClient(config);
        const targetCollection = this.resolveTargetCollection(collectionName, config);
        console.log('[Qdrant] Searching in collection', targetCollection);
        try {
          const searchParams = {
            vector,
            limit: +limit,
            with_payload: true,
          };

          if (filter) {
            searchParams.filter = filter;
          }

          if (scoreThreshold) {
            searchParams.score_threshold = +scoreThreshold;
          }

          const results = await client.search(targetCollection, searchParams);

          return results.map(result => ({
            id: result.id,
            score: result.score,
            payload: result.payload,
          }));
        } catch (error) {
          this.logger.error(`Error searching in ${targetCollection}:`, error);
          throw new MoleculerClientError('Failed to search points', 500, 'SEARCH_ERROR', {error: error.message});
        }
      },
    },

    searchHybrid: {
      params: {
        collectionName: {type: 'string'},
        denseVector: {type: 'array'},
        sparseVector: {type: 'object', optional: true},
        query: {type: 'string'},
        limit: {type: 'number', optional: true, default: 10},
        filter: {type: 'object', optional: true},
        scoreThreshold: {type: 'number', optional: true},
      },
      async handler(ctx) {
        const {collectionName, denseVector, sparseVector, query, limit, filter, scoreThreshold} = ctx.params;
        const config = await this.getConfig(ctx);
        const client = this.getClient(config);
        const targetCollection = this.resolveTargetCollection(collectionName, config);
        try {
          const denseResults = await client.search(targetCollection, {
            vector: denseVector,
            limit: limit * 2,
            with_payload: true,
            filter,
          });

          if (!sparseVector || !sparseVector.indices || sparseVector.indices.length === 0) {
            return denseResults.slice(0, limit).map(result => ({
              id: result.id,
              score: result.score,
              payload: result.payload,
            }));
          }
          const sparseResults = await client.search(targetCollection, {
            vector: {
              name: 'text',
              vector: {
                indices: sparseVector.indices,
                values: sparseVector.values,
              },
            },
            limit: limit * 2,
            with_payload: true,
            filter,
          });

          const combined = this.fusionRRF([denseResults, sparseResults], limit);

          return combined.map(result => ({
            id: result.id,
            score: result.score,
            payload: result.payload,
          }));
        } catch (error) {
          throw new MoleculerClientError('Failed to perform hybrid search', 500, 'HYBRID_SEARCH_ERROR', {
            error: error.message,
          });
        }
      },
    },

    deletePoints: {
      params: {
        collectionName: {type: 'string'},
        pointIds: {type: 'array', items: 'string'},
      },
      async handler(ctx) {
        const {collectionName, pointIds} = ctx.params;
        const config = await this.getConfig(ctx);
        const client = this.getClient(config);
        const targetCollection = this.resolveTargetCollection(collectionName, config);

        try {
          await client.delete(targetCollection, {
            wait: true,
            points: pointIds,
          });

          return {success: true, count: pointIds.length};
        } catch (error) {
          throw new MoleculerClientError('Failed to delete points', 500, 'DELETE_ERROR', {error: error.message});
        }
      },
    },

    deleteCollection: {
      rest: 'DELETE /collection/:collectionName',
      params: {
        collectionName: {type: 'string'},
      },
      async handler(ctx) {
        const {collectionName} = ctx.params;
        const config = await this.getConfig(ctx);
        const client = this.getClient(config);
        const targetCollection = this.resolveTargetCollection(collectionName, config);

        try {
          await client.deleteCollection(targetCollection);
          return {success: true, message: `Collection ${targetCollection} deleted`};
        } catch (error) {
          throw new MoleculerClientError('Failed to delete collection', 500, 'DELETE_COLLECTION_ERROR', {
            error: error.message,
          });
        }
      },
    },

    getCollectionInfo: {
      params: {
        collectionName: {type: 'string'},
      },
      async handler(ctx) {
        const {collectionName} = ctx.params;
        const config = await this.getConfig(ctx);
        const client = this.getClient(config);
        const targetCollection = this.resolveTargetCollection(collectionName, config);

        try {
          const info = await client.getCollection(targetCollection);
          return info;
        } catch (error) {
          throw new MoleculerClientError('Failed to get collection info', 500, 'INFO_ERROR', {error: error.message});
        }
      },
    },

    getTargetCollectionName: {
      params: {
        collectionName: {type: 'string'},
      },
      async handler(ctx) {
        const config = await this.getConfig(ctx);
        return this.resolveTargetCollection(ctx.params.collectionName, config);
      },
    },

    initializeCollections: {
      rest: 'POST /initialize-collections',
      async handler(ctx) {
        try {
          const config = await this.getConfig(ctx);
          const targetCollection = config.collectionName;

          await ctx.call('qdrant.createCollection', {
            collectionName: this.settings.collections.training_data,
            vectorSize: this.settings.vectorSize,
          });

          return {
            success: true,
            message: `Collection ${targetCollection} created`,
            collections: [targetCollection],
          };
        } catch (error) {
          throw error;
        }
      },
    },
  },

  methods: {
    async getConfig(ctx) {
      try {
        const dbSettings = await ctx.call('settings.findOne').catch(() => null);
        return {
          url: dbSettings?.qdrantUrl || this.settings.qdrant.url,
          apiKey: dbSettings?.qdrantApiKey || this.settings.qdrant.apiKey,
          collectionName: dbSettings?.qdrantCollectionName || this.settings.collections.training_data,
        };
      } catch (e) {
        this.logger.warn('Failed to fetch qdrant settings from DB, using fallbacks');
        return {
          url: this.settings.qdrant.url,
          apiKey: this.settings.qdrant.apiKey,
          collectionName: this.settings.collections.training_data,
        };
      }
    },

    getClient(config) {
      if (!this._clients) this._clients = new Map();
      const key = `${config.url}_${config.apiKey}`;
      if (this._clients.has(key)) return this._clients.get(key);

      const client = new QdrantClient({
        url: config.url,
        apiKey: config.apiKey,
      });
      this._clients.set(key, client);
      return client;
    },

    resolveTargetCollection(collectionName, config) {
      if (collectionName === this.settings.collections.training_data) {
        return config.collectionName;
      }
      return collectionName;
    },

    fusionRRF(resultSets, limit, k = 60) {
      const scoreMap = new Map();

      resultSets.forEach(results => {
        results.forEach((result, index) => {
          const rank = index + 1;
          const rrfScore = 1 / (k + rank);

          const id = result.id;
          if (scoreMap.has(id)) {
            scoreMap.set(id, {
              ...scoreMap.get(id),
              score: scoreMap.get(id).score + rrfScore,
            });
          } else {
            scoreMap.set(id, {
              id: result.id,
              score: rrfScore,
              payload: result.payload,
            });
          }
        });
      });

      const combined = Array.from(scoreMap.values());
      combined.sort((a, b) => b.score - a.score);

      return combined.slice(0, limit);
    },
  },

  async created() {
    this._clients = new Map();
  },

  async started() {
    try {
      const config = await this.getConfig(this.broker);
      const client = this.getClient(config);
      const targetCollection = config.collectionName;

      const existsResult = await client.collectionExists(targetCollection);
      if (!existsResult?.exists) {
        const result = await client.createCollection(targetCollection, {
          vectors: {
            size: this.settings.vectorSize,
            distance: 'Cosine',
          },
          sparse_vectors: {
            text: {},
          },
        });

        const verifyResult = await client.collectionExists(targetCollection);
        const verified = verifyResult?.exists === true;
        console.log(`Collection ${targetCollection} created and verified: ${verified}`);
      } else {
        console.log(`Collection ${targetCollection} already exists.`);
      }
    } catch (error) {
      this.logger.error('Error during Qdrant initialization on start:', error);
    }
  },

  async stopped() {},
};
