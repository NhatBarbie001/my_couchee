'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./coursecategories.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const { MoleculerClientError } = require('moleculer').Errors;
const DefaultPermission = require('../../../mixins/defaultPermission.mixin');
const { RESOURCES, ACTIONS } = require('../../../constants/permissions');

module.exports = {
  name: 'coursecategories',
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
        name: { type: 'string', min: 2, max: 255 },
        description: { type: 'string', optional: true, max: 1000 },
        status: { type: 'enum', values: ['active', 'inactive'], optional: true },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.CREATE },
      async handler(ctx) {
        const { name, description, status } = ctx.params;
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
            i18next.t('error.course_category_exists', 'Loại khóa học với tên này đã tồn tại'),
            400,
          );
        }

        const category = await this.adapter.insert({
          name: name.trim(),
          description: description?.trim() || '',
          status: status || 'active',
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
        description: { type: 'string', optional: true, max: 1000 },
        status: { type: 'enum', values: ['active', 'inactive'], optional: true },
      },
      permission: { resource: RESOURCES.CATEGORY, action: ACTIONS.UPDATE },
      async handler(ctx) {
        const { id, name, description, status } = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const category = await this.adapter.findById(id);
        if (!category || category.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.course_category_not_found', 'Loại khóa học không tồn tại'),
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
              i18next.t('error.course_category_exists', 'Loại khóa học với tên này đã tồn tại'),
              400,
            );
          }
        }

        const updateData = { updatedBy: user._id };
        if (name) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description?.trim() || '';
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

        const category = await this.adapter.findById(id);
        if (!category || category.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error.course_category_not_found', 'Loại khóa học không tồn tại'),
            404,
          );
        }

        // Kiểm tra xem category có đang được sử dụng bởi khóa học nào không
        const courses = await ctx.call('courses.find', {
          query: {
            courseCategoryId: id,
            isDeleted: false,
          },
        });

        if (courses && courses.length > 0) {
          throw new MoleculerClientError(
            i18next.t('error.course_category_in_use', 'Không thể xóa loại khóa học vì đang được sử dụng bởi {{count}} khóa học', { count: courses.length }),
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

  methods: {},

  created() {},

  async started() {
    this.logger.info('CourseCategories service started');
  },

  async stopped() {
    this.logger.info('CourseCategories service stopped');
  },
};
