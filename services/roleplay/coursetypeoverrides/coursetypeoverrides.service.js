'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const Model = require('./coursetypeoverrides.model');
const DbMongoose = require('../../../mixins/dbMongo.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const DefaultPermission = require('../../../mixins/defaultPermission.mixin');
const {RESOURCES, ACTIONS} = require('../../../constants/permissions');

module.exports = {
  name: 'coursetypeoverrides',
  mixins: [DbMongoose(Model), FunctionsCommon, BaseService, DefaultPermission],

  settings: {
    defaultResource: RESOURCES.COURSE,
    entityValidator: {
      courseId: {type: 'string'},
      targetType: {type: 'enum', values: ['user', 'organization']},
      targetId: {type: 'string'},
      courseType: {type: 'enum', values: ['mandatory', 'optional']},
    },
    populates: {
      courseId: 'courses.get',
      overrideBy: 'users.get',
    },
    populateOptions: ['courseId', 'overrideBy'],
    fields: ['_id', 'courseId', 'targetType', 'targetId', 'courseType', 'overrideBy', 'createdAt', 'updatedAt'],
    defaultSort: '-createdAt',
  },

  actions: {
    setOverride: {
      rest: 'POST /',
      params: {
        courseId: {type: 'string'},
        targetType: {type: 'enum', values: ['user', 'organization']},
        targetId: {type: 'string'},
        courseType: {type: 'enum', values: ['mandatory', 'optional']},
      },
      permission: {resource: RESOURCES.COURSE, action: ACTIONS.UPDATE},
      async handler(ctx) {
        const {courseId, targetType, targetId, courseType} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const course = await ctx.call('courses.get', {id: courseId});
        if (!course || course.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
        }

        const existing = await this.adapter.findOne({
          courseId,
          targetType,
          targetId,
        });

        if (existing) {
          const updated = await this.adapter.updateById(existing._id, {
            $set: {
              courseType,
              overrideBy: user._id,
              updatedAt: new Date(),
            },
          });
          return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updated);
        }

        const override = await this.adapter.insert({
          courseId,
          targetType,
          targetId,
          courseType,
          overrideBy: user._id,
        });

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, override);
      },
    },

    bulkSetOverrides: {
      rest: 'POST /bulk',
      params: {
        courseId: {type: 'string'},
        targetType: {type: 'enum', values: ['user', 'organization']},
        targetIds: {type: 'array', items: 'string', min: 1},
        courseType: {type: 'enum', values: ['mandatory', 'optional']},
      },
      permission: {resource: RESOURCES.COURSE, action: ACTIONS.UPDATE},
      async handler(ctx) {
        const {courseId, targetType, targetIds, courseType} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const course = await ctx.call('courses.get', {id: courseId});
        if (!course || course.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
        }

        const results = await Promise.all(
          targetIds.map(async targetId => {
            const existing = await this.adapter.findOne({
              courseId,
              targetType,
              targetId,
            });

            if (existing) {
              return this.adapter.updateById(existing._id, {
                $set: {
                  courseType,
                  overrideBy: user._id,
                  updatedAt: new Date(),
                },
              });
            }

            return this.adapter.insert({
              courseId,
              targetType,
              targetId,
              courseType,
              overrideBy: user._id,
            });
          }),
        );

        return {
          success: true,
          count: results.length,
          courseType,
        };
      },
    },

    removeOverride: {
      rest: 'DELETE /',
      params: {
        courseId: {type: 'string'},
        targetType: {type: 'enum', values: ['user', 'organization']},
        targetId: {type: 'string'},
      },
      permission: {resource: RESOURCES.COURSE, action: ACTIONS.UPDATE},
      async handler(ctx) {
        const {courseId, targetType, targetId} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const deleted = await this.adapter.removeMany({
          courseId,
          targetType,
          targetId,
        });

        return {
          success: true,
          deletedCount: deleted.deletedCount || 0,
        };
      },
    },

    getOverrideForUser: {
      params: {
        courseId: {type: 'string'},
        userId: {type: 'string'},
        orgId: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {courseId, userId, orgId} = ctx.params;

        const userOverride = await this.adapter.findOne({
          courseId,
          targetType: 'user',
          targetId: userId,
        });

        if (userOverride) {
          return {
            courseType: userOverride.courseType,
            source: 'user',
            overrideId: userOverride._id,
          };
        }

        if (orgId) {
          const orgOverride = await this.adapter.findOne({
            courseId,
            targetType: 'organization',
            targetId: orgId,
          });

          if (orgOverride) {
            return {
              courseType: orgOverride.courseType,
              source: 'organization',
              overrideId: orgOverride._id,
            };
          }
        }

        return null;
      },
    },

    getOverridesForCourse: {
      rest: 'GET /course/:courseId',
      params: {
        courseId: {type: 'string'},
      },
      permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
      async handler(ctx) {
        const {courseId} = ctx.params;

        const overrides = await this.adapter.find({
          query: {courseId},
          sort: '-createdAt',
        });

        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, overrides);
      },
    },

    getMandatoryUsersForCourse: {
      params: {
        courseId: {type: 'string'},
      },
      async handler(ctx) {
        const {courseId} = ctx.params;

        const overrides = await this.adapter.find({
          query: {
            courseId,
            targetType: 'user',
            courseType: 'mandatory',
          },
        });

        return overrides.map(o => o.targetId.toString());
      },
    },
  },

  methods: {},

  created() {},

  async started() {},

  async stopped() {},
};
