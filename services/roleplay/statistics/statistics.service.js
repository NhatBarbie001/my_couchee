'use strict';

const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const BaseService = require('../../../mixins/baseService.mixin');
const CourseStatisticsMixin = require('./courseStatistics.mixin');
const ReportExportMixin = require('./reportExport.mixin');
const OverviewReportMixin = require('./overviewReport.mixin');
const {MoleculerClientError} = require('moleculer').Errors;
const mongoose = require('mongoose');
const path = require('path');
const FileMixin = require('../../../mixins/file.mixin');
const CarboneMixin = require('../../../mixins/carbone.mixin');
const templatesDir = path.join(__dirname, 'templates');
const storageDir = path.join(__dirname, 'storage');

module.exports = {
  name: 'roleplay.statistics',
  mixins: [
    FunctionsCommon,
    BaseService,
    CourseStatisticsMixin,
    ReportExportMixin,
    OverviewReportMixin,
    FileMixin,
    CarboneMixin,
  ],

  settings: {
    cacheCleanEventName: 'cache.clean.statistics',
    cacheTTL: 300,
  },

  actions: {
    getStudentStatistics: {
      rest: 'GET /students/:studentId/statistics',
      params: {
        studentId: 'string',
        startDate: {type: 'string', optional: true},
        endDate: {type: 'string', optional: true},
      },
      cache: {
        keys: ['studentId', 'startDate', 'endDate'],
        ttl: 300,
      },
      async handler(ctx) {
        const {studentId, startDate, endDate} = ctx.params;

        try {
          const student = await this.broker.call('users.get', {id: studentId});
          if (!student) {
            throw new MoleculerClientError('Student not found', 404);
          }

          const dateFilter = this.buildDateFilter(startDate, endDate);

          const [
            completedCourses,
            averageScore,
            detailedScores,
            studentRanking,
            completionRate,
            averageCompletionTime,
            bestWorstCourses,
          ] = await Promise.all([
            this.getStudentCompletedCourses(studentId, dateFilter),
            this.getStudentAverageScore(studentId, dateFilter),
            this.getStudentDetailedScores(studentId, dateFilter),
            this.getStudentRanking(studentId, dateFilter),
            this.getStudentCompletionRate(studentId, dateFilter),
            this.getStudentAverageCompletionTime(studentId, dateFilter),
            this.getStudentBestWorstCourses(studentId, dateFilter),
          ]);

          return {
            studentId,
            studentName: student.name || student.email,
            period: {startDate, endDate},
            completedCourses: completedCourses.length,
            averageScore: averageScore,
            completionRate: completionRate,
            averageCompletionTimeMinutes: averageCompletionTime,
            ranking: studentRanking,
            bestPerformingCourse: bestWorstCourses.best,
            worstPerformingCourse: bestWorstCourses.worst,
            detailedScores: detailedScores,
            generatedAt: new Date(),
          };
        } catch (error) {
          this.logger.error('Error getting student statistics:', error);
          throw error;
        }
      },
    },

    getOverallStatistics: {
      rest: 'GET /overall',
      params: {
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        organizationId: {type: 'string', optional: true},
      },
      cache: {
        keys: ['time', 'fromDate', 'toDate', 'organizationId'],
        ttl: 600,
      },
      async handler(ctx) {
        const {time, fromDate, toDate, organizationId} = ctx.params;
        const user = ctx.meta.user;

        try {
          const dateFilter = this.extractQueryTime({time, fromDate, toDate});

          let orgIds = null;
          let targetOrgId = organizationId;
          if (!targetOrgId && user && user.organizationId) {
            targetOrgId = user.organizationId.toString();
          }

          if (targetOrgId) {
            try {
              const descendants = await ctx.call('organizations.getAllDescendants', {
                orgId: targetOrgId,
              });

              orgIds = [new mongoose.Types.ObjectId(targetOrgId)];
              descendants.forEach(desc => {
                orgIds.push(desc._id);
              });
            } catch (error) {
              console.log('Error getting descendants for org', targetOrgId, error);
              orgIds = [new mongoose.Types.ObjectId(targetOrgId)];
            }
          }

          // Lấy tất cả users thuộc đơn vị + đơn vị con/cháu
          const users = await ctx.call('users.find', {
            query: {organizationId: {$in: orgIds}},
          });
          const userIds = users.map(user => user._id);

          // Lấy tất cả khóa học thuộc đơn vị + đơn vị con/cháu
          const courses = await ctx.call('courses.find', {
            query: {organizationId: {$in: orgIds}, isDeleted: {$ne: true}, status: {$ne: 'draft'}, isActive: true},
            fields: ['_id'],
          });
          const courseIds = courses.map(c => c._id);

          const [
            courseCompletionStats,
            totalActiveStudents,
            totalSessions,
            totalCompletedSessions,
            averagePlatformScore,
            mostPopularCourses,
            topPerformingStudents,
            topWeakStudents,
            topCompletionRateCourses,
          ] = await Promise.all([
            this.getCourseCompletionStatistics(ctx, orgIds, userIds),
            this.getTotalActiveStudents(dateFilter, userIds, courseIds),
            this.getTotalSessions(dateFilter, userIds, courseIds),
            this.getTotalCompletedSessions(dateFilter, userIds, courseIds),
            this.getAveragePlatformScore(dateFilter, userIds, courseIds),
            this.getMostPopularCourses(5, dateFilter, userIds, courseIds),
            this.getTopPerformingStudents(10, dateFilter, userIds, courseIds),
            this.getTopWeakStudents(10, dateFilter, userIds, courseIds),
            this.getTopCompletionRateCourses(5, dateFilter, userIds, orgIds),
          ]);

          return {
            courseCompletionStats,
            totalCourses: courseCompletionStats.totalCourses,
            totalStudents: courseCompletionStats.totalStudents,
            totalActiveStudents,
            totalSessions,
            totalCompletedSessions,
            overallCompletionRate: totalSessions > 0 ? ((totalCompletedSessions / totalSessions) * 100).toFixed(2) : 0,
            averagePlatformScore,
            mostPopularCourses,
            topPerformingStudents,
            topWeakStudents,
            topCompletionRateCourses,
          };
        } catch (error) {
          this.logger.error('Error getting overall statistics:', error);
          throw error;
        }
      },
    },

    getPersonalDashboard: {
      rest: 'GET /personal-dashboard',
      params: {
        userId: {type: 'string', optional: true}, // Optional, defaults to current user
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        scenarioCategoryId: {type: 'string', optional: true},
        courseCategoryId: {type: 'string', optional: true},
        skillGroupId: {type: 'string', optional: true},
      },
      /* cache: {
        keys: ['userId', 'time', 'fromDate', 'toDate', 'scenarioCategoryId', 'courseCategoryId', 'skillGroupId'],
        ttl: 300,
      }, */
      async handler(ctx) {
        const {time, fromDate, toDate, scenarioCategoryId, courseCategoryId, skillGroupId} = ctx.params;

        const userId = ctx.params.userId || ctx.meta.user?.userId || ctx.meta.user?._id;

        if (!userId) {
          throw new MoleculerClientError('User ID is required', 400);
        }

        try {
          const dateFilter = this.extractQueryTime({time, fromDate, toDate});
          const scenarioFilter = scenarioCategoryId ? {scenarioCategoryId} : {};
          const courseFilter = courseCategoryId ? {courseCategoryId} : {};

          const [
            summaryStats,
            practiceHistory,
            latestCumulativeSkills,
            userCourseOverdue,
            courseCompletionChart,
            scenarioPassRateChart,
          ] = await Promise.all([
            this.getPersonalSummaryStats(userId, dateFilter, scenarioFilter, courseFilter),
            this.getPracticeHistoryByScenario(userId, dateFilter, scenarioFilter, courseFilter),
            this.getLatestCumulativeSnapshot(ctx, userId, skillGroupId),
            ctx.call('courses.getExpiredCoursesForUser'),
            this.getPersonalCourseCompletionChart(ctx, userId, scenarioFilter, courseFilter),
            this.getPersonalScenarioPassRateChart(ctx, userId, scenarioFilter, courseFilter),
          ]);

          return {
            summary: {
              ...summaryStats,
              totalCourses: courseCompletionChart.totalCourses,
            },
            courseCompletionChart,
            scenarioPassRateChart,
            practiceHistory: practiceHistory,
            latestCumulativeSkills,
            userCourseOverdue,
          };
        } catch (error) {
          this.logger.error('Error getting personal dashboard:', error);
          throw error;
        }
      },
    },

    getPersonalTopSkills: {
      rest: 'GET /personal-top-skills',
      params: {
        userId: {type: 'string', optional: true},
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        scenarioCategoryId: {type: 'string', optional: true},
        courseCategoryId: {type: 'string', optional: true},
        skillGroupId: {type: 'string', optional: true},
        limit: {type: 'number', optional: true, integer: true, min: 1, default: 5},
      },
      async handler(ctx) {
        const {time, fromDate, toDate, scenarioCategoryId, courseCategoryId, skillGroupId, limit} = ctx.params;

        const userId = ctx.params.userId || ctx.meta.user?.userId || ctx.meta.user?._id;

        if (!userId) {
          throw new MoleculerClientError('User ID is required', 400);
        }

        try {
          const dateFilter = this.extractQueryTime({time, fromDate, toDate});
          const scenarioFilter = scenarioCategoryId ? {scenarioCategoryId} : {};
          const courseFilter = courseCategoryId ? {courseCategoryId} : {};

          const topSkills = await this.getTopSkillsByGroup(
            ctx,
            userId,
            skillGroupId,
            limit,
            dateFilter,
            scenarioFilter,
            courseFilter,
          );

          return topSkills;
        } catch (error) {
          this.logger.error('Error getting personal top skills:', error);
          throw error;
        }
      },
    },

    getOrganizationSkillsStatistics: {
      rest: 'GET /skills-statistics',
      params: {
        organizationId: {type: 'string', optional: true},
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        skillGroupId: {type: 'string', optional: true},
      },

      async handler(ctx) {
        const {time, fromDate, toDate, organizationId, skillGroupId} = ctx.params;
        const user = ctx.meta.user;

        try {
          const dateFilter = this.extractQueryTime({time, fromDate, toDate});
          let targetOrgId = organizationId;
          if (!targetOrgId && user && user.organizationId) {
            targetOrgId = user.organizationId.toString();
          }

          if (!targetOrgId) {
            throw new MoleculerClientError('Organization ID is required', 400);
          }

          let orgIds = [new mongoose.Types.ObjectId(targetOrgId)];
          try {
            const descendants = await ctx.call('organizations.getAllDescendants', {
              orgId: targetOrgId,
            });
            descendants.forEach(desc => {
              orgIds.push(desc._id);
            });
          } catch (error) {
            console.log('Error getting descendants for org', targetOrgId, error);
          }
          const users = await ctx.call('users.find', {
            query: {organizationId: {$in: orgIds}},
            fields: ['_id'],
          });
          const userIds = users.map(user => user._id);

          if (userIds.length === 0) {
            return {
              overview: {
                totalStudents: 0,
                totalSessions: 0,
                averageScore: 0,
              },
              topSkills: [],
              allSkills: {all: []},
            };
          }

          const [overview, allSkillsData] = await Promise.all([
            this.getOrganizationOverview(ctx, userIds, dateFilter, skillGroupId, orgIds),
            this.getOrganizationSkillsByGroup(ctx, userIds, skillGroupId, dateFilter, orgIds),
          ]);

          const practicedSkills = allSkillsData
            .filter(skill => skill.isPracticed)
            .sort((a, b) => b.averageScore - a.averageScore);

          const bestSkills = practicedSkills.filter(skill => skill.averageScore >= 50).slice(0, 5);
          const worstSkills = practicedSkills
            .filter(skill => skill.averageScore < 50)
            .slice(-5)
            .reverse();

          const allSkillsSimple = allSkillsData.map(skill => ({
            skillId: skill.skillId,
            skillName: skill.skillName,
            averageScore: skill.averageScore,
            totalAttempts: skill.totalAttempts,
            isPracticed: skill.isPracticed,
            topStudents: skill.topStudents || [],
            bottomStudents: skill.bottomStudents || [],
          }));

          const organizedSkills = this.organizeSkillsByTopAndBottom(allSkillsSimple);

          return {
            overview,
            topSkills: {
              best: bestSkills,
              worst: worstSkills,
            },
            allSkills: organizedSkills,
          };
        } catch (error) {
          console.log('Error getting organization skills statistics:', error);
          throw error;
        }
      },
    },

    getOrganizationCompletionStats: {
      rest: 'GET /organization-completion-stats',
      params: {
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        organizationId: {type: 'string', optional: true},
        sortOrder: {type: 'string', optional: true, enum: ['asc', 'desc'], default: 'desc'},
      },
      cache: {
        keys: ['time', 'fromDate', 'toDate', 'organizationId', 'sortOrder'],
        ttl: 600,
      },
      async handler(ctx) {
        const {time, fromDate, toDate, organizationId, sortOrder} = ctx.params;
        const user = ctx.meta.user;

        try {
          const dateFilter = this.extractQueryTime({time, fromDate, toDate});

          let targetOrgId = organizationId;
          if (!targetOrgId && user && user.organizationId) {
            targetOrgId = user.organizationId.toString();
          }

          if (!targetOrgId) {
            throw new MoleculerClientError('Organization ID is required', 400);
          }

          const targetOrg = await ctx.call('organizations.get', {id: targetOrgId});
          let allDescendants = [];
          try {
            const descendants = await ctx.call('organizations.getAllDescendants', {orgId: targetOrgId});
            allDescendants = descendants
              .filter(d => !d.isDeleted)
              .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          } catch (e) {
            // ignore
          }
          const allOrgs = targetOrg && !targetOrg.isDeleted ? [targetOrg, ...allDescendants] : allDescendants;
          const allOrgIds = allOrgs.map(o => o._id);

          const allUsers = await ctx.call('users.find', {
            query: {organizationId: {$in: allOrgIds}},
            fields: ['_id', 'organizationId'],
          });

          const usersByOrg = {};
          allUsers.forEach(u => {
            const orgId = u.organizationId?._id ? u.organizationId._id.toString() : u.organizationId?.toString();
            if (orgId) {
              if (!usersByOrg[orgId]) usersByOrg[orgId] = [];
              usersByOrg[orgId].push(u._id.toString());
            }
          });

          const allUserIds = allUsers.map(u => u._id);

          const courses = await ctx.call('courses.find', {
            query: {
              isDeleted: {$ne: true},
              organizationId: {$in: allOrgIds},
            },
            fields: ['_id', 'publishedToUsers'],
          });

          if (courses.length === 0 || allUsers.length === 0) {
            return allOrgs.map(org => ({
              organizationId: org._id.toString(),
              organizationName: org.name,
              totalStudents: (usersByOrg[org._id.toString()] || []).length,
              totalScenarios: 0,
              passedScenarios: 0,
              completionRate: 0,
            }));
          }

          const courseIds = courses.map(c => c._id);

          const [allScenarios, aggregatedResult] = await Promise.all([
            ctx.call('aiscenarios.find', {
              query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}},
              fields: ['_id', 'courseId', 'passScore'],
            }),
            ctx.call('roleplaysessions.aggregateCompletedSessions', {
              courseIds: courseIds.map(id => id.toString()),
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

          const bestScoresByCourse = {};
          (aggregatedResult.allSessions || []).forEach(agg => {
            const cid = agg.courseId?.toString();
            const sid = agg.studentId?.toString();
            const scid = agg.aiScenarioId?.toString();
            if (!cid || !sid || !scid) return;
            if (!bestScoresByCourse[cid]) bestScoresByCourse[cid] = {};
            if (!bestScoresByCourse[cid][sid]) bestScoresByCourse[cid][sid] = {};
            bestScoresByCourse[cid][sid][scid] = agg.bestScore;
          });

          const results = allOrgs.map(org => {
            const orgId = org._id.toString();
            const orgUserIdList = usersByOrg[orgId] || [];
            const orgUserIdSet = new Set(orgUserIdList);

            if (orgUserIdList.length === 0) {
              return {
                organizationId: orgId,
                organizationName: org.name,
                totalStudents: 0,
                totalScenarios: 0,
                passedScenarios: 0,
                completionRate: 0,
              };
            }

            let totalScenarios = 0;
            let passedScenarios = 0;

            for (const course of courses) {
              const courseId = course._id.toString();
              const courseScenarios = scenariosByCourse[courseId] || [];
              if (courseScenarios.length === 0) continue;

              const publishedUsers = course.publishedToUsers || [];
              const validUserIds = [];
              publishedUsers.forEach(entry => {
                const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
                if (uid && orgUserIdSet.has(uid)) {
                  validUserIds.push(uid);
                }
              });

              if (validUserIds.length === 0) continue;

              const scenarioPassScores = {};
              courseScenarios.forEach(s => {
                scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
              });

              const scenarioIds = Object.keys(scenarioPassScores);
              totalScenarios += validUserIds.length * scenarioIds.length;

              const courseBestScores = bestScoresByCourse[courseId] || {};

              for (const uid of validUserIds) {
                const studentScores = courseBestScores[uid] || {};
                for (const scenarioId of scenarioIds) {
                  if ((studentScores[scenarioId] ?? -1) >= scenarioPassScores[scenarioId]) {
                    passedScenarios++;
                  }
                }
              }
            }

            return {
              organizationId: orgId,
              organizationName: org.name,
              totalStudents: orgUserIdList.length,
              totalScenarios,
              passedScenarios,
              completionRate:
                totalScenarios > 0 ? parseFloat(((passedScenarios / totalScenarios) * 100).toFixed(2)) : 0,
            };
          });

          if (sortOrder === 'asc') {
            results.sort((a, b) => a.completionRate - b.completionRate);
          } else {
            results.sort((a, b) => b.completionRate - a.completionRate);
          }

          return results;
        } catch (error) {
          this.logger.error('Error getting organization completion stats:', error);
          throw error;
        }
      },
    },

    getStudentCompletionStats: {
      rest: 'GET /student-completion-stats',
      params: {
        organizationId: {type: 'string', optional: true},
        sortOrder: {type: 'string', optional: true, enum: ['asc', 'desc'], default: 'asc'},
        limit: {type: 'number', optional: true, integer: true, positive: true, default: 10},
      },
      cache: {
        keys: ['organizationId', 'sortOrder', 'limit'],
        ttl: 600,
      },
      async handler(ctx) {
        const {organizationId, sortOrder, limit} = ctx.params;
        const user = ctx.meta.user;

        try {
          let targetOrgId = organizationId;
          if (!targetOrgId && user && user.organizationId) {
            targetOrgId = user.organizationId.toString();
          }

          if (!targetOrgId) {
            throw new MoleculerClientError('Organization ID is required', 400);
          }

          let orgIds = [new mongoose.Types.ObjectId(targetOrgId)];
          try {
            const descendants = await ctx.call('organizations.getAllDescendants', {orgId: targetOrgId});
            descendants.forEach(desc => orgIds.push(desc._id));
          } catch (e) {
            // ignore
          }

          const [allUsers, allOrgs] = await Promise.all([
            ctx.call('users.find', {
              query: {organizationId: {$in: orgIds}},
              fields: ['_id', 'fullName', 'email', 'organizationId'],
            }),
            ctx.call('organizations.find', {
              query: {_id: {$in: orgIds}},
              fields: ['_id', 'name'],
            }),
          ]);
          if (allUsers.length === 0) return [];

          const orgNameMap = {};
          allOrgs.forEach(o => {
            orgNameMap[o._id.toString()] = o.name;
          });
          const allUserIds = allUsers.map(u => u._id);
          const userIdSet = new Set(allUserIds.map(id => id.toString()));

          const courses = await ctx.call('courses.find', {
            query: {
              isDeleted: {$ne: true},
              organizationId: {$in: orgIds},
            },
            fields: ['_id', 'publishedToUsers'],
          });

          if (courses.length === 0) {
            const effectiveLimit = limit || 10;
            return allUsers.slice(0, effectiveLimit).map(u => ({
              studentId: u._id,
              studentName: u.fullName || u.email,
              organizationName: orgNameMap[u.organizationId?._id?.toString() || u.organizationId?.toString()] || '',
              totalScenarios: 0,
              passedScenarios: 0,
              completionRate: 0,
            }));
          }

          const courseIds = courses.map(c => c._id);

          const [allScenarios, aggregatedResult] = await Promise.all([
            ctx.call('aiscenarios.find', {
              query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}},
              fields: ['_id', 'courseId', 'passScore'],
            }),
            ctx.call('roleplaysessions.aggregateCompletedSessions', {
              courseIds: courseIds.map(id => id.toString()),
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

          const bestScoresByStudent = {};
          (aggregatedResult.allSessions || []).forEach(agg => {
            const sid = agg.studentId?.toString();
            const cid = agg.courseId?.toString();
            const scid = agg.aiScenarioId?.toString();
            if (!sid || !cid || !scid) return;
            if (!bestScoresByStudent[sid]) bestScoresByStudent[sid] = {};
            if (!bestScoresByStudent[sid][cid]) bestScoresByStudent[sid][cid] = {};
            bestScoresByStudent[sid][cid][scid] = agg.bestScore;
          });

          const userCourseScenarios = {};
          for (const course of courses) {
            const courseId = course._id.toString();
            const courseScenarios = scenariosByCourse[courseId] || [];
            if (courseScenarios.length === 0) continue;

            const scenarioPassScores = {};
            courseScenarios.forEach(s => {
              scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
            });

            const publishedUsers = course.publishedToUsers || [];
            publishedUsers.forEach(entry => {
              const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
              if (uid && userIdSet.has(uid)) {
                if (!userCourseScenarios[uid]) userCourseScenarios[uid] = [];
                userCourseScenarios[uid].push({courseId, scenarioPassScores});
              }
            });
          }

          const studentStats = allUsers.map(u => {
            const uid = u._id.toString();
            const orgId = u.organizationId?._id?.toString() || u.organizationId?.toString();
            const courseScenarioList = userCourseScenarios[uid] || [];

            let totalScenarios = 0;
            let passedScenarios = 0;

            for (const {courseId, scenarioPassScores} of courseScenarioList) {
              const scenarioIds = Object.keys(scenarioPassScores);
              totalScenarios += scenarioIds.length;

              const studentCourseScores = bestScoresByStudent[uid]?.[courseId] || {};
              for (const scenarioId of scenarioIds) {
                if ((studentCourseScores[scenarioId] ?? -1) >= scenarioPassScores[scenarioId]) {
                  passedScenarios++;
                }
              }
            }

            return {
              studentId: u._id,
              studentName: u.fullName || u.email,
              organizationName: orgNameMap[orgId] || '',
              totalScenarios,
              passedScenarios,
              completionRate:
                totalScenarios > 0 ? parseFloat(((passedScenarios / totalScenarios) * 100).toFixed(2)) : 0,
            };
          });

          const effectiveLimit = limit || 5;
          if (sortOrder === 'desc') {
            studentStats.sort((a, b) => b.passedScenarios - a.passedScenarios);
          } else {
            studentStats.sort((a, b) => a.passedScenarios - b.passedScenarios);
          }

          return studentStats.slice(0, effectiveLimit);
        } catch (error) {
          this.logger.error('Error getting student completion stats:', error);
          throw error;
        }
      },
    },

    getOrganizationRanking: {
      rest: 'GET /organization-ranking',
      params: {
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        organizationId: {type: 'string', optional: true},
      },
      cache: {
        keys: ['time', 'fromDate', 'toDate', 'organizationId'],
        ttl: 600,
      },
      async handler(ctx) {
        const {time, fromDate, toDate, organizationId} = ctx.params;
        const user = ctx.meta.user;

        try {
          const dateFilter = this.extractQueryTime({time, fromDate, toDate});

          let targetOrgId = organizationId;
          if (!targetOrgId && user && user.organizationId) {
            targetOrgId = user.organizationId.toString();
          }

          if (!targetOrgId) {
            throw new MoleculerClientError('Organization ID is required', 400);
          }

          const targetOrg = await ctx.call('organizations.get', {id: targetOrgId});
          let allDescendants = [];
          try {
            const descendants = await ctx.call('organizations.getAllDescendants', {orgId: targetOrgId});
            allDescendants = descendants
              .filter(d => !d.isDeleted)
              .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          } catch (e) {
            // ignore
          }
          const allOrgs = targetOrg && !targetOrg.isDeleted ? [targetOrg, ...allDescendants] : allDescendants;

          const results = await Promise.all(
            allOrgs.map(async org => {
              const orgId = org._id.toString();

              // Chỉ lấy users trực tiếp thuộc đơn vị này
              const orgUsers = await ctx.call('users.find', {
                query: {organizationId: new mongoose.Types.ObjectId(orgId)},
                fields: ['_id'],
              });
              const orgUserIds = orgUsers.map(u => u._id);

              if (orgUserIds.length === 0) {
                return {
                  organizationId: orgId,
                  organizationName: org.name,
                  averageScore: 0,
                  totalStudents: orgUserIds.length,
                  totalSessions: 0,
                };
              }

              // Lấy khóa học thuộc đơn vị này
              const orgCourses = await ctx.call('courses.find', {
                query: {organizationId: new mongoose.Types.ObjectId(orgId), isDeleted: {$ne: true}},
                fields: ['_id'],
              });
              const orgCourseIds = orgCourses.map(c => c._id);

              const avgScore = await this.getAveragePlatformScore(dateFilter, orgUserIds, orgCourseIds);
              const totalSessions = await this.getTotalSessions(dateFilter, orgUserIds, orgCourseIds);

              return {
                organizationId: orgId,
                organizationName: org.name,
                averageScore: parseFloat(avgScore) || 0,
                totalStudents: orgUserIds.length,
                totalSessions,
              };
            }),
          );

          results.sort((a, b) => b.averageScore - a.averageScore);

          return results;
        } catch (error) {
          this.logger.error('Error getting organization ranking:', error);
          throw error;
        }
      },
    },

    getStudentRanking: {
      rest: 'GET /student-ranking',
      params: {
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        organizationId: {type: 'string', optional: true},
        type: {
          type: 'string',
          enum: ['all', 'unit', 'scenario', 'skillGroup'],
          default: 'all',
        },
        filterOrganizationId: {type: 'string', optional: true},
        filterScenarioId: {type: 'string', optional: true},
        filterSkillGroupId: {type: 'string', optional: true},
      },
      cache: {
        keys: [
          'time',
          'fromDate',
          'toDate',
          'organizationId',
          'type',
          'filterOrganizationId',
          'filterScenarioId',
          'filterSkillGroupId',
        ],
        ttl: 300,
      },
      async handler(ctx) {
        const {
          time,
          fromDate,
          toDate,
          organizationId,
          type,
          filterOrganizationId,
          filterScenarioId,
          filterSkillGroupId,
        } = ctx.params;
        const user = ctx.meta.user;

        try {
          const dateFilter = this.extractQueryTime({time, fromDate, toDate});

          let targetOrgId = organizationId;
          if (!targetOrgId && user && user.organizationId) {
            targetOrgId = user.organizationId.toString();
          }

          if (!targetOrgId) {
            throw new MoleculerClientError('Organization ID is required', 400);
          }

          // Lấy courseIds thuộc org scope
          const orgIds = await this.resolveOrgIds(ctx, targetOrgId);
          const orgCourses = await ctx.call('courses.find', {
            query: {organizationId: {$in: orgIds}, isDeleted: {$ne: true}},
            fields: ['_id'],
          });
          const courseIds = orgCourses.map(c => c._id);

          switch (type) {
            case 'all':
              return await this.getRankingByAllUnits(ctx, targetOrgId, dateFilter, courseIds);
            case 'unit':
              return await this.getRankingByUnit(ctx, filterOrganizationId || targetOrgId, dateFilter, courseIds);
            case 'scenario':
              return await this.getRankingByScenario(ctx, targetOrgId, dateFilter, filterScenarioId, courseIds);
            case 'skillGroup':
              return await this.getRankingBySkillGroup(ctx, targetOrgId, dateFilter, filterSkillGroupId, courseIds);
            default:
              return await this.getRankingByAllUnits(ctx, targetOrgId, dateFilter, courseIds);
          }
        } catch (error) {
          this.logger.error('Error getting organization ranking detail:', error);
          throw error;
        }
      },
    },
  },

  methods: {
    buildDateFilter(startDate, endDate) {
      const filter = {};

      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) {
          filter.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          filter.createdAt.$lte = new Date(endDate);
        }
      }

      return filter;
    },
    async getStudentCompletedCourses(studentId, dateFilter) {
      try {
        const sessions = await this.broker.call('roleplaysessions.find', {
          query: {
            studentId: new mongoose.Types.ObjectId(studentId),
            status: {$in: ['completed', 'analyzed']},
            isDeleted: {$ne: true},
            analysisId: {$exists: true},
            ...dateFilter,
          },
          populate: ['courseId', 'analysisId', 'aiScenarioId'],
        });

        const uniqueCourses = new Map();
        sessions.forEach(session => {
          if (session.courseId && this.isSessionCompleted(session)) {
            const score = session.analysisId?.result?.simulationScore;
            const courseKey = session.courseId._id.toString();
            if (!uniqueCourses.has(courseKey)) {
              uniqueCourses.set(courseKey, {
                courseId: session.courseId._id,
                courseName: session.courseId.name,
                completedAt: session.endTime || session.updatedAt,
                bestScore: score,
              });
            } else {
              // Update with better score if found
              const existing = uniqueCourses.get(courseKey);
              if (score > existing.bestScore) {
                existing.bestScore = score;
                existing.completedAt = session.endTime || session.updatedAt;
              }
            }
          }
        });

        return Array.from(uniqueCourses.values());
      } catch (error) {
        this.logger.error('Error getting student completed courses:', error);
        return [];
      }
    },

    async getStudentAverageScore(studentId, dateFilter) {
      try {
        const sessions = await this.broker.call('roleplaysessions.find', {
          query: {
            studentId: new mongoose.Types.ObjectId(studentId),
            status: {$in: ['completed', 'analyzed']},
            isDeleted: {$ne: true},
            analysisId: {$exists: true},
            ...dateFilter,
          },
          populate: ['analysisId'],
        });

        const scores = sessions
          .filter(session => session.analysisId?.result?.hasOwnProperty('simulationScore'))
          .map(session => session.analysisId.result.simulationScore || 0);

        if (scores.length === 0) return 0;

        return (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2);
      } catch (error) {
        this.logger.error('Error getting student average score:', error);
        return 0;
      }
    },

    async getStudentDetailedScores(studentId, dateFilter) {
      try {
        const sessions = await this.broker.call('roleplaysessions.find', {
          query: {
            studentId: new mongoose.Types.ObjectId(studentId),
            status: {$in: ['completed', 'analyzed']},
            isDeleted: {$ne: true},
            analysisId: {$exists: true},
            ...dateFilter,
          },
          populate: ['courseId', 'aiScenarioId', 'analysisId'],
        });

        return sessions
          .filter(session => session.analysisId?.result?.hasOwnProperty('simulationScore'))
          .map(session => ({
            sessionId: session._id,
            courseId: session.courseId?._id,
            courseName: session.courseId?.name,
            scenarioId: session.aiScenarioId?._id,
            scenarioName: session.aiScenarioId?.name,
            score: session.analysisId.result.simulationScore,
            completedAt: session.endTime || session.updatedAt,
            duration: session.duration,
            taskScores:
              session.analysisId.result.knowledgeAnalysis?.taskAnalyses?.map(task => ({
                taskId: task.taskId,
                taskName: task.taskName,
                score: task.score,
              })) || [],
          }));
      } catch (error) {
        this.logger.error('Error getting student detailed scores:', error);
        return [];
      }
    },

    async getStudentRanking(studentId, dateFilter) {
      try {
        // Get all students with their average scores
        const allSessions = await this.broker.call('roleplaysessions.find', {
          query: {
            status: {$in: ['completed', 'analyzed']},
            isDeleted: {$ne: true},
            analysisId: {$exists: true},
            ...dateFilter,
          },
          populate: ['studentId', 'analysisId'],
        });

        // Group by student and calculate averages
        const studentAverages = {};

        allSessions.forEach(session => {
          if (!session.analysisId?.result?.simulationScore || !session.studentId) return;

          const sId = session.studentId._id.toString();
          const score = session.analysisId.result.simulationScore;

          if (!studentAverages[sId]) {
            studentAverages[sId] = {
              studentId: sId,
              scores: [],
              studentName: session.studentId.name || session.studentId.email,
            };
          }

          studentAverages[sId].scores.push(score);
        });

        // Calculate averages and sort
        const rankedStudents = Object.values(studentAverages)
          .map(student => ({
            studentId: student.studentId,
            studentName: student.studentName,
            averageScore: student.scores.reduce((sum, score) => sum + score, 0) / student.scores.length,
            totalSessions: student.scores.length,
          }))
          .sort((a, b) => b.averageScore - a.averageScore);

        // Find target student's rank
        const targetStudentIndex = rankedStudents.findIndex(s => s.studentId === studentId);

        if (targetStudentIndex === -1) {
          return {rank: null, totalStudents: rankedStudents.length, percentile: null};
        }

        const rank = targetStudentIndex + 1;
        const percentile = (((rankedStudents.length - rank) / rankedStudents.length) * 100).toFixed(2);

        return {
          rank,
          totalStudents: rankedStudents.length,
          percentile,
          averageScore: rankedStudents[targetStudentIndex].averageScore.toFixed(2),
        };
      } catch (error) {
        this.logger.error('Error getting student ranking:', error);
        return {rank: null, totalStudents: 0, percentile: null};
      }
    },

    async getStudentCompletionRate(studentId, dateFilter) {
      try {
        const [totalSessions, allCompletedSessions] = await Promise.all([
          this.broker.call('roleplaysessions.find', {
            query: {
              studentId: new mongoose.Types.ObjectId(studentId),
              status: {$in: ['completed', 'analyzed']},
              isDeleted: {$ne: true},
              analysisId: {$exists: true},
              ...dateFilter,
            },
          }),
          this.broker.call('roleplaysessions.find', {
            query: {
              studentId: new mongoose.Types.ObjectId(studentId),
              status: {$in: ['completed', 'analyzed']},
              isDeleted: {$ne: true},
              analysisId: {$exists: true},
              ...dateFilter,
            },
            populate: ['analysisId', 'aiScenarioId'],
          }),
        ]);

        if (totalSessions.length === 0) return 0;

        // Count sessions with score >= passScore
        const completedSessions = allCompletedSessions.filter(session => this.isSessionCompleted(session));

        return ((completedSessions.length / totalSessions.length) * 100).toFixed(2);
      } catch (error) {
        this.logger.error('Error getting student completion rate:', error);
        return 0;
      }
    },

    async getStudentAverageCompletionTime(studentId, dateFilter) {
      try {
        const sessions = await this.broker.call('roleplaysessions.find', {
          query: {
            studentId: new mongoose.Types.ObjectId(studentId),
            status: {$in: ['completed', 'analyzed']},
            isDeleted: {$ne: true},
            duration: {$exists: true},
            ...dateFilter,
          },
        });

        const durations = sessions
          .filter(session => session.duration && session.duration > 0)
          .map(session => session.duration);

        if (durations.length === 0) return 0;

        // Return average in minutes
        return Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length / 60);
      } catch (error) {
        this.logger.error('Error getting student average completion time:', error);
        return 0;
      }
    },

    async getStudentBestWorstCourses(studentId, dateFilter) {
      try {
        const sessions = await this.broker.call('roleplaysessions.find', {
          query: {
            studentId: new mongoose.Types.ObjectId(studentId),
            status: {$in: ['completed', 'analyzed']},
            isDeleted: {$ne: true},
            analysisId: {$exists: true},
            ...dateFilter,
          },
          populate: ['courseId', 'analysisId'],
        });

        // Group by course and calculate averages
        const courseScores = {};

        sessions.forEach(session => {
          if (!session.analysisId?.result?.hasOwnProperty('simulationScore') || !session.courseId) return;

          const courseId = session.courseId._id.toString();
          const score = session.analysisId.result.simulationScore || 0;

          if (!courseScores[courseId]) {
            courseScores[courseId] = {
              courseId: courseId,
              courseName: session.courseId.name,
              scores: [],
            };
          }

          courseScores[courseId].scores.push(score);
        });

        // Calculate averages
        const courseAverages = Object.values(courseScores)
          .map(course => ({
            courseId: course.courseId,
            courseName: course.courseName,
            averageScore: course.scores.reduce((sum, score) => sum + score, 0) / course.scores.length,
            totalSessions: course.scores.length,
          }))
          .sort((a, b) => b.averageScore - a.averageScore);

        return {
          best: courseAverages.length > 0 ? courseAverages[0] : null,
          worst: courseAverages.length > 0 ? courseAverages[courseAverages.length - 1] : null,
        };
      } catch (error) {
        this.logger.error('Error getting student best/worst courses:', error);
        return {best: null, worst: null};
      }
    },

    async getCourseCompletionStatistics(ctx, orgIds = null, userIds = null) {
      try {
        const query = {isDeleted: {$ne: true}};
        if (orgIds) {
          query.organizationId = {$in: orgIds};
        }
        const courses = await this.broker.call('courses.find', {
          query,
          fields: ['_id', 'publishedToUsers'],
        });

        if (courses.length === 0) {
          return {
            totalCourses: 0,
            totalStudents: 0,
            completedCourses: 0,
            inProgressCourses: 0,
            notStartedCourses: 0,
            completionRate: 0,
          };
        }

        const courseIds = courses.map(c => c._id);

        const userIdSet = userIds ? new Set(userIds.map(id => id.toString())) : null;

        const sessionQuery = {courseId: {$in: courseIds}, isDeleted: {$ne: true}};
        if (userIds) {
          sessionQuery.studentId = {$in: userIds.map(id => id.toString())};
        }

        const [allScenarios, aggregatedResult, allSessions] = await Promise.all([
          ctx.call('aiscenarios.find', {
            query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}},
            fields: ['_id', 'courseId', 'passScore'],
          }),
          ctx.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: courseIds.map(id => id.toString()),
          }),
          ctx.call('roleplaysessions.find', {
            query: sessionQuery,
            fields: ['studentId', 'courseId'],
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

        const bestScoresByCourse = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const cid = agg.courseId?.toString();
          const sid = agg.studentId?.toString();
          const scid = agg.aiScenarioId?.toString();
          if (!cid || !sid || !scid) return;
          if (userIdSet && !userIdSet.has(sid)) return;
          if (!bestScoresByCourse[cid]) bestScoresByCourse[cid] = {};
          if (!bestScoresByCourse[cid][sid]) bestScoresByCourse[cid][sid] = {};
          bestScoresByCourse[cid][sid][scid] = agg.bestScore;
        });

        const startedStudentsByCourse = {};
        allSessions.forEach(session => {
          const cid = session.courseId?._id ? session.courseId._id.toString() : session.courseId?.toString();
          const sid = session.studentId?._id ? session.studentId._id.toString() : session.studentId?.toString();
          if (cid && sid) {
            if (!startedStudentsByCourse[cid]) startedStudentsByCourse[cid] = new Set();
            startedStudentsByCourse[cid].add(sid);
          }
        });

        let completedCourses = 0;
        let inProgressCourses = 0;
        let notStartedCourses = 0;
        const allUniqueStudents = new Set();

        for (const course of courses) {
          const courseId = course._id.toString();
          const courseScenarios = scenariosByCourse[courseId] || [];

          const publishedUsers = course.publishedToUsers || [];
          const validUserIds = [];
          publishedUsers.forEach(entry => {
            const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
            if (uid && (!userIdSet || userIdSet.has(uid))) {
              validUserIds.push(uid);
              allUniqueStudents.add(uid);
            }
          });

          if (validUserIds.length === 0 || courseScenarios.length === 0) {
            notStartedCourses++;
            continue;
          }

          const scenarioPassScores = {};
          courseScenarios.forEach(s => {
            scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
          });

          const startedSet = startedStudentsByCourse[courseId] || new Set();
          const courseBestScores = bestScoresByCourse[courseId] || {};

          const hasAnyStarted = validUserIds.some(uid => startedSet.has(uid));

          if (!hasAnyStarted) {
            notStartedCourses++;
            continue;
          }

          // completedCourses: tất cả học viên được assign đều pass hết tất cả scenario
          let allCompleted = true;
          for (const uid of validUserIds) {
            const studentScores = courseBestScores[uid] || {};
            for (const scenarioId in scenarioPassScores) {
              if ((studentScores[scenarioId] ?? -1) < scenarioPassScores[scenarioId]) {
                allCompleted = false;
                break;
              }
            }
            if (!allCompleted) break;
          }

          if (allCompleted) {
            completedCourses++;
          } else {
            inProgressCourses++;
          }
        }

        const totalCourses = courses.length;
        return {
          totalCourses,
          totalStudents: allUniqueStudents.size,
          completedCourses,
          inProgressCourses,
          notStartedCourses,
          completionRate: totalCourses > 0 ? parseFloat(((completedCourses / totalCourses) * 100).toFixed(2)) : 0,
        };
      } catch (error) {
        this.logger.error('Error getting course completion statistics:', error);
        return {
          totalCourses: 0,
          totalStudents: 0,
          completedCourses: 0,
          inProgressCourses: 0,
          notStartedCourses: 0,
          completionRate: 0,
        };
      }
    },

    async getTotalActiveStudents(dateFilter, userIds = null, courseIds = null) {
      try {
        const matchStage = {
          isDeleted: {$ne: true},
          ...dateFilter,
        };

        if (userIds) {
          matchStage.studentId = {$in: userIds.map(id => new mongoose.Types.ObjectId(id))};
        }
        if (courseIds && courseIds.length > 0) {
          matchStage.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
        }

        const result = await this.broker.call('roleplaysessions.aggregate', {
          pipeline: [{$match: matchStage}, {$group: {_id: '$studentId'}}, {$count: 'count'}],
        });

        return result[0]?.count || 0;
      } catch (error) {
        this.logger.error('Error getting total active students:', error);
        return 0;
      }
    },

    /**
     * Get total number of sessions
     */
    async getTotalSessions(dateFilter, userIds = null, courseIds = null) {
      try {
        const query = {
          isDeleted: {$ne: true},
          ...dateFilter,
        };

        if (userIds) {
          query.studentId = {$in: userIds.map(id => new mongoose.Types.ObjectId(id))};
        }
        if (courseIds && courseIds.length > 0) {
          query.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
        }
        return await this.broker.call('roleplaysessions.count', {query});
      } catch (error) {
        this.logger.error('Error getting total sessions:', error);
        return 0;
      }
    },

    /**
     * Get total number of completed sessions
     */
    async getTotalCompletedSessions(dateFilter, userIds = null, courseIds = null) {
      try {
        const matchStage = {
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          ...dateFilter,
        };

        if (userIds) {
          matchStage.studentId = {$in: userIds.map(id => new mongoose.Types.ObjectId(id))};
        }
        if (courseIds && courseIds.length > 0) {
          matchStage.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
        }

        const pipeline = [
          {$match: matchStage},
          {
            $lookup: {
              from: 'RolePlayAnalysis',
              localField: 'analysisId',
              foreignField: '_id',
              as: 'analysis',
            },
          },
          {$unwind: '$analysis'},
          {
            $lookup: {
              from: 'RoleplayAIScenarios',
              localField: 'aiScenarioId',
              foreignField: '_id',
              as: 'scenario',
            },
          },
          {
            $unwind: {
              path: '$scenario',
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $addFields: {
              score: '$analysis.result.simulationScore',
              requiredScore: {$ifNull: ['$scenario.passScore', 70]},
            },
          },
          {
            $match: {
              $expr: {$gte: ['$score', '$requiredScore']},
            },
          },
          {
            $count: 'count',
          },
        ];

        const result = await this.broker.call('roleplaysessions.aggregate', {pipeline});

        return result[0]?.count || 0;
      } catch (error) {
        this.logger.error('Error getting total completed sessions:', error);
        return 0;
      }
    },

    /**
     * Get average platform score
     */
    async getAveragePlatformScore(dateFilter, userIds = null, courseIds = null) {
      try {
        const matchStage = {
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          ...dateFilter,
        };

        if (userIds) {
          matchStage.studentId = {$in: userIds.map(id => new mongoose.Types.ObjectId(id))};
        }
        if (courseIds && courseIds.length > 0) {
          matchStage.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
        }

        const result = await this.broker.call('roleplaysessions.aggregate', {
          pipeline: [
            {$match: matchStage},
            {
              $lookup: {
                from: 'RolePlayAnalysis',
                localField: 'analysisId',
                foreignField: '_id',
                as: 'analysis',
              },
            },
            {$unwind: '$analysis'},
            {
              $group: {
                _id: null,
                averageScore: {$avg: '$analysis.result.simulationScore'},
              },
            },
          ],
        });

        return result[0]?.averageScore ? result[0].averageScore.toFixed(2) : 0;
      } catch (error) {
        this.logger.error('Error getting average platform score:', error);
        return 0;
      }
    },

    /**
     * Get most popular courses by enrollment
     */
    async getMostPopularCourses(limit = 5, dateFilter, userIds = null, courseIds = null) {
      try {
        const matchStage = {
          isDeleted: {$ne: true},
          ...dateFilter,
        };

        if (userIds) {
          matchStage.studentId = {$in: userIds.map(id => new mongoose.Types.ObjectId(id))};
        }
        if (courseIds && courseIds.length > 0) {
          matchStage.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
        }
        const pipeline = [
          {$match: matchStage},
          {
            $group: {
              _id: {courseId: '$courseId', studentId: '$studentId'},
              sessionsCount: {$sum: 1},
            },
          },
          {
            $group: {
              _id: '$_id.courseId',
              uniqueEnrollments: {$sum: 1},
              totalSessions: {$sum: '$sessionsCount'},
            },
          },
          {$sort: {uniqueEnrollments: -1}},
          {$limit: limit},
          {
            $lookup: {
              from: 'RoleplayCourses',
              localField: '_id',
              foreignField: '_id',
              as: 'course',
            },
          },
          {$unwind: '$course'},
          {
            $project: {
              courseId: '$_id',
              courseName: '$course.name',
              uniqueEnrollments: 1,
              totalSessions: 1,
              _id: 0,
            },
          },
        ];

        return await this.broker.call('roleplaysessions.aggregate', {pipeline});
      } catch (error) {
        this.logger.error('Error getting most popular courses:', error);
        return [];
      }
    },

    /**
     * Get top performing students across platform
     */
    async getTopPerformingStudents(limit = 10, dateFilter, userIds = null, courseIds = null) {
      try {
        const matchStage = {
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          ...dateFilter,
        };

        if (userIds) {
          matchStage.studentId = {$in: userIds.map(id => new mongoose.Types.ObjectId(id))};
        }
        if (courseIds && courseIds.length > 0) {
          matchStage.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
        }

        const pipeline = [
          {$match: matchStage},
          {
            $lookup: {
              from: 'RolePlayAnalysis',
              localField: 'analysisId',
              foreignField: '_id',
              as: 'analysis',
            },
          },
          {$unwind: '$analysis'},
          {
            $group: {
              _id: '$studentId',
              averageScore: {$avg: '$analysis.result.simulationScore'},
              highestScore: {$max: '$analysis.result.simulationScore'},
              totalSessions: {$sum: 1},
            },
          },
          {$match: {totalSessions: {$gte: 3}}},
          {$sort: {averageScore: -1}},
          {$limit: limit},
          {
            $lookup: {
              from: 'User',
              localField: '_id',
              foreignField: '_id',
              as: 'student',
            },
          },
          {$unwind: '$student'},
          {
            $project: {
              studentId: '$_id',
              studentName: {$ifNull: ['$student.name', '$student.email']},
              averageScore: 1,
              totalSessions: 1,
              highestScore: 1,
              _id: 0,
            },
          },
        ];

        const result = await this.broker.call('roleplaysessions.aggregate', {pipeline});

        return result.map(student => ({
          ...student,
          averageScore: parseFloat(student.averageScore).toFixed(2),
        }));
      } catch (error) {
        this.logger.error('Error getting top performing students:', error);
        return [];
      }
    },

    async getTopWeakStudents(limit = 10, dateFilter, userIds = null, courseIds = null) {
      try {
        const matchStage = {
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          ...dateFilter,
        };

        if (userIds) {
          matchStage.studentId = {
            $in: userIds.map(id => new mongoose.Types.ObjectId(id)),
          };
        }
        if (courseIds && courseIds.length > 0) {
          matchStage.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
        }

        const pipeline = [
          {$match: matchStage},

          {
            $lookup: {
              from: 'RolePlayAnalysis',
              localField: 'analysisId',
              foreignField: '_id',
              as: 'analysis',
            },
          },

          {$unwind: '$analysis'},

          {
            $group: {
              _id: '$studentId',
              averageScore: {$avg: '$analysis.result.simulationScore'},
              highestScore: {$max: '$analysis.result.simulationScore'},
              totalSessions: {$sum: 1},
            },
          },

          {
            $match: {
              totalSessions: {$gte: 3},
              averageScore: {$lt: 50},
            },
          },

          {$sort: {averageScore: 1}},

          {$limit: limit},

          {
            $lookup: {
              from: 'User',
              localField: '_id',
              foreignField: '_id',
              as: 'student',
            },
          },

          {$unwind: '$student'},

          {
            $project: {
              studentId: '$_id',
              studentName: {$ifNull: ['$student.name', '$student.email']},
              averageScore: 1,
              highestScore: 1,
              totalSessions: 1,
              _id: 0,
            },
          },
        ];

        const result = await this.broker.call('roleplaysessions.aggregate', {pipeline});

        return result.map(student => ({
          ...student,
          averageScore: Number(student.averageScore.toFixed(2)),
        }));
      } catch (error) {
        this.logger.error('Error getting weak students:', error);
        return [];
      }
    },

    async getPersonalCourseCompletionChart(ctx, userId, scenarioFilter, courseFilter = {}) {
      try {
        const userIdStr = userId.toString();

        const courseQuery = {
          isDeleted: {$ne: true},
          isActive: true,
          status: {$in: ['published', 'archived']},
          'publishedToUsers.userId': new mongoose.Types.ObjectId(userIdStr),
        };
        if (courseFilter.courseCategoryId) {
          courseQuery.courseCategoryId = courseFilter.courseCategoryId;
        }
        const allCourses = await ctx.call('courses.find', {
          query: courseQuery,
          fields: ['_id', 'name', 'publishedToUsers'],
        });
        if (allCourses.length === 0) {
          return {
            totalCourses: 0,
            completed: 0,
            inProgress: 0,
            notStarted: 0,
            completionRate: 0,
          };
        }

        const courseIds = allCourses.map(c => c._id);

        const scenarioQuery = {courseId: {$in: courseIds}, isDeleted: {$ne: true}};
        if (scenarioFilter.scenarioCategoryId) {
          scenarioQuery.scenarioCategoryId = scenarioFilter.scenarioCategoryId;
        }

        const [allScenarios, aggregatedResult, allSessions] = await Promise.all([
          ctx.call('aiscenarios.find', {
            query: scenarioQuery,
            fields: ['_id', 'courseId', 'passScore'],
          }),
          ctx.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: courseIds.map(id => id.toString()),
          }),
          ctx.call('roleplaysessions.find', {
            query: {
              courseId: {$in: courseIds},
              studentId: new mongoose.Types.ObjectId(userIdStr),
              isDeleted: false,
            },
            fields: ['courseId'],
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

        const bestScoresByCourse = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const sid = agg.studentId?.toString();
          if (sid !== userIdStr) return;
          const cid = agg.courseId?.toString();
          const scid = agg.aiScenarioId?.toString();
          if (!cid || !scid) return;
          if (!bestScoresByCourse[cid]) bestScoresByCourse[cid] = {};
          bestScoresByCourse[cid][scid] = agg.bestScore;
        });

        const startedCourses = new Set();
        allSessions.forEach(session => {
          const cid = session.courseId?._id ? session.courseId._id.toString() : session.courseId?.toString();
          if (cid) startedCourses.add(cid);
        });

        let completed = 0;
        let inProgress = 0;
        let notStarted = 0;

        for (const course of allCourses) {
          const courseId = course._id.toString();
          const courseScenarios = scenariosByCourse[courseId] || [];

          if (courseScenarios.length === 0) {
            notStarted++;
            continue;
          }

          if (!startedCourses.has(courseId)) {
            notStarted++;
            continue;
          }

          const studentScores = bestScoresByCourse[courseId] || {};
          let passedAll = true;

          for (const scenario of courseScenarios) {
            const scenarioId = scenario._id.toString();
            const passScore = scenario.passScore ?? 70;
            if ((studentScores[scenarioId] ?? -1) < passScore) {
              passedAll = false;
              break;
            }
          }

          if (passedAll) {
            completed++;
          } else {
            inProgress++;
          }
        }

        const totalCourses = allCourses.length;
        const completionRate = totalCourses > 0 ? parseFloat(((completed / totalCourses) * 100).toFixed(2)) : 0;

        return {
          totalCourses,
          completed,
          inProgress,
          notStarted,
          completionRate,
        };
      } catch (error) {
        this.logger.error('Error getting personal course completion chart:', error);
        return {
          totalCourses: 0,
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          completionRate: 0,
        };
      }
    },

    async getPersonalScenarioPassRateChart(ctx, userId, scenarioFilter, courseFilter = {}) {
      try {
        const userIdStr = userId.toString();

        // Lấy tất cả courses mà user được publish
        const courseQuery = {
          isDeleted: {$ne: true},
          isActive: true,
          status: {$in: ['published', 'archived']},
          'publishedToUsers.userId': new mongoose.Types.ObjectId(userIdStr),
        };
        if (courseFilter.courseCategoryId) {
          courseQuery.courseCategoryId = courseFilter.courseCategoryId;
        }

        const allCourses = await ctx.call('courses.find', {
          query: courseQuery,
          fields: ['_id'],
        });

        if (allCourses.length === 0) {
          return {
            totalScenarios: 0,
            passed: 0,
            failed: 0,
            notStarted: 0,
            passRate: 0,
          };
        }

        const courseIds = allCourses.map(c => c._id);

        const scenarioQuery = {courseId: {$in: courseIds}, isDeleted: {$ne: true}};
        if (scenarioFilter.scenarioCategoryId) {
          scenarioQuery.scenarioCategoryId = scenarioFilter.scenarioCategoryId;
        }

        const [allScenarios, aggregatedResult, allSessions] = await Promise.all([
          ctx.call('aiscenarios.find', {
            query: scenarioQuery,
            fields: ['_id', 'courseId', 'passScore'],
          }),
          ctx.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: courseIds.map(id => id.toString()),
          }),
          ctx.call('roleplaysessions.find', {
            query: {
              courseId: {$in: courseIds},
              studentId: new mongoose.Types.ObjectId(userIdStr),
              isDeleted: false,
            },
            fields: ['aiScenarioId'],
          }),
        ]);

        if (allScenarios.length === 0) {
          return {
            totalScenarios: 0,
            passed: 0,
            failed: 0,
            notStarted: 0,
            passRate: 0,
          };
        }

        const bestScoreByScenario = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const sid = agg.studentId?.toString();
          if (sid !== userIdStr) return;
          const scid = agg.aiScenarioId?.toString();
          if (!scid) return;
          bestScoreByScenario[scid] = agg.bestScore;
        });

        const attemptedScenarios = new Set();
        allSessions.forEach(session => {
          const scid = session.aiScenarioId?._id
            ? session.aiScenarioId._id.toString()
            : session.aiScenarioId?.toString();
          if (scid) attemptedScenarios.add(scid);
        });

        let passed = 0;
        let failed = 0;
        let notStarted = 0;

        for (const scenario of allScenarios) {
          const scenarioId = scenario._id.toString();
          const passScore = scenario.passScore ?? 70;

          if (!attemptedScenarios.has(scenarioId)) {
            notStarted++;
          } else if ((bestScoreByScenario[scenarioId] ?? -1) >= passScore) {
            passed++;
          } else {
            failed++;
          }
        }

        const totalScenarios = allScenarios.length;
        const passRate = totalScenarios > 0 ? parseFloat(((passed / totalScenarios) * 100).toFixed(2)) : 0;

        return {
          totalScenarios,
          passed,
          failed,
          notStarted,
          passRate,
        };
      } catch (error) {
        this.logger.error('Error getting personal scenario pass rate chart:', error);
        return {
          totalScenarios: 0,
          passed: 0,
          failed: 0,
          notStarted: 0,
          passRate: 0,
        };
      }
    },

    async getPersonalSummaryStats(userId, dateFilter, scenarioFilter, courseFilter = {}) {
      try {
        // Build query filter
        const baseQuery = {
          studentId: new mongoose.Types.ObjectId(userId),
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          ...dateFilter,
        };

        // Nếu có courseFilter, lấy courseIds phù hợp
        if (courseFilter.courseCategoryId) {
          const courses = await this.broker.call('courses.find', {
            query: {
              isDeleted: {$ne: true},
              'publishedToUsers.userId': new mongoose.Types.ObjectId(userId),
              courseCategoryId: courseFilter.courseCategoryId,
            },
            fields: ['_id'],
          });
          const courseIds = courses.map(c => c._id);
          if (courseIds.length === 0) {
            return {
              totalSessions: 0,
              completedScenarios: 0,
              passedSessions: 0,
              averageScore: 0,
              bestSkill: null,
            };
          }
          baseQuery.courseId = {$in: courseIds};
        }

        const sessions = await this.broker.call('roleplaysessions.find', {
          query: baseQuery,
          populate: ['aiScenarioId', 'analysisId'],
        });

        let filteredSessions = sessions;
        if (scenarioFilter.scenarioCategoryId) {
          filteredSessions = sessions.filter(
            session =>
              session.aiScenarioId?.scenarioCategoryId &&
              session.aiScenarioId.scenarioCategoryId.toString() === scenarioFilter.scenarioCategoryId,
          );
        }

        const totalSessions = filteredSessions.length;

        // Lấy tất cả unique scenario IDs từ sessions để fetch passScore
        const scenarioIds = new Set();
        filteredSessions.forEach(session => {
          if (session.aiScenarioId) {
            const scenarioId = session.aiScenarioId._id
              ? session.aiScenarioId._id.toString()
              : session.aiScenarioId.toString();
            scenarioIds.add(scenarioId);
          }
        });

        // Fetch scenarios để lấy passScore
        const scenarioPassScores = new Map();
        if (scenarioIds.size > 0) {
          const scenarios = await this.broker.call('aiscenarios.find', {
            query: {
              _id: {$in: Array.from(scenarioIds).map(id => new mongoose.Types.ObjectId(id))},
              isDeleted: {$ne: true},
            },
            fields: ['_id', 'passScore'],
          });

          scenarios.forEach(scenario => {
            scenarioPassScores.set(scenario._id.toString(), scenario.passScore || 70);
          });
        }

        const completedScenarios = new Set();
        const allScores = [];
        const skillScores = {};
        let passedSessions = 0;

        filteredSessions.forEach(session => {
          if (!session.analysisId) return;

          const score = session.analysisId.result?.simulationScore;
          if (score !== undefined) {
            allScores.push(score);

            if (session.aiScenarioId) {
              const scenarioId = session.aiScenarioId._id
                ? session.aiScenarioId._id.toString()
                : session.aiScenarioId.toString();
              const requiredScore = scenarioPassScores.get(scenarioId) || 70;

              if (score >= requiredScore) {
                completedScenarios.add(scenarioId);
                passedSessions++;
              }
            }

            const skillAnalyses = session.analysisId.result?.knowledgeAnalysis?.skillAnalyses || [];
            skillAnalyses.forEach(skillAnalysis => {
              if (skillAnalysis.skillId && skillAnalysis.score !== undefined) {
                const skillId = skillAnalysis.skillId.toString();
                if (!skillScores[skillId]) {
                  skillScores[skillId] = {
                    skillName: skillAnalysis.skillName,
                    scores: [],
                  };
                }
                skillScores[skillId].scores.push(skillAnalysis.score);
              }
            });
          }
        });

        const averageScore =
          allScores.length > 0 ? (allScores.reduce((sum, score) => sum + score, 0) / allScores.length).toFixed(2) : 0;

        let bestSkill = null;
        let highestAvg = 0;

        Object.entries(skillScores).forEach(([skillId, data]) => {
          const avg = data.scores.reduce((sum, score) => sum + score, 0) / data.scores.length;
          if (avg > highestAvg) {
            highestAvg = avg;
            bestSkill = {
              skillId,
              skillName: data.skillName,
              averageScore: avg.toFixed(2),
            };
          }
        });

        return {
          totalSessions,
          completedScenarios: completedScenarios.size,
          passedSessions,
          averageScore: parseFloat(averageScore),
          bestSkill,
        };
      } catch (error) {
        this.logger.error('Error getting personal summary stats:', error);
        return {
          totalSessions: 0,
          completedScenarios: 0,
          passedSessions: 0,
          averageScore: 0,
          bestSkill: null,
        };
      }
    },

    toDateKey(date) {
      return new Date(date).toISOString().split('T')[0];
    },

    getDateKeysFromFilter(dateFilter, grouping = 'day') {
      const gte = dateFilter?.createdAt?.$gte;
      const lte = dateFilter?.createdAt?.$lte;

      if (!gte || !lte) return [];

      const TIMEZONE_OFFSET_MS = 7 * 60 * 60 * 1000;

      const extractDateString = dateInput => {
        let d = new Date(dateInput);
        d = new Date(d.getTime() + TIMEZONE_OFFSET_MS);
        return d.toISOString().split('T')[0];
      };

      const startStr = extractDateString(gte);
      const endStr = extractDateString(lte);

      const startParts = startStr.split('-').map(Number);
      const endParts = endStr.split('-').map(Number);

      const start = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
      let end = new Date(Date.UTC(endParts[0], endParts[1] - 1, endParts[2]));

      const cursor = new Date(start);

      const getStartOfWeek = d => {
        const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const day = date.getUTCDay(); // 0 = Sunday
        date.setUTCDate(date.getUTCDate() - day);
        return date;
      };

      const getStartOfMonth = d => {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      };

      const formatDate = d => d.toISOString().split('T')[0];

      const getPeriodStart = d => {
        if (grouping === 'month') return getStartOfMonth(d);
        if (grouping === 'week') return getStartOfWeek(d);
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      };

      const keys = new Set();
      while (cursor <= end) {
        const periodStart = getPeriodStart(cursor);
        keys.add(formatDate(periodStart));

        if (grouping === 'month') {
          cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        } else if (grouping === 'week') {
          cursor.setUTCDate(cursor.getUTCDate() + 7);
        } else {
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }

      if (grouping !== 'day') {
        keys.add(formatDate(end));
      }

      return Array.from(keys).sort();
    },

    determineTimeGrouping(startDate, endDate) {
      if (!startDate || !endDate) return 'day';
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffTime = Math.abs(end - start);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 32) return 'day';
      if (diffDays <= 180) return 'week';
      return 'month';
    },

    getMongoDateFormat(grouping) {
      switch (grouping) {
        case 'month':
          return '%Y-%m';
        case 'week':
          return '%Y-%U';
        default:
          return '%Y-%m-%d';
      }
    },

    getStartEndDatesFromFilter(dateFilter) {
      const gte = dateFilter?.createdAt?.$gte;
      const lte = dateFilter?.createdAt?.$lte;
      return {
        startDate: gte ? new Date(gte) : null,
        endDate: lte ? new Date(lte) : null,
      };
    },

    async getSkillsByGroupCumulative(ctx, userId, skillGroupId, dateFilter, scenarioFilter, courseFilter = {}) {
      try {
        // Luôn dùng grouping 'day' và chỉ trả về những ngày có dữ liệu
        const groupFormat = '%Y-%m-%d';

        const skillsQuery = {isDeleted: {$ne: true}};
        if (skillGroupId) {
          skillsQuery.skillGroupId = skillGroupId;
        }
        const skills = await ctx.call('skills.find', {
          query: skillsQuery,
          populate: ['skillGroupId'],
        });
        const skillIds = skills.map(s => s._id.toString());
        const skillsMap = {};
        skills.forEach(s => (skillsMap[s._id.toString()] = s));

        if (skillIds.length === 0) return [];

        let scenarioIds = [];
        if (scenarioFilter && scenarioFilter.scenarioCategoryId) {
          const scenarios = await ctx.call('aiscenarios.find', {
            query: {scenarioCategoryId: scenarioFilter.scenarioCategoryId, isDeleted: {$ne: true}},
            fields: ['_id'],
          });
          scenarioIds = scenarios.map(s => s._id.toString());
          if (scenarioIds.length === 0) return [];
        }

        const aggregatedData = await ctx.call('roleplaysessions.aggregateSkillStats', {
          studentId: userId.toString(),
          query: dateFilter,
          skillIds: skillIds,
          scenarioIds: scenarioIds.length > 0 ? scenarioIds : undefined,
          groupFormat: groupFormat,
        });

        return aggregatedData
          .map(item => {
            const skillId = item._id?.toString ? item._id.toString() : item._id;
            const skillName = skillsMap[skillId]?.name || 'Unknown Skill';

            const scoresMap = {};
            if (item.dailyScores) {
              item.dailyScores.forEach(d => {
                scoresMap[d.dateKey] = {sum: d.sum, count: d.count};
              });
            }

            // Lấy chỉ những ngày có dữ liệu và sort theo thời gian
            const datesWithData = Object.keys(scoresMap).sort();

            let cumulativeSum = 0;
            let cumulativeCount = 0;

            const dataPoints = datesWithData.map(date => {
              const day = scoresMap[date];
              cumulativeSum += day.sum;
              cumulativeCount += day.count;

              return {
                date,
                score: parseFloat((cumulativeSum / cumulativeCount).toFixed(2)),
              };
            });

            return {
              skillId,
              skillName,
              skillGroupId:
                skillsMap[skillId]?.skillGroupId?._id?.toString() ||
                skillsMap[skillId]?.skillGroupId?.toString() ||
                null,
              skillGroupName: skillsMap[skillId]?.skillGroupId?.name || null,
              averageScore: cumulativeCount > 0 ? (cumulativeSum / cumulativeCount).toFixed(2) : '0.00',
              totalAttempts: cumulativeCount,
              dataPoints,
            };
          })
          .filter(s => s.totalAttempts > 0)
          .sort((a, b) => parseFloat(b.averageScore) - parseFloat(a.averageScore));
      } catch (error) {
        this.logger.error('Error getting top skills by group:', error);
        return [];
      }
    },

    async getTopSkillsByGroup(ctx, userId, skillGroupId, limit = 5, dateFilter, scenarioFilter, courseFilter = {}) {
      const skills = await this.getSkillsByGroupCumulative(
        ctx,
        userId,
        skillGroupId,
        dateFilter,
        scenarioFilter,
        courseFilter,
      );
      return skills.slice(0, limit);
    },

    async getLatestCumulativeSnapshot(ctx, userId, skillGroupId) {
      try {
        const query = {
          userId: userId.toString(),
          isDeleted: false,
        };

        // Lookup skills by skillGroupId to get skillIds
        if (skillGroupId) {
          const skills = await ctx.call('skills.getSkills', {
            skillGroupId: skillGroupId,
            isDeleted: {$ne: true},
          });
          const skillIds = skills.map(s => s._id.toString());
          if (skillIds.length === 0) return [];
          query.skillId = {$in: skillIds};
        }

        const userSkillScores = await ctx.call('userskillscores.find', {
          query,
          sort: '-averageScore',
          populate: ['skillId'],
        });

        // Batch lookup skillGroups từ populated skillId
        const skillGroupIds = new Set();
        userSkillScores.forEach(record => {
          const sgId = record.skillId?.skillGroupId;
          if (sgId) {
            const id = sgId._id ? sgId._id.toString() : sgId.toString();
            skillGroupIds.add(id);
          }
        });

        const skillGroupMap = {};
        if (skillGroupIds.size > 0) {
          const skillGroups = await ctx.call('skillgroups.find', {
            query: {_id: {$in: Array.from(skillGroupIds).map(id => new mongoose.Types.ObjectId(id))}},
          });
          skillGroups.forEach(sg => {
            skillGroupMap[sg._id.toString()] = sg.name;
          });
        }
        return userSkillScores.map(record => {
          const sgId = record.skillId?.skillGroupId;
          const sgIdStr = sgId?._id ? sgId._id.toString() : sgId?.toString() || null;

          return {
            skillId: record.skillId?._id?.toString() || record.skillId?.toString(),
            skillName: record.skillId?.name || record.skillName,
            skillGroupId: sgIdStr,
            skillGroupName: skillGroupMap[sgIdStr] || null,
            averageScore: record.averageScore?.toFixed?.(2) || record.averageScore,
            totalAttempts: record.sessionCount,
            lastScore: record.lastScore,
            highestScore: record.highestScore,
            lowestScore: record.lowestScore,
            lastSessionDate: record.lastSessionDate,
          };
        });
      } catch (error) {
        this.logger.error('Error getting cumulative snapshot:', error);
        return [];
      }
    },

    async getPracticeHistoryByScenario(userId, dateFilter, scenarioFilter, courseFilter = {}) {
      try {
        const baseQuery = {
          studentId: new mongoose.Types.ObjectId(userId),
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          aiScenarioId: {$exists: true},
          ...dateFilter,
        };

        const sessions = await this.broker.call('roleplaysessions.find', {
          query: baseQuery,
          populate: ['aiScenarioId', 'analysisId', 'courseId'],
          sort: '-createdAt',
        });

        const scenarioCategoryIds = new Set();
        sessions.forEach(session => {
          const catId = session.aiScenarioId?.scenarioCategoryId;
          if (catId) {
            const id = catId._id ? catId._id.toString() : catId.toString();
            scenarioCategoryIds.add(id);
          }
        });

        const categoryMap = {};
        if (scenarioCategoryIds.size > 0) {
          const categories = await this.broker.call('scenariocategories.find', {
            query: {
              _id: {$in: Array.from(scenarioCategoryIds).map(id => new mongoose.Types.ObjectId(id))},
            },
          });
          categories.forEach(cat => {
            categoryMap[cat._id.toString()] = cat.name;
          });
        }

        let filteredSessions = sessions;
        if (scenarioFilter.scenarioCategoryId) {
          filteredSessions = filteredSessions.filter(
            session =>
              session.aiScenarioId?.scenarioCategoryId &&
              session.aiScenarioId.scenarioCategoryId.toString() === scenarioFilter.scenarioCategoryId,
          );
        }
        if (courseFilter.courseCategoryId) {
          filteredSessions = filteredSessions.filter(
            session =>
              session.courseId?.courseCategoryId &&
              session.courseId.courseCategoryId.toString() === courseFilter.courseCategoryId,
          );
        }

        const scenarioGroups = {};

        filteredSessions.forEach(session => {
          if (!session.aiScenarioId || !session.analysisId) return;

          const scenarioId = session.aiScenarioId._id.toString();
          const score = session.analysisId.result?.simulationScore;

          if (score === undefined) return;

          if (!scenarioGroups[scenarioId]) {
            const catId = session.aiScenarioId.scenarioCategoryId;
            const catIdStr = catId?._id ? catId._id.toString() : catId?.toString();

            scenarioGroups[scenarioId] = {
              scenarioId,
              scenarioName: session.aiScenarioId.name,
              scenarioCategoryId: catIdStr || null,
              scenarioCategoryName: categoryMap[catIdStr] || null,
              courseName: session.courseId?.name,
              courseId: session.courseId?._id,
              passScore: session.aiScenarioId.passScore ?? 70,
              attempts: 0,
              highestScore: 0,
              sessions: [],
            };
          }

          scenarioGroups[scenarioId].attempts++;
          scenarioGroups[scenarioId].highestScore = Math.max(scenarioGroups[scenarioId].highestScore, score);

          const passScore = scenarioGroups[scenarioId].passScore;
          scenarioGroups[scenarioId].sessions.push({
            sessionId: session._id,
            courseId: session.courseId._id,
            score: score,
            completedAt: session.endTime || session.updatedAt,
            duration: session.duration,
            status: score >= passScore ? 'passed' : 'failed',
          });
        });

        return Object.values(scenarioGroups)
          .map(group => ({
            ...group,
            isPassed: group.highestScore >= group.passScore,
            sessions: group.sessions.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)),
            lastPracticed: group.sessions.length > 0 ? group.sessions[0].completedAt : null,
          }))
          .sort((a, b) => new Date(b.lastPracticed) - new Date(a.lastPracticed));
      } catch (error) {
        this.logger.error('Error getting practice history by scenario:', error);
        return [];
      }
    },

    async getOrganizationOverview(ctx, userIds, dateFilter, skillGroupId, organizationIds) {
      try {
        const query = {
          studentId: {$in: userIds.map(id => new mongoose.Types.ObjectId(id))},
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          ...dateFilter,
        };

        const skillsQuery = {status: 'active', isDeleted: false, organizationId: {$in: organizationIds}};
        if (skillGroupId) {
          skillsQuery.skillGroupId = skillGroupId;
        }
        const allSkillsFromDb = await ctx.call('skills.getSkills', skillsQuery);
        const validSkillIds = new Set(allSkillsFromDb.map(s => s._id.toString()));
        const totalSkillsInDb = allSkillsFromDb.length;

        const sessions = await ctx.call('roleplaysessions.find', {
          query,
          populate: ['analysisId'],
        });

        const uniqueStudents = new Set(sessions.map(s => s.studentId.toString()));

        const scores = sessions
          .filter(session => session.analysisId?.result?.hasOwnProperty('simulationScore'))
          .map(session => session.analysisId.result.simulationScore || 0);

        const averageScore =
          scores.length > 0 ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2) : 0;

        const skillScoresMap = {};

        sessions.forEach(session => {
          if (!session.analysisId?.result?.knowledgeAnalysis?.skillAnalyses) return;

          const skillAnalyses = session.analysisId.result.knowledgeAnalysis.skillAnalyses;

          skillAnalyses.forEach(skillAnalysis => {
            const skillId = skillAnalysis.skillId?.toString();
            if (!skillId || skillAnalysis.score === undefined) return;

            if (skillGroupId && !validSkillIds.has(skillId)) return;

            if (!skillScoresMap[skillId]) {
              skillScoresMap[skillId] = {
                skillId,
                skillName: skillAnalysis.skillName || 'Unknown Skill',
                scores: [],
              };
            }

            skillScoresMap[skillId].scores.push(skillAnalysis.score);
          });
        });

        const skillsWithAverage = Object.values(skillScoresMap)
          .map(skill => ({
            skillId: skill.skillId,
            skillName: skill.skillName,
            averageScore: parseFloat(
              (skill.scores.reduce((sum, score) => sum + score, 0) / skill.scores.length).toFixed(2),
            ),
            totalAttempts: skill.scores.length,
          }))
          .sort((a, b) => b.averageScore - a.averageScore);

        const bestSkill = skillsWithAverage.length > 0 ? skillsWithAverage[0] : null;
        const worstSkill = skillsWithAverage.length > 0 ? skillsWithAverage[skillsWithAverage.length - 1] : null;

        return {
          totalStudents: uniqueStudents.size,
          totalSessions: sessions.length,
          averageScore: parseFloat(averageScore),
          totalSkills: totalSkillsInDb,
          totalPracticedSkills: skillsWithAverage.length,
          bestSkill: bestSkill
            ? {
                skillId: bestSkill.skillId,
                skillName: bestSkill.skillName,
                averageScore: bestSkill.averageScore,
              }
            : null,
          worstSkill: worstSkill
            ? {
                skillId: worstSkill.skillId,
                skillName: worstSkill.skillName,
                averageScore: worstSkill.averageScore,
              }
            : null,
        };
      } catch (error) {
        this.logger.error('Error getting organization overview:', error);
        return {
          totalStudents: 0,
          totalSessions: 0,
          averageScore: 0,
          totalSkills: 0,
          totalPracticedSkills: 0,
          bestSkill: null,
          worstSkill: null,
        };
      }
    },

    organizeSkillsByTopAndBottom(skills) {
      if (skills.length <= 10) {
        return {all: skills};
      } else {
        return {
          top5: skills.slice(0, 5),
          bottom5: skills.slice(-5).reverse(),
        };
      }
    },

    async getOrganizationSkillsByGroup(ctx, userIds, skillGroupId, dateFilter, organizationIds) {
      try {
        const {startDate, endDate} = this.getStartEndDatesFromFilter(dateFilter);
        const grouping = this.determineTimeGrouping(startDate, endDate);

        const skillsQuery = {isDeleted: false, organizationId: {$in: organizationIds}};
        if (skillGroupId) {
          skillsQuery.skillGroupId = skillGroupId;
        }
        const allSkillsFromDb = await ctx.call('skills.getSkills', skillsQuery);
        const sessions = await ctx.call('roleplaysessions.find', {
          query: {
            studentId: {$in: userIds.map(id => new mongoose.Types.ObjectId(id))},
            status: {$in: ['completed', 'analyzed']},
            isDeleted: {$ne: true},
            analysisId: {$exists: true},
            ...dateFilter,
          },
          populate: ['analysisId', 'studentId'],
        });

        const skillDataMap = {};

        allSkillsFromDb.forEach(skill => {
          const skillId = skill._id.toString();
          skillDataMap[skillId] = {
            skillId,
            skillName: skill.name || 'Unknown Skill',
            periodScoresMap: {},
            totalSum: 0,
            totalCount: 0,
            studentScoresMap: {},
          };
        });

        sessions.forEach(session => {
          if (!session.analysisId?.result?.knowledgeAnalysis?.skillAnalyses) return;

          const skillAnalyses = session.analysisId.result.knowledgeAnalysis.skillAnalyses;
          const TIMEZONE_OFFSET_MS = 7 * 60 * 60 * 1000;
          const sessionDate = new Date(new Date(session.createdAt).getTime() + TIMEZONE_OFFSET_MS);
          const studentId = session.studentId?._id?.toString() || session.studentId?.toString();
          const studentName =
            session.studentId?.fullName || session.studentId?.name || session.studentId?.email || 'Unknown';
          const studentEmail = session.studentId?.email || '';

          skillAnalyses.forEach(skillAnalysis => {
            const skillId = skillAnalysis.skillId?.toString();
            if (!skillId || skillAnalysis.score === undefined) return;

            if (!skillDataMap[skillId]) {
              skillDataMap[skillId] = {
                skillId,
                skillName: skillAnalysis.skillName || 'Unknown Skill',
                periodScoresMap: {},
                totalSum: 0,
                totalCount: 0,
                studentScoresMap: {},
              };
            }

            skillDataMap[skillId].totalSum += skillAnalysis.score;
            skillDataMap[skillId].totalCount += 1;

            const periodKey = this.toPeriodKey(sessionDate, grouping);
            if (!skillDataMap[skillId].periodScoresMap[periodKey]) {
              skillDataMap[skillId].periodScoresMap[periodKey] = {sum: 0, count: 0};
            }
            skillDataMap[skillId].periodScoresMap[periodKey].sum += skillAnalysis.score;
            skillDataMap[skillId].periodScoresMap[periodKey].count += 1;

            if (studentId) {
              if (!skillDataMap[skillId].studentScoresMap[studentId]) {
                skillDataMap[skillId].studentScoresMap[studentId] = {
                  studentId,
                  studentName,
                  email: studentEmail,
                  scores: [],
                };
              }
              skillDataMap[skillId].studentScoresMap[studentId].scores.push(skillAnalysis.score);
            }
          });
        });

        const dateKeys = this.getDateKeysFromFilter(dateFilter, grouping);

        const result = Object.values(skillDataMap)
          .map(skill => {
            let cumulativeSum = 0;
            let cumulativeCount = 0;
            const processedPeriods = new Set();

            const dataPoints = dateKeys.map(date => {
              // Tìm periodKey tương ứng với ngày này
              const periodKey = this.toPeriodKey(new Date(date), grouping);

              // Nếu ngày này là periodKey, hoặc periodKey chưa được xử lý
              if (date === periodKey) {
                const period = skill.periodScoresMap[date];
                if (period) {
                  cumulativeSum += period.sum;
                  cumulativeCount += period.count;
                  processedPeriods.add(date);
                }
              } else if (!processedPeriods.has(periodKey)) {
                // Ngày cuối không phải periodKey, tìm dữ liệu từ periodKey tương ứng
                const period = skill.periodScoresMap[periodKey];
                if (period) {
                  cumulativeSum += period.sum;
                  cumulativeCount += period.count;
                  processedPeriods.add(periodKey);
                }
              }

              return {
                date,
                score: cumulativeCount > 0 ? parseFloat((cumulativeSum / cumulativeCount).toFixed(2)) : 0,
              };
            });

            const studentAverages = Object.values(skill.studentScoresMap)
              .map(student => ({
                studentId: student.studentId,
                studentName: student.studentName,
                email: student.email,
                averageScore: parseFloat(
                  (student.scores.reduce((sum, s) => sum + s, 0) / student.scores.length).toFixed(2),
                ),
                practiceCount: student.scores.length,
              }))
              .sort((a, b) => b.averageScore - a.averageScore);

            const topStudents = studentAverages.slice(0, 3);
            const bottomStudents = studentAverages.length > 3 ? studentAverages.slice(-3).reverse() : [];

            return {
              skillId: skill.skillId,
              skillName: skill.skillName,
              averageScore: skill.totalCount > 0 ? parseFloat((skill.totalSum / skill.totalCount).toFixed(2)) : 0,
              totalAttempts: skill.totalCount,
              isPracticed: skill.totalCount > 0,
              dataPoints,
              topStudents,
              bottomStudents,
            };
          })
          .sort((a, b) => {
            if (a.isPracticed && !b.isPracticed) return -1;
            if (!a.isPracticed && b.isPracticed) return 1;
            if (a.isPracticed && b.isPracticed) return b.averageScore - a.averageScore;
            return a.skillName.localeCompare(b.skillName);
          });

        return result;
      } catch (error) {
        return [];
      }
    },

    toPeriodKey(date, grouping = 'day') {
      const d = new Date(date);

      if (grouping === 'month') {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().split('T')[0];
      }

      if (grouping === 'week') {
        const day = d.getUTCDay();
        const weekStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
        return weekStart.toISOString().split('T')[0];
      }

      return d.toISOString().split('T')[0];
    },

    async getTopCompletionRateCourses(limit = 5, dateFilter, userIds = null, orgIds = null) {
      try {
        const courseQuery = {isDeleted: {$ne: true}, status: {$ne: 'draft'}, isActive: true};
        if (orgIds) {
          courseQuery.organizationId = {$in: orgIds};
        }
        const courses = await this.broker.call('courses.find', {
          query: courseQuery,
          fields: ['_id', 'name', 'publishedToUsers'],
        });

        if (courses.length === 0) return [];

        const courseIds = courses.map(c => c._id);

        // Set userIds cho filter
        const userIdSet = userIds ? new Set(userIds.map(id => id.toString())) : null;

        const [allScenarios, aggregatedResult, allSessions] = await Promise.all([
          this.broker.call('aiscenarios.find', {
            query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}, status: 'published'},
            fields: ['_id', 'courseId', 'passScore'],
          }),
          this.broker.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: courseIds.map(id => id.toString()),
          }),
          this.broker.call('roleplaysessions.find', {
            query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}},
            fields: ['studentId', 'courseId', 'aiScenarioId'],
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

        const bestScoresByCourse = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const cid = agg.courseId?.toString();
          const sid = agg.studentId?.toString();
          const scid = agg.aiScenarioId?.toString();
          if (!cid || !sid || !scid) return;
          if (!bestScoresByCourse[cid]) bestScoresByCourse[cid] = {};
          if (!bestScoresByCourse[cid][sid]) bestScoresByCourse[cid][sid] = {};
          bestScoresByCourse[cid][sid][scid] = agg.bestScore;
        });

        // Map attempted scenarios: courseId -> studentId -> Set of scenarioIds
        const attemptedByCourse = {};
        allSessions.forEach(session => {
          const cid = session.courseId?._id ? session.courseId._id.toString() : session.courseId?.toString();
          const sid = session.studentId?._id ? session.studentId._id.toString() : session.studentId?.toString();
          const scid = session.aiScenarioId?._id
            ? session.aiScenarioId._id.toString()
            : session.aiScenarioId?.toString();
          if (cid && sid && scid) {
            if (!attemptedByCourse[cid]) attemptedByCourse[cid] = {};
            if (!attemptedByCourse[cid][sid]) attemptedByCourse[cid][sid] = new Set();
            attemptedByCourse[cid][sid].add(scid);
          }
        });

        const courseStats = [];
        for (const course of courses) {
          const courseId = course._id.toString();
          const courseScenarios = scenariosByCourse[courseId] || [];

          if (courseScenarios.length === 0) continue;

          const publishedUsers = course.publishedToUsers || [];
          const validUserIds = [];
          publishedUsers.forEach(entry => {
            const uid = entry?.userId?._id?.toString() || entry?.userId?.toString();
            if (uid && (!userIdSet || userIdSet.has(uid))) {
              validUserIds.push(uid);
            }
          });

          if (validUserIds.length === 0) continue;

          const scenarioPassScores = {};
          courseScenarios.forEach(s => {
            scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
          });

          const scenarioIds = Object.keys(scenarioPassScores);
          const totalScenarios = scenarioIds.length;
          let passedScenarios = 0;
          let failedScenarios = 0;
          let notAttemptedScenarios = 0;

          const courseBestScores = bestScoresByCourse[courseId] || {};
          const courseAttempted = attemptedByCourse[courseId] || {};

          for (const scenarioId of scenarioIds) {
            let hasAnyAttempt = false;
            let allPassed = true;
            let hasAnyFail = false;

            for (const uid of validUserIds) {
              const studentAttempted = courseAttempted[uid] || new Set();
              const studentScores = courseBestScores[uid] || {};

              if (studentAttempted.has(scenarioId)) {
                hasAnyAttempt = true;
                if ((studentScores[scenarioId] ?? -1) < scenarioPassScores[scenarioId]) {
                  allPassed = false;
                  hasAnyFail = true;
                }
              } else {
                allPassed = false;
              }
            }

            if (!hasAnyAttempt) {
              notAttemptedScenarios++;
            } else if (allPassed) {
              passedScenarios++;
            } else if (hasAnyFail) {
              failedScenarios++;
            } else {
              failedScenarios++;
            }
          }

          const completionRate = totalScenarios > 0 ? (passedScenarios / totalScenarios) * 100 : 0;

          courseStats.push({
            courseId: course._id,
            courseName: course.name || 'Unknown',
            totalScenarios,
            passedScenarios,
            failedScenarios,
            notAttemptedScenarios,
            completionRate: parseFloat(completionRate.toFixed(2)),
          });
        }

        courseStats.sort((a, b) => b.completionRate - a.completionRate);
        return courseStats.slice(0, limit);
      } catch (error) {
        this.logger.error('Error getting top completion rate courses:', error);
        return [];
      }
    },

    async resolveOrgIds(ctx, targetOrgId) {
      let orgIds = [new mongoose.Types.ObjectId(targetOrgId)];
      try {
        const descendants = await ctx.call('organizations.getAllDescendants', {
          orgId: targetOrgId,
        });
        descendants.forEach(desc => orgIds.push(desc._id));
      } catch (e) {
        // ignore
      }
      return orgIds;
    },

    async getUserIdsByOrgIds(ctx, orgIds) {
      const users = await ctx.call('users.find', {
        query: {organizationId: {$in: orgIds}},
        fields: ['_id'],
      });
      return users.map(u => u._id);
    },

    async getRankingByAllUnits(ctx, targetOrgId, dateFilter, courseIds = null) {
      const orgIds = await this.resolveOrgIds(ctx, targetOrgId);
      const userIds = await this.getUserIdsByOrgIds(ctx, orgIds);

      if (userIds.length === 0) return [];

      return await this.getStudentRankingList(dateFilter, userIds, courseIds);
    },

    async getRankingByUnit(ctx, unitOrgId, dateFilter, courseIds = null) {
      const orgIds = await this.resolveOrgIds(ctx, unitOrgId);
      const userIds = await this.getUserIdsByOrgIds(ctx, orgIds);

      if (userIds.length === 0) return [];

      return await this.getStudentRankingList(dateFilter, userIds, courseIds);
    },

    async getRankingByScenario(ctx, targetOrgId, dateFilter, scenarioId, courseIds = null) {
      const orgIds = await this.resolveOrgIds(ctx, targetOrgId);
      const userIds = await this.getUserIdsByOrgIds(ctx, orgIds);

      if (userIds.length === 0) return [];

      const matchStage = {
        status: {$in: ['completed', 'analyzed']},
        isDeleted: {$ne: true},
        analysisId: {$exists: true},
        studentId: {$in: userIds.map(id => new mongoose.Types.ObjectId(id))},
        ...dateFilter,
      };

      if (scenarioId) {
        matchStage.aiScenarioId = new mongoose.Types.ObjectId(scenarioId);
      }
      if (courseIds && courseIds.length > 0) {
        matchStage.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
      }

      const pipeline = [
        {$match: matchStage},
        {
          $lookup: {
            from: 'RolePlayAnalysis',
            localField: 'analysisId',
            foreignField: '_id',
            as: 'analysis',
          },
        },
        {$unwind: '$analysis'},
        {
          $lookup: {
            from: 'RoleplayAIScenarios',
            localField: 'aiScenarioId',
            foreignField: '_id',
            as: 'scenario',
          },
        },
        {
          $unwind: {
            path: '$scenario',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: '$studentId',
            averageScore: {$avg: '$analysis.result.simulationScore'},
            totalSessions: {$sum: 1},
            scenarioName: {$first: '$scenario.name'},
          },
        },
        {$sort: {averageScore: -1}},
        {
          $lookup: {
            from: 'User',
            localField: '_id',
            foreignField: '_id',
            as: 'student',
          },
        },
        {$unwind: '$student'},
        {
          $lookup: {
            from: 'Organization',
            localField: 'student.organizationId',
            foreignField: '_id',
            as: 'organization',
          },
        },
        {
          $unwind: {
            path: '$organization',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            studentId: '$_id',
            studentName: {$ifNull: ['$student.fullName', {$ifNull: ['$student.name', '$student.email']}]},
            organizationName: {$ifNull: ['$organization.name', '']},
            scenarioName: 1,
            averageScore: {$round: ['$averageScore', 2]},
            totalSessions: 1,
            _id: 0,
          },
        },
      ];

      return await this.broker.call('roleplaysessions.aggregate', {pipeline});
    },

    async getRankingBySkillGroup(ctx, targetOrgId, dateFilter, skillGroupId, courseIds = null) {
      const orgIds = await this.resolveOrgIds(ctx, targetOrgId);
      const userIds = await this.getUserIdsByOrgIds(ctx, orgIds);

      if (userIds.length === 0) return [];

      let skillIds = null;
      let skillGroupName = null;
      if (skillGroupId) {
        const skillGroup = await ctx.call('skillgroups.get', {id: skillGroupId});
        skillGroupName = skillGroup?.name || null;

        // Lấy danh sách scenarios có skillGroupId này
        const scenarios = await ctx.call('aiscenarios.find', {
          query: {
            skillGroupIds: new mongoose.Types.ObjectId(skillGroupId),
            isDeleted: {$ne: true},
          },
          fields: ['_id'],
        });

        // Lấy skills từ scenarioskills liên quan
        const scenarioIds = scenarios.map(s => s._id);
        const scenarioSkills = await ctx.call('scenarioskills.find', {
          query: {
            aiScenarioId: {$in: scenarioIds},
            isDeleted: {$ne: true},
          },
          fields: ['skillId'],
        });
        skillIds = [...new Set(scenarioSkills.map(ss => ss.skillId?.toString()).filter(Boolean))];
      }

      // Lấy sessions
      const matchStage = {
        status: {$in: ['completed', 'analyzed']},
        isDeleted: {$ne: true},
        analysisId: {$exists: true},
        studentId: {$in: userIds.map(id => new mongoose.Types.ObjectId(id))},
        ...dateFilter,
      };
      if (courseIds && courseIds.length > 0) {
        matchStage.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
      }

      const sessions = await this.broker.call('roleplaysessions.find', {
        query: matchStage,
        populate: ['analysisId', 'studentId'],
      });

      // Tính điểm trung bình skill cho mỗi student
      const studentScoresMap = {};

      sessions.forEach(session => {
        if (!session.analysisId?.result?.knowledgeAnalysis?.skillAnalyses) return;
        if (!session.studentId) return;

        const studentId = session.studentId._id?.toString() || session.studentId.toString();
        const studentName =
          session.studentId?.fullName || session.studentId?.name || session.studentId?.email || 'Unknown';

        const skillAnalyses = session.analysisId.result.knowledgeAnalysis.skillAnalyses;

        skillAnalyses.forEach(skillAnalysis => {
          if (skillAnalysis.score === undefined) return;

          // Nếu có filter skillIds, chỉ lấy skills thuộc nhóm
          if (skillIds && !skillIds.includes(skillAnalysis.skillId?.toString())) return;

          if (!studentScoresMap[studentId]) {
            studentScoresMap[studentId] = {
              studentId,
              studentName,
              scores: [],
            };
          }

          studentScoresMap[studentId].scores.push(skillAnalysis.score);
        });
      });

      const users = await ctx.call('users.find', {
        query: {_id: {$in: userIds}},
        populate: ['organizationId'],
        fields: ['_id', 'organizationId'],
      });
      const userOrgMap = {};
      users.forEach(u => {
        userOrgMap[u._id.toString()] = u.organizationId?.name || '';
      });

      const result = Object.values(studentScoresMap)
        .map(student => ({
          studentId: student.studentId,
          studentName: student.studentName,
          organizationName: userOrgMap[student.studentId] || '',
          skillGroupName: skillGroupName,
          averageScore:
            student.scores.length > 0
              ? parseFloat((student.scores.reduce((sum, s) => sum + s, 0) / student.scores.length).toFixed(2))
              : 0,
          totalAttempts: student.scores.length,
        }))
        .sort((a, b) => b.averageScore - a.averageScore);

      return result;
    },
    async getStudentRankingList(dateFilter, userIds, courseIds = null) {
      try {
        const matchStage = {
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          studentId: {$in: userIds.map(id => new mongoose.Types.ObjectId(id))},
          ...dateFilter,
        };
        if (courseIds && courseIds.length > 0) {
          matchStage.courseId = {$in: courseIds.map(id => new mongoose.Types.ObjectId(id))};
        }

        const pipeline = [
          {$match: matchStage},
          {
            $lookup: {
              from: 'RolePlayAnalysis',
              localField: 'analysisId',
              foreignField: '_id',
              as: 'analysis',
            },
          },
          {$unwind: '$analysis'},
          {
            $group: {
              _id: '$studentId',
              averageScore: {$avg: '$analysis.result.simulationScore'},
              totalSessions: {$sum: 1},
            },
          },
          {$sort: {averageScore: -1}},
          {
            $lookup: {
              from: 'User',
              localField: '_id',
              foreignField: '_id',
              as: 'student',
            },
          },
          {$unwind: '$student'},
          {
            $lookup: {
              from: 'Organization',
              localField: 'student.organizationId',
              foreignField: '_id',
              as: 'organization',
            },
          },
          {
            $unwind: {
              path: '$organization',
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              studentId: '$_id',
              studentName: {$ifNull: ['$student.fullName', {$ifNull: ['$student.name', '$student.email']}]},
              organizationName: {$ifNull: ['$organization.name', '']},
              averageScore: {$round: ['$averageScore', 2]},
              totalSessions: 1,
              _id: 0,
            },
          },
        ];

        return await this.broker.call('roleplaysessions.aggregate', {pipeline});
      } catch (error) {
        this.logger.error('Error getting student ranking list:', error);
        return [];
      }
    },
  },

  async started() {
    this.createFolderIfNotExist(storageDir);
  },
};
