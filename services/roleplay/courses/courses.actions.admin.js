'use strict';

const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const {RESOURCES, ACTIONS} = require('../../../constants/permissions');

/**
 * Courses Service - Admin Actions
 * Contains: getListAdmin, getAllCourseStarted, getLearningProgress,
 *           getExpiredCoursesForUser, cleanupDeletedCoursesScenarios,
 *           markOverdue, warningCoursesOverdue, getSuggestedCourses
 */

module.exports = {
  getListAdmin: {
    rest: 'GET /admin/list',
    async handler(ctx) {
      const user = ctx.meta.user;
      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const page = Number(ctx.params.page) || 1;
      const pageSize = Number(ctx.params.pageSize) || Number(ctx.params.limit) || 10;
      const offset = (page - 1) * pageSize;

      const baseQuery = {isDeleted: false};
      let clientQuery = {};
      if (ctx.params.query) {
        try {
          clientQuery = typeof ctx.params.query === 'string' ? JSON.parse(ctx.params.query) : ctx.params.query;
        } catch (e) {
          this.logger.warn('Invalid JSON in query param', ctx.params.query);
        }
      }

      let finalQuery = {...baseQuery, ...clientQuery};

      if (ctx.params.searchFields) {
        finalQuery = this.convertSearchFields(ctx.params.searchFields, finalQuery);
      }

      if (!user.isSystemAdmin) {
        const accessConditions = [];

        if (user.organizationId) {
          let allowedOrgIds = [];
          const orgIdStr = user.organizationId._id
            ? user.organizationId._id.toString()
            : user.organizationId.toString();
          allowedOrgIds.push(orgIdStr);
          try {
            const descendants = await ctx.call('organizations.getAllDescendants', {orgId: orgIdStr});
            if (descendants && descendants.length > 0) {
              allowedOrgIds.push(...descendants.map(desc => desc._id.toString()));
            }
          } catch (err) {
            this.logger.error('Error fetching descendants for unit admin', err);
          }

          accessConditions.push({organizationId: {$in: allowedOrgIds}});
        }

        if (accessConditions.length > 0) {
          finalQuery = {$and: [finalQuery, {$or: accessConditions}]};
        } else {
          finalQuery._id = null;
        }
      }

      let sortParam = ctx.params.sort;
      if (!sortParam) {
        sortParam = {createdAt: -1};
      } else if (typeof sortParam === 'string') {
        sortParam = sortParam.replace(/,/g, ' ');
      }

      console.log('finalQuery', finalQuery);
      let [rows, total] = await Promise.all([
        this.adapter.find({
          query: finalQuery,
          limit: pageSize,
          offset,
          sort: sortParam,
          populate: this.settings.populateOptions,
        }),
        this.adapter.count({query: finalQuery}),
      ]);

      if (!rows || rows.length === 0) {
        return {rows: [], page, pageSize, total, totalPages: 0};
      }

      const courseIds = rows.map(c => c._id);

      rows = await this.transformDocuments(
        ctx,
        {...ctx.params, populate: ctx.params.populate || this.settings.populateOptions},
        rows,
      );

      const [allScenarios, allSessions, totalMembersMap, completedSessionsAgg, sessionScoresAgg] = await Promise.all([
        this.batchGetScenariosByCourses(ctx, courseIds),
        ctx.call('roleplaysessions.find', {
          query: {courseId: {$in: courseIds}, isDeleted: false, isCompleted: true},
          fields: ['studentId', 'userId', 'courseId', 'aiScenarioId', 'isDeleted'],
          populate: ['courseId'],
        }),
        this.batchCalculateTotalMembers(ctx, rows),
        ctx.call('roleplaysessions.aggregateCompletedSessions', {
          courseIds: courseIds.map(id => id.toString()),
        }),
        ctx.call('roleplaysessions.aggregate', {
          pipeline: [
            {
              $match: {
                courseId: {$in: courseIds},
                status: {$in: ['completed', 'analyzed']},
                isDeleted: {$ne: true},
                analysisId: {$exists: true, $ne: null},
              },
            },
            {
              $lookup: {
                from: 'RolePlayAnalysis',
                localField: 'analysisId',
                foreignField: '_id',
                pipeline: [{$project: {'result.simulationScore': 1}}],
                as: 'analysis',
              },
            },
            {$unwind: {path: '$analysis', preserveNullAndEmptyArrays: true}},
            {$project: {courseId: 1, aiScenarioId: 1, score: '$analysis.result.simulationScore'}},
          ],
        }),
      ]);

      const scenariosByCourse = {};
      allScenarios.forEach(s => {
        const cid = s.courseId?._id ? s.courseId._id.toString() : s.courseId?.toString();
        if (cid) {
          if (!scenariosByCourse[cid]) scenariosByCourse[cid] = [];
          scenariosByCourse[cid].push(s);
        }
      });

      const sessionsByCourse = {};
      allSessions.forEach(s => {
        const cid = s.courseId?._id ? s.courseId._id.toString() : s.courseId?.toString();
        if (cid) {
          if (!sessionsByCourse[cid]) sessionsByCourse[cid] = [];
          sessionsByCourse[cid].push(s);
        }
      });

      const sessionScoresByCourse = {};
      (sessionScoresAgg || []).forEach(s => {
        const cid = s.courseId?.toString();
        if (cid) {
          if (!sessionScoresByCourse[cid]) sessionScoresByCourse[cid] = [];
          sessionScoresByCourse[cid].push(s);
        }
      });

      const enrichedRows = rows.map(course => {
        const plainCourse = course.toObject ? course.toObject() : course;
        const courseId = plainCourse._id.toString();

        const validUserIds = totalMembersMap[courseId]?.validUserIds || new Set();
        const totalMembers = validUserIds.size;

        const courseScenarios = scenariosByCourse[courseId] || [];
        const courseSessions = sessionsByCourse[courseId] || [];

        const scenarioPassScores = {};
        courseScenarios.forEach(s => {
          scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
        });

        const studentBestScores = {};
        const studentStarted = new Set();

        courseSessions.forEach(session => {
          const sIdRaw = session.studentId || session.userId;
          const studentId = sIdRaw?._id ? sIdRaw._id.toString() : sIdRaw?.toString();
          if (studentId) {
            studentStarted.add(studentId);
          }
        });

        const aggregatedForCourse =
          completedSessionsAgg && completedSessionsAgg.allSessions
            ? completedSessionsAgg.allSessions.filter(s => s.courseId?.toString() === courseId)
            : [];

        aggregatedForCourse.forEach(agg => {
          const studentId = agg.studentId?.toString();
          const scenarioId = agg.aiScenarioId?.toString();
          const score = agg.bestScore;

          if (!studentId || !scenarioId || score === undefined || score === null) return;

          if (!studentBestScores[studentId]) studentBestScores[studentId] = {};
          const prev = studentBestScores[studentId][scenarioId];
          if (prev === undefined || score > prev) {
            studentBestScores[studentId][scenarioId] = score;
          }
        });

        let completedCount = 0;
        let inProgressCount = 0;
        let notStartedCount = 0;

        validUserIds.forEach(studentId => {
          let passedAll = false;
          if (courseScenarios.length > 0) {
            passedAll = true;
            const bestScores = studentBestScores[studentId] || {};
            for (const scenarioId in scenarioPassScores) {
              if ((bestScores[scenarioId] ?? -1) < scenarioPassScores[scenarioId]) {
                passedAll = false;
                break;
              }
            }
          }

          if (passedAll && courseScenarios.length > 0) {
            completedCount++;
          } else if (studentStarted.has(studentId)) {
            inProgressCount++;
          } else {
            notStartedCount++;
          }
        });

        let completedMembersPercentage = 0;
        if (totalMembers > 0) {
          completedMembersPercentage = Math.round((completedCount / totalMembers) * 100);
        }

        const courseSessionScores = sessionScoresByCourse[courseId] || [];
        let passedSessions = 0;
        let failedSessions = 0;
        courseSessionScores.forEach(s => {
          const scenarioId = s.aiScenarioId?.toString();
          const score = s.score;
          if (score === undefined || score === null) return;
          const passScore = scenarioPassScores[scenarioId] ?? 70;
          if (score >= passScore) {
            passedSessions++;
          } else {
            failedSessions++;
          }
        });

        const override = (plainCourse.publishedToUsers || []).find(entry => {
          const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
          return uid === user._id.toString();
        });
        const effectiveCourseType = override ? override.courseType : plainCourse.courseType;

        return {
          ...plainCourse,
          courseType: effectiveCourseType,
          totalMembers,
          completedMembersPercentage,
          completedMembersCount: completedCount,
          inProgressMembersCount: inProgressCount,
          notStartedMembersCount: notStartedCount,
          scenarios: courseScenarios.length,
          totalSessions: courseSessions.length,
          passedSessions,
          failedSessions,
          totalEstimatedCallTimeInMinutes: courseScenarios.reduce(
            (sum, s) => sum + (s.estimatedCallTimeInMinutes || 0),
            0,
          ),
        };
      });

      return {rows: enrichedRows, page, pageSize, total, totalPages: Math.ceil(total / pageSize)};
    },
  },

  getAllCourseStarted: {
    rest: 'GET /started',
    async handler(ctx) {
      const user = ctx.meta.user;
      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const page = Number(ctx.params.page) || 1;
      const pageSize = Number(ctx.params.pageSize) || Number(ctx.params.limit) || 10;
      const offset = (page - 1) * pageSize;

      const today = new Date();
      today.setHours(23, 59, 59, 999);

      const baseQuery = {
        isDeleted: false,
        status: 'published',
        $or: [{courseType: 'optional'}, {courseType: {$ne: 'optional'}, startDate: {$lte: today}}],
      };

      let extraQuery = {};
      if (ctx.params.query) {
        try {
          extraQuery = JSON.parse(ctx.params.query);
        } catch (err) {
          throw new MoleculerClientError('Query không đúng định dạng JSON', 400);
        }
      }

      const ALLOWED_QUERY_FIELDS = ['courseType', 'expired_status'];
      const safeExtraQuery = {};
      for (const key of ALLOWED_QUERY_FIELDS) {
        if (extraQuery[key] !== undefined) {
          safeExtraQuery[key] = extraQuery[key];
        }
      }

      const finalQuery = {
        ...baseQuery,
        ...safeExtraQuery,
        'publishedToUsers.userId': user._id,
      };

      const [rows, total] = await Promise.all([
        this.adapter.find({query: finalQuery, limit: pageSize, offset, sort: {createdAt: -1}}),
        this.adapter.count({query: finalQuery}),
      ]);

      return {rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize)};
    },
  },

  getLearningProgress: {
    rest: 'GET /learning-progress',
    async handler(ctx) {
      const user = ctx.meta.user;
      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const userId = user._id.toString();

      const allCourses = await this.adapter.find({
        query: {
          isDeleted: false,
          isActive: true,
          status: 'published',
          'publishedToUsers.userId': user._id,
        },
        sort: {createdAt: -1},
      });
      if (!allCourses || allCourses.length === 0) {
        return {inProgress: 0, completed: 0, notStarted: 0, reminded: 0, latestCourses: []};
      }

      const courseIds = allCourses.map(c => c._id);

      const [allScenarios, aggregatedResult, userReminders] = await Promise.all([
        this.batchGetScenariosByCourses(ctx, courseIds),
        ctx.call('roleplaysessions.aggregateCompletedSessions', {
          courseIds: courseIds.map(id => id.toString()),
          studentId: userId,
        }),
        ctx
          .call('coursereminders.find', {
            query: {userId: user._id, courseId: {$in: courseIds}},
            fields: ['courseId'],
          })
          .catch(() => []),
      ]);

      const remindedCourseIds = new Set(
        userReminders.map(r => (r.courseId?._id || r.courseId)?.toString()).filter(Boolean),
      );

      const userSessions = aggregatedResult.userSessions || [];

      const scenariosByCourse = new Map(courseIds.map(id => [id.toString(), []]));
      allScenarios.forEach(scenario => {
        const courseId = scenario.courseId?._id ? scenario.courseId._id.toString() : scenario.courseId.toString();
        scenariosByCourse.get(courseId)?.push(scenario);
      });

      const userSessionsByCourse = new Map(courseIds.map(id => [id.toString(), []]));
      userSessions.forEach(session => {
        const courseId = session.courseId?.toString();
        if (courseId) {
          userSessionsByCourse.get(courseId)?.push(session);
        }
      });

      let inProgress = 0;
      let completed = 0;
      let notStarted = 0;

      for (const course of allCourses) {
        const courseId = course._id.toString();
        const scenarios = scenariosByCourse.get(courseId) || [];
        const sessions = userSessionsByCourse.get(courseId) || [];

        const completionStr = this.calculateCompletionFromAggregatedData(scenarios, sessions);
        const completionPercent = this.parseCompletionPercentage(completionStr);

        if (completionPercent >= 100) {
          completed++;
        } else if (sessions.length > 0) {
          inProgress++;
        } else {
          notStarted++;
        }
      }

      const top3 = allCourses.slice(0, 3);
      const latestCourses = top3.map(course => {
        const courseId = course._id.toString();
        const scenarios = scenariosByCourse.get(courseId) || [];
        const sessions = userSessionsByCourse.get(courseId) || [];
        const completionStr = this.calculateCompletionFromAggregatedData(scenarios, sessions);
        const completionPercent = this.parseCompletionPercentage(completionStr);
        const totalEstimatedTime = scenarios.reduce((sum, s) => sum + (s.estimatedCallTimeInMinutes || 0), 0);

        const override = (course.publishedToUsers || []).find(entry => {
          const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
          return uid === userId;
        });
        const effectiveCourseType = override ? override.courseType : course.courseType;

        return {
          _id: course._id,
          name: course.name,
          description: course.description,
          thumbnailId: course.thumbnailId,
          thumbnailIds: course.thumbnailIds,
          courseType: effectiveCourseType,
          expired_status: course.expired_status,
          deadline: course.deadline,
          startDate: course.startDate,
          createdAt: course.createdAt,
          totalEstimatedCallTimeInMinutes: totalEstimatedTime,
          userCompletionPercentage: completionStr,
          completionPercent,
          totalScenarios: scenarios.length,
          totalSessions: sessions.length,
        };
      });

      return {inProgress, completed, notStarted, reminded: remindedCourseIds.size, latestCourses};
    },
  },

  getExpiredCoursesForUser: {
    rest: 'GET /expired-for-user',
    async handler(ctx) {
      const user = ctx.meta.user;
      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const baseQuery = {
        isDeleted: false,
        expired_status: {$in: ['due_soon', 'overdue']},
        status: 'published',
      };

      const finalQuery = {...baseQuery, 'publishedToUsers.userId': user._id};

      const courses = await this.adapter.find({query: finalQuery});
      if (!courses || courses.length === 0) {
        return [];
      }

      const courseIds = courses.map(c => c._id);

      const [allScenarios, allSessions] = await Promise.all([
        this.batchGetScenariosByCourses(ctx, courseIds),
        ctx.call('roleplaysessions.find', {
          query: {
            studentId: user._id,
            courseId: {$in: courseIds},
            status: {$in: ['completed', 'analyzed']},
            isDeleted: false,
            analysisId: {$exists: true},
          },
          fields: ['_id', 'courseId', 'aiScenarioId', 'analysisId.result.simulationScore'],
        }),
      ]);

      const scenariosByCourse = new Map(courseIds.map(id => [id.toString(), []]));
      const sessionsByCourse = new Map(courseIds.map(id => [id.toString(), []]));

      allScenarios.forEach(scenario => {
        const courseId = scenario.courseId?._id ? scenario.courseId._id.toString() : scenario.courseId.toString();
        scenariosByCourse.get(courseId)?.push(scenario);
      });

      allSessions.forEach(session => {
        const courseId = session.courseId?._id ? session.courseId._id.toString() : session.courseId.toString();
        sessionsByCourse.get(courseId)?.push(session);
      });

      const incompleteCourses = courses.filter(course => {
        const courseId = course._id.toString();
        const scenarios = scenariosByCourse.get(courseId) || [];
        const sessions = sessionsByCourse.get(courseId) || [];
        const totalEstimatedCallTimeInMinutes = scenarios.reduce(
          (acc, scenario) => acc + scenario.estimatedCallTimeInMinutes,
          0,
        );

        const completionPercentage = this.calculateCompletionPercentageFromData(scenarios, sessions);

        course.set('userCompletionPercentage', completionPercentage, {strict: false});
        course.set('totalSessions', sessions.length, {strict: false});
        course.set('scenarios', scenarios.length, {strict: false});
        course.set('totalEstimatedCallTimeInMinutes', totalEstimatedCallTimeInMinutes, {strict: false});

        return this.parseCompletionPercentage(completionPercentage) < 100;
      });

      return incompleteCourses;
    },
  },

  cleanupDeletedCoursesScenarios: {
    rest: 'POST /cleanup-deleted-scenarios',
    params: {},
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.DELETE},
    async handler(ctx) {
      const user = ctx.meta.user;
      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      try {
        const deletedCourses = await this.adapter.find({
          query: {isDeleted: true},
          fields: ['_id', 'name'],
        });

        if (!deletedCourses || deletedCourses.length === 0) {
          return {
            success: true,
            message: 'Không có khóa học nào đã bị xóa',
            deletedCoursesCount: 0,
            deletedScenariosCount: 0,
          };
        }

        const courseIds = deletedCourses.map(course => course._id);
        let totalDeletedScenarios = 0;

        for (const courseId of courseIds) {
          try {
            const scenarios = await ctx.call('aiscenarios.find', {
              query: {courseId: courseId, isDeleted: false},
            });

            if (scenarios && scenarios.length > 0) {
              for (const scenario of scenarios) {
                await ctx.call('aiscenarios.remove', {id: scenario._id});
                totalDeletedScenarios++;
              }
              this.logger.info(`Deleted ${scenarios.length} scenarios for course ${courseId}`);
            }
          } catch (error) {
            this.logger.error(`Error deleting scenarios for course ${courseId}:`, error);
          }
        }

        return {
          success: true,
          message: `Đã xóa ${totalDeletedScenarios} kịch bản từ ${deletedCourses.length} khóa học đã bị xóa`,
          deletedCoursesCount: deletedCourses.length,
          deletedScenariosCount: totalDeletedScenarios,
          courses: deletedCourses.map(c => ({id: c._id, name: c.name})),
        };
      } catch (error) {
        this.logger.error('Error cleaning up deleted courses scenarios:', error);
        throw new MoleculerClientError(
          error.message || 'Lỗi khi xóa kịch bản của các khóa học đã xóa',
          error.code || 500,
        );
      }
    },
  },

  markOverdue: {
    visibility: 'protected',
    async handler(ctx) {
      const now = new Date();
      const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      const optionalRes = await this.adapter.updateMany(
        {courseType: 'optional', isDeleted: false},
        {$set: {expired_status: 'pending'}},
      );

      const overdueRes = await this.adapter.updateMany(
        {deadline: {$lt: now}, courseType: {$ne: 'optional'}, isDeleted: false},
        {$set: {expired_status: 'overdue'}},
      );

      const dueSoonRes = await this.adapter.updateMany(
        {deadline: {$gte: now, $lte: threeDaysLater}, courseType: {$ne: 'optional'}, isDeleted: false},
        {$set: {expired_status: 'due_soon'}},
      );

      const pendingRes = await this.adapter.updateMany(
        {deadline: {$gt: threeDaysLater}, courseType: {$ne: 'optional'}, isDeleted: false},
        {$set: {expired_status: 'pending'}},
      );

      this.logger.info(
        `[CRON] expired_status updated: optional=${optionalRes.modifiedCount || 0}, overdue=${overdueRes.modifiedCount || 0}, due_soon=${dueSoonRes.modifiedCount || 0}, pending=${pendingRes.modifiedCount || 0}`,
      );

      return {
        optional: optionalRes.modifiedCount || 0,
        overdue: overdueRes.modifiedCount || 0,
        dueSoon: dueSoonRes.modifiedCount || 0,
        pending: pendingRes.modifiedCount || 0,
      };
    },
  },

  warningCoursesOverdue: {
    visibility: 'protected',
    async handler(ctx) {
      /**
       * 1. Lấy courses overdue
       */
      const now = new Date();
      const courses = await this.adapter.find({
        query: {
          deadline: {$lt: now},
          courseType: {$in: ['mandatory', 'both']},
          status: 'published',
          isDeleted: false,
          isActive: true,
        },
      });

      if (!courses?.length) {
        return {courses: [], notCompletedMap: {}};
      }

      const courseIds = courses.map(c => c._id);

      /**
       * 2. Lấy scenarios + aggregated sessions + totalMembers
       */
      const [allScenarios, aggregatedResult, totalMembersMap] = await Promise.all([
        this.batchGetScenariosByCourses(ctx, courseIds),

        ctx.call('roleplaysessions.aggregateCompletedSessions', {
          courseIds: courseIds.map(id => id.toString()),
        }),

        this.batchCalculateTotalMembers(ctx, courses),
      ]);

      const aggregatedSessions = aggregatedResult?.allSessions || [];

      /**
       * 3. Tính user đã hoàn thành
       */
      const completedMemberIdsMap = this.calculateCompletedMemberIdsFromAggregatedData(
        courseIds,
        courses,
        allScenarios,
        aggregatedSessions,
        totalMembersMap,
      );

      /**
       * 4. Build students từng course
       */
      const studentsByCourse = {};

      courses?.forEach(course => {
        const courseId = course._id.toString();
        const set = new Set();

        (course.publishedToUsers || []).forEach(entry => {
          const entryCourseType = entry?.courseType || (course.courseType === 'mandatory' ? 'mandatory' : 'optional');
          if (entryCourseType === 'mandatory') {
            const uid = entry?.userId?._id ? entry.userId._id.toString() : entry?.userId?.toString();
            if (uid) set.add(uid);
          }
        });

        studentsByCourse[courseId] = set;
      });

      /**
       * 5. Lọc user chưa hoàn thành
       */
      const notCompletedMap = {};

      for (const courseId in studentsByCourse) {
        const allStudents = studentsByCourse[courseId];
        const completed = new Set(completedMemberIdsMap[courseId] || []);

        const notCompleted = [];

        allStudents.forEach(uid => {
          if (!completed.has(uid)) {
            notCompleted.push(uid);
          }
        });

        notCompletedMap[courseId] = notCompleted;
      }
      const hasData = Object.values(notCompletedMap).some(arr => arr.length);

      if (hasData) {
        await ctx.call('courses.sendEmailOverdueMultiCourses', {
          courseUserMap: notCompletedMap,
        });
      } else {
        this.logger.info('No overdue students → skip email');
      }

      for (const [courseId, userIds] of Object.entries(notCompletedMap)) {
        if (userIds && userIds.length > 0) {
          const course = courses.find(c => c._id.toString() === courseId);
          await ctx
            .call('coursereminders.createReminders', {
              courseId: courseId,
              userIds: userIds,
              message: `Hệ thống nhắc nhở thực hành khóa học: ${course?.name || ''}`,
            })
            .catch(err => this.logger.error(`Error saving course reminders for course ${courseId}:`, err));
        }
      }

      return {
        // courses,
        // completedMemberIdsMap,
        notCompletedMap,
      };
    },
  },
  getSuggestedCourses: {
    rest: 'GET /suggested',
    params: {
      userIds: {type: 'array', items: 'string', min: 1},
      weakScoreThreshold: {type: 'number', optional: true, default: 60, min: 0, max: 100},
      limit: {type: 'number', optional: true, default: 10, min: 1, max: 50},
    },
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      const {userIds, weakScoreThreshold, limit} = ctx.params;
      const user = ctx.meta.user;
      const now = new Date();

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      try {
        let orgIds = [];
        if (user.organizationId) {
          const targetOrgId = user.organizationId.toString();
          orgIds = [targetOrgId];
          try {
            const descendants = await ctx.call('organizations.getAllDescendants', {orgId: targetOrgId});
            descendants.forEach(desc => {
              orgIds.push(desc._id.toString());
            });
          } catch (error) {
            this.logger.warn(`Could not get descendants for org ${targetOrgId}: ${error.message}`);
          }
        }

        const allUserSkillScores = await Promise.all(
          userIds.map(async userId => {
            const scores = await ctx.call('userskillscores.getUserSkillScores', {userId});
            return {userId, scores};
          }),
        );

        const weakSkillsMap = new Map();

        for (const {userId, scores} of allUserSkillScores) {
          for (const score of scores) {
            if (score.averageScore < weakScoreThreshold) {
              const skillId = score.skillId?._id?.toString() || score.skillId?.toString() || score.skillId;
              if (!weakSkillsMap.has(skillId)) {
                weakSkillsMap.set(skillId, {
                  skillId,
                  skillName: score.skillName,
                  userIds: [],
                  totalScore: 0,
                  count: 0,
                });
              }
              const skillData = weakSkillsMap.get(skillId);
              skillData.userIds.push(userId);
              skillData.totalScore += score.averageScore;
              skillData.count++;
            }
          }
        }

        if (weakSkillsMap.size === 0) {
          return {
            suggestedCourses: [],
            weakSkillsSummary: {},
            message: 'Không tìm thấy kỹ năng yếu nào cho các học viên được chọn',
          };
        }

        const weakSkillIds = Array.from(weakSkillsMap.keys());

        const scenarioSkillsResult = await Promise.all(
          weakSkillIds.map(async skillId => {
            const scenarioSkills = await ctx.call('scenarioskills.getScenariosBySkill', {
              skillId,
              fields: ['_id', 'scenarioId.courseId'],
            });
            return {skillId, scenarioSkills};
          }),
        );

        const courseSkillsMap = new Map();
        for (const {skillId, scenarioSkills} of scenarioSkillsResult) {
          for (const ss of scenarioSkills) {
            if (ss.scenarioId && ss.scenarioId.courseId) {
              const courseId = ss.scenarioId.courseId?.toString() || ss.scenarioId.courseId;
              if (!courseSkillsMap.has(courseId)) {
                courseSkillsMap.set(courseId, new Set());
              }
              courseSkillsMap.get(courseId).add(skillId);
            }
          }
        }

        if (courseSkillsMap.size === 0) {
          return {
            suggestedCourses: [],
            weakSkillsSummary: this.buildWeakSkillsSummary(weakSkillsMap),
            message: 'Không tìm thấy khóa học nào có kịch bản phù hợp với các kỹ năng yếu',
          };
        }

        const courseIds = Array.from(courseSkillsMap.keys());

        const scopeConditions = [];
        if (orgIds.length > 0) {
          scopeConditions.push({organizationId: {$in: orgIds}});
        }
        scopeConditions.push({createdBy: user._id});

        const courses = await this.adapter.find({
          query: {
            _id: {$in: courseIds},
            isDeleted: false,
            status: 'published',
            courseType: 'optional',
            $and: [
              {$or: [{startDate: {$exists: false}}, {startDate: null}, {startDate: {$lte: now}}]},
              {$or: scopeConditions},
            ],
          },
          fields: [
            '_id',
            'name',
            'description',
            'thumbnailId',
            'startDate',
            'deadline',
            'courseType',
            'organizationId',
            'publishedToUsers',
          ],
        });

        const mandatoryUsersByCourse = new Map();
        for (const course of courses) {
          const cid = course._id.toString();
          const mandatorySet = new Set();
          (course.publishedToUsers || []).forEach(entry => {
            const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
            if (uid && entry.courseType === 'mandatory' && userIds.includes(uid)) {
              mandatorySet.add(uid);
            }
          });
          if (mandatorySet.size > 0) {
            mandatoryUsersByCourse.set(cid, mandatorySet);
          }
        }

        const validCourses = courses.filter(course => {
          if (course.deadline && new Date(course.deadline) <= now) return false;

          const courseId = course._id.toString();
          const publishedUserIds = (course.publishedToUsers || [])
            .map(entry => entry?.userId?._id?.toString() || entry?.userId?.toString())
            .filter(Boolean);
          const mandatoryUsers = mandatoryUsersByCourse.get(courseId) || new Set();

          for (const uid of userIds) {
            const isPublished = publishedUserIds.includes(uid);
            const isMandatory = mandatoryUsers.has(uid);
            if (!isPublished || !isMandatory) {
              return true;
            }
          }
          return false;
        });

        const enrichedCourses = validCourses.map(course => {
          const courseId = course._id.toString();
          const matchedSkillIds = Array.from(courseSkillsMap.get(courseId) || []);
          const publishedUserIds = (course.publishedToUsers || [])
            .map(entry => entry?.userId?._id?.toString() || entry?.userId?.toString())
            .filter(Boolean);
          const mandatoryUsers = mandatoryUsersByCourse.get(courseId) || new Set();

          const affectedUserSet = new Set();
          for (const skillId of matchedSkillIds) {
            const skillData = weakSkillsMap.get(skillId);
            if (skillData) {
              skillData.userIds.forEach(uid => {
                const isMandatory = mandatoryUsers.has(uid);
                if (!isMandatory) {
                  affectedUserSet.add(uid);
                }
              });
            }
          }
          const affectedUserCount = affectedUserSet.size;

          const matchedSkills = matchedSkillIds.map(skillId => {
            const skillData = weakSkillsMap.get(skillId);
            return {
              skillId,
              skillName: skillData?.skillName,
              avgScore: skillData ? Math.round(skillData.totalScore / skillData.count) : 0,
            };
          });

          const matchScore = Math.round((matchedSkillIds.length / weakSkillIds.length) * 100);

          const notPublishedCount = userIds.filter(uid => !publishedUserIds.includes(uid)).length;
          const publishedButNotMandatoryCount = userIds.filter(
            uid => publishedUserIds.includes(uid) && !mandatoryUsers.has(uid),
          ).length;

          delete course.publishedToUsers;

          return {
            course,
            matchedSkills,
            matchScore,
            affectedUserCount,
            notPublishedCount,
            publishedButNotMandatoryCount,
          };
        });

        const sortedCourses = enrichedCourses
          .sort((a, b) => b.matchScore - a.matchScore || b.affectedUserCount - a.affectedUserCount)
          .slice(0, limit);

        return {
          suggestedCourses: sortedCourses,
          weakSkillsSummary: this.buildWeakSkillsSummary(weakSkillsMap),
          totalWeakSkills: weakSkillsMap.size,
          totalCoursesFound: sortedCourses.length,
        };
      } catch (error) {
        this.logger.error('Error in getSuggestedCourses:', error);
        throw new MoleculerClientError(error.message || 'Lỗi khi tìm khóa học gợi ý', error.code || 500);
      }
    },
  },
};
