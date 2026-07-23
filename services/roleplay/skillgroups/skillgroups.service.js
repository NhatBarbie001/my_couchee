'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./skillgroups.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const { MoleculerClientError } = require('moleculer').Errors;
const DefaultPermission = require('../../../mixins/defaultPermission.mixin');
const { RESOURCES, ACTIONS } = require('../../../constants/permissions');

module.exports = {
  name: 'skillgroups',
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
      'name',
      'status',
      'enableStyleAnalysis',
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
        name: { type: 'string', min: 2, max: 255 },
        status: { type: 'enum', values: ['active', 'inactive'], optional: true },
        enableStyleAnalysis: { type: 'boolean', optional: true },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.CREATE },
      async handler(ctx) {
        const { name, status, enableStyleAnalysis } = ctx.params;
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
            i18next.t('error.skill_group_exists', 'Nhóm kỹ năng đánh giá với tên này đã tồn tại'),
            400,
          );
        }

        const group = await this.adapter.insert({
          name: name.trim(),
          status: status || 'active',
          enableStyleAnalysis: enableStyleAnalysis || false,
          createdBy: user._id,
          updatedBy: user._id,
        });

        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, group);
      },
    },

    update: {
      rest: 'PUT /:id',
      params: {
        id: { type: 'string' },
        name: { type: 'string', min: 2, max: 255, optional: true },
        status: { type: 'enum', values: ['active', 'inactive'], optional: true },
        enableStyleAnalysis: { type: 'boolean', optional: true },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.UPDATE },
      async handler(ctx) {
        const { id, name, status, enableStyleAnalysis } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const group = await this.adapter.findById(id);
        if (!group || group.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.skill_group_not_found', 'Nhóm kỹ năng đánh giá không tồn tại'),
            404,
          );
        }

        if (name && name.trim() !== group.name) {
          const existing = await this.adapter.findOne({
            name: name.trim(),
            isDeleted: false,
            _id: { $ne: id },
          });

          if (existing) {
            throw new MoleculerClientError(
              i18next.t('error.skill_group_exists', 'Nhóm kỹ năng đánh giá với tên này đã tồn tại'),
              400,
            );
          }
        }

        const updateData = { updatedBy: user._id };
        if (name) updateData.name = name.trim();
        if (status) updateData.status = status;
        if (enableStyleAnalysis !== undefined) updateData.enableStyleAnalysis = enableStyleAnalysis;

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

        const group = await this.adapter.findById(id);
        if (!group || group.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.skill_group_not_found', 'Nhóm kỹ năng đánh giá không tồn tại'),
            404,
          );
        }

        // Kiểm tra xem có skills nào đang dùng group này không
        const skills = await ctx.call('skills.find', {
          query: {
            skillGroupId: id,
            isDeleted: false,
          },
        });

        if (skills && skills.length > 0) {
          throw new MoleculerClientError(
            i18next.t('error.skill_group_in_use', 'Không thể xóa nhóm kỹ năng vì đang được sử dụng bởi {{count}} kỹ năng', { count: skills.length }),
            400,
            'SKILL_GROUP_IN_USE',
          );
        }

        // Kiểm tra xem có scenarios nào đang dùng group này không
        const scenarios = await ctx.call('aiscenarios.find', {
          query: {
            skillGroupIds: id,
            isDeleted: false,
          },
        });

        if (scenarios && scenarios.length > 0) {
          throw new MoleculerClientError(
            i18next.t('error.skill_group_in_use_scenarios', 'Không thể xóa nhóm kỹ năng vì đang được sử dụng bởi {{count}} kịch bản', { count: scenarios.length }),
            400,
            'SKILL_GROUP_IN_USE',
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

        const groups = await this.adapter.find({ query, sort: 'name' });
        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, groups);
      },
    },
  },

  methods: {},

  created() {},

  async started() {
    this.logger.info('SkillGroups service started');
  },

  async stopped() {
    this.logger.info('SkillGroups service stopped');
  },
};
