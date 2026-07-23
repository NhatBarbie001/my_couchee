'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./coursebookmarks.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;

module.exports = {
  name: 'coursebookmarks',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService],

  settings: {
    populates: {
      userId: 'users.get',
      courseId: 'courses.get',
    },
    populateOptions: ['userId', 'courseId'],
    fields: ['_id', 'userId', 'courseId', 'createdAt', 'updatedAt'],
  },

  actions: {
    toggleBookmark: {
      rest: 'POST /:courseId/toggle',
      params: {
        courseId: {type: 'string'},
      },
      async handler(ctx) {
        const user = ctx.meta.user;
        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const {courseId} = ctx.params;

        const course = await ctx.call('courses.get', {id: courseId});
        if (!course) {
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
        }

        const existing = await this.adapter.findOne({
          userId: user._id,
          courseId: courseId,
        });

        if (existing) {
          await this.adapter.removeById(existing._id);
          return {bookmarked: false, courseId};
        } else {
          await this.adapter.insert({
            userId: user._id,
            courseId: courseId,
          });
          return {bookmarked: true, courseId};
        }
      },
    },

    getMyBookmarks: {
      rest: 'GET /my',
      params: {
        page: {type: 'number', optional: true, integer: true, min: 1, convert: true},
        pageSize: {type: 'number', optional: true, integer: true, min: 1, max: 100, convert: true},
      },
      async handler(ctx) {
        const user = ctx.meta.user;
        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const page = ctx.params.page || 1;
        const pageSize = ctx.params.pageSize || 10;
        const offset = (page - 1) * pageSize;

        const query = {userId: user._id};

        const [rows, total] = await Promise.all([
          this.adapter.find({
            query,
            limit: pageSize,
            offset,
            sort: {createdAt: -1},
          }),
          this.adapter.count({query}),
        ]);

        const populated = await this.transformDocuments(ctx, {populate: ['courseId']}, rows);

        return {
          rows: populated,
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        };
      },
    },

    checkBookmark: {
      rest: 'GET /:courseId/check',
      params: {
        courseId: {type: 'string'},
      },
      async handler(ctx) {
        const user = ctx.meta.user;
        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const {courseId} = ctx.params;

        const existing = await this.adapter.findOne({
          userId: user._id,
          courseId: courseId,
        });

        return {bookmarked: !!existing, courseId};
      },
    },

    remove: {
      rest: 'DELETE /:id',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;

        const bookmark = await this.adapter.findById(id);
        if (!bookmark) {
          throw new MoleculerClientError(
            i18next.t('error.bookmark_not_found', 'Bookmark không tồn tại'),
            404,
          );
        }

        await this.adapter.removeById(id);
        return {success: true, id};
      },
    },
  },

  methods: {},

  created() {},

  async started() {
    this.logger.info('CourseBookmarks service started');
  },

  async stopped() {
    this.logger.info('CourseBookmarks service stopped');
  },
};
