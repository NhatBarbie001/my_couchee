'use strict';

const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const BaseService = require('../../mixins/baseService.mixin');
const Model = require('./jobtitles.model');
const DbMongoose = require('../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const { MoleculerClientError } = require('moleculer').Errors;
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const { RESOURCES, ACTIONS } = require('../../constants/permissions');

module.exports = {
  name: 'jobtitles',
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
      'description',
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
        description: { type: 'string', max: 1000, optional: true },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.CREATE },
      async handler(ctx) {
        const { name, description } = ctx.params;
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
            i18next.t('error.job_title_exists', 'Chức vụ với tên này đã tồn tại'),
            400,
          );
        }

        const jobTitle = await this.adapter.insert({
          name: name.trim(),
          description: description?.trim() || '',
          createdBy: user._id,
          updatedBy: user._id,
        });

        return this.transformDocuments(ctx, { populate: this.settings.populateOptions }, jobTitle);
      },
    },

    update: {
      rest: 'PUT /:id',
      params: {
        id: { type: 'string' },
        name: { type: 'string', min: 2, max: 255, optional: true },
        description: { type: 'string', max: 1000, optional: true },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.UPDATE },
      async handler(ctx) {
        const { id, name, description } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const jobTitle = await this.adapter.findById(id);
        if (!jobTitle || jobTitle.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.job_title_not_found', 'Chức vụ không tồn tại'),
            404,
          );
        }

        if (name && name.trim() !== jobTitle.name) {
          const existing = await this.adapter.findOne({
            name: name.trim(),
            isDeleted: false,
            _id: { $ne: id },
          });

          if (existing) {
            throw new MoleculerClientError(
              i18next.t('error.job_title_exists', 'Chức vụ với tên này đã tồn tại'),
              400,
            );
          }
        }

        const updateData = { updatedBy: user._id };
        if (name) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description?.trim() || '';

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

        const jobTitle = await this.adapter.findById(id);
        if (!jobTitle || jobTitle.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.job_title_not_found', 'Chức vụ không tồn tại'),
            404,
          );
        }

        // Kiểm tra xem chức vụ có đang được sử dụng bởi user nào không
        const usersWithJobTitle = await ctx.call('users.count', {
          query: {
            jobTitleId: id,
            isDeleted: false,
          },
        });

        if (usersWithJobTitle > 0) {
          throw new MoleculerClientError(
            i18next.t('error.job_title_in_use', 'Không thể xóa chức vụ vì đang được sử dụng bởi {{count}} người dùng', { count: usersWithJobTitle }),
            400,
            'JOB_TITLE_IN_USE',
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
  },

  methods: {},

  created() {},

  async started() {
    this.logger.info('JobTitles service started');
  },

  async stopped() {
    this.logger.info('JobTitles service stopped');
  },
};
