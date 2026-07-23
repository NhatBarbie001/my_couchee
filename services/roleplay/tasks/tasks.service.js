'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./tasks.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const z = require('zod');
const {zodResponseFormat} = require('openai/helpers/zod');

module.exports = {
  name: 'tasks',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService],

  settings: {
    entityValidator: {
      name: {type: 'string', min: 2, max: 255},
      description: {type: 'string', max: 5000},
      evaluationGuidelines: {type: 'string', optional: true, max: 5000},
      weight: {type: 'number', optional: true, min: 0},
      exampleVideoUrl: {type: 'string', optional: true},
      helpfulLinks: {type: 'array', optional: true, items: 'string'},
      isMakeOrBreak: {type: 'boolean', optional: true},
      orderInScenario: {type: 'number', optional: true, min: 0},
    },
    populates: {
      organizationId: 'organizations.get',
      createdBy: 'users.get',
      updatedBy: 'users.get',
    },
    populateOptions: ['organizationId', 'createdBy', 'updatedBy'],
    fields: [
      '_id',
      'name',
      'description',
      'evaluationGuidelines',
      'weight',
      'exampleVideoUrl',
      'helpfulLinks',
      'isMakeOrBreak',
      'orderInScenario',
      'organizationId',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
      'isDeleted',
    ],
    defaultSort: 'orderInScenario',
  },

  dependencies: ['organizations', 'users'],

  hooks: {
    after: {
      create: async (ctx, task) => {
        console.log('#####################task', task);
        ctx.emit('tasks.created', {task});
        return task;
      },
      remove: async (ctx, task) => {
        ctx.emit('tasks.deleted', {task});
        return task;
      },
    },
  },

  actions: {
    // Tạo nhiệm vụ mới
    create: {
      rest: 'POST /',
      params: {
        name: {type: 'string', min: 2, max: 255},
        description: {type: 'string', max: 5000},
        evaluationGuidelines: {type: 'string', optional: true, max: 5000},
        weight: {type: 'number', optional: true, min: 0},
        exampleVideoUrl: {type: 'string', optional: true},
        helpfulLinks: {type: 'array', optional: true, items: 'string'},
        isMakeOrBreak: {type: 'boolean', optional: true, default: false},
        orderInScenario: {type: 'number', optional: true},
      },
      async handler(ctx) {
        const {
          name,
          description,
          evaluationGuidelines,
          weight,
          exampleVideoUrl,
          helpfulLinks,
          isMakeOrBreak,
          orderInScenario,
          organizationId,
        } = ctx.params;
        const user = ctx.meta.user;

        // Tìm orderInScenario cao nhất hiện tại nếu không được cung cấp
        let taskOrder = orderInScenario;
        if (taskOrder === undefined) {
          const lastTask = await this.adapter.findOne(
            {
              organizationId,
              isDeleted: {$ne: true},
            },
            {sort: {orderInScenario: -1}},
          );

          taskOrder = lastTask ? lastTask.orderInScenario + 1 : 0;
        }

        const taskData = {
          name,
          description,
          evaluationGuidelines: evaluationGuidelines || '',
          weight: weight || 0,
          exampleVideoUrl: exampleVideoUrl || '',
          helpfulLinks: helpfulLinks || [],
          isMakeOrBreak: isMakeOrBreak || false,
          orderInScenario: taskOrder,
          organizationId, // Đã được gán từ hook before
          createdBy: user._id,
          updatedBy: user._id,
        };

        const task = await this.adapter.insert(taskData);
        return this.transformDocuments(ctx, {}, task);
      },
    },
    // Xóa nhiệm vụ (xóa mềm)
    remove: {
      rest: 'DELETE /:id',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const user = ctx.meta.user;
        const task = ctx.locals.task; // Task đã được lấy từ hook before

        const updated = await this.adapter.updateById(id, {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            updatedBy: user._id,
          },
        });

        return this.transformDocuments(ctx, {}, updated);
      },
    },

    // Tạo tasks từ prompt sử dụng AI
    createTasksFromPrompt: {
      rest: 'POST /createFromPrompt',
      params: {
        courseId: {type: 'string'}, // ID của course (bắt buộc)
        prompt: {type: 'string'}, // Prompt để gửi cho AI
        scenario: {type: 'object'}, // Scenario để gửi cho AI
        aiPersonaId: {type: 'string', optional: true}, // AI Persona ID để AI hiểu rõ hơn ngữ cảnh
      },
      async handler(ctx) {
        const {courseId, prompt, scenario, aiPersonaId} = ctx.params;
        const user = ctx.meta.user;

        let course = null;
        let courseReferences = [];

        // Lấy thông tin course liên quan
        try {
          course = await ctx.call('courses.get', {id: courseId, populate: ['references']});
          if (!course) {
            throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
          }

          if (course.references && Array.isArray(course.references)) {
            courseReferences = course.references;
          }

          // Kiểm tra quyền (ví dụ: chỉ admin hoặc người tạo course)
          // Add actual permission check here, e.g., based on course.createdBy or organizationId
        } catch (error) {
          this.logger.error('Failed to get course:', error);
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
        }

        // Xử lý helpfulLinks và exampleVideoUrl từ course.references nếu có
        let extractedHelpfulLinks = [];
        let extractedExampleVideoUrl = '';

        if (courseReferences.length > 0) {
          // Lọc ra các reference có type là 'url' hoặc 'youtube' cho helpfulLinks
          extractedHelpfulLinks = courseReferences
            .filter(ref => ref.type === 'url' || ref.type === 'youtube')
            .map(ref => ref.url)
            .filter(url => url); // Lọc bỏ các giá trị null/undefined

          // Tìm reference đầu tiên có type là 'youtube' hoặc 'video' cho exampleVideoUrl
          const videoRef = courseReferences.find(ref => ref.type === 'youtube' || ref.type === 'video');
          if (videoRef && videoRef.url) {
            extractedExampleVideoUrl = videoRef.url;
          }
        }

        // Sử dụng giá trị từ tham số đầu vào nếu có, nếu không thì sử dụng giá trị trích xuất từ references
        const finalHelpfulLinks = extractedHelpfulLinks;
        const finalExampleVideoUrl = extractedExampleVideoUrl;
        const systemPrompt = `
Bạn là một hệ thống tạo danh sách chủ đề/nhiệm vụ (tasks) cho một cuộc trò chuyện giữa người dùng với AI Persona.
Hãy đọc thông tin khóa học, thông tin kịch bản (scenario) và AI Persona (nếu có) được cung cấp trong prompt sau đây.
Dựa vào những thông tin đó bạn hãy đưa danh sách các chủ đề/nhiệm trò chuyện để người dùng nói chuyện với AI Persona.
Ngoài ra mỗi chủ đề/nhiệm vụ đấy cần phải đáp ứng được mục tiêu kịch bản và phải có các hướng dẫn đánh giá sơ bộ dành cho giám khảo khi xem lại cuộc trò chuyện giữa người và AI, đây là đánh giá dành cho nguòi dùng.

Mỗi chủ đề/nhiệm vụ cần có các thông tin sau:
- name: string (Tên nhiệm vụ, ngắn gọn, ví dụ: "Chào hỏi và giới thiệu sản phẩm")
- description: string (Mô tả chi tiết nhiệm vụ, mục tiêu cần đạt được, ví dụ: "Học viên thực hành kỹ năng chào hỏi khách hàng và giới thiệu về sản phẩm X một cách tự nhiên và thu hút.")
- evaluationGuidelines: string (Hướng dẫn đánh giá sơ bộ dành cho giám khảo đánh giá chấ lượng trò chuyện của người dùng, ví dụ: "Đánh giá dựa trên sự tự tin, thông tin sản phẩm chính xác, khả năng tạo thiện cảm.")
- weight: number (Trọng số của nhiệm vụ, từ 0-100, ví dụ: 20)
- isMakeOrBreak: boolean (Đánh dấu nhiệm vụ có tính chất "sống còn", ví dụ: true/false)
- helpfulLinks: array (Danh sách các URL tham khảo hữu ích, bỏ trống nếu không có)
- exampleVideoUrl: string (URL đến video mẫu minh họa cách thực hiện nhiệm vụ, bỏ trống nếu không có)

Trả về một mảng JSON chứa các object nhiệm vụ. Ví dụ:
[
  {
    "name": "Task 1 Name",
    "description": "Detailed description for Task 1.",
    "evaluationGuidelines": "Guideline for evaluating task 1.",
    "weight": 30,
    "isMakeOrBreak": true,
    "helpfulLinks": ["https://example.com/guide1"],
    "exampleVideoUrl": "https://example.com/video1.mp4"
  },
  {
    "name": "Task 2 Name",
    "description": "Detailed description for task 2.",
    "evaluationGuidelines": "Guideline for evaluating task 2.",
    "weight": 20,
    "isMakeOrBreak": false,
    "helpfulLinks": ["https://example.com/guide2", "https://example.com/guide3"],
    "exampleVideoUrl": "https://example.com/video2.mp4"
  }
]
Chỉ trả về mảng JSON hợp lệ, không giải thích thêm.
        `.trim();

        const messages = [
          {role: 'system', content: systemPrompt},
          {
            role: 'user',
            content: `Dưới đây là thông tin chi tiết để bạn tạo danh sách nhiệm vụ (tasks) cho cuộc trò chuyện:\n
          ${scenario ? `\n##Kịch bản trò chuyện: ${scenario.name}, mô tả kịch bản ${scenario.description}` : ''}
          ${scenario.aiPersonaId ? `\n##Thông tin AI Persona trong trò chuyện: ${JSON.stringify(scenario.aiPersonaId)}` : ''}
          ${courseReferences.length > 0 ? `\n##Tài liệu liên quan tới kịch bản trò chuyện:\n${courseReferences.map(ref => `- ${ref.name} - ${ref.url} : ${ref.content ? ref.content : 'Không có nội dung'}`).join('\n')}` : ''}
          ${prompt ? `\n##Yêu cầu bổ sung: ${prompt}` : ''}`,
          },
        ];
        console.log('##########messages', messages);
        // Tạo Zod schema cho task
        const taskZodSchema = z.object({
          tasks: z.array(
            z.object({
              name: z.string(),
              description: z.string(),
              evaluationGuidelines: z.string().optional(),
              weight: z.number().optional(),
              isMakeOrBreak: z.boolean().optional(),
              helpfulLinks: z.array(z.string()).optional(),
              exampleVideoUrl: z.string().optional(),
            }),
          ),
        });

        let aiResult;
        try {
          // Lấy default model data để có apiKey và modelInterface
          const defaultModelData = await ctx.call('llmsmodel.getDefaultModel');
          const {apiKey, model, endpoint} = defaultModelData;
          const modelInterface = defaultModelData?.modelInterface || 'AzureOpenAI';

          this.logger.info(`Calling ${modelInterface} for task generation...`);
          aiResult = await ctx.call(
            modelInterface === 'AzureOpenAI' ? 'azureopenai.chatCompletion' : 'chatgpt.chatCompletion',
            {
              messages,
              schema: zodResponseFormat(taskZodSchema, 'tasks').json_schema.schema,
              responseFormat: 'json_object',
              max_tokens: 1000,
              apiKey,
              model,
              endpoint,
            },
          );
          this.logger.info('LLM response received for task generation.');
        } catch (error) {
          this.logger.error('LLM task generation failed:', error);
          throw new MoleculerClientError('Không thể tạo tasks từ AI', 500, 'AI_TASK_GENERATION_FAILED');
        }

        // Không cần phải parse JSON vì aiResult đã là một mảng JSON
        const suggestedTasks = aiResult.tasks;

        // Chuẩn bị danh sách tasks để trả về cho client
        const suggestedTasksData = [];
        let orderInScenario = 0;

        // Lấy orderInScenario tiếp theo từ organization
        const lastTask = await this.adapter.findOne(
          {organizationId: user.organizationId, isDeleted: {$ne: true}},
          {sort: {orderInScenario: -1}},
        );
        orderInScenario = lastTask ? lastTask.orderInScenario + 1 : 0;

        for (const taskSuggestion of suggestedTasks) {
          if (!taskSuggestion.name || !taskSuggestion.description) {
            this.logger.warn('Skipping task suggestion due to missing name or description:', taskSuggestion);
            continue;
          }

          const taskData = {
            name: taskSuggestion.name,
            description: taskSuggestion.description,
            evaluationGuidelines: taskSuggestion.evaluationGuidelines || '',
            weight: taskSuggestion.weight || 0,
            isMakeOrBreak: taskSuggestion.isMakeOrBreak || false,
            helpfulLinks: taskSuggestion.helpfulLinks || finalHelpfulLinks || [],
            exampleVideoUrl: taskSuggestion.exampleVideoUrl || finalExampleVideoUrl || '',
            orderInScenario: orderInScenario++,
            organizationId: user.organizationId,
            createdBy: user._id,
            updatedBy: user._id,
          };

          // Tạo task trong database
          const createdTask = await this.adapter.insert(taskData);
          suggestedTasksData.push(createdTask);
        }

        return {tasks: suggestedTasksData, count: suggestedTasksData.length};
      },
    },
  },

  methods: {
    /**
     * Kiểm tra quyền của user đối với nhiệm vụ
     *
     * @param {Object} user - Thông tin user
     * @param {Object} task - Thông tin nhiệm vụ
     * @param {String} permission - Loại quyền ('read', 'write', 'delete')
     * @returns {Boolean} - Có quyền hay không
     */
    hasPermission(user, task, permission = 'read') {
      if (!user) return false;

      // System admin có mọi quyền
      if (user.isSystemAdmin) return true;

      // Organization admin có quyền với nhiệm vụ trong tổ chức của mình
      if (
        user.isOrgAdmin &&
        task.organizationId &&
        user.organizationId &&
        user.organizationId.toString() === task.organizationId.toString()
      ) {
        return true;
      }

      // Người dùng thường chỉ có quyền đọc
      if (permission === 'read') {
        // Nhiệm vụ thuộc tổ chức của user
        if (
          task.organizationId &&
          user.organizationId &&
          user.organizationId.toString() === task.organizationId.toString()
        ) {
          return true;
        }
      }

      return false;
    },
  },

  async started() {
    this.logger.warn('#####################################################Tasks service started');
  },

  async stopped() {
    this.logger.warn('#####################################################Tasks service stopped');
  },
};
