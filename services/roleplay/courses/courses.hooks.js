'use strict';

const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;

/**
 * Courses Service - Hooks
 * Contains all before and after hooks for the courses service.
 */

module.exports = {
  after: {
    'create|update|delete|addReferenceFile|removeReferenceFile': function (ctx, res) {
      const courseId = res._id;
      const performedBy = ctx.meta.user?._id;
      const action = ctx.action.name;
      this.logger.info(`${action} course ${courseId} by user ${performedBy}`);
      return res;
    },

    get: async function (ctx, res) {
      if (!res) return res;

      if (res.references && Array.isArray(res.references)) {
        try {
          const refIds = res.references.map(ref => (ref?._id || ref)?.toString()).filter(Boolean);
          if (refIds.length > 0) {
            const populatedRefs = await ctx.call('references.get', {
              id: refIds,
              populate: ['fileId', 'createdBy'],
            });
            res.references = Array.isArray(populatedRefs) ? populatedRefs : [populatedRefs];
          }
        } catch (err) {
          this.logger.error('Error populating fileId in references', err);
        }
      }

      if (res.publishedToUsers && Array.isArray(res.publishedToUsers)) {
        const userIds = res.publishedToUsers
          .map(entry => entry?.userId?._id?.toString() || entry?.userId?.toString())
          .filter(Boolean);

        if (userIds.length > 0) {
          try {
            const fullUsers = await ctx.call('users.get', {
              id: userIds,
              populate: ['roleId', 'organizationId.parentOrganizationId', 'jobTitleId'],
            });
            const userMap = {};
            fullUsers.forEach(u => {
              userMap[u._id.toString()] = u;
            });

            res.publishedToUsers = res.publishedToUsers.map(entry => {
              const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
              const fullUser = userMap[uid];
              return fullUser ? {...fullUser, courseType: entry.courseType} : entry;
            });
          } catch (err) {
            this.logger.error('Error fetching full users for publishedToUsers in get hook', err);
          }
        }
      }

      const user = ctx.meta.user;
      if (user && res._id) {
        try {
          const [bookmarkResult, reminderResult] = await Promise.all([
            ctx.call('coursebookmarks.checkBookmark', {
              courseId: res._id.toString(),
            }),
            ctx.call('coursereminders.checkReminder', {
              courseId: res._id.toString(),
            }),
          ]);
          res.isBookmarked = bookmarkResult.bookmarked;
          res.isReminded = reminderResult.reminded;
        } catch (err) {
          res.isBookmarked = false;
          res.isReminded = false;
        }
      }

      return res;
    },

    list: async function (ctx, res) {
      const user = ctx.meta.user;

      if (!user || !res || !Array.isArray(res.rows)) {
        return res;
      }

      try {
        const courseIds = res.rows.map(c => c._id);

        const [allScenarios, aggregatedResult, totalMembersMap, userBookmarks, userReminders] = await Promise.all([
          this.batchGetScenariosByCourses(ctx, courseIds),
          ctx.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: courseIds.map(id => id.toString()),
            studentId: user._id.toString(),
          }),
          this.batchCalculateTotalMembers(ctx, res.rows),
          ctx
            .call('coursebookmarks.find', {
              query: {userId: user._id, courseId: {$in: courseIds}},
              fields: ['courseId'],
            })
            .catch(() => []),
          ctx
            .call('coursereminders.find', {
              query: {userId: user._id, courseId: {$in: courseIds}},
              fields: ['courseId'],
            })
            .catch(() => []),
        ]);

        const bookmarkedCourseIds = new Set(
          userBookmarks.map(b => (b.courseId?._id || b.courseId)?.toString()).filter(Boolean),
        );
        const remindedCourseIds = new Set(
          userReminders.map(r => (r.courseId?._id || r.courseId)?.toString()).filter(Boolean),
        );

        const aggregatedSessions = aggregatedResult.allSessions || [];
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

        const completedMembersMap = this.calculateCompletedMembersFromAggregatedData(
          courseIds,
          res.rows,
          allScenarios,
          aggregatedSessions,
          totalMembersMap,
        );

        const enrichedRows = res.rows.map(course => {
          try {
            const courseId = course._id.toString();
            const scenarios = scenariosByCourse.get(courseId) || [];
            const sessions = userSessionsByCourse.get(courseId) || [];

            const totalEstimatedTime = scenarios.reduce((sum, s) => sum + (s.estimatedCallTimeInMinutes || 0), 0);
            const completionPercentage = this.calculateCompletionFromAggregatedData(scenarios, sessions);
            const totalMembers = totalMembersMap[courseId]?.count || 0;
            const completedMembersCount = completedMembersMap[courseId] || 0;

            const override = (course.publishedToUsers || []).find(entry => {
              const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
              return uid === user._id.toString();
            });
            const effectiveCourseType = override ? override.courseType : course.courseType;

            return {
              ...course,
              courseType: effectiveCourseType,
              totalEstimatedCallTimeInMinutes: totalEstimatedTime,
              userCompletionPercentage: completionPercentage,
              totalMembers,
              completedMembers: totalMembers > 0 ? Math.round((completedMembersCount / totalMembers) * 100) : 0,
              completedMembersCount: completedMembersCount,
              totalSessions: sessions.length,
              scenarios: scenarios.length,
              isBookmarked: bookmarkedCourseIds.has(courseId),
              isReminded: remindedCourseIds.has(courseId),
            };
          } catch (err) {
            this.logger.error(`Error enriching course ${course._id}`, err);
            return {
              ...course,
              totalEstimatedCallTimeInMinutes: 0,
              userCompletionPercentage: 0,
              totalMembers: 0,
              completedMembers: 0,
            };
          }
        });

        return {
          ...res,
          rows: enrichedRows,
        };
      } catch (error) {
        this.logger.error('Error in list after hook:', error);
        return res;
      }
    },

    getAllCourseStarted: async function (ctx, res) {
      const user = ctx.meta.user;
      if (!user || !res || !Array.isArray(res.rows)) {
        return res;
      }

      try {
        const courseIds = res.rows.map(c => c._id);

        const [allScenarios, aggregatedResult, totalMembersMap, userBookmarks, userReminders] = await Promise.all([
          this.batchGetScenariosByCourses(ctx, courseIds),
          ctx.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: courseIds.map(id => id.toString()),
            studentId: user._id.toString(),
          }),
          this.batchCalculateTotalMembers(ctx, res.rows),
          ctx
            .call('coursebookmarks.find', {
              query: {userId: user._id, courseId: {$in: courseIds}},
              fields: ['courseId'],
            })
            .catch(() => []),
          ctx
            .call('coursereminders.find', {
              query: {userId: user._id, courseId: {$in: courseIds}},
              fields: ['courseId'],
            })
            .catch(() => []),
        ]);

        const bookmarkedCourseIds = new Set(
          userBookmarks.map(b => (b.courseId?._id || b.courseId)?.toString()).filter(Boolean),
        );
        const remindedCourseIds = new Set(
          userReminders.map(r => (r.courseId?._id || r.courseId)?.toString()).filter(Boolean),
        );

        const aggregatedSessions = aggregatedResult.allSessions || [];
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

        const completedMembersMap = this.calculateCompletedMembersFromAggregatedData(
          courseIds,
          res.rows,
          allScenarios,
          aggregatedSessions,
          totalMembersMap,
        );

        const enrichedRows = res.rows.map(course => {
          const plainCourse = course.toObject();
          try {
            const courseId = plainCourse._id.toString();
            const scenarios = scenariosByCourse.get(courseId) || [];
            const sessions = userSessionsByCourse.get(courseId) || [];

            const totalEstimatedTime = scenarios.reduce((sum, s) => sum + (s.estimatedCallTimeInMinutes || 0), 0);
            const completionPercentage = this.calculateCompletionFromAggregatedData(scenarios, sessions);
            const totalMembers = totalMembersMap[courseId]?.count || 0;
            const completedMembersCount = completedMembersMap[courseId] || 0;

            const override = (plainCourse.publishedToUsers || []).find(entry => {
              const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
              return uid === user._id.toString();
            });
            const effectiveCourseType = override ? override.courseType : plainCourse.courseType;

            return {
              ...plainCourse,
              courseType: effectiveCourseType,
              totalEstimatedCallTimeInMinutes: totalEstimatedTime,
              userCompletionPercentage: completionPercentage,
              totalMembers,
              completedMembers: totalMembers > 0 ? Math.round((completedMembersCount / totalMembers) * 100) : 0,
              completedMembersCount: completedMembersCount,
              totalSessions: sessions.length,
              scenarios: scenarios.length,
              isBookmarked: bookmarkedCourseIds.has(courseId),
              isReminded: remindedCourseIds.has(courseId),
            };
          } catch (err) {
            this.logger.error(`Error enriching course ${plainCourse._id}`, err);
            return {
              ...plainCourse,
              totalEstimatedCallTimeInMinutes: 0,
              userCompletionPercentage: 0,
              totalMembers: 0,
              completedMembers: 0,
            };
          }
        });

        return {
          ...res,
          rows: enrichedRows,
        };
      } catch (error) {
        this.logger.error('Error in list after hook:', error);
        return res;
      }
    },
  },

  before: {
    get(ctx) {
      ctx.params.populate = ctx.params.populate || this.settings.populateOptions;
    },

    async update(ctx) {
      const {deadline, courseType, references: newReferences} = ctx.params;

      if (newReferences && Array.isArray(newReferences)) {
        try {
          const courseId = ctx.params.id;
          const currentCourse = await this.adapter.findById(courseId);

          if (currentCourse && currentCourse.references && currentCourse.references.length > 0) {
            const newRefSet = new Set(newReferences.map(r => r.toString()));
            const removedRefs = currentCourse.references.map(r => r.toString()).filter(r => !newRefSet.has(r));
            if (removedRefs.length > 0) {
              const scenarios = await ctx.call('aiscenarios.find', {
                query: {courseId: courseId, isDeleted: false},
                fields: ['_id', 'references'],
              });
              const scenariosToUpdate = scenarios.filter(
                s =>
                  s.references && s.references.some(ref => removedRefs.includes(ref._id?.toString() || ref.toString())),
              );
              if (scenariosToUpdate.length > 0) {
                await Promise.all(
                  scenariosToUpdate.map(scenario => {
                    const updatedRefs = scenario.references
                      .map(ref => ref._id?.toString() || ref.toString())
                      .filter(ref => !removedRefs.includes(ref));
                    return ctx.call('aiscenarios.update', {
                      id: scenario._id.toString(),
                      references: updatedRefs,
                    });
                  }),
                );
                this.logger.info(
                  `Đã xóa ${removedRefs.length} tài liệu khỏi ${scenariosToUpdate.length} kịch bản của khóa học ${courseId}`,
                );
              }
            }
          }
        } catch (err) {
          this.logger.error('Lỗi khi xóa tài liệu khỏi kịch bản:', err);
        }
      }

      if (!deadline) return;

      const now = new Date();
      const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      let expired_status = 'pending';

      if (courseType === 'optional') {
        expired_status = 'pending';
      } else {
        const d = new Date(deadline);

        if (d < now) expired_status = 'overdue';
        else if (d <= threeDaysLater) expired_status = 'due_soon';
        else expired_status = 'pending';
      }

      ctx.params.expired_status = expired_status;
    },

    list: async function (ctx) {
      const params = ctx.params;
      const user = ctx.meta.user;
      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const baseQuery = {isDeleted: false};

      let clientQuery = {};
      if (params.query) {
        if (typeof params.query === 'string') {
          try {
            clientQuery = JSON.parse(params.query);
          } catch (e) {
            this.logger.warn('Invalid JSON in query param', params.query);
          }
        } else if (typeof params.query === 'object') {
          clientQuery = params.query;
        }
      }

      let finalQuery = {...baseQuery, ...clientQuery};

      finalQuery['publishedToUsers.userId'] = user._id;

      ctx.params.query = finalQuery;
    },
  },
};
