'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const FileMixin = require('../../../mixins/file.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./aipersonas.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const storageDir = path.join(__dirname, 'storage');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const i18next = require('i18next');
const { INPUT_TYPE } = require('../../../constants/constant');
const { MoleculerClientError } = require('moleculer').Errors;
const z = require('zod'); // Thêm dòng này
const { zodResponseFormat } = require('openai/helpers/zod');

module.exports = {
  name: 'aipersonas',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, FileMixin],

  settings: {
    entityValidator: {},
    populates: {
      avatarId: 'files.get',
      voiceId: 'aivoice.get',
      llmModelId: 'llmsmodel.get',
      roleplayInstructionId: 'roleplayinstruction.get',
      createdBy: 'users.get',
      updatedBy: 'users.get',
    },
    populateOptions: ['createdBy', 'updatedBy', 'voiceId', 'llmModelId', 'roleplayInstructionId'],
  },

  hooks: {
    before: {
      async create(ctx) {
        if (ctx.params.aiScenariosId) {
          const scenario = await ctx.call('aiscenarios.get', { id: ctx.params.aiScenariosId }).catch(() => null);
          if (!scenario) {
            throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'AI Scenario không tồn tại'), 404);
          }
          ctx.meta.aiScenariosId = ctx.params.aiScenariosId;
          delete ctx.params.aiScenariosId;
        }
      },
      async update(ctx) {
        if (ctx.params.aiScenariosId) {
          const scenario = await ctx.call('aiscenarios.get', { id: ctx.params.aiScenariosId }).catch(() => null);
          if (!scenario) {
            throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'AI Scenario không tồn tại'), 404);
          }
          ctx.meta.aiScenariosId = ctx.params.aiScenariosId;
          delete ctx.params.aiScenariosId;
        }
      },
    },
    after: {
      async create(ctx, res) {
        if (ctx.meta.aiScenariosId) {
          try {
            await ctx.call('aiscenarios.update', {
              id: ctx.meta.aiScenariosId,
              aiPersonaId: res._id.toString(),
            });
            this.logger.info(`Updated scenario ${ctx.meta.aiScenariosId} with persona ${res._id}`);
          } catch (error) {
            this.logger.error('Failed to update scenario with persona ID:', error);
          }
        }
        return res;
      },
      async update(ctx, res) {
        if (ctx.meta.aiScenariosId) {
          try {
            await ctx.call('aiscenarios.update', {
              id: ctx.meta.aiScenariosId,
              aiPersonaId: res._id.toString(),
            });
            this.logger.info(`Updated scenario ${ctx.meta.aiScenariosId} with persona ${res._id}`);
          } catch (error) {
            this.logger.error('Failed to update scenario with persona ID:', error);
          }
        }
        return res;
      },
      'createAIPersona|updateAIPersona|deleteAIPersona': function (ctx, res) {
        const AIPersonaId = res._id;
        const performedBy = ctx.meta.user?._id;
        const action = ctx.action.name.includes('create')
          ? 'create'
          : ctx.action.name.includes('update')
            ? 'update'
            : 'delete';
        this.logger.info(`${action} AI Persona ${AIPersonaId} by ${performedBy}`);
        return res;
      },
    },
  },
  dependencies: [],

  actions: {
    createAIPersonaFromCourseContext: {
      rest: 'POST /createFromCourseContext',
      params: {
        courseId: { type: 'string', optional: true }, // To associate the persona if needed, and for context
        userPrompt: { type: 'string', optional: true }, // Additional prompt from user for persona customization
        llmModelId: { type: 'string', optional: true }, // LLM Model ID to use for generation
      },
      async handler(ctx) {
        const { courseId, userPrompt, llmModelId } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(
            i18next.t('error.permission_denied', 'Bạn không có quyền thực hiện hành động này'),
            403,
          );
        }

        let courseReferencesContent = '';
        let course;
        if (courseId) {
          try {
            course = await ctx.call('courses.get', { id: courseId, populate: ['references'] });

            if (course.references && course.references.length > 0) {
              courseReferencesContent = course.references
                .map(ref => ref.content || ref.url || ref.name)
                .join('\n---\n');
            }
          } catch (error) {
            this.logger.warn('Failed to get course references content:', error);
          }
        }

        const systemPrompt = `
          Bạn là một hệ thống tạo Persona cho một cuộc nói chuyện giữa học viên và Persona dựa trên thông tin được cung cấp.
          Hãy phân tích tên khóa học, mô tả, nội dung tài liệu tham khảo và yêu cầu thêm từ người dùng (nếu có) để tạo ra một Persona để nói chuyện với học viên.
          Persona cần có các thông tin sau:
          {
            "name": string, // Tên nhân vật
            "age": number, // Tuổi của persona
            "gender": string, // Giới tính của persona (ví dụ: "male" hoặc "female")
            "role": string, // Vai trò của persona trong kịch bản (ví dụ: "Khách hàng/người dùng/giảng viên..."
            "organization": string, // Tổ chức/Công ty mà persona thuộc về (nếu có, ví dụ: "Công ty dệt may Sông Hồng")
            "mood": string, // Tâm trạng chung của persona (ví dụ: "Bình thường/Cáu gắt ...")
            "smallTalkLikely": number, // Khả năng nói chuyện phiếm (0-100, ví dụ: 60)
            "filterWords": [string], // Danh sách từ persona nên TRÁNH sử dụng (ví dụ: ["giá quá cao", "không chắc"])
            "personaBackground": string, // Thông tin nền tảng cho cuộc trò chuyện như công việc, thu nhập hiện có, địa chỉ nhà ở v.v
            "personaConcern": string, // Mối quan tâm chính, mục tiêu của persona trong kịch bản (ví dụ: "Muốn có giải pháp để giải quyết vấn đề X", "Không muốn tư vấn gì cả...")
            "conversationStyle": string // Phong cách nói chuyện (ví dụ: "Lịch sự, thô lỗ, nhẹ nhàng, dùng từ lóng, nói ngắn gọn, nói dài dòng...")
          }
          Chú ý: Persona cần có các thông tin về tính cách, bối cảnh, và phong cách giao tiếp để tạo ra một nhân vật sống động, phù hợp với kịch bản. Đặc biệt cần phân vai cho đúng (ví dụ: kịch bản nhân viên tư vấn -> persona là khách hàng).

          Chỉ trả về object JSON hợp lệ, không giải thích thêm.
                  `.trim();

        let combinedContext = ``;
        // let combinedContext = `Tên khóa học: ${course.name}`;
        // combinedContext += `\nMô tả khóa học: ${course.description}`;
        // combinedContext += `\nNội dung tài liệu tham khảo: ${courseReferencesContent}`;
        if (userPrompt) combinedContext += `\n Đây là thông tin yêu cầu thêm từ người dùng : ${userPrompt}`;

        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: combinedContext },
        ];
        // console.log('###################################################  messages',messages);
        let aiResult;
        try {
          const personaZodSchema = z.object({
            name: z.string(),
            age: z.number().optional(),
            gender: z.enum(['male', 'female']).optional(),
            role: z.string(),
            organization: z.string().optional(),
            mood: z.string().optional(),
            smallTalkLikely: z.number().optional(),
            filterWords: z.array(z.string()).optional(),
            personaBackground: z.string().optional(),
            personaConcern: z.string().optional(),

            conversationStyle: z.string().optional(),
          });

          let modelData;
          if (llmModelId) {
            modelData = await this.broker.call('llmsmodel.getDetailsModel', { id: llmModelId });
          } else {
            modelData = await ctx.call('llmsmodel.getDefaultModel');
          }
          const { apiKey, model, endpoint } = modelData;
          const modelInterface = modelData?.modelInterface || 'AzureOpenAI';

          // Gọi LLM dựa trên modelInterface
          aiResult = await ctx.call(
            modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
            {
              messages,
              schema: zodResponseFormat(personaZodSchema, 'aiPersona').json_schema.schema,
              responseFormat: 'json_object',
              apiKey,
              model,
              endpoint,
              temperature: 0.7,
              max_tokens: 3000,
            },
          );

          console.log('AI Persona generation result from course context:', aiResult);

          this.logger.info('OpenAI response received for AI Persona generation.');
        } catch (error) {
          this.logger.error('OpenAI AI Persona generation failed:', error);
          throw new MoleculerClientError(
            i18next.t(
              'error_no_llm_model',
              'Không thể tạo AI Persona do không có LLMs Model đang hoạt động hoặc API Key không hợp lệ',
            ),
            500,
            'AI_PERSONA_GENERATION_FAILED',
          );
        }

        let personaData;
        try {
          // Khi sử dụng jsonSchema, aiResult đã là object JSON, không cần parse
          personaData = aiResult;
        } catch (error) {
          this.logger.error('Failed to process persona data from AI:', error);
          throw new MoleculerClientError(
            'Kết quả AI trả về không hợp lệ để tạo AI Persona',
            422,
            'AI_INVALID_PERSONA_JSON',
          );
        }

        if (!personaData.name) {
          this.logger.warn('AI Persona data missing name, assigning a default name.');
          personaData.name = `AI Persona cho ${course?.name}`.substring(0, 100);
        }
        // Trả về dữ liệu persona để client có thể gọi API create sau đó
        return {
          name: personaData.name,
          age: personaData.age || 30,
          gender: personaData.gender || 'male',
          avatarId: null, // Can be set later
          role: personaData.role || '',
          mood: personaData.mood || '',
          organization: personaData.organization || '',
          smallTalkLikely: typeof personaData.smallTalkLikely === 'number' ? personaData.smallTalkLikely : 50,
          filterWords: Array.isArray(personaData.filterWords) ? personaData.filterWords : [],
          personaBackground: personaData.personaBackground || '',
          personaConcern: personaData.personaConcern || '',

          conversationStyle: personaData.conversationStyle || '',
          status: 'draft', // Default status
          llmModelId,
        };
      },
    },

    createAIPersona: {
      createAIPersonaFromPrompt: {
        rest: 'POST /createAIPersonaFromPrompt',
        params: {
          prompt: { type: 'string' },
          llmModelId: { type: 'string', optional: true }, // LLM Model ID to use for generation
        },
        async handler(ctx) {
          const { prompt, llmModelId } = ctx.params;
          const user = ctx.meta.user;

          const systemPrompt = `
            Bạn là một hệ thống trích xuất thông tin AI Persona cho ứng dụng roleplay.
            Hãy đọc đoạn mô tả sau và trả về một object JSON với các trường sau:
            {
              "name": string, // Tên nhân vật
              "role": string, // Vai trò
              "organization": string, // Tổ chức
              "mood": string, // Tâm trạng
              "smallTalkLikely": number, // Xác suất nói chuyện phiếm (0-100)
              "filterWords": [string], // Danh sách từ cần tránh
              "personaBackground": string, // Nền tảng nhân vật
              "personaConcern": string, // Mối quan tâm
              "conversationStyle": string // Phong cách nói chuyện
            }

            Chỉ trả về object JSON hợp lệ, không giải thích thêm.
                    `.trim();

          const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ];

          // Lấy model data từ llmModelId hoặc sử dụng default
          let modelData;
          if (llmModelId) {
            modelData = await this.broker.call('llmsmodel.getDetailsModel', { id: llmModelId });
          } else {
            modelData = await ctx.call('llmsmodel.getDefaultModel');
          }

          // Gọi OpenAI để phân tích prompt
          let aiResult;
          try {
            // Tạo Zod schema cho AI Persona
            const personaZodSchema = z.object({
              name: z.string(),
              role: z.string().optional(),
              organization: z.string().optional(),
              mood: z.string().optional(),
              smallTalkLikely: z.number().optional(),
              filterWords: z.array(z.string()).optional(),
              personaBackground: z.string().optional(),
              personaConcern: z.string().optional(),

              conversationStyle: z.string().optional(),
            });

            const { apiKey, model, endpoint } = modelData;
            const modelInterface = modelData?.modelInterface || 'AzureOpenAI';
            aiResult = await ctx.call(
              modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
              {
                messages,
                schema: personaZodSchema, // Truyền Zod schema trực tiếp
                responseFormat: 'json_object',
                apiKey,
                model,
                endpoint,
              },
            );
          } catch (error) {
            this.logger.error('OpenAI extraction failed:', error);
            throw new MoleculerClientError('Không thể phân tích prompt để tạo AI Persona', 500);
          }

          let personaData;
          try {
            personaData = aiResult;
          } catch (error) {
            this.logger.error('Failed to process persona data:', error);
            throw new MoleculerClientError('Kết quả trả về không hợp lệ, không thể tạo AI Persona', 422);
          }

          if (!personaData.name) {
            throw new MoleculerClientError('Thiếu tên nhân vật (name)', 422);
          }
          console.log('personaData', personaData);
          const persona = await this.adapter.insert({
            name: personaData.name,
            avatarId: null,
            role: personaData.role || '',
            mood: personaData.mood || '',
            organization: personaData.organization || '',
            smallTalkLikely: typeof personaData.smallTalkLikely === 'number' ? personaData.smallTalkLikely : 50,
            filterWords: Array.isArray(personaData.filterWords) ? personaData.filterWords : [],
            personaBackground: personaData.personaBackground || '',
            personaConcern: personaData.personaConcern || '',
            status: 'draft',
            createdBy: user._id,
            updatedBy: user._id,
            organizationId: user.organizationId,

            conversationStyle: personaData.conversationStyle || '',
            llmModelId: llmModelId || modelData?._id,
          });

          this.broker.emit('aipersonas.created', { persona, user });
          return persona;
        },
      },

      rest: 'POST /createAIPersona',
      params: {
        name: { type: 'string', min: 2, max: 100 },
        avatarId: { type: 'string', optional: true },
        voiceId: { type: 'string', optional: true },
        llmModelId: { type: 'string', optional: true },
        role: { type: 'string', optional: true, max: 100 },
        mood: { type: 'string', optional: true, max: 100 },
        organization: { type: 'string', optional: true, max: 255 },
        smallTalkLikely: { type: 'number', optional: true, min: 0, max: 100, default: 50 },
        filterWords: { type: 'array', optional: true, items: 'string' },
        personaBackground: { type: 'string', optional: true, max: 2000 },
        personaConcern: { type: 'string', optional: true, max: 2000 },
        status: { type: 'string', optional: true, enum: ['draft', 'published', 'hidden'], default: 'draft' },
        aiScenariosId: { type: 'string', optional: true },
        gender: { type: 'string', optional: true },
        age: { type: 'number', optional: true },
        roleplayInstructionId: { type: 'string', optional: true },
        conversationStyle: { type: 'string', optional: true, max: 2000 },
      },
      async handler(ctx) {
        const {
          name,
          avatarId,
          voiceId,
          llmModelId,
          role,
          mood,
          organization,
          smallTalkLikely,
          filterWords,
          personaBackground,
          personaConcern,
          status,
          aiScenariosId,
          personaPrompt,
          gender,
          age,
          roleplayInstructionId,
          conversationStyle,
          conversationEndCondition,
        } = ctx.params;
        const user = ctx.meta.user;

        if (llmModelId) {
          const llmModel = await ctx.call('llmsmodel.get', { id: llmModelId });
          if (!llmModel || llmModel.isDeleted) {
            throw new MoleculerClientError(i18next.t('error_llm_model_not_found', 'LLM Model không tồn tại'), 404);
          }
        }

        if (aiScenariosId) {
          const scenario = await ctx.call('aiscenarios.get', { id: aiScenariosId }).catch(() => null);
          if (!scenario) {
            throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'AI Scenario không tồn tại'), 404);
          }
        }
        const persona = await this.adapter.insert({
          name,
          avatarId,
          voiceId,
          llmModelId,
          role,
          mood,
          organization,
          smallTalkLikely: smallTalkLikely || 50,
          filterWords: filterWords || [],
          personaBackground,
          personaConcern,
          status: status || 'draft',
          createdBy: user._id,
          updatedBy: user._id,
          organizationId: user.organizationId,
          personaPrompt: personaPrompt || '',
          gender,
          age,
          roleplayInstructionId,
          conversationStyle,
          conversationEndCondition: conversationEndCondition || '',
        });

        if (aiScenariosId) {
          try {
            await ctx.call('aiscenarios.update', {
              id: aiScenariosId,
              aiPersonaId: persona._id.toString(),
            });
          } catch (error) {
            this.logger.error('Failed to update scenario with persona ID:', error);
          }
        }

        this.broker.emit('aipersonas.created', { persona, user });
        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, persona);
      },
    },

    // Cập nhật AI Persona
    updateAIPersona: {
      rest: 'PUT /:id/updateAIPersona',
      params: {
        id: { type: 'string' },
        name: { type: 'string', min: 2, max: 100, optional: true },
        avatarId: { type: 'string', optional: true },
        voiceId: { type: 'string', optional: true },
        llmModelId: { type: 'string', optional: true },
        role: { type: 'string', optional: true, max: 100 },
        mood: { type: 'string', optional: true, max: 100 },
        organization: { type: 'string', optional: true, max: 255 },
        smallTalkLikely: { type: 'number', optional: true, min: 0, max: 100 },
        filterWords: { type: 'array', optional: true, items: 'string' },
        personaBackground: { type: 'string', optional: true, max: 2000 },
        personaConcern: { type: 'string', optional: true, max: 2000 },
        status: { type: 'string', optional: true, enum: ['draft', 'published', 'hidden'] },
        aiScenariosId: { type: 'string', optional: true },
        useGeminiLive: { type: 'boolean', optional: true },
        roleplayInstructionId: { type: 'string', optional: true },
        conversationStyle: { type: 'string', optional: true, max: 2000 },
      },
      async handler(ctx) {
        const { id, ...updateData } = ctx.params;
        const user = ctx.meta.user;

        // Kiểm tra quyền
        if (!user || (!user.isSystemAdmin && !this.hasOrgAdminPermission(user))) {
          throw new MoleculerClientError(
            i18next.t('error.permission_denied', 'Bạn không có quyền thực hiện hành động này'),
            403,
          );
        }

        // Tìm AI Persona
        const persona = await this.adapter.findById(id);
        if (!persona) {
          throw new MoleculerClientError(i18next.t('error.persona_not_found', 'AI Persona không tìm thấy'), 404);
        }

        // Nếu không phải system admin, kiểm tra xem có thuộc tổ chức của user không
        if (
          !user.isSystemAdmin &&
          persona.organizationId &&
          persona.organizationId.toString() !== user.organizationId.toString()
        ) {
          throw new MoleculerClientError(
            i18next.t('error.permission_denied', 'Bạn không có quyền cập nhật AI Persona này'),
            403,
          );
        }

        // Cập nhật AI Persona
        if (updateData.llmModelId) {
          const llmModel = await ctx.call('llmsmodel.get', { id: updateData.llmModelId });
          if (!llmModel || llmModel.isDeleted) {
            throw new MoleculerClientError(i18next.t('error_llm_model_not_found', 'LLM Model không tồn tại'), 404);
          }
        }

        // Kiểm tra AI Scenario tồn tại nếu có aiScenariosId
        if (updateData.aiScenariosId) {
          const scenario = await ctx.call('aiscenarios.get', { id: updateData.aiScenariosId }).catch(() => null);
          if (!scenario) {
            throw new MoleculerClientError(i18next.t('error.scenario_not_found', 'AI Scenario không tồn tại'), 404);
          }
        }

        const allowedUpdates = [
          'name',
          'avatarId',
          'voiceId',
          'llmModelId',
          'role',
          'mood',
          'organization',
          'smallTalkLikely',
          'filterWords',
          'personaBackground',
          'personaConcern',
          'status',
          'useGeminiLive',
          'roleplayInstructionId',
          'conversationStyle',
        ];
        const finalUpdateData = {};
        for (const key of allowedUpdates) {
          if (updateData.hasOwnProperty(key)) {
            finalUpdateData[key] = updateData[key];
          }
        }

        Object.assign(persona, finalUpdateData, { updatedBy: user._id });
        await persona.save();

        // Nếu có aiScenariosId mới, cập nhật aiPersonaId trong scenario
        if (updateData.aiScenariosId) {
          try {
            await ctx.call('aiscenarios.update', {
              id: updateData.aiScenariosId,
              aiPersonaId: id,
            });
          } catch (error) {
            this.logger.error('Failed to update scenario with persona ID:', error);
          }
        }

        this.broker.emit('aipersonas.updated', { persona, user });
        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, persona);
      },
    },

    // Xóa AI Persona (xóa mềm)
    deleteAIPersona: {
      rest: 'DELETE /:id/deleteAIPersona',
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        const { id } = ctx.params;
        const user = ctx.meta.user;

        // Kiểm tra quyền
        if (!user || (!user.isSystemAdmin && !this.hasOrgAdminPermission(user))) {
          throw new MoleculerClientError(
            i18next.t('error.permission_denied', 'Bạn không có quyền thực hiện hành động này'),
            403,
          );
        }

        // Tìm AI Persona
        const persona = await this.adapter.findById(id);
        if (!persona) {
          throw new MoleculerClientError(i18next.t('error.persona_not_found', 'AI Persona không tìm thấy'), 404);
        }

        // Nếu không phải system admin, kiểm tra xem có thuộc tổ chức của user không
        if (
          !user.isSystemAdmin &&
          persona.organizationId &&
          persona.organizationId.toString() !== user.organizationId.toString()
        ) {
          throw new MoleculerClientError(
            i18next.t('error.permission_denied', 'Bạn không có quyền xóa AI Persona này'),
            403,
          );
        }

        // Xóa mềm
        persona.deletedAt = new Date();
        persona.isDeleted = true;
        persona.status = 'archived';
        await persona.save();

        this.broker.emit('aipersonas.deleted', { personaId: id, user });
        return persona;
      },
    },

    // Lấy danh sách AI Persona đã publish
    getAll: {
      rest: 'GET /allPublished',
      async handler(ctx) {
        try {
          const { query: queryString = '{}', sort } = ctx.params;
          const query = { ...JSON.parse(queryString), status: 'published', isDeleted: { $ne: true } };
          const params = this.constructParamsGetAll(ctx.params, query, sort);

          return ctx.call('aipersonas.list', params);
        } catch (error) {
          this.logger.error('Error in getAll handler:', error);
          throw error;
        }
      },
    },

    // Tải lên avatar cho AI Persona
    uploadAvatar: {
      rest: {
        method: 'POST',
        path: '/:id/avatar',
      },
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        const { id } = ctx.params;
        const user = ctx.meta.user;

        // Kiểm tra quyền
        if (!user || (!user.isSystemAdmin && !this.hasOrgAdminPermission(user))) {
          throw new MoleculerClientError(
            i18next.t('error.permission_denied', 'Bạn không có quyền thực hiện hành động này'),
            403,
          );
        }

        // Lấy AI Persona
        const persona = await this.adapter.findById(id);
        if (!persona) {
          throw new MoleculerClientError(i18next.t('error.persona_not_found', 'AI Persona không tìm thấy'), 404);
        }

        // Nếu không phải system admin, kiểm tra xem có thuộc tổ chức của user không
        if (
          !user.isSystemAdmin &&
          persona.organizationId &&
          persona.organizationId.toString() !== user.organizationId.toString()
        ) {
          throw new MoleculerClientError(
            i18next.t('error.permission_denied', 'Bạn không có quyền cập nhật AI Persona này'),
            403,
          );
        }

        // Xử lý upload avatar
        ctx.meta.$multipart = ctx.meta.$multipart || {};
        ctx.meta.$multipart.folder = 'aipersonas';
        ctx.meta.$multipart.fileType = 'image';

        const file = await ctx.call('files.upload', ctx.params, { meta: ctx.meta });

        // Cập nhật avatar cho AI Persona
        persona.avatarId = file._id;
        await persona.save();

        return { success: true, file, persona };
      },
    },

    // Tạo prompt cho AI Persona
    generatePersonaPrompt: {
      visibility: 'public',
      params: {
        personaId: { type: 'string' },
        context: { type: 'object', optional: true },
      },
      async handler(ctx) {
        const { personaId, context } = ctx.params;

        // Lấy thông tin AI Persona
        const persona = await this.adapter.findById(personaId);
        if (!persona || persona.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.persona_not_found', 'AI Persona không tìm thấy'), 404);
        }

        // Tạo prompt cho AI
        const prompt = this.constructPersonaPrompt(persona, context);

        return { prompt };
      },
    },
  },

  events: {
    'aipersonas.created': {
      async handler(payload) {
        this.logger.info(`New AI Persona created: ${payload.persona.name}`);
      },
    },

    'aipersonas.updated': {
      async handler(payload) {
        this.logger.info(`AI Persona updated: ${payload.persona._id}`);
      },
    },

    'aipersonas.deleted': {
      async handler(payload) {
        this.logger.info(`AI Persona deleted: ${payload.personaId}`);
      },
    },
  },

  methods: {
    constructParamsGetAll(params, query, sort) {
      return {
        ...this.extractParamsList(params),
        searchFields: 'name,role,organization',
        query: JSON.stringify(query),
        fields:
          'name avatarId role mood organization smallTalkLikely personaBackground personaConcern status _id roleplayInstructionId conversationEndCondition',
        sort,
      };
    },

    hasOrgAdminPermission(user) {
      // Kiểm tra xem user có phải là admin của tổ chức không
      return user && (user.role === 'orgAdmin' || user.isOrgAdmin === true);
    },

    constructPersonaPrompt(persona, context = {}) {
      const { courseInfo, taskInfo, conversationHistory } = context;

      // Tạo prompt cơ bản từ thông tin persona
      let prompt = `You are roleplaying as ${persona.name}`;

      if (persona.role) {
        prompt += `, a ${persona.role}`;
      }

      if (persona.organization) {
        prompt += ` from ${persona.organization}`;
      }

      if (persona.mood) {
        prompt += `. Your current mood is ${persona.mood}`;
      }

      prompt += '.\n\n';

      // Thêm thông tin background
      if (persona.personaBackground) {
        prompt += `Background information: ${persona.personaBackground}\n\n`;
      }

      // Thêm các mối quan tâm của persona
      if (persona.personaConcern) {
        prompt += `Your main concerns or interests: ${persona.personaConcern}\n\n`;
      }

      // Thêm xác suất small talk
      if (persona.smallTalkLikely !== undefined) {
        const smallTalkLevel =
          persona.smallTalkLikely > 70 ? 'high' : persona.smallTalkLikely > 30 ? 'moderate' : 'low';
        prompt += `You have a ${smallTalkLevel} tendency for small talk.\n\n`;
      }

      // Thêm các từ cần tránh
      if (persona.filterWords && persona.filterWords.length > 0) {
        prompt += `Avoid using these words or phrases: ${persona.filterWords.join(', ')}\n\n`;
      }

      // Thêm thông tin khóa học nếu có
      if (courseInfo) {
        prompt += `Course information: ${JSON.stringify(courseInfo)}\n\n`;
      }

      // Thêm thông tin nhiệm vụ nếu có
      if (taskInfo) {
        prompt += `Task information: ${JSON.stringify(taskInfo)}\n\n`;
      }

      // Thêm lịch sử trò chuyện nếu có
      if (conversationHistory && conversationHistory.length > 0) {
        prompt += 'Previous conversation:\n';
        conversationHistory.forEach(msg => {
          prompt += `${msg.role === 'ai' ? persona.name : 'User'}: ${msg.content}\n`;
        });
        prompt += '\n';
      }

      // Thêm hướng dẫn kết thúc
      prompt +=
        "Respond in a way that's consistent with your character. Keep your responses natural and conversational.";

      return prompt;
    },

    async timeout(delay) {
      return new Promise(res => setTimeout(res, delay));
    },
  },

  created() { },

  async started() {
    this.createFolderIfNotExist(storageDir);
  },

  async stopped() { },
};
