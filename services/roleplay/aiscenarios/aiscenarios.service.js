'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./aiscenarios.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const z = require('zod');
const {zodResponseFormat} = require('openai/helpers/zod');

module.exports = {
  name: 'aiscenarios',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService],

  settings: {
    populates: {
      courseId: 'courses.get',
      aiPersonaId: 'aipersonas.get',
      scenarioCategoryId: 'scenariocategories.get',
      skillGroupIds: 'skillgroups.get',
      taskIds: 'tasks.get',
      references: 'references.get',
      organizationId: 'organizations.get',
      createdBy: 'users.get',
      updatedBy: 'users.get',
    },
    populateOptions: [
      'courseId',
      'aiPersonaId.voiceId',
      'aiPersonaId.llmModelId',
      'aiPersonaId.roleplayInstructionId',
      'taskIds',
      'references',
      'createdBy',
      'updatedBy',
      'skillGroupIds',
    ],
    fields: [
      '_id',
      'courseId',
      'aiPersonaId',
      'scenarioCategoryId',
      'skillGroupIds',
      'taskIds',
      'name',
      'description',
      'studentDescription',
      'aiDescription',
      'passScore',
      'estimatedCallTimeInMinutes',
      'organizationId',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
      'isDeleted',
      'status',
      'aiSpeaksFirst',
      'initialAiMessage',
      'moodleAssignmentId',
      'isCompleted',
      'enableStyleAnalysis',
      'simulationFormat',
      'references',
    ],
    defaultSort: 'createdAt',
  },

  hooks: {
    after: {},
    before: {},
  },

  dependencies: ['courses', 'aipersonas', 'roleplayinstruction', 'organizations', 'users', 'rag', 'references'],

  events: {
    // Xử lý khi task bị xóa
    'tasks.deleted': {
      async handler(payload) {
        if (payload.task && payload.task._id) {
          // Tìm tất cả scenarios có chứa taskId này và xóa nó khỏi mảng taskIds
          const taskId = payload.task._id;

          try {
            // Tìm tất cả scenarios có chứa taskId này
            const scenarios = await this.adapter.find({
              query: {
                taskIds: {$in: [taskId]},
                isDeleted: {$ne: true},
              },
            });

            // Cập nhật từng scenario để xóa taskId
            for (const scenario of scenarios) {
              const updatedTaskIds = scenario.taskIds.filter(id => id.toString() !== taskId.toString());
              await this.adapter.updateById(scenario._id, {
                $set: {taskIds: updatedTaskIds},
              });
              this.logger.info(`Removed task ${taskId} from scenario ${scenario._id}`);
            }
          } catch (error) {
            this.logger.error(`Error removing task ${taskId} from scenarios:`, error);
          }
        }
      },
    },
  },

  actions: {
    generateScenarioFromPrompt: {
      rest: 'POST /generate-by-prompt',
      params: {
        courseId: {type: 'string'},
        prompt: {type: 'string', min: 5, max: 5000},
        llmModelId: {type: 'string', optional: true},
        scenarioCategoryId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {courseId, prompt, scenarioCategoryId} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const course = await ctx.call('courses.get', {id: courseId, populate: ['references']}).catch(() => null);
        if (!course) {
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Khóa học không tồn tại'), 404);
        }

        const aiReadableRefs = (course.references || [])
          .filter(ref => ref && ref.aiReadable)
          .map(ref => ref._id || ref);

        const defaultModel = await ctx.call('llmsmodel.getDefaultModel');
        const llmModelId = ctx.params.llmModelId || defaultModel._id;

        try {
          const personaData = await ctx.call('aipersonas.createAIPersonaFromCourseContext', {
            courseId,
            userPrompt: prompt,
            llmModelId,
          });

          const scenarioData = await this.generateScenarioWithOpenAI(ctx, {
            courseId,
            description: prompt,
            llmModelId,
            persona: personaData,
          });

          const personaGender = personaData.gender || 'male';
          const voiceId = await this.getVoiceByGender(ctx, personaGender);

          const persona = await ctx.call('aipersonas.createAIPersona', {
            ...personaData,
            voiceId,
            status: 'draft',
            llmModelId: llmModelId,
          });

          // Tự động chọn roleplayInstructionId phù hợp cho persona
          await this.suggestRoleplayInstructionForPersona(
            ctx,
            persona,
            prompt,
            user.organizationId,
            llmModelId,
            scenarioCategoryId,
          );

          const maxOrderScenario = await this.adapter.find({
            query: {
              courseId: ctx.params.courseId,
              isDeleted: false,
            },
            fields: ['order'],
            limit: 1,
            sort: '-order',
          });
          const order = maxOrderScenario && maxOrderScenario[0].order !== undefined ? maxOrderScenario[0].order + 1 : 1;

          const scenario = await this.adapter.insert({
            courseId,
            aiPersonaId: persona._id,
            name: scenarioData.name,
            description: scenarioData.description,
            studentDescription: scenarioData.studentDescription,
            aiDescription: scenarioData.aiDescription,

            passScore: scenarioData.passScore ?? 70,
            estimatedCallTimeInMinutes: scenarioData.estimatedCallTimeInMinutes ?? 10,
            organizationId: user.organizationId,
            aiSpeaksFirst: scenarioData.aiSpeaksFirst || false,
            initialAiMessage: scenarioData.initialAiMessage || '',
            createdBy: user._id,
            updatedBy: user._id,
            status: 'draft',
            simulationFormat: scenarioData.simulationFormat || 'dialogue',
            references: aiReadableRefs,
            scenarioCategoryId,
            order,
          });

          // Tự chọn nhóm kỹ năng đánh giá phù hợp
          await this.suggestSkillGroupsForScenario(ctx, scenario, llmModelId);

          // Resolve enableStyleAnalysis từ nhóm kỹ năng đánh giá đã được gợi ý
          const enableStyleAnalysis = await this.resolveEnableStyleAnalysis(ctx, scenario.skillGroupIds || []);
          if (enableStyleAnalysis) {
            await this.adapter.updateById(scenario._id, {$set: {enableStyleAnalysis}});
            scenario.enableStyleAnalysis = enableStyleAnalysis;
          }

          const configuredSkills = await this.suggestSkillsForScenario(ctx, scenario, user.organizationId, llmModelId);

          return {
            source: 'prompt',
            scenario: await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, scenario),
            persona,
            skills: configuredSkills,
          };
        } catch (error) {
          this.logger.error('Error generating scenario from prompt:', error);
          throw new MoleculerClientError(
            i18next.t('error.scenario_generation_failed', 'Không thể tạo kịch bản từ AI'),
            500,
          );
        }
      },
    },

    generateDescriptionsByAI: {
      rest: 'POST /generate-descriptions-by-ai',
      params: {
        promptInput: {type: 'string'},
        referenceIds: {type: 'array', items: 'string', optional: true},
        categoryId: {type: 'string', optional: true},
        courseId: {type: 'string'},
        skillGroupIds: {type: 'array', items: 'string', optional: true},
      },
      async handler(ctx) {
        let {promptInput, referenceIds, categoryId} = ctx.params;

        let trainingDescription = '';

        if (categoryId) {
          try {
            const category = await ctx.call('scenariocategories.get', {id: categoryId});
            if (category) {
              if (category.trainingDescription) trainingDescription = category.trainingDescription;
            }
          } catch (err) {
            this.logger.warn('Error fetching scenario category:', err);
          }
        }

        const trainingDescSection = trainingDescription
          ? `\n\nHướng dẫn huấn luyện cho loại kịch bản này:\n${trainingDescription}`
          : '';

        const systemPrompt = `Bạn là chuyên gia thiết kế kịch bản đào tạo nhập vai (roleplay) cho nhân viên.

Từ mô tả kịch bản dưới đây, hãy tạo ra thông tin tổng quan kịch bản và HAI phiếu kịch bản riêng biệt:

1. Tên kịch bản: Tên ngắn gọn cho kịch bản.
2. Mô tả tổng quan: Đoạn văn mô tả tóm tắt bối cảnh và mục tiêu kịch bản.
3. Thời lượng phút (số nguyên): Ước tính từ 5 - 30 phút.
4. Điểm đạt (số nguyên): Mức điểm để qua bài (thường từ 60 - 90).
5. MÔ TẢ CHO HỌC VIÊN — chỉ chứa thông tin học viên cần biết để thực hiện tốt vai diễn của mình. Không tiết lộ thông tin ẩn, không tiết lộ kịch bản phản ứng của huấn luyện viên.
6. MÔ TẢ CHO HUẤN LUYỆN VIÊN — chứa đầy đủ thông tin để huấn luyện viên đóng vai nhân vật một cách nhất quán và thực tế, bao gồm: nhân vật, động cơ, thông tin ẩn, chuỗi phản đối, điều kiện leo thang/xuống thang, và kết quả chấp nhận được.
${trainingDescSection}
Yêu cầu:
- Viết bằng tiếng Việt, tự nhiên và sát thực tế.
- Mọi câu thoại phải cụ thể, không chung chung.
- TÓM TẮT NGẮN GỌN tài liệu nghiệp vụ. KHÔNG ĐƯỢC chép lại nội dung tài liệu. Chỉ giữ lại những số liệu, quy định tối thiểu cần thiết để đóng vai tình huống (dài tối đa 300 từ).
- Phần thông tin ẩn phải có giá trị thực sự — tức là chỉ học viên giỏi mới khai thác được.
- LƯU Ý QUAN TRỌNG ĐỐI VỚI "aiDescription": Lược bỏ các thông tin như Tên, Vai trò, Tâm trạng, Mối quan tâm của AI. Chỉ tập trung viết về bối cảnh, kịch bản phản ứng và thái độ ứng xử để tránh lặp lặp dữ liệu với form Thông tin AI Coach.

Chỉ trả về object JSON hợp lệ với các trường: "name", "description", "estimatedCallTimeInMinutes", "passScore", "studentDescription" và "aiDescription", không giải thích thêm:
{
  "name": "string",
  "description": "string",
  "estimatedCallTimeInMinutes": 15,
  "passScore": 80,
  "studentDescription": "string - Nội dung phiếu học viên",
  "aiDescription": "string - Nội dung phiếu huấn luyện viên"
}`;

        if (referenceIds && referenceIds.length > 0) {
          try {
            const references = await ctx.call('references.find', {
              query: {_id: {$in: referenceIds}},
            });
            if (references && references.length > 0) {
              const refsContent = references
                .map(ref => ref.content || ref.extractedText || ref.url || ref.name)
                .join('\n---\n');
              promptInput += `\n\n[TÀI LIỆU NGHIỆP VỤ (HỆ THỐNG TỰ ĐỘNG LẤY TỪ SELECT)]\n${refsContent}`;
            }
          } catch (err) {
            this.logger.warn('Error fetching references for prompt generation:', err);
          }
        }

        const messages = [
          {role: 'system', content: systemPrompt},
          {role: 'user', content: promptInput},
        ];

        const schemaZod = z.object({
          name: z.string(),
          description: z.string(),
          estimatedCallTimeInMinutes: z.number(),
          passScore: z.number(),
          studentDescription: z.string(),
          aiDescription: z.string(),
        });

        // Lấy theo llm default của hệ thống
        const modelData = await ctx.call('llmsmodel.getDefaultModel');
        const {apiKey, model, endpoint} = modelData;
        const modelInterface = modelData?.modelInterface || 'AzureOpenAI';

        const aiResult = await ctx.call(
          modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
          {
            messages,
            schema: zodResponseFormat(schemaZod, 'descriptions').json_schema.schema,
            responseFormat: 'json_object',
            apiKey,
            model,
            endpoint,
            max_tokens: 16384,
          },
        );

        const descriptions = typeof aiResult === 'string' ? JSON.parse(aiResult) : aiResult;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const course = await ctx
          .call('courses.get', {
            id: ctx.params.courseId,
            populate: ['references'],
          })
          .catch(() => null);
        if (!course) {
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Khóa học không tồn tại'), 404);
        }

        const aiReadableRefs = (course.references || [])
          .filter(ref => ref && ref.aiReadable)
          .map(ref => ref._id || ref);

        const personaData = await ctx.call('aipersonas.createAIPersonaFromCourseContext', {
          courseId: ctx.params.courseId,
          userPrompt: `Tạo persona phù hợp cho nhập vai sau: ${descriptions.aiDescription}`,
          llmModelId: modelData._id,
        });

        // Trich xuat conversationEndCondition tu aiDescription
        const extractedEndCondition = await this.extractConversationEndCondition(ctx, {
          aiDescription: descriptions.aiDescription,
          modelData,
        });

        const personaGender = personaData.gender || 'male';
        const voiceId = await this.getVoiceByGender(ctx, personaGender);

        const persona = await ctx.call('aipersonas.createAIPersona', {
          ...personaData,
          voiceId,
          conversationEndCondition: extractedEndCondition || '',
          status: 'draft',
          llmModelId: modelData._id,
        });

        const maxOrderScenario = await this.adapter.find({
          query: {
            courseId: ctx.params.courseId,
            isDeleted: false,
          },
          fields: ['order'],
          limit: 1,
          sort: '-order',
        });
        const order = maxOrderScenario && maxOrderScenario[0].order !== undefined ? maxOrderScenario[0].order + 1 : 1;

        let resolvedEnableStyleAnalysis = false;
        if (ctx.params.skillGroupIds && ctx.params.skillGroupIds.length > 0) {
          resolvedEnableStyleAnalysis = await this.resolveEnableStyleAnalysis(ctx, ctx.params.skillGroupIds);
        }

        const scenario = await this.adapter.insert({
          courseId: ctx.params.courseId,
          aiPersonaId: persona._id,
          name: descriptions.name,
          description: descriptions.description,
          studentDescription: descriptions.studentDescription,
          aiDescription: descriptions.aiDescription,
          passScore: descriptions.passScore ?? 70,
          estimatedCallTimeInMinutes: descriptions.estimatedCallTimeInMinutes ?? 10,
          organizationId: user.organizationId,
          aiSpeaksFirst: false,
          initialAiMessage: '',
          createdBy: user._id,
          updatedBy: user._id,
          status: 'draft',
          simulationFormat: 'dialogue',
          references: referenceIds || aiReadableRefs,
          scenarioCategoryId: categoryId,
          skillGroupIds: ctx.params.skillGroupIds || [],
          enableStyleAnalysis: resolvedEnableStyleAnalysis,
          order,
        });

        if (ctx.params.skillGroupIds && ctx.params.skillGroupIds.length > 0) {
          scenario.skillGroupIds = ctx.params.skillGroupIds;
        } else {
          await this.suggestSkillGroupsForScenario(ctx, scenario, modelData._id);
        }

        const configuredSkills = await this.suggestSkillsForScenario(ctx, scenario, user.organizationId, modelData._id);

        return {
          source: 'openai',
          scenario: await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, scenario),
          persona,
          skills: configuredSkills,
        };
      },
    },

    generateScenarioFromDescription: {
      rest: 'POST /generate-by-description',
      params: {
        courseId: {type: 'string'},
        description: {type: 'string'},
        name: {type: 'string', optional: true},
        passScore: {type: 'number', optional: true, min: 0, max: 100},
        estimatedCallTimeInMinutes: {type: 'number', optional: true, min: 0},

        simulationFormat: {type: 'string', optional: true, enum: ['dialogue', 'knowledge_test']},
        moodleAssignmentId: {type: 'number', optional: true},
        scenarioCategoryId: {type: 'string', optional: true},
        skillGroupIds: {type: 'array', optional: true, items: 'string'},
        aiSpeaksFirst: {type: 'boolean', optional: true},
        initialAiMessage: {type: 'string', optional: true},
        enableStyleAnalysis: {type: 'boolean', optional: true},
        llmModelId: {type: 'string', optional: true},
        references: {type: 'array', optional: true},
      },
      async handler(ctx) {
        const {
          courseId,
          description,
          aiDescription,
          studentDescription,
          estimatedCallTimeInMinutes,
          passScore,
          name,
          moodleAssignmentId,
          simulationFormat,
          scenarioCategoryId,
          skillGroupIds,
          aiSpeaksFirst,
          initialAiMessage,
          enableStyleAnalysis,
          references,
        } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const course = await ctx.call('courses.get', {id: courseId, populate: ['references']}).catch(() => null);
        if (!course) {
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Khóa học không tồn tại'), 404);
        }

        const aiReadableRefs = (course.references || [])
          .filter(ref => ref && ref.aiReadable)
          .map(ref => ref._id || ref);

        const defaultModel = await ctx.call('llmsmodel.getDefaultModel');
        const llmModelId = ctx.params.llmModelId || defaultModel._id;

        // Resolve enableStyleAnalysis từ nhóm kỹ năng đánh giá nếu user không truyền
        let resolvedEnableStyleAnalysis = enableStyleAnalysis;
        if (resolvedEnableStyleAnalysis === undefined && skillGroupIds && skillGroupIds.length > 0) {
          resolvedEnableStyleAnalysis = await this.resolveEnableStyleAnalysis(ctx, skillGroupIds);
        }

        try {
          const ragResults = await ctx.call('rag.search', {
            query: description,
            limit: 3,
            scoreThreshold: 0.75,
          });
          if (ragResults && ragResults.length > 0) {
            const templateData = ragResults[0].payload;
            const personaFromTemplate = templateData.persona || {};
            const scenarioData = templateData.scenario || {};
            const sampleConversation = templateData.sample_conversation || [];
            const personaGender = personaFromTemplate.gender || 'male';
            const voiceId = await this.getVoiceByGender(ctx, personaGender);
            const persona = await ctx.call('aipersonas.insert', {
              entity: {
                name: personaFromTemplate.name || 'AI Persona',
                age: personaFromTemplate.age || 30,
                gender: personaGender,
                avatarId: null,
                role: personaFromTemplate.role || '',
                mood: personaFromTemplate.mood || '',
                organization: personaFromTemplate.organization || '',
                smallTalkLikely: personaFromTemplate.smallTalkLikely || 50,
                filterWords: personaFromTemplate.filterWords || [],
                personaBackground: personaFromTemplate.personaBackground || '',
                personaConcern: personaFromTemplate.personaConcern || '',
                voiceId,
                conversationStyle: personaFromTemplate.conversationStyle || '',
                conversationEndCondition: personaFromTemplate.conversationEndCondition || '',
                status: 'draft',
                createdBy: user._id,
                updatedBy: user._id,
                organizationId: user.organizationId,
                isDeleted: false,
              },
            });

            const scenarioName = scenarioData.name || `Kịch bản: ${description.substring(0, 50)}`;
            const scenarioDescription = scenarioData.description || `Kịch bản được tạo dựa trên: ${description}`;

            const maxOrderScenario = await this.adapter.find({
              query: {
                courseId: ctx.params.courseId,
                isDeleted: false,
              },
              fields: ['order'],
              limit: 1,
              sort: '-order',
            });
            const order =
              maxOrderScenario && maxOrderScenario[0].order !== undefined ? maxOrderScenario[0].order + 1 : 1;

            const scenario = await this.adapter.insert({
              courseId,
              aiPersonaId: persona._id,
              name: name || scenarioName,
              description: description || scenarioDescription,
              studentDescription: studentDescription || scenarioData.studentDescription,
              aiDescription: aiDescription || scenarioData.aiDescription,

              passScore: passScore ?? scenarioData.passScore ?? 70,
              estimatedCallTimeInMinutes: estimatedCallTimeInMinutes ?? scenarioData.estimatedCallTimeInMinutes ?? 10,
              organizationId: user.organizationId,
              aiSpeaksFirst: aiSpeaksFirst ?? scenarioData.aiSpeaksFirst ?? false,
              initialAiMessage: initialAiMessage || scenarioData.initialAiMessage || '',
              createdBy: user._id,
              updatedBy: user._id,
              status: 'draft',
              moodleAssignmentId,
              simulationFormat: simulationFormat || scenarioData.simulationFormat || 'dialogue',
              references: references || aiReadableRefs,
              scenarioCategoryId,
              skillGroupIds: skillGroupIds || [],
              enableStyleAnalysis: resolvedEnableStyleAnalysis,
              order,
            });

            if (skillGroupIds && skillGroupIds.length > 0) {
              scenario.skillGroupIds = skillGroupIds;
            } else {
              await this.suggestSkillGroupsForScenario(ctx, scenario, llmModelId);
            }

            // Gợi ý và cấu hình skills cho scenario
            const configuredSkills = await this.suggestSkillsForScenario(
              ctx,
              scenario,
              user.organizationId,
              llmModelId,
            );

            return {
              source: 'template',
              scenario: await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, scenario),
              persona,
              skills: configuredSkills,
              templateMatch: {
                score: ragResults[0].score,
                templateName: templateData.scenarioName,
              },
            };
          } else {
            const personaData = await ctx.call('aipersonas.createAIPersonaFromCourseContext', {
              courseId,
              userPrompt: `Tạo persona phù hợp cho nhập vai sau: ${aiDescription}`,
              llmModelId,
            });

            const scenarioData = await this.generateScenarioWithOpenAI(ctx, {
              courseId,
              aiDescription,
              llmModelId,
              persona: personaData,
            });

            const personaGender = personaData.gender || 'male';
            const voiceId = await this.getVoiceByGender(ctx, personaGender);

            // Trích xuất conversationEndCondition từ aiDescription
            const extractedEndCondition = await this.extractConversationEndCondition(ctx, {
              aiDescription,
              llmModelId,
              modelData: defaultModel,
            });

            const persona = await ctx.call('aipersonas.createAIPersona', {
              ...personaData,
              voiceId,
              conversationEndCondition: extractedEndCondition || '',
              status: 'draft',
              llmModelId: llmModelId,
            });

            const maxOrderScenario = await this.adapter.find({
              query: {
                courseId: ctx.params.courseId,
                isDeleted: false,
              },
              fields: ['order'],
              limit: 1,
              sort: '-order',
            });
            const order =
              maxOrderScenario && maxOrderScenario[0].order !== undefined ? maxOrderScenario[0].order + 1 : 1;

            const scenario = await this.adapter.insert({
              courseId,
              aiPersonaId: persona._id,
              name: name || scenarioData.name,
              description: description || scenarioData.description,
              studentDescription: studentDescription || scenarioData.studentDescription,
              aiDescription: aiDescription || scenarioData.aiDescription,

              passScore: passScore ?? scenarioData.passScore ?? 70,
              estimatedCallTimeInMinutes: estimatedCallTimeInMinutes ?? scenarioData.estimatedCallTimeInMinutes ?? 10,
              organizationId: user.organizationId,
              aiSpeaksFirst: aiSpeaksFirst ?? scenarioData.aiSpeaksFirst ?? false,
              initialAiMessage: initialAiMessage || scenarioData.initialAiMessage || '',
              createdBy: user._id,
              updatedBy: user._id,
              status: 'draft',
              moodleAssignmentId,
              simulationFormat: simulationFormat || scenarioData.simulationFormat || 'dialogue',
              references: aiReadableRefs,
              scenarioCategoryId,
              skillGroupIds: skillGroupIds || [],
              enableStyleAnalysis: resolvedEnableStyleAnalysis,
              order,
            });

            // Nếu user gửi skillGroupIds -> dùng trực tiếp, không cần AI suggest
            if (skillGroupIds && skillGroupIds.length > 0) {
              scenario.skillGroupIds = skillGroupIds;
            } else {
              await this.suggestSkillGroupsForScenario(ctx, scenario, llmModelId);
            }

            const configuredSkills = await this.suggestSkillsForScenario(
              ctx,
              scenario,
              user.organizationId,
              llmModelId,
            );

            return {
              source: 'openai',
              scenario: await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, scenario),
              persona,
              skills: configuredSkills,
            };
          }
        } catch (error) {
          console.log(error);
          throw new MoleculerClientError(
            i18next.t('error.scenario_generation_failed', 'Không thể tạo kịch bản từ AI'),
            500,
          );
        }
      },
    },

    generateScenarioFromDraftScenario: {
      rest: 'PUT /:id/generate-from-draft-scenario',
      params: {
        id: {type: 'string'},
        description: {type: 'string', optional: true},
        name: {type: 'string', optional: true},
        passScore: {type: 'number', optional: true, min: 0, max: 100},
        estimatedCallTimeInMinutes: {type: 'number', optional: true, min: 0},
        simulationFormat: {type: 'string', optional: true, enum: ['dialogue', 'knowledge_test']},
        scenarioCategoryId: {type: 'string', optional: true},
        skillGroupIds: {type: 'array', optional: true, items: 'string'},
        aiSpeaksFirst: {type: 'boolean', optional: true},
        initialAiMessage: {type: 'string', optional: true},
        enableStyleAnalysis: {type: 'boolean', optional: true},
        llmModelId: {type: 'string', optional: true},
        references: {type: 'array', optional: true},
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        // Lấy scenario hiện tại
        const existingScenario = await this.adapter.findById(id);
        if (!existingScenario || existingScenario.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Kịch bản không tồn tại'), 404);
        }

        const courseId = existingScenario.courseId.toString();
        const course = await ctx.call('courses.get', {id: courseId, populate: ['references']}).catch(() => null);
        if (!course) {
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Khóa học không tồn tại'), 404);
        }

        // Merge dữ liệu: payload mới ghi đè lên dữ liệu cũ
        const mergedData = {
          name: ctx.params.name ?? existingScenario.name,
          description: ctx.params.description ?? existingScenario.description,
          passScore: ctx.params.passScore ?? existingScenario.passScore ?? 70,
          estimatedCallTimeInMinutes:
            ctx.params.estimatedCallTimeInMinutes ?? existingScenario.estimatedCallTimeInMinutes ?? 10,
          simulationFormat: ctx.params.simulationFormat ?? existingScenario.simulationFormat ?? 'dialogue',
          scenarioCategoryId: ctx.params.scenarioCategoryId ?? existingScenario.scenarioCategoryId?.toString(),
          skillGroupIds: ctx.params.skillGroupIds ?? (existingScenario.skillGroupIds || []).map(sk => sk.toString()),
          aiSpeaksFirst: ctx.params.aiSpeaksFirst ?? existingScenario.aiSpeaksFirst ?? false,
          initialAiMessage: ctx.params.initialAiMessage ?? existingScenario.initialAiMessage ?? '',
          enableStyleAnalysis: ctx.params.enableStyleAnalysis ?? existingScenario.enableStyleAnalysis,
          references: ctx.params.references ?? (existingScenario.references || []).map(r => r.toString()),
        };

        // Tự động chọn references có aiReadable từ course nếu không truyền
        const aiReadableRefs = (course.references || [])
          .filter(ref => ref && ref.aiReadable)
          .map(ref => ref._id || ref);

        const defaultModel = await ctx.call('llmsmodel.getDefaultModel');
        const llmModelId = ctx.params.llmModelId || defaultModel._id;

        // Resolve enableStyleAnalysis từ nhóm kỹ năng đánh giá nếu chưa có
        if (
          mergedData.enableStyleAnalysis === undefined &&
          mergedData.skillGroupIds &&
          mergedData.skillGroupIds.length > 0
        ) {
          mergedData.enableStyleAnalysis = await this.resolveEnableStyleAnalysis(ctx, mergedData.skillGroupIds);
        }

        try {
          // Tạo persona mới từ AI dựa trên mô tả kịch bản
          const personaData = await ctx.call('aipersonas.createAIPersonaFromCourseContext', {
            courseId,
            userPrompt: `Tạo persona phù hợp với kịch bản: ${mergedData.description}`,
            llmModelId,
          });

          // Tạo scenario data từ AI
          const scenarioData = await this.generateScenarioWithOpenAI(ctx, {
            courseId,
            description: mergedData.description,
            llmModelId,
            persona: personaData,
          });

          const personaGender = personaData.gender || 'male';
          const voiceId = await this.getVoiceByGender(ctx, personaGender);

          // Tạo persona record mới
          const persona = await ctx.call('aipersonas.createAIPersona', {
            ...personaData,
            voiceId,
            status: 'draft',
            llmModelId: llmModelId,
          });

          // Cập nhật scenario với dữ liệu merged + persona mới
          const updatePayload = {
            aiPersonaId: persona._id,
            name: mergedData.name || scenarioData.name,
            description: mergedData.description || scenarioData.description,
            passScore: mergedData.passScore,
            estimatedCallTimeInMinutes: mergedData.estimatedCallTimeInMinutes,
            aiSpeaksFirst: mergedData.aiSpeaksFirst,
            initialAiMessage: mergedData.initialAiMessage || scenarioData.initialAiMessage || '',
            simulationFormat: mergedData.simulationFormat,
            references: mergedData.references.length > 0 ? mergedData.references : aiReadableRefs,
            scenarioCategoryId: mergedData.scenarioCategoryId,
            skillGroupIds: mergedData.skillGroupIds,
            enableStyleAnalysis: mergedData.enableStyleAnalysis,
            updatedBy: user._id,
          };

          const updatedScenario = await this.adapter.updateById(id, {$set: updatePayload});

          // Gợi ý skill groups nếu chưa có
          if (mergedData.skillGroupIds && mergedData.skillGroupIds.length > 0) {
            updatedScenario.skillGroupIds = mergedData.skillGroupIds;
          } else {
            await this.suggestSkillGroupsForScenario(ctx, updatedScenario, llmModelId);
          }

          // Gợi ý và cấu hình skills cho scenario
          const configuredSkills = await this.suggestSkillsForScenario(
            ctx,
            updatedScenario,
            user.organizationId,
            llmModelId,
          );

          return {
            source: 'openai',
            scenario: await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updatedScenario),
            persona,
            skills: configuredSkills,
          };
        } catch (error) {
          this.logger.error('Error regenerating scenario from description:', error);
          throw new MoleculerClientError(
            i18next.t('error.scenario_generation_failed', 'Không thể tạo lại kịch bản từ AI'),
            500,
          );
        }
      },
    },

    create: {
      rest: 'POST /',
      params: {
        courseId: {type: 'string'},
        aiPersonaId: {type: 'string', optional: true},
        taskIds: {type: 'array', optional: true, items: 'string'},
        name: {type: 'string', min: 2, max: 255},
        description: {type: 'string', optional: true},
        studentDescription: {type: 'string', optional: true},
        aiDescription: {type: 'string', optional: true},

        passScore: {type: 'number', optional: true, min: 0, max: 100},
        estimatedCallTimeInMinutes: {type: 'number', optional: true, min: 0},
        organizationId: {type: 'string', optional: true},
        aiSpeaksFirst: {type: 'boolean', optional: true},
        initialAiMessage: {type: 'string', optional: true, max: 1000},
        moodleAssignmentId: {type: 'number', optional: true},
        enableStyleAnalysis: {type: 'boolean', optional: true},
        simulationFormat: {type: 'string', optional: true, enum: ['dialogue', 'knowledge_test']},
        references: {type: 'array', optional: true, items: 'string'},
        scenarioCategoryId: {type: 'string', optional: true},
        skillGroupIds: {type: 'array', optional: true, items: 'string'},
      },
      async handler(ctx) {
        const {
          courseId,
          aiPersonaId,
          taskIds,
          name,
          description,
          studentDescription,
          aiDescription,

          passScore,
          estimatedCallTimeInMinutes,
          organizationId,
          aiSpeaksFirst,
          initialAiMessage,
          moodleAssignmentId,
          enableStyleAnalysis,
          simulationFormat,
          scenarioCategoryId,
          skillGroupIds,
          order,
        } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        if (aiSpeaksFirst === true && (!initialAiMessage || initialAiMessage.trim() === '')) {
          throw new MoleculerClientError(
            i18next.t('error.initial_ai_message_required', 'Tin nhắn khởi tạo AI là bắt buộc khi AI nói trước'),
            400,
          );
        }

        // Kiểm tra course tồn tại
        const course = await ctx.call('courses.get', {id: courseId}).catch(() => null);
        if (!course) {
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Khóa học không tồn tại'), 404);
        }

        // Kiểm tra AI Persona tồn tại nếu có aiPersonaId
        if (aiPersonaId) {
          const persona = await ctx.call('aipersonas.get', {id: aiPersonaId}).catch(() => null);
          if (!persona) {
            throw new MoleculerClientError(i18next.t('error.persona_not_found', 'AI Persona không tồn tại'), 404);
          }
        }

        // Validate references nằm trong danh sách references của course
        let validatedReferences = [];
        if (ctx.params.references && ctx.params.references.length > 0) {
          const courseRefs = (course.references || []).map(r => r._id.toString() || r.toString());
          validatedReferences = ctx.params.references.filter(refId => courseRefs.includes(refId));
        }
        const scenarioData = {
          courseId,
          aiPersonaId,
          taskIds: taskIds || [],
          name,
          description,
          studentDescription,
          aiDescription,

          passScore,
          estimatedCallTimeInMinutes,
          organizationId: organizationId || user.organizationId,
          aiSpeaksFirst: aiSpeaksFirst || false,
          initialAiMessage: initialAiMessage || '',
          createdBy: user._id,
          updatedBy: user._id,
          status: 'draft',
          moodleAssignmentId,
          enableStyleAnalysis,
          simulationFormat,
          references: validatedReferences,
          scenarioCategoryId,
          skillGroupIds: skillGroupIds || [],
        };

        const maxOrderScenario = await this.adapter.find({
          query: {
            courseId: ctx.params.courseId,
            isDeleted: false,
          },
          fields: ['order'],
          limit: 1,
          sort: '-order',
        });
        scenarioData.order = order
          ? order
          : maxOrderScenario && maxOrderScenario[0]?.order !== undefined
            ? maxOrderScenario[0]?.order + 1
            : 1;

        const scenario = await this.adapter.insert(scenarioData);
        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, scenario);
      },
    },

    getByCourse: {
      rest: 'GET /course/:courseId',
      params: {
        courseId: {type: 'string'},
        studentId: {type: 'string', optional: true},
        showAll: {type: 'boolean', optional: true, convert: true},
      },

      async handler(ctx) {
        const {courseId, studentId, showAll} = ctx.params;
        const user = ctx.meta.user;

        // Kiểm tra khóa học tồn tại và quyền truy cập (chỉ áp dụng cho phía học viên, không áp dụng cho admin showAll)
        if (!showAll) {
          const course = await ctx.call('courses.get', {id: courseId, populate: []}).catch(() => null);
          if (!course || course.isDeleted) {
            throw new MoleculerClientError(i18next.t('error.course_not_found', 'Khóa học không tồn tại.'), 404);
          }
          if (!course.isActive) {
            throw new MoleculerClientError(i18next.t('error.course_inactive', 'Khóa học hiện không hoạt động.'), 403);
          }
          if (user && !user.isSystemAdmin && course.publishedToUsers) {
            const currentUserId = user._id.toString();
            const hasAccess = course.publishedToUsers.some(entry => {
              const uid = entry?._id?.toString() || entry?.userId?._id?.toString();
              return uid === currentUserId;
            });
            if (!hasAccess) {
              throw new MoleculerClientError(
                i18next.t('error.access_denied', 'Bạn không có quyền truy cập khóa học này.'),
                403,
              );
            }
          }
        }

        const scenarios = await this.adapter.find({
          query: {courseId, isDeleted: false, ...(showAll ? {} : {status: 'published'})},
          sort: ['order', 'createdAt'],
        });

        const transformedScenarios = await this.transformDocuments(
          ctx,
          {
            populate: [
              'aiPersonaId.voiceId',
              'aiPersonaId.llmModelId',
              'aiPersonaId.roleplayInstructionId',
              'courseId',
              'references',
              'scenarioCategoryId',
              'skillGroupIds',
            ],
          },
          scenarios,
        );

        const targetStudentId = studentId || user?._id;
        if (!targetStudentId || !Array.isArray(transformedScenarios)) {
          return transformedScenarios;
        }

        const scenarioIds = transformedScenarios.map(s => s._id);

        const allSessions = await ctx
          .call('roleplaysessions.find', {
            query: {
              aiScenarioId: {$in: scenarioIds},
              isDeleted: false,
              status: {$in: ['completed', 'analyzed']},
            },
            fields: ['aiScenarioId', 'studentId'],
          })
          .catch(() => []);

        const sessionCountByScenario = {};
        const allSessionCountByScenario = {};
        const targetStudentIdStr = targetStudentId.toString();

        allSessions.forEach(session => {
          const scId = session.aiScenarioId?._id
            ? session.aiScenarioId._id.toString()
            : session.aiScenarioId?.toString();
          if (!scId) return;

          // Đếm tổng phiên (tất cả user)
          allSessionCountByScenario[scId] = (allSessionCountByScenario[scId] || 0) + 1;

          // Đếm phiên của user hiện tại
          const studentId = session.studentId?._id ? session.studentId._id.toString() : session.studentId?.toString();
          if (studentId === targetStudentIdStr) {
            sessionCountByScenario[scId] = (sessionCountByScenario[scId] || 0) + 1;
          }
        });

        const scenariosWithStatus = await Promise.all(
          transformedScenarios.map(async scenario => {
            try {
              const [skills, isCompleted, highestScore] = await Promise.all([
                ctx.call('aiscenarios.getSkillsConfig', {id: scenario._id}),
                this.checkScenarioCompletion(ctx, scenario._id, targetStudentId),
                this.getHighestScenarioScore(ctx, scenario._id, targetStudentId),
              ]);

              const scenarioIdStr = scenario._id.toString();
              return {
                ...scenario,
                isCompleted,
                highestScore,
                skills,
                totalPracticeSessions: sessionCountByScenario[scenarioIdStr] || 0,
                hasPracticeSessions: (allSessionCountByScenario[scenarioIdStr] || 0) > 0,
              };
            } catch (error) {
              this.logger.error(`Error scenario ${scenario._id}:`, error);
              const scenarioIdStr = scenario._id.toString();
              return {
                ...scenario,
                isCompleted: false,
                totalPracticeSessions: sessionCountByScenario[scenarioIdStr] || 0,
                hasPracticeSessions: (allSessionCountByScenario[scenarioIdStr] || 0) > 0,
              };
            }
          }),
        );

        const isSequential = scenariosWithStatus[0]?.courseId?.isSequentialStudyRequired;

        if (!isSequential) {
          return scenariosWithStatus.map(s => ({
            ...s,
            isLocked: false,
          }));
        }

        let canUnlockNext = true;

        return scenariosWithStatus.map(scenario => {
          const isLocked = !canUnlockNext;

          if (!scenario.isCompleted) {
            canUnlockNext = false;
          }

          return {
            ...scenario,
            isLocked,
          };
        });
      },
    },

    getDetailAIScenarioByCourse: {
      params: {
        courseId: {type: 'string'},
        studentId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {courseId, studentId} = ctx.params;
        const user = ctx.meta.user;
        const scenarios = await this.adapter.find({
          query: {courseId, isDeleted: false},
          sort: ['order', 'createdAt'],
        });

        const transformedScenarios = await this.transformDocuments(
          ctx,
          {
            populate: [
              'aiPersonaId.voiceId.apiKeyId',
              'aiPersonaId.llmModelId.apiKeyId',
              'roleplayInstructionId',
              'courseId',
            ],
          },
          scenarios,
        );

        const targetStudentId = studentId || user?._id;
        if (targetStudentId && Array.isArray(transformedScenarios)) {
          return Promise.all(
            transformedScenarios.map(async scenario => {
              try {
                const scenarioSkills = await ctx.call('aiscenarios.getSkillsConfig', {id: scenario._id});
                const isCompleted = await this.checkScenarioCompletion(ctx, scenario._id, targetStudentId);
                return {
                  ...scenario,
                  isCompleted,
                  skills: scenarioSkills,
                };
              } catch (error) {
                this.logger.error(`Error checking completion for scenario ${scenario._id}:`, error);
                return {
                  ...scenario,
                  isCompleted: false,
                };
              }
            }),
          );
        }

        return transformedScenarios;
      },
    },

    getScenarioWithDetails: {
      rest: 'GET /:id/details',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;

        const scenario = await this.adapter.findById(id);
        if (!scenario) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Kịch bản không tồn tại'), 404);
        }

        // Transform với populate đầy đủ
        const populateOptions = ['courseId', 'aiPersonaId', 'taskIds'];
        const skills = await ctx.call('aiscenarios.getSkillsConfig', {id});
        const transformedScenario = await this.transformDocuments(ctx, {populate: populateOptions}, scenario);
        return {
          ...transformedScenario,
          skills,
        };
      },
    },

    update: {
      rest: 'PUT /:id',
      async handler(ctx) {
        const {id, ...updateData} = ctx.params;
        const user = ctx.meta.user;
        const scenario = await this.adapter.findById(id);
        if (!scenario) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Kịch bản không tồn tại'), 404);
        }

        if (updateData.aiPersonaId) {
          const persona = await ctx.call('aipersonas.get', {id: updateData.aiPersonaId}).catch(() => null);
          if (!persona) {
            throw new MoleculerClientError(i18next.t('error.persona_not_found', 'AI Persona không tồn tại'), 404);
          }
        }

        if (
          updateData.aiSpeaksFirst === true &&
          (!updateData.initialAiMessage || updateData.initialAiMessage.trim() === '')
        ) {
          throw new MoleculerClientError(
            i18next.t('error.initial_ai_message_required', 'Tin nhắn khởi tạo AI là bắt buộc khi AI nói trước'),
            400,
          );
        }

        // Validate references nếu có
        if (updateData.references) {
          const course = await ctx.call('courses.get', {id: scenario.courseId.toString()}).catch(() => null);
          if (course) {
            const courseRefs = (course.references || []).map(r => r._id.toString());
            updateData.references = updateData.references.filter(refId => courseRefs.includes(refId));
          }
        }

        updateData.updatedBy = user._id;
        const updated = await this.adapter.updateById(id, {$set: updateData});

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updated);
      },
    },

    moveUp: {
      rest: 'PUT /:id/move-up',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const scenario = await this.adapter.findById(id);
        if (!scenario || scenario.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Kịch bản không tồn tại'), 404);
        }

        const scenarios = await this.adapter.find({
          query: {courseId: scenario.courseId, isDeleted: false},
          sort: ['order', 'createdAt'],
        });

        for (let i = 0; i < scenarios.length; i++) {
          const expectedOrder = i + 1;
          if (scenarios[i].order !== expectedOrder) {
            await this.adapter.updateById(scenarios[i]._id, {$set: {order: expectedOrder}});
            scenarios[i].order = expectedOrder;
          }
        }

        const currentIndex = scenarios.findIndex(s => s._id.toString() === id);
        if (currentIndex > 0) {
          const prevScenario = scenarios[currentIndex - 1];
          await this.adapter.updateById(scenario._id, {$set: {order: currentIndex}});
          await this.adapter.updateById(prevScenario._id, {$set: {order: currentIndex + 1}});
        }

        return {success: true};
      },
    },

    moveDown: {
      rest: 'PUT /:id/move-down',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const scenario = await this.adapter.findById(id);
        if (!scenario || scenario.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Kịch bản không tồn tại'), 404);
        }

        const scenarios = await this.adapter.find({
          query: {courseId: scenario.courseId, isDeleted: false},
          sort: ['order', 'createdAt'],
        });

        for (let i = 0; i < scenarios.length; i++) {
          const expectedOrder = i + 1;
          if (scenarios[i].order !== expectedOrder) {
            await this.adapter.updateById(scenarios[i]._id, {$set: {order: expectedOrder}});
            scenarios[i].order = expectedOrder;
          }
        }

        const currentIndex = scenarios.findIndex(s => s._id.toString() === id);
        if (currentIndex > -1 && currentIndex < scenarios.length - 1) {
          const nextScenario = scenarios[currentIndex + 1];
          await this.adapter.updateById(scenario._id, {$set: {order: currentIndex + 2}});
          await this.adapter.updateById(nextScenario._id, {$set: {order: currentIndex + 1}});
        }

        return {success: true};
      },
    },

    reorder: {
      rest: 'PUT /:id/reorder',
      params: {
        id: {type: 'string'},
        targetPosition: {type: 'number', integer: true, min: 1},
      },
      async handler(ctx) {
        const {id, targetPosition} = ctx.params;
        const scenario = await this.adapter.findById(id);
        if (!scenario || scenario.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Kịch bản không tồn tại'), 404);
        }

        const scenarios = await this.adapter.find({
          query: {courseId: scenario.courseId, isDeleted: false},
          sort: ['order', 'createdAt'],
        });

        for (let i = 0; i < scenarios.length; i++) {
          const expectedOrder = i + 1;
          if (scenarios[i].order !== expectedOrder) {
            await this.adapter.updateById(scenarios[i]._id, {$set: {order: expectedOrder}});
            scenarios[i].order = expectedOrder;
          }
        }

        if (targetPosition < 1 || targetPosition > scenarios.length) {
          throw new MoleculerClientError('Vị trí đích không hợp lệ', 400);
        }

        const currentIndex = scenarios.findIndex(s => s._id.toString() === id);
        const currentPosition = currentIndex + 1;

        if (targetPosition === currentPosition) {
          return {success: true};
        }

        const targetIndex = targetPosition - 1;

        if (targetPosition < currentPosition) {
          for (let i = currentIndex - 1; i >= targetIndex; i--) {
            await this.adapter.updateById(scenarios[i]._id, {$set: {order: i + 2}});
          }
        } else {
          for (let i = currentIndex + 1; i <= targetIndex; i++) {
            await this.adapter.updateById(scenarios[i]._id, {$set: {order: i}});
          }
        }

        await this.adapter.updateById(scenario._id, {$set: {order: targetPosition}});

        return {success: true};
      },
    },

    migrateOrders: {
      rest: 'POST /migrate-orders',
      async handler(ctx) {
        const uniqueCourses = await this.adapter.model.distinct('courseId');

        let totalUpdated = 0;
        let migratedCourses = 0;

        for (const courseId of uniqueCourses) {
          const scenarios = await this.adapter.find({
            query: {courseId, isDeleted: false},
            sort: ['createdAt'],
          });
          console.log('Scenarios for courseId', courseId, scenarios);
          let courseUpdated = false;
          for (let i = 0; i < scenarios.length; i++) {
            const expectedOrder = i + 1;
            if (scenarios[i].order !== expectedOrder) {
              await this.adapter.updateById(scenarios[i]._id, {$set: {order: expectedOrder}});
              totalUpdated++;
              courseUpdated = true;
            }
          }
          if (courseUpdated) {
            migratedCourses++;
          }
        }

        return {
          success: true,
          message: 'Migrate order cho các kịch bản thành công',
          data: {
            totalCoursesProcessed: uniqueCourses.length,
            coursesMigrated: migratedCourses,
            scenariosUpdated: totalUpdated,
          },
        };
      },
    },

    // Thêm tasks vào scenario
    addTasksToScenario: {
      rest: 'POST /:id/tasks',
      params: {
        id: {type: 'string'},
        taskIds: {type: 'array', items: 'string'},
      },
      async handler(ctx) {
        const {id, taskIds} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const scenario = await this.adapter.findById(id);
        if (!scenario || scenario.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Không tìm thấy kịch bản'), 404);
        }

        for (const taskId of taskIds) {
          const task = await ctx.call('tasks.get', {id: taskId}).catch(() => null);
          if (!task) {
            throw new MoleculerClientError(i18next.t('error.task_not_found', 'Task không tồn tại'), 404);
          }
          if (task.organizationId && task.organizationId.toString() !== scenario.organizationId.toString()) {
            throw new MoleculerClientError(
              i18next.t('error.task_not_belong_organization', 'Task không thuộc về tổ chức này'),
              400,
            );
          }
        }

        const currentTaskIds = scenario.taskIds || [];
        const newTaskIds = [...new Set([...currentTaskIds.map(id => id.toString()), ...taskIds])];

        const updated = await this.adapter.updateById(id, {
          $set: {
            taskIds: newTaskIds,
            updatedBy: user._id,
          },
        });

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updated);
      },
    },

    configureSkills: {
      rest: 'POST /:id/skills',
      params: {
        id: {type: 'string'},
        skills: {
          type: 'array',
          items: {
            type: 'object',
            props: {
              skillId: {type: 'string'},
              weight: {type: 'number', min: 0, max: 100},
            },
          },
        },
      },
      async handler(ctx) {
        const {id, skills} = ctx.params;
        return ctx.call('scenarioskills.configureSkillsForScenario', {
          scenarioId: id,
          skills,
        });
      },
    },

    getSkillsConfig: {
      rest: 'GET /:id/skills',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;
        return ctx.call('scenarioskills.getSkillsByScenario', {scenarioId: id});
      },
    },

    remove: {
      rest: 'DELETE /:id',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const user = ctx.meta.user;

        const scenario = await this.adapter.findById(id);
        if (!scenario) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Kịch bản không tồn tại'), 404);
        }

        const updated = await this.adapter.updateById(id, {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            updatedBy: user._id,
          },
        });

        try {
          const sessions = await ctx.call('roleplaysessions.find', {
            query: {
              aiScenarioId: id,
              isDeleted: false,
            },
          });

          if (sessions && sessions.length > 0) {
            for (const session of sessions) {
              if (session.analysisId) {
                try {
                  const analysisId = session.analysisId._id
                    ? session.analysisId._id.toString()
                    : session.analysisId.toString();
                  await ctx.call('roleplay.analysises.update', {
                    id: analysisId,
                    isDeleted: true,
                    deletedAt: new Date(),
                  });
                } catch (err) {
                  this.logger.error(`Error deleting analysis ${session.analysisId} for session ${session._id}:`, err);
                }
              }

              try {
                await ctx.call('roleplaysessions.update', {
                  id: session._id.toString(),
                  isDeleted: true,
                  deletedAt: new Date(),
                });
              } catch (err) {
                this.logger.error(`Error deleting session ${session._id}:`, err);
              }
            }
            this.logger.info(`Deleted ${sessions.length} practice sessions for scenario ${id}`);
          }
        } catch (error) {
          this.logger.error(`Error cleaning up practice sessions for scenario ${id}:`, error);
        }

        try {
          const scenarioSkills = await ctx.call('scenarioskills.getSkillsByScenario', {scenarioId: id});
          if (scenarioSkills && scenarioSkills.length > 0) {
            for (const skill of scenarioSkills) {
              await ctx.call('scenarioskills.remove', {id: skill._id});
            }
            this.logger.info(`Deleted ${scenarioSkills.length} skills for scenario ${id}`);
          }
        } catch (error) {
          this.logger.error(`Error cleaning up scenario skills for scenario ${id}:`, error);
        }
        try {
          const remainingScenarios = await this.adapter.find({
            query: {courseId: scenario.courseId, isDeleted: false},
            sort: ['order', 'createdAt'],
          });
          for (let i = 0; i < remainingScenarios.length; i++) {
            const expectedOrder = i + 1;
            if (remainingScenarios[i].order !== expectedOrder) {
              await this.adapter.updateById(remainingScenarios[i]._id, {$set: {order: expectedOrder}});
            }
          }
        } catch (error) {
          this.logger.error(`Error reordering scenarios after deleting ${id}:`, error);
        }

        return this.transformDocuments(ctx, {}, updated);
      },
    },

    /**
     * Bulk soft-delete scenarios theo query.
     * Dùng bởi courses.remove để xóa cascade mà không cần import model trực tiếp.
     */
    bulkSoftDelete: {
      visibility: 'public',
      params: {
        query: {type: 'object'},
        updatedBy: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {query, updatedBy} = ctx.params;
        const now = new Date();
        const updateFields = {isDeleted: true, deletedAt: now};
        if (updatedBy) updateFields.updatedBy = updatedBy;

        const result = await this.adapter.updateMany({...query, isDeleted: false}, {$set: updateFields});
        this.logger.info(`[bulkSoftDelete] Soft-deleted ${result.modifiedCount || result.nModified || 0} scenarios`);
        return {modifiedCount: result.modifiedCount || result.nModified || 0};
      },
    },

    copy: {
      rest: 'POST /:id/copy',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const originalScenario = await this.adapter.findById(id);
        if (!originalScenario || originalScenario.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'Kịch bản không tồn tại'), 404);
        }

        let aiPersonaId = null;
        if (originalScenario.aiPersonaId) {
          const personaIdStr =
            typeof originalScenario.aiPersonaId === 'object' && originalScenario.aiPersonaId._id
              ? originalScenario.aiPersonaId._id.toString()
              : originalScenario.aiPersonaId.toString();

          const persona = await ctx.call('aipersonas.get', {id: personaIdStr, populate: []}).catch(() => null);
          if (persona && !persona.isDeleted) {
            const newPersonaParams = {
              name: `${persona.name} - Bản sao`.substring(0, 100),
              avatarId: persona.avatarId?.toString(),
              voiceId: persona.voiceId?.toString(),
              llmModelId: persona.llmModelId?.toString(),
              role: persona.role,
              mood: persona.mood,
              organization: persona.organization,
              smallTalkLikely: persona.smallTalkLikely,
              filterWords: persona.filterWords,
              personaBackground: persona.personaBackground,
              personaConcern: persona.personaConcern,
              status: 'draft',
              personaPrompt: persona.personaPrompt,
              gender: persona.gender,
              age: persona.age,
              roleplayInstructionId: persona.roleplayInstructionId?.toString(),
              conversationEndCondition: persona.conversationEndCondition,
            };
            const newPersona = await ctx.call('aipersonas.createAIPersona', newPersonaParams);
            aiPersonaId = newPersona._id.toString();
          }
        }

        const newScenarioName = await this.generateCopyName(this.adapter, originalScenario.name, {
          courseId: originalScenario.courseId,
          isDeleted: false,
        });

        const maxOrderScenario = await this.adapter.find({
          query: {
            courseId: originalScenario.courseId,
            isDeleted: false,
          },
          fields: ['order'],
          limit: 1,
          sort: '-order',
        });
        const order = maxOrderScenario && maxOrderScenario[0].order !== undefined ? maxOrderScenario[0].order + 1 : 1;

        const newScenarioData = {
          courseId: originalScenario.courseId.toString(),
          aiPersonaId: aiPersonaId,
          taskIds: (originalScenario.taskIds || []).map(taskId => taskId.toString()),
          name: newScenarioName,
          description: originalScenario.description,
          order,
          passScore: originalScenario.passScore,
          estimatedCallTimeInMinutes: originalScenario.estimatedCallTimeInMinutes,
          organizationId: originalScenario.organizationId?.toString() || user.organizationId?.toString(),
          aiSpeaksFirst: originalScenario.aiSpeaksFirst,
          initialAiMessage: originalScenario.initialAiMessage,
          enableStyleAnalysis: originalScenario.enableStyleAnalysis,
          simulationFormat: originalScenario.simulationFormat,
          references: (originalScenario.references || []).map(r => r.toString()),
          scenarioCategoryId: originalScenario.scenarioCategoryId?.toString(),
          skillGroupIds: (originalScenario.skillGroupIds || []).map(sk => sk.toString()),
          createdBy: user._id,
          updatedBy: user._id,
          studentDescription: originalScenario.studentDescription,
          aiDescription: originalScenario.aiDescription,
          status: 'draft',
        };

        const newScenario = await this.adapter.insert(newScenarioData);

        try {
          const scenarioSkills = await ctx
            .call('scenarioskills.getSkillsByScenario', {
              scenarioId: originalScenario._id.toString(),
            })
            .catch(() => null);

          if (scenarioSkills && scenarioSkills.length > 0) {
            const skillsConfig = scenarioSkills.map(sk => ({
              skillId: sk.skillId?._id ? sk.skillId._id.toString() : sk.skillId.toString(),
              weight: sk.weight,
            }));
            await ctx.call('scenarioskills.configureSkillsForScenario', {
              scenarioId: newScenario._id.toString(),
              skills: skillsConfig,
            });
          }
        } catch (error) {
          this.logger.error('Error copying skills for scenario:', error);
        }

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, newScenario);
      },
    },
  },

  methods: {
    async resolveScenarioCategoryName(ctx, scenarioCategoryId) {
      if (!scenarioCategoryId) return 'Chung';
      try {
        const id = scenarioCategoryId._id ? scenarioCategoryId._id.toString() : scenarioCategoryId.toString();
        const category = await ctx.call('scenariocategories.get', {id});
        return category?.name || 'Chung';
      } catch (error) {
        this.logger.warn('Error resolving scenario category name:', error.message);
        return 'Chung';
      }
    },

    async resolveEnableStyleAnalysis(ctx, skillGroupIds) {
      if (!skillGroupIds || !Array.isArray(skillGroupIds) || skillGroupIds.length === 0) return false;
      try {
        for (const groupId of skillGroupIds) {
          const id = groupId._id ? groupId._id.toString() : groupId.toString();
          const group = await ctx.call('skillgroups.get', {id}).catch(() => null);
          if (group && group.enableStyleAnalysis) {
            return true;
          }
        }
        return false;
      } catch (error) {
        this.logger.warn('Error resolving enableStyleAnalysis from skill groups:', error.message);
        return false;
      }
    },

    async getVoiceByGender(ctx, gender) {
      try {
        const voices = await ctx.call('aivoice.getVoicesByLanguage', {
          gender: gender || 'male',
          language: 'vi',
        });

        if (voices && voices.length > 0) {
          const randomIndex = Math.floor(Math.random() * voices.length);
          return voices[randomIndex]._id;
        }

        const allVoices = await ctx.call('aivoice.getVoicesByLanguage', {gender: gender || 'male'});
        if (allVoices && allVoices.length > 0) {
          return allVoices[0]._id;
        }

        return null;
      } catch (error) {
        this.logger.warn('Error fetching voice by gender:', error.message);
        return null;
      }
    },

    async generatePersonaPrompt(ctx, {persona, scenario, sampleConversation = [], description, llmModelId}) {
      // console.log('###################################################persona', persona);
      // console.log('###################################################scenario', scenario);
      // console.log('###################################################sampleConversation', sampleConversation);
      // console.log('###################################################description', description);
      // console.log('###################################################llmModelId', llmModelId);
      const systemPrompt = `Bạn là chuyên gia tạo prompt cho AI đóng vai trong roleplay đào tạo.

        Nhiệm vụ: Tạo một prompt hướng dẫn AI nhập vai và trò chuyện tự nhiên. Prompt cần:
        1. Mô tả cách AI nên nói chuyện (giọng điệu, từ ngữ, phong cách)
        2. Thể hiện tâm trạng và thái độ của nhân vật
        3. Nếu có mẫu hội thoại, học cách phản hồi từ đó
        4. Xác định điều kiện kết thúc cuộc trò chuyện (khi nào AI nên kết thúc cuộc gọi)

        Format output:
        [THÔNG TIN NHÂN VẬT]
        ...mô tả nhân vật...

        [PHONG CÁCH GIAO TIẾP]
        ...cách nói chuyện, giọng điệu...

        [ĐIỀU KIỆN KẾT THÚC CUỘC TRÒ CHUYỆN]
        ...các trường hợp cụ thể khi cuộc trò chuyện nên kết thúc...

        Chỉ trả về prompt, không giải thích.`;

      let userContent = `Thông tin nhân vật:
        - Tên: ${persona.name || 'Khách hàng'}, ${persona.age || 30} tuổi, ${persona.gender === 'female' ? 'Nữ' : 'Nam'}
        - Vai trò: ${persona.role || 'Khách hàng'}
        - Tâm trạng: ${persona.mood || 'Bình thường'}
        - Background: ${persona.personaBackground || 'Không rõ'}
        - Mối quan tâm: ${persona.personaConcern || 'Không rõ'}

        Kịch bản: ${scenario.name || description}
        Danh mục: ${await this.resolveScenarioCategoryName(ctx, scenario.scenarioCategoryId)}`;

      if (sampleConversation && sampleConversation.length > 0) {
        const convSample = sampleConversation
          .slice(0, 6)
          .map(turn => `${turn.role === 'assistant' ? 'Nhân vật' : 'Người dùng'}: ${turn.content}`)
          .join('\n');
        userContent += `\n\nMẫu hội thoại tham khảo:\n${convSample}`;
      }

      userContent += `\n\nTạo prompt hướng dẫn AI đóng vai nhân vật này. Đặc biệt chú ý xác định rõ điều kiện kết thúc cuộc trò chuyện phù hợp với kịch bản.`;

      try {
        let modelData;
        if (llmModelId) {
          modelData = await this.broker.call('llmsmodel.getDetailsModel', {id: llmModelId});
        } else {
          modelData = await ctx.call('llmsmodel.getDefaultModel');
        }
        // console.log('###################################################modelData', llmModelId, modelData);
        const {apiKey, gptModel: model, endpoint} = modelData;
        // console.log('###################################################model', model);
        const modelInterface = modelData?.modelInterface || 'AzureOpenAI';

        const aiResult = await ctx.call(
          modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
          {
            messages: [
              {role: 'system', content: systemPrompt},
              {role: 'user', content: userContent},
            ],
            apiKey,
            model,
            endpoint,
            max_tokens: 1000,
          },
        );
        // console.log('###################################################aiResult', aiResult);
        return typeof aiResult === 'string' ? aiResult : aiResult?.content || '';
      } catch (error) {
        this.logger.error('Error generating persona prompt:', error);
        return this.buildFallbackPersonaPrompt(persona, scenario, sampleConversation);
      }
    },

    buildFallbackPersonaPrompt(persona, scenario, sampleConversation = []) {
      let prompt = `[THÔNG TIN NHÂN VẬT]
        Bạn là ${persona.name || 'khách hàng'}, ${persona.age || 30} tuổi, ${persona.gender === 'female' ? 'nữ' : 'nam'}.
        - Vai trò: ${persona.role || 'Khách hàng'}
        - Tâm trạng: ${persona.mood || 'Bình thường'}
        - Mối quan tâm: ${persona.personaConcern || 'Cần hỗ trợ'}`;

      if (persona.personaBackground) {
        prompt += `\n- Hoàn cảnh: ${persona.personaBackground}`;
      }

      if (sampleConversation && sampleConversation.length > 0) {
        prompt += '\n\n[PHONG CÁCH GIAO TIẾP]\nTham khảo các câu trả lời mẫu:';
        sampleConversation.slice(0, 4).forEach(turn => {
          if (turn.role === 'assistant') {
            prompt += `\n- "${turn.content.substring(0, 100)}${turn.content.length > 100 ? '...' : ''}"`;
          }
        });
      }

      prompt += `\n\n[ĐIỀU KIỆN KẾT THÚC CUỘC TRÒ CHUYỆN]
        - Khách hàng đã đồng ý hoặc từ chối rõ ràng và dứt khoát
        - Mục tiêu cuộc hội thoại đã đạt được
        - Cuộc trò chuyện kết thúc tự nhiên với lời chào tạm biệt
        - Khách hàng nói bận và không muốn tiếp tục`;

      return prompt;
    },

    async generateScenarioWithOpenAI(ctx, {courseId, description, llmModelId, persona = {}}) {
      const course = await ctx.call('courses.get', {id: courseId, populate: ['references']});

      let courseReferencesContent = '';
      if (course.references && course.references.length > 0) {
        courseReferencesContent = course.references.map(ref => ref.content || ref.url || ref.name).join('\n---\n');
      }

      const personaRole = persona.role || 'Khách hàng';
      const personaName = persona.name || 'AI Persona';
      const personaMood = persona.mood || 'Bình thường';
      const personaConcern = persona.personaConcern || '';

      const systemPrompt = `
        Bạn là một hệ thống tạo kịch bản roleplay cho khóa học đào tạo kỹ năng giao tiếp.

        THÔNG TIN AI PERSONA (nhân vật do AI đóng vai):
        - Tên: ${personaName}
        - Vai trò: ${personaRole}
        - Tâm trạng: ${personaMood}
        ${personaConcern ? `- Mối quan tâm: ${personaConcern}` : ''}

        QUAN TRỌNG:
        - AI PERSONA sẽ đóng vai "${personaRole}" trong kịch bản này
        - HỌC VIÊN sẽ đóng vai đối tác giao tiếp với AI Persona (ví dụ: nếu AI là khách hàng thì học viên là nhân viên, nếu AI là giảng viên thì học viên là sinh viên, v.v.)
        - "initialAiMessage" PHẢI là lời thoại phù hợp với vai trò "${personaRole}" của AI Persona

        Hãy phân tích mô tả kịch bản và tạo ra một kịch bản chi tiết với các thông tin sau:
        {
          "name": string, // Tên kịch bản (ngắn gọn, súc tích)
          "description": string, // Mô tả chi tiết kịch bản
          "passScore": number, // Điểm đạt yêu cầu (0-100)
          "estimatedCallTimeInMinutes": number, // Thời gian ước tính (phút)
          "aiSpeaksFirst": boolean, // AI Persona có nói trước không
          "initialAiMessage": string // Tin nhắn đầu tiên của AI Persona với vai trò "${personaRole}" (nếu aiSpeaksFirst = true)
        }
        Chỉ trả về object JSON hợp lệ, không giải thích thêm.
      `.trim();

      let combinedContext = `Tên khóa học: ${course.name}`;
      combinedContext += `\nMô tả khóa học: ${course.description}`;
      if (courseReferencesContent) {
        combinedContext += `\nNội dung tài liệu tham khảo: ${courseReferencesContent}`;
      }
      combinedContext += `\nMô tả kịch bản cần tạo: ${description}`;

      const messages = [
        {role: 'system', content: systemPrompt},
        {role: 'user', content: combinedContext},
      ];

      const scenarioZodSchema = z.object({
        name: z.string(),
        description: z.string(),

        passScore: z.number().optional(),
        estimatedCallTimeInMinutes: z.number().optional(),
        aiSpeaksFirst: z.boolean().optional(),
        initialAiMessage: z.string().optional(),
      });
      console.log('systemPrompt', systemPrompt);
      let modelData;
      if (llmModelId) {
        modelData = await this.broker.call('llmsmodel.getDetailsModel', {id: llmModelId});
      } else {
        modelData = await ctx.call('llmsmodel.getDefaultModel');
      }
      const {apiKey, model, endpoint} = modelData;
      const modelInterface = modelData?.modelInterface || 'AzureOpenAI';

      const aiResult = await ctx.call(
        modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
        {
          messages,
          schema: zodResponseFormat(scenarioZodSchema, 'scenario').json_schema.schema,
          responseFormat: 'json_object',
          apiKey,
          model,
          endpoint,
          max_tokens: 4000,
        },
      );

      return aiResult;
    },

    constructParams(params, query, sort) {
      return {
        ...this.extractParamsList(params),
        searchFields: 'name,description',
        query: JSON.stringify(query),
        fields: this.settings.fields.join(' '),
        sort,
        populate: this.settings.populateOptions,
      };
    },

    async checkScenarioCompletion(ctx, scenarioId, studentId) {
      try {
        const scenario = await this.adapter.findById(scenarioId);
        if (!scenario) {
          this.logger.warn(`Scenario ${scenarioId} not found for completion check`);
          return false;
        }
        const requiredScore = scenario.passScore || 70;

        const sessions = await ctx.call('roleplaysessions.find', {
          query: {
            studentId: studentId,
            aiScenarioId: scenarioId,
            status: {$in: ['completed', 'analyzed']},
            isDeleted: false,
            analysisId: {$exists: true},
          },
          populate: ['analysisId'],
        });

        if (!sessions || sessions.length === 0) {
          return false;
        }

        return sessions.some(session => {
          const score = session.analysisId?.result?.simulationScore;
          return score !== undefined && score >= requiredScore;
        });
      } catch (error) {
        this.logger.error(
          `Error checking scenario completion for scenario ${scenarioId}, student ${studentId}:`,
          error,
        );
        return false;
      }
    },
    async getHighestScenarioScore(ctx, scenarioId, studentId) {
      try {
        const sessions = await ctx.call('roleplaysessions.find', {
          query: {
            studentId,
            aiScenarioId: scenarioId,
            status: {$in: ['completed', 'analyzed']},
            isDeleted: false,
            analysisId: {$exists: true},
          },
          populate: ['analysisId'],
        });

        if (!sessions?.length) return null;

        return sessions
          .map(s => s.analysisId?.result?.simulationScore)
          .filter(score => typeof score === 'number')
          .reduce((max, score) => Math.max(max, score), null);
      } catch (error) {
        this.logger.error(
          `Error getting highest scenario score for scenario ${scenarioId}, student ${studentId}:`,
          error,
        );
        return null;
      }
    },

    async suggestRoleplayInstructionForPersona(
      ctx,
      persona,
      scenarioDescription,
      organizationId,
      llmModelId,
      scenarioCategoryId,
    ) {
      try {
        // Lấy danh sách roleplay instructions có sẵn trong tổ chức
        const descendants = await ctx
          .call('organizations.getAllDescendants', {
            orgId: organizationId,
          })
          .catch(() => []);

        const orgIds = [organizationId];
        if (descendants && descendants.length > 0) {
          orgIds.push(...descendants.map(desc => desc._id));
        }

        const instructions = await ctx.call('roleplayinstruction.find', {
          query: {
            isDeleted: false,
            organizationId: {$in: orgIds},
            scenarioCategoryId,
          },
        });

        const instructionList = Array.isArray(instructions) ? instructions : instructions.rows || [];

        if (!instructionList || instructionList.length === 0) {
          this.logger.warn('No roleplay instructions available for suggestion.');
          return null;
        }

        const instructionsInfo = instructionList.map(inst => `- ID: ${inst._id} | Tên: ${inst.name}`).join('\n');

        const systemPrompt = `Bạn là chuyên gia thiết kế kịch bản đào tạo roleplay.
          Nhiệm vụ: Chọn một bộ hướng dẫn roleplay (roleplay instruction) phù hợp nhất cho nhân vật AI dựa trên mô tả kịch bản.
          Yêu cầu:
          1. Phân tích mô tả kịch bản và thông tin nhân vật.
          2. Chọn DUY NHẤT MỘT bộ hướng dẫn phù hợp nhất từ danh sách.
          3. Nếu không có bộ hướng dẫn nào phù hợp, trả về roleplayInstructionId là chuỗi rỗng.
          4. Chỉ trả về JSON object với trường "roleplayInstructionId" là ID đã chọn.`;

        const userContent = `Mô tả kịch bản: "${scenarioDescription}"
          Nhân vật: "${persona.name}" - Vai trò: "${persona.role || 'N/A'}" - Tổ chức: "${persona.organization || 'N/A'}"

          Danh sách bộ hướng dẫn roleplay:
          ${instructionsInfo}

          Hãy chọn bộ hướng dẫn phù hợp nhất:`;

        const instructionSchema = z.object({
          roleplayInstructionId: z.string(),
        });

        let modelData;
        if (llmModelId) {
          modelData = await this.broker.call('llmsmodel.getDetailsModel', {id: llmModelId});
        } else {
          modelData = await ctx.call('llmsmodel.getDefaultModel');
        }
        const {apiKey, model, endpoint} = modelData;
        const modelInterface = modelData?.modelInterface || 'AzureOpenAI';

        const aiResult = await ctx.call(
          modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
          {
            messages: [
              {role: 'system', content: systemPrompt},
              {role: 'user', content: userContent},
            ],
            schema: zodResponseFormat(instructionSchema, 'roleplay_instruction_selection').json_schema.schema,
            responseFormat: 'json_object',
            apiKey,
            model,
            endpoint,
          },
        );
        console.log(aiResult);
        let selectedId = aiResult?.roleplayInstructionId || '';

        if (!selectedId && typeof aiResult === 'string') {
          try {
            const parsed = JSON.parse(aiResult);
            selectedId = parsed.roleplayInstructionId || '';
          } catch (e) {
            this.logger.error('Error parsing roleplay instruction result:', e);
          }
        }

        // Validate ID đã chọn phải nằm trong danh sách
        const validIds = new Set(instructionList.map(inst => inst._id.toString()));
        if (selectedId && validIds.has(selectedId)) {
          // Cập nhật persona với roleplayInstructionId
          await ctx.call('aipersonas.updateAIPersona', {
            id: persona._id.toString(),
            roleplayInstructionId: selectedId,
          });
          persona.roleplayInstructionId = selectedId;
          this.logger.info(`Selected roleplay instruction ${selectedId} for persona ${persona._id}`);
          return selectedId;
        }

        this.logger.info('No suitable roleplay instruction found for persona.');
        return null;
      } catch (error) {
        this.logger.error('Error suggesting roleplay instruction for persona:', error);
        return null;
      }
    },

    async suggestSkillGroupsForScenario(ctx, scenario, llmModelId) {
      try {
        const allGroups = await ctx.call('skillgroups.find', {
          query: {status: 'active', isDeleted: false},
        });
        const groups = Array.isArray(allGroups) ? allGroups : allGroups.rows || [];

        if (!groups || groups.length === 0) {
          this.logger.warn('No skill groups available for suggestions.');
          return [];
        }

        const groupsList = groups.map(g => `- ID: ${g._id} | Tên: ${g.name}`).join('\n');

        const systemPrompt = `Bạn là chuyên gia thiết kế kịch bản đào tạo.
          Nhiệm vụ: Chọn các nhóm kỹ năng đánh giá phù hợp nhất cho kịch bản roleplay dưới đây.
          Yêu cầu:
          1. Chọn 1-3 nhóm kỹ năng phù hợp nhất với loại kịch bản và mô tả.
          2. Chỉ trả về JSON object với trường "skillGroupIds" là array các ID đã chọn.`;

        const categoryName = await this.resolveScenarioCategoryName(ctx, scenario.scenarioCategoryId);

        const userContent = `Kịch bản: "${scenario.name}"
          Mô tả: "${scenario.description}"
          Danh mục: ${categoryName}

          Danh sách nhóm kỹ năng đánh giá:
          ${groupsList}

          Hãy chọn các nhóm phù hợp:`;

        const skillGroupsSchema = z.object({
          skillGroupIds: z.array(z.string()),
        });

        let modelData;
        if (llmModelId) {
          modelData = await this.broker.call('llmsmodel.getDetailsModel', {id: llmModelId});
        } else {
          modelData = await ctx.call('llmsmodel.getDefaultModel');
        }
        const {apiKey, model, endpoint} = modelData;
        const modelInterface = modelData?.modelInterface || 'AzureOpenAI';

        const aiResult = await ctx.call(
          modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
          {
            messages: [
              {role: 'system', content: systemPrompt},
              {role: 'user', content: userContent},
            ],
            schema: zodResponseFormat(skillGroupsSchema, 'skill_groups_config').json_schema.schema,
            responseFormat: 'json_object',
            apiKey,
            model,
            endpoint,
          },
        );

        let selectedGroupIds = aiResult?.skillGroupIds || [];

        if (!selectedGroupIds && typeof aiResult === 'string') {
          try {
            const parsed = JSON.parse(aiResult);
            selectedGroupIds = parsed.skillGroupIds || [];
          } catch (e) {
            this.logger.error('Error parsing skill groups result:', e);
          }
        }

        const validGroupIds = new Set(groups.map(g => g._id.toString()));
        selectedGroupIds = (selectedGroupIds || []).filter(id => validGroupIds.has(id));

        if (selectedGroupIds.length > 0) {
          await this.adapter.updateById(scenario._id, {
            $set: {skillGroupIds: selectedGroupIds},
          });
          scenario.skillGroupIds = selectedGroupIds;
        }

        return selectedGroupIds;
      } catch (error) {
        this.logger.error('Error suggesting skill groups for scenario:', error);
        return [];
      }
    },

    async suggestSkillsForScenario(ctx, scenario, organizationId, llmModelId) {
      try {
        // Lọc skills theo skillGroupIds của scenario (nếu có)
        const skillQuery = {
          status: 'active',
          isDeleted: false,
        };

        if (scenario.skillGroupIds && scenario.skillGroupIds.length > 0) {
          skillQuery.skillGroupId = {$in: scenario.skillGroupIds};
        }

        const skillsResult = await ctx.call('skills.find', {
          query: skillQuery,
        });
        const skills = Array.isArray(skillsResult) ? skillsResult : skillsResult.rows || [];

        if (!skills || skills.length === 0) {
          this.logger.warn('No skills available for suggestions.');
          return [];
        }

        const skillsList = skills
          .map(s => `- ID: ${s._id} | Tên: ${s.name} | Mô tả: ${s.instruction} | Loại: ${s.category}`)
          .join('\n');

        const systemPrompt = `Bạn là chuyên gia thiết kế kịch bản đào tạo.
          Nhiệm vụ: Chọn các kỹ năng (skills) phù hợp để đánh giá cho kịch bản roleplay dưới đây từ danh sách được cung cấp.
          Yêu cầu:
          1. Chọn các kỹ năng (tối đa là 5) phù hợp nhất với loại kịch bản cũng như các mô tả.
          2. Phân bổ trọng số (weight) cho từng kỹ năng sao cho tổng trọng số M BẰNG 100%.
          3. Chỉ trả về JSON array các object gồm { "skillId": string, "weight": number }.`;

        const categoryName = await this.resolveScenarioCategoryName(ctx, scenario.scenarioCategoryId);

        const userContent = `Kịch bản: "${scenario.name}"
          Mô tả: "${scenario.description}"
          Danh mục: ${categoryName}

          Danh sách kỹ năng khả dụng:
          ${skillsList}

          Hãy chọn và phân bổ trọng số:`;

        const skillsSchema = z.object({
          skills: z.array(
            z.object({
              skillId: z.string(),
              weight: z.number(),
            }),
          ),
        });

        let modelData;
        if (llmModelId) {
          modelData = await this.broker.call('llmsmodel.getDetailsModel', {id: llmModelId});
        } else {
          modelData = await ctx.call('llmsmodel.getDefaultModel');
        }
        const {apiKey, model, endpoint} = modelData;
        const modelInterface = modelData?.modelInterface || 'AzureOpenAI';

        const aiResult = await ctx.call(
          modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
          {
            messages: [
              {role: 'system', content: systemPrompt},
              {role: 'user', content: userContent},
            ],
            schema: zodResponseFormat(skillsSchema, 'skills_config').json_schema.schema,
            responseFormat: 'json_object',
            apiKey,
            model,
            endpoint,
          },
        );

        let suggestedSkills = aiResult?.skills || [];

        if (!suggestedSkills && typeof aiResult === 'string') {
          try {
            const parsed = JSON.parse(aiResult);
            suggestedSkills = parsed.skills || parsed;
          } catch (e) {
            console.log(e);
          }
        }

        if (!Array.isArray(suggestedSkills) || suggestedSkills.length === 0) {
          return [];
        }
        const validSkillIds = new Set(skills.map(s => s._id.toString()));
        suggestedSkills = suggestedSkills.filter(s => validSkillIds.has(s.skillId));

        if (suggestedSkills.length === 0) return [];

        let totalWeight = suggestedSkills.reduce((sum, s) => sum + (s.weight || 0), 0);

        if (totalWeight !== 100 && totalWeight > 0) {
          suggestedSkills = suggestedSkills.map(s => ({
            ...s,
            weight: Math.round((s.weight / totalWeight) * 100),
          }));

          const newTotal = suggestedSkills.reduce((sum, s) => sum + s.weight, 0);
          const diff = 100 - newTotal;
          if (diff !== 0) {
            suggestedSkills[0].weight += diff;
          }
        } else if (totalWeight === 0) {
          const evenWeight = Math.floor(100 / suggestedSkills.length);
          suggestedSkills = suggestedSkills.map((s, i) => ({
            ...s,
            weight: i === 0 ? evenWeight + (100 - evenWeight * suggestedSkills.length) : evenWeight,
          }));
        }
        return await ctx.call('scenarioskills.configureSkillsForScenario', {
          scenarioId: scenario._id.toString(),
          skills: suggestedSkills,
        });
      } catch (error) {
        this.logger.error('Error suggesting skills for scenario:', error);
        return [];
      }
    },

    /**
     * Trich xuat dieu kien ket thuc hoi thoai tu noi dung aiDescription.
     * Duoc goi trong generateScenarioFromDescription sau khi co aiDescription hoan chinh.
     */
    async extractConversationEndCondition(ctx, {aiDescription, modelData}) {
      console.log('===========aiDescription', aiDescription);
      if (!aiDescription || !aiDescription.trim()) return '';
      try {
        const model = modelData || (await ctx.call('llmsmodel.getDefaultModel'));
        const {apiKey, model: modelName, endpoint} = model;
        const modelInterface = model?.modelInterface || 'AzureOpenAI';

        const messages = [
          {
            role: 'system',
            content: `Bạn là chuyên gia phân tích kịch bản nhập vai.
Từ mô tả danh cho huấn luyện viên (AI Coach) dưới đây, hãy trích xuất hoặc suy luận các điều kiện để AI kết thúc cuộc trò chuyện.
Chỉ trả về nội dung các điều kiện kết thúc, viết ngắn gọn, rõ ràng bằng tiếng Việt, không giải thích thêm. Chỉ trả về chuỗi văn bản thuần túy (không JSON).`,
          },
          {
            role: 'user',
            content: `Mô tả AI Coach:\n${aiDescription}`,
          },
        ];

        const result = await ctx.call(
          modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
          {
            messages,
            apiKey,
            model: modelName,
            endpoint,
            max_tokens: 512,
          },
        );
        console.log('==========result', result);
        return typeof result === 'string' ? result.trim() : '';
      } catch (err) {
        console.error('extractConversationEndCondition failed, skipping:', err.message);
        return '';
      }
    },
  },

  created() {},

  async started() {},

  async stopped() {},
};
