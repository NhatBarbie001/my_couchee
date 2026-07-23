'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./scenariocategories.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const { MoleculerClientError } = require('moleculer').Errors;
const DefaultPermission = require('../../../mixins/defaultPermission.mixin');
const { RESOURCES, ACTIONS } = require('../../../constants/permissions');

module.exports = {
  name: 'scenariocategories',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, DefaultPermission],

  settings: {
    defaultResource: RESOURCES.CATEGORY,
    entityValidator: {},
    populates: {
      createdBy: 'users.get',
      updatedBy: 'users.get',
      'sampleQuestions.sampleQuestionId': 'samplequestions.get',
    },
    populateOptions: ['createdBy', 'updatedBy', 'sampleQuestions.sampleQuestionId'],
    fields: [
      '_id',
      'name',
      'status',
      'trainingDescription',
      'sampleQuestions',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
      'isDeleted',
    ],
    defaultSort: '-createdAt',
  },

  hooks: {
    after: {
      list: 'populateSampleQuestions',
      get: 'populateSampleQuestions',
    },
    before: {},
  },

  actions: {
    create: {
      rest: 'POST /',
      params: {
        name: { type: 'string', min: 2, max: 255 },
        status: { type: 'enum', values: ['active', 'inactive'], optional: true },
        trainingDescription: { type: 'string', optional: true },
        sampleQuestions: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            props: {
              sampleQuestionId: { type: 'string', optional: true },
              customQuestion: { type: 'string', optional: true },
              isRequired: { type: 'boolean', optional: true },
            },
          },
        },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.CREATE },
      async handler(ctx) {
        const { name, status, trainingDescription, sampleQuestions } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const existing = await this.adapter.findOne({
          name: name.trim(),
          isDeleted: false,
        });

        if (existing) {
          throw new MoleculerClientError(
            i18next.t('error.scenario_category_exists', 'Loại kịch bản với tên này đã tồn tại'),
            400,
          );
        }

        const category = await this.adapter.insert({
          name: name.trim(),
          status: status || 'active',
          trainingDescription: trainingDescription || null,
          sampleQuestions: (sampleQuestions || [])
            .filter(sq => sq.sampleQuestionId || sq.customQuestion)
            .map(sq => ({
              ...(sq.sampleQuestionId ? { sampleQuestionId: sq.sampleQuestionId } : {}),
              ...(sq.customQuestion ? { customQuestion: sq.customQuestion } : {}),
              isRequired: sq.isRequired || false,
            })),
          createdBy: user._id,
          updatedBy: user._id,
        });

        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, category);
      },
    },

    update: {
      rest: 'PUT /:id',
      params: {
        id: { type: 'string' },
        name: { type: 'string', min: 2, max: 255, optional: true },
        status: { type: 'enum', values: ['active', 'inactive'], optional: true },
        trainingDescription: { type: 'string', optional: true },
        sampleQuestions: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            props: {
              sampleQuestionId: { type: 'string', optional: true },
              customQuestion: { type: 'string', optional: true },
              isRequired: { type: 'boolean', optional: true },
            },
          },
        },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.UPDATE },
      async handler(ctx) {
        const { id, name, status, trainingDescription, sampleQuestions } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const category = await this.adapter.findById(id);
        if (!category || category.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.scenario_category_not_found', 'Loại kịch bản không tồn tại'),
            404,
          );
        }

        if (name && name.trim() !== category.name) {
          const existing = await this.adapter.findOne({
            name: name.trim(),
            isDeleted: false,
            _id: { $ne: id },
          });

          if (existing) {
            throw new MoleculerClientError(
              i18next.t('error.scenario_category_exists', 'Loại kịch bản với tên này đã tồn tại'),
              400,
            );
          }
        }

        const updateData = { updatedBy: user._id };
        if (name) updateData.name = name.trim();
        if (status) updateData.status = status;
        if (trainingDescription !== undefined) updateData.trainingDescription = trainingDescription;
        if (sampleQuestions !== undefined) {
          updateData.sampleQuestions = sampleQuestions
            .filter(sq => sq.sampleQuestionId || sq.customQuestion)
            .map(sq => ({
              ...(sq.sampleQuestionId ? { sampleQuestionId: sq.sampleQuestionId } : {}),
              ...(sq.customQuestion ? { customQuestion: sq.customQuestion } : {}),
              isRequired: sq.isRequired || false,
            }));
        }

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

        const category = await this.adapter.findById(id);
        if (!category || category.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.scenario_category_not_found', 'Loại kịch bản không tồn tại'),
            404,
          );
        }

        // Kiểm tra xem category có đang được sử dụng bởi kịch bản nào không
        const scenarios = await ctx.call('aiscenarios.find', {
          query: {
            scenarioCategoryId: id,
            isDeleted: false,
          },
        });

        if (scenarios && scenarios.length > 0) {
          throw new MoleculerClientError(
            i18next.t('error.scenario_category_in_use', 'Không thể xóa loại kịch bản vì đang được sử dụng bởi {{count}} kịch bản', { count: scenarios.length }),
            400,
            'CATEGORY_IN_USE',
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

        const categories = await this.adapter.find({ query, sort: 'name' });
        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, categories);
      },
    },
  },

  methods: {
    async populateSampleQuestions(ctx, res) {
      const rows = res?.rows || (Array.isArray(res) ? res : [res]);
      if (!rows || rows.length === 0) return res;

      const allIds = new Set();
      rows.forEach(row => {
        (row.sampleQuestions || []).forEach(sq => {
          if (sq.sampleQuestionId) {
            allIds.add(sq.sampleQuestionId.toString());
          }
        });
      });
      if (allIds.size === 0) return res;

      const uniqueIds = [...allIds];
      const questions = await Promise.all(
        uniqueIds.map(id => ctx.call('samplequestions.get', { id }).catch(() => null)),
      );
      const questionMap = {};
      questions.forEach((q, i) => {
        if (q) questionMap[uniqueIds[i]] = q;
      });

      rows.forEach(row => {
        (row.sampleQuestions || []).forEach(sq => {
          if (sq.sampleQuestionId) {
            const key = sq.sampleQuestionId.toString();
            if (questionMap[key]) {
              sq.sampleQuestionId = questionMap[key];
            }
          }
        });
      });

      return res;
    },
  },

  created() {},

  async started() {
    this.logger.info('ScenarioCategories service started');
  },

  async stopped() {
    this.logger.info('ScenarioCategories service stopped');
  },
};
