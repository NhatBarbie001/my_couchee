'use strict';

const DbMixin = require('../../mixins/dbMongo.mixin');
const {MoleculerClientError} = require('moleculer').Errors;
const TrainingDataModel = require('./training-data.model');
const BaseService = require('../../mixins/baseService.mixin');
module.exports = {
  name: 'trainingdata',

  mixins: [DbMixin(TrainingDataModel), BaseService],

  settings: {
    entityValidator: {
      scenario: {type: 'object'},
      persona: {type: 'object', optional: true},
    },
    populates: {
      createdBy: 'users.get',
      organizationId: 'organizations.get',
    },
    populateOptions: ['createdBy', 'organizationId'],
  },

  actions: {
    submitScenario: {
      rest: 'POST /submit',
      params: {
        input: {type: 'string'},
        inputType: {type: 'string', enum: ['text', 'file'], default: 'text'},
        organizationId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {input, inputType} = ctx.params;
        const organizationId = ctx.meta.user?.organizationId || ctx.params.organizationId;
        try {
          const parsedData = await ctx.call('trainingdata.parseInputWithAI', {
            input,
            inputType,
          });
          console.log('parsedData', parsedData);
          const trainingData = await this.adapter.insert({
            ...parsedData,
            source: inputType === 'file' ? 'file_upload' : 'user_input',
            rawInput: input,
            organizationId: organizationId || null,
            createdBy: ctx.meta.user?._id || null,
            status: 'draft',
            indexed: false,
          });

          return {
            success: true,
            message: 'Scenario submitted successfully. Review and index to Qdrant.',
            data: trainingData,
          };
        } catch (error) {
          throw new MoleculerClientError('Failed to submit scenario: ' + error.message, 500);
        }
      },
    },

    uploadBatchFile: {
      async handler(ctx) {
        const {organizationId} = ctx.meta.$multipart || {};
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError('Unauthorized', 401);
        }

        try {
          ctx.meta.$multipart = ctx.meta.$multipart || {};
          ctx.meta.$multipart.fileType = 'file';
          ctx.meta.$multipart.folder = 'training-data';
          ctx.meta.$multipart.organizationId = organizationId || user.organizationId || null;

          const file = await ctx.call('files.upload', ctx.params, {meta: ctx.meta});
          if (!file) throw new MoleculerClientError('Không thể tải lên file', 500);
          const {totalPages, pdfPath} = await ctx.call('files.prepareFileForExtraction', {
            id: file._id.toString(),
            folder: 'training-data',
          });
          console.log('totalPages', totalPages);
          console.log('pdfPath', pdfPath);
          const chunkSize = 10;
          const chunks = [];
          for (let i = 1; i <= totalPages; i += chunkSize) {
            chunks.push({
              firstPage: i,
              lastPage: Math.min(i + chunkSize - 1, totalPages),
            });
          }

          const processedResults = await Promise.allSettled(
            chunks.map(async chunk => {
              const {text} = await ctx.call('files.extractTextFromFileId', {
                id: file._id,
                firstPage: chunk.firstPage,
                lastPage: chunk.lastPage,
                totalPages,
                storageLocation: 'training-data',
                pdfPath,
              });

              if (!text) {
                throw new Error(`Không tìm thấy văn bản cho trang ${chunk.firstPage}-${chunk.lastPage}`);
              }
              const extractedText = Array.isArray(text) ? text.map(t => t.value).join('\n') : text.value || text;
              const scenarios = await ctx.call('trainingdata.parseBatchScenariosWithAI', {
                text: extractedText,
              });

              if (!scenarios || scenarios.length === 0) {
                return [];
              }

              const insertedData = [];
              for (const scenarioData of scenarios) {
                const trainingData = await this.adapter.insert({
                  ...scenarioData,
                  source: 'file_upload',
                  rawInput: extractedText.substring(0, 1000),
                  organizationId: organizationId || user.organizationId || null,
                  createdBy: user._id,
                  status: 'draft',
                  indexed: false,
                });
                insertedData.push(trainingData);
              }
              return insertedData;
            }),
          );

          const successfulData = [];
          const errors = [];

          processedResults.forEach((result, index) => {
            const chunk = chunks[index];
            if (result.status === 'fulfilled') {
              successfulData.push(...result.value);
            } else {
              errors.push({
                pages: `${chunk.firstPage}-${chunk.lastPage}`,
                error: result.reason.message,
              });
            }
          });

          if (successfulData.length === 0) {
            throw new MoleculerClientError('Không tìm thấy kịch bản trong file', 400);
          }
          return {
            success: true,
            message: `Đã xử lý ${chunks.length} chunks. Đã lưu ${successfulData.length} kịch bản.`,
            data: successfulData,
            errors: errors.length > 0 ? errors : undefined,
            totalPages,
          };
        } catch (error) {
          throw new MoleculerClientError('Lỗi khi xử lý file: ' + error.message, 500);
        }
      },
    },

    parseBatchScenariosWithAI: {
      params: {
        text: {type: 'string'},
      },
      async handler(ctx) {
        const {text} = ctx.params;

        const systemPrompt = `Bạn là chuyên gia phân tích kịch bản đào tạo. Nhiệm vụ của bạn là đọc toàn bộ nội dung file và trích xuất TẤT CẢ các kịch bản training có trong đó.

          Trả về JSON theo đúng format sau:
          {
            "scenarios": [
              {
                "scenario": {
                  "name": "Tên kịch bản (bắt buộc)",
                  "description": "Mô tả chi tiết kịch bản",
                  "aiSpeaksFirst": "boolean",
                  "initialAiMessage": "Nội dung tin nhắn đầu tiên của AI nếu AI nói trước hoặc trả về null nếu không"
                },
                "persona": {
                  "name": "Tên nhân vật",
                  "age": 30,
                  "gender": "male hoặc female",
                  "role": "Vai trò (vd: Khách hàng, Ứng viên)",
                  "mood": "Tâm trạng (vd: Bực bội, Vui vẻ, Lo lắng)",
                  "personaBackground": "Bối cảnh nhân vật",
                  "personaConcern": "Mối quan tâm chính"
                },
                "data_label": {
                  "intent": "Ý định (vd: Complaint_Fee, Inquiry_Product)",
                  "product": "Sản phẩm liên quan (vd: Credit_Card, Savings_Account)",
                  "sentiment": "Cảm xúc (Positive, Negative/Angry, Neutral)",
                  "key_entity": ["Từ khóa quan trọng"]
                },
                "sample_conversation": [
                  {"role": "user", "content": "Lời thoại khách hàng"},
                  {"role": "assistant", "content": "Lời thoại nhân viên"}
                ]
              }
            ]
          }

          QUAN TRỌNG:
          - Phải trích xuất HẾT TẤT CẢ kịch bản có trong file
          - Mỗi kịch bản PHẢI có scenario.name
          - Nếu file có nhiều kịch bản, phải trả về array đầy đủ
          - Nếu không có thông tin chi tiết, điền giá trị mặc định hợp lý
          - sample_conversation phải đầy đủ theo text cung cấp nếu có`;

        const userPrompt = `Phân tích toàn bộ file và trích xuất TẤT CẢ các kịch bản JSON:\n\n${text}`;
        try {
          const aiResponse = await ctx.call('azureopenai.chatCompletion', {
            messages: [
              {role: 'system', content: systemPrompt},
              {role: 'user', content: userPrompt},
            ],
            model: 'gpt-4.1',
            schema: {
              type: 'object',
              properties: {
                scenarios: {type: 'array', items: {type: 'object'}},
              },
              required: ['scenarios'],
            },
            max_tokens: 10000,
            responseFormat: 'json_object',
          });
          if (!aiResponse.scenarios || !Array.isArray(aiResponse.scenarios)) {
            throw new Error('AI response missing scenarios array');
          }

          const validScenarios = aiResponse.scenarios.filter(s => s.scenario && s.scenario.name);

          if (validScenarios.length === 0) {
            throw new Error('No valid scenarios found in AI response');
          }

          return validScenarios;
        } catch (error) {
          throw new MoleculerClientError('Có lỗi khi AI phân tích kịch bản', 500);
        }
      },
    },

    parseInputWithAI: {
      params: {
        input: {type: 'string'},
        inputType: {type: 'string'},
      },
      handler: async function (ctx) {
        const {input, inputType} = ctx.params;

        const systemPrompt = `Bạn là chuyên gia phân tích kịch bản đào tạo. Nhiệm vụ của bạn là đọc mô tả kịch bản và trả về JSON theo đúng format sau:
          {
            "scenario": {
              "name": "Tên kịch bản (bắt buộc)",
              "description": "Mô tả chi tiết kịch bản",
              "aiSpeaksFirst": "boolean",
              "initialAiMessage": "Nội dung tin nhắn đầu tiên của AI nếu AI nói trước hoặc trả về null nếu không"
            },
            "persona": {
              "name": "Tên nhân vật",
              "age": 30,
              "gender": "male hoặc female",
              "role": "Vai trò (vd: Khách hàng, Ứng viên)",
              "mood": "Tâm trạng (vd: Bực bội, Vui vẻ, Lo lắng)",
              "personaBackground": "Bối cảnh nhân vật",
              "personaConcern": "Mối quan tâm chính"
            },
            "data_label": {
              "intent": "Ý định (vd: Complaint_Fee, Inquiry_Product)",
              "product": "Sản phẩm liên quan (vd: Credit_Card, Savings_Account)",
              "sentiment": "Cảm xúc (Positive, Negative/Angry, Neutral)",
              "key_entity": ["Từ khóa quan trọng"]
            },
            "sample_conversation": [
              {"role": "user", "content": "Lời thoại khách hàng"},
              {"role": "assistant", "content": "Lời thoại nhân viên"}
            ]
          }

          QUAN TRỌNG:
          - scenario.name là BẮT BUỘC
          - Nếu không có thông tin, để giá trị mặc định hợp lý
          - sample_conversation có thể để mảng rỗng nếu không có
          - Chỉ trả về JSON, không có text thêm`;

        const userPrompt = `Phân tích kịch bản sau và trả về JSON:\n\n${input}`;

        try {
          return await ctx.call('azureopenai.chatCompletion', {
            messages: [
              {role: 'system', content: systemPrompt},
              {role: 'user', content: userPrompt},
            ],
            model: 'gpt-4.1',
            temperature: 0.3,
            responseFormat: 'json_object',
            schema: {
              type: 'object',
              properties: {
                scenario: {type: 'object'},
                persona: {type: 'object', optional: true},
                data_label: {type: 'object'},
                sample_conversation: {type: 'array', items: {type: 'object'}},
              },
              required: ['scenario', 'data_label'],
            },
          });
        } catch (error) {
          this.logger.error('AI parsing failed:', error);
          throw new MoleculerClientError('AI failed to parse input: ' + error.message, 500);
        }
      },
    },

    indexToQdrant: {
      rest: 'POST /:id/index',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;

        const trainingData = await this.adapter.findById(id);
        if (!trainingData) {
          throw new MoleculerClientError('Training data not found', 404);
        }

        if (trainingData.indexed) {
          return {
            success: true,
            message: 'Already indexed',
            qdrantId: trainingData.qdrantId,
          };
        }

        try {
          const combinedText = this.buildCombinedText(trainingData);

          const [embedding, sparseVector] = await Promise.all([
            ctx.call('embedding.createEmbedding', {
              text: combinedText,
            }),
            ctx.call('sparsevector.createSparseVector', {
              text: combinedText,
            }),
          ]);

          const qdrantId = Date.now();

          const targetCollectionName = await ctx.call('qdrant.getTargetCollectionName', {
            collectionName: 'training_data',
          });

          await ctx.call('qdrant.upsertPoints', {
            collectionName: 'training_data',
            points: [
              {
                id: qdrantId,
                vector: embedding.embedding,
                sparse_vector: {
                  text: sparseVector,
                },
                payload: this.buildPayload(trainingData, qdrantId),
              },
            ],
          });

          await this.adapter.updateById(id, {
            $set: {
              qdrantId: qdrantId,
              indexed: true,
              indexedAt: new Date(),
              status: 'active',
              collectionName: targetCollectionName,
            },
          });

          this.logger.info(`Indexed training data ${id} to Qdrant with ID ${qdrantId}`);

          return {
            success: true,
            message: 'Indexed to Qdrant successfully',
            qdrantId,
          };
        } catch (error) {
          this.logger.error('Error indexing to Qdrant:', error);
          throw new MoleculerClientError('Failed to index: ' + error.message, 500);
        }
      },
    },

    indexMultipleToQdrant: {
      rest: 'POST /index-batch',
      params: {
        ids: {type: 'array', items: 'string', optional: true},
        batchSize: {type: 'number', optional: true, default: 10},
      },
      async handler(ctx) {
        const {ids, batchSize} = ctx.params;

        let trainingDataList;

        if (ids && ids.length > 0) {
          trainingDataList = await this.adapter.find({
            query: {_id: {$in: ids}},
          });
        } else {
          trainingDataList = await this.adapter.find({
            query: {indexed: {$ne: true}},
          });
        }

        if (!trainingDataList || trainingDataList.length === 0) {
          return {
            success: true,
            message: 'No training data to index',
            indexed: 0,
            skipped: 0,
            failed: 0,
          };
        }

        const results = {
          success: true,
          indexed: 0,
          skipped: 0,
          failed: 0,
          errors: [],
        };

        const toIndex = trainingDataList.filter(item => !item.indexed);
        const skipped = trainingDataList.length - toIndex.length;
        results.skipped = skipped;

        if (toIndex.length === 0) {
          return {
            ...results,
            message: 'All items already indexed',
          };
        }

        for (let i = 0; i < toIndex.length; i += batchSize) {
          const batch = toIndex.slice(i, i + batchSize);
          const baseTimestamp = Date.now();

          try {
            const embeddings = await Promise.all(
              batch.map(async (trainingData, idx) => {
                try {
                  const combinedText = this.buildCombinedText(trainingData);
                  const [embedding, sparseVector] = await Promise.all([
                    ctx.call('embedding.createEmbedding', {
                      text: combinedText,
                    }),
                    ctx.call('sparsevector.createSparseVector', {
                      text: combinedText,
                    }),
                  ]);
                  return {
                    trainingData,
                    embedding: embedding.embedding,
                    sparseVector,
                    qdrantId: baseTimestamp + idx,
                    success: true,
                  };
                } catch (error) {
                  this.logger.error(`Error creating embedding for ${trainingData._id}:`, error);
                  return {
                    trainingData,
                    success: false,
                    error: error.message,
                  };
                }
              }),
            );

            const successfulEmbeddings = embeddings.filter(e => e.success);
            const failedEmbeddings = embeddings.filter(e => !e.success);

            if (successfulEmbeddings.length > 0) {
              const points = successfulEmbeddings.map(item => ({
                id: item.qdrantId,
                vector: item.embedding,
                sparse_vector: {
                  text: item.sparseVector,
                },
                payload: this.buildPayload(item.trainingData, item.qdrantId),
              }));

              const targetCollectionName = await ctx.call('qdrant.getTargetCollectionName', {
                collectionName: 'training_data',
              });

              await ctx.call('qdrant.upsertPoints', {
                collectionName: 'training_data',
                points,
              });
              const bulkOps = successfulEmbeddings.map(item => ({
                updateOne: {
                  filter: {_id: item.trainingData._id},
                  update: {
                    $set: {
                      qdrantId: item.qdrantId,
                      indexed: true,
                      indexedAt: new Date(),
                      status: 'active',
                      collectionName: targetCollectionName,
                    },
                  },
                },
              }));

              await this.adapter.model.bulkWrite(bulkOps);

              results.indexed += successfulEmbeddings.length;
              this.logger.info(`Batch ${Math.floor(i / batchSize) + 1}: Indexed ${successfulEmbeddings.length} items`);
            }

            failedEmbeddings.forEach(item => {
              results.failed++;
              results.errors.push({
                id: item.trainingData._id.toString(),
                error: item.error,
              });
            });
          } catch (error) {
            this.logger.error(`Error processing batch ${Math.floor(i / batchSize) + 1}:`, error);
            batch.forEach(trainingData => {
              results.failed++;
              results.errors.push({
                id: trainingData._id.toString(),
                error: error.message,
              });
            });
          }
        }

        return {
          ...results,
          message: `Batch indexing completed. Indexed: ${results.indexed}, Skipped: ${results.skipped}, Failed: ${results.failed}`,
        };
      },
    },

    removeFromQdrant: {
      rest: 'DELETE /:id/index',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;

        const trainingData = await this.adapter.findById(id);
        if (!trainingData) {
          throw new MoleculerClientError('Training data not found', 404);
        }

        if (!trainingData.indexed || !trainingData.qdrantId) {
          return {success: true, message: 'Not indexed yet'};
        }

        try {
          await ctx.call('qdrant.deletePoints', {
            collectionName: trainingData.collectionName || 'training_data',
            pointIds: [trainingData.qdrantId.toString()],
          });

          await this.adapter.updateById(id, {
            $set: {
              indexed: false,
              indexedAt: null,
            },
          });

          return {
            success: true,
            message: 'Removed from Qdrant index',
          };
        } catch (error) {
          this.logger.error('Error removing from Qdrant:', error);
          throw new MoleculerClientError('Failed to remove index: ' + error.message, 500);
        }
      },
    },

    resetIndexedStatus: {
      rest: 'POST /reset-indexed',
      async handler(ctx) {
        try {
          const result = await this.adapter.updateMany(
            {},
            {
              $set: {
                indexed: false,
                indexedAt: null,
              },
            },
          );

          this.logger.info(`Reset indexed status for all training data`);
          return {
            success: true,
            message: 'All training data marked as not indexed',
            count: result.modifiedCount || result.nModified || 0,
          };
        } catch (error) {
          this.logger.error('Error resetting indexed status:', error);
          throw new MoleculerClientError('Failed to reset indexed status: ' + error.message, 500);
        }
      },
    },
  },

  methods: {
    buildCombinedText(item) {
      const parts = [];
      if (item.organizationId) parts.push(`Đơn vị: ${item.organizationId}`);
      if (item.scenario) {
        parts.push(`Kịch bản: ${item.scenario.name}`);
        if (item.scenario.description) parts.push(item.scenario.description);
      }

      if (item.persona) {
        parts.push(`Nhân vật: ${item.persona.name}`);
        if (item.persona.role) parts.push(`Vai trò: ${item.persona.role}`);
        if (item.persona.age) parts.push(`${item.persona.age} tuổi`);
        if (item.persona.gender) parts.push(item.persona.gender === 'male' ? 'Nam' : 'Nữ');
        if (item.persona.mood) parts.push(`Tâm trạng: ${item.persona.mood}`);
        if (item.persona.personaBackground) parts.push(`Bối cảnh: ${item.persona.personaBackground}`);
        if (item.persona.personaConcern) parts.push(`Mối quan tâm: ${item.persona.personaConcern}`);
      }

      if (item.data_label) {
        if (item.data_label.intent) parts.push(`Intent: ${item.data_label.intent}`);
        if (item.data_label.product) parts.push(`Product: ${item.data_label.product}`);
        if (item.data_label.sentiment) parts.push(`Sentiment: ${item.data_label.sentiment}`);
      }

      if (item.sample_conversation && Array.isArray(item.sample_conversation)) {
        const convText = item.sample_conversation.map(turn => `${turn.role}: ${turn.content}`).join(' ');
        parts.push(convText);
      }

      return parts.join('. ');
    },

    buildPayload(item, qdrantId) {
      const payload = {
        id: qdrantId,
        type: 'training_data',
        mongoId: item._id.toString(),
        organizationId: item.organizationId,
      };

      if (item.scenario) {
        payload.scenario = item.scenario;
      }

      if (item.persona) {
        payload.persona = item.persona;
      }

      if (item.data_label) {
        payload.data_label = item.data_label;
      }

      if (item.sample_conversation && item.sample_conversation.length > 0) {
        payload.sample_conversation = item.sample_conversation;
      }

      return payload;
    },
  },

  async started() {
    this.logger.info('Training Data service started');
  },

  async stopped() {
    this.logger.info('Training Data service stopped');
  },
};
