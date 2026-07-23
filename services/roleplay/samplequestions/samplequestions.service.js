'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./samplequestions.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const { MoleculerClientError } = require('moleculer').Errors;
const DefaultPermission = require('../../../mixins/defaultPermission.mixin');
const { RESOURCES, ACTIONS } = require('../../../constants/permissions');

module.exports = {
  name: 'samplequestions',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, DefaultPermission],

  settings: {
    defaultResource: RESOURCES.CATEGORY,
    entityValidator: {},
    populates: {
      createdBy: 'users.get',
      updatedBy: 'users.get',
    },
    populateOptions: ['createdBy', 'updatedBy'],
    fields: [
      '_id',
      'content',
      'status',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
      'isDeleted',
    ],
    defaultSort: '-createdAt',
  },

  hooks: {
    after: {},
    before: {},
  },

  actions: {
    create: {
      rest: 'POST /',
      params: {
        content: { type: 'string', min: 2 },
        status: { type: 'enum', values: ['active', 'inactive'], optional: true },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.CREATE },
      async handler(ctx) {
        const { content, status } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const question = await this.adapter.insert({
          content: content.trim(),
          status: status || 'active',
          createdBy: user._id,
          updatedBy: user._id,
        });

        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, question);
      },
    },

    update: {
      rest: 'PUT /:id',
      params: {
        id: { type: 'string' },
        content: { type: 'string', min: 2, optional: true },
        status: { type: 'enum', values: ['active', 'inactive'], optional: true },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.UPDATE },
      async handler(ctx) {
        const { id, content, status } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const question = await this.adapter.findById(id);
        if (!question || question.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.sample_question_not_found', 'Câu hỏi mẫu không tồn tại'),
            404,
          );
        }

        const updateData = { updatedBy: user._id };
        if (content) updateData.content = content.trim();
        if (status) updateData.status = status;

        const updated = await this.adapter.updateById(id, { $set: updateData });
        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, updated);
      },
    },

    remove: {
      rest: 'DELETE /:id',
      params: {
        id: { type: 'string' },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.DELETE },
      async handler(ctx) {
        const { id } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const question = await this.adapter.findById(id);
        if (!question || question.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.sample_question_not_found', 'Câu hỏi mẫu không tồn tại'),
            404,
          );
        }

        // Kiểm tra xem câu hỏi mẫu có đang được sử dụng bởi scenariocategory nào không
        const categories = await ctx.call('scenariocategories.find', {
          query: {
            'sampleQuestions.sampleQuestionId': id,
            isDeleted: false,
          },
        });

        if (categories && categories.length > 0) {
          throw new MoleculerClientError(
            i18next.t('error.sample_question_in_use', 'Không thể xóa câu hỏi mẫu vì đang được sử dụng bởi {{count}} danh mục kịch bản', { count: categories.length }),
            400,
            'SAMPLE_QUESTION_IN_USE',
          );
        }

        const updated = await this.adapter.updateById(id, {
          $set: {
            isDeleted: true,
            updatedBy: user._id,
          },
        });

        return this.transformDocuments(ctx, {}, updated);
      },
    },

    getAll: {
      rest: 'GET /all',
      async handler(ctx) {
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const query = {
          isDeleted: false,
          status: 'active',
        };

        const questions = await this.adapter.find({ query, sort: '-createdAt' });
        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, questions);
      },
    },
  },

  methods: {},

  created() {},

  async started() {
    this.logger.info('SampleQuestions service started');
  },

  async stopped() {
    this.logger.info('SampleQuestions service stopped');
  },
};
