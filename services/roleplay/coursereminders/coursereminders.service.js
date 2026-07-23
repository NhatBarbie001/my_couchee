'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./coursereminders.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const { MoleculerClientError } = require('moleculer').Errors;

module.exports = {
  name: 'coursereminders',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService],

  settings: {
    populates: {
      userId: 'users.get',
      courseId: 'courses.get',
      sentBy: 'users.get',
    },
    populateOptions: ['userId', 'courseId', 'sentBy'],
    fields: ['_id', 'userId', 'courseId', 'sentBy', 'message', 'createdAt', 'updatedAt'],
  },

  actions: {
    createReminders: {
      params: {
        courseId: { type: 'string' },
        userIds: { type: 'array', items: 'string', min: 1 },
        sentBy: { type: 'string', optional: true },
        message: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { courseId, userIds, sentBy, message } = ctx.params;

        const docs = userIds.map(userId => ({
          userId,
          courseId,
          sentBy: sentBy || ctx.meta.user?._id,
          message: message || '',
        }));

        const inserted = await this.adapter.insertMany(docs);
        return {
          created: inserted.length,
          courseId,
        };
      },
    },

    getRemindersForUser: {
      rest: 'GET /my',
      params: {
        courseId: { type: 'string', optional: true },
        page: { type: 'number', optional: true, integer: true, min: 1, convert: true },
        pageSize: { type: 'number', optional: true, integer: true, min: 1, max: 1000, convert: true },
      },
      async handler(ctx) {
        const user = ctx.meta.user;
        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const page = ctx.params.page || 1;
        const pageSize = ctx.params.pageSize || 10;
        const offset = (page - 1) * pageSize;

        const query = { userId: user._id };
        if (ctx.params.courseId) {
          query.courseId = ctx.params.courseId;
        }

        const [rows, total] = await Promise.all([
          this.adapter.find({
            query,
            limit: pageSize,
            offset,
            sort: ['-createdAt'],
          }),
          this.adapter.count({ query }),
        ]);

        const populated = await this.transformDocuments(ctx, { populate: ['courseId', 'sentBy'] }, rows);

        return {
          rows: populated,
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        };
      },
    },

    checkReminder: {
      params: {
        courseId: { type: 'string' },
        userId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const user = ctx.meta.user;
        const targetUserId = ctx.params.userId || user?._id;

        if (!targetUserId) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const { courseId } = ctx.params;

        const existing = await this.adapter.findOne({
          userId: targetUserId,
          courseId: courseId,
        });

        return { reminded: !!existing, courseId };
      },
    },

    countRemindedCourses: {
      params: {
        userId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const user = ctx.meta.user;
        const targetUserId = ctx.params.userId || user?._id;

        if (!targetUserId) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const reminders = await this.adapter.find({
          query: { userId: targetUserId },
          fields: ['courseId'],
        });

        const uniqueCourseIds = new Set(
          reminders.map(r => (r.courseId?._id || r.courseId)?.toString()).filter(Boolean),
        );

        return { count: uniqueCourseIds.size };
      },
    },
  },

  methods: {},

  created() { },

  async started() {
    this.logger.info('CourseReminders service started');
  },

  async stopped() {
    this.logger.info('CourseReminders service stopped');
  },
};
