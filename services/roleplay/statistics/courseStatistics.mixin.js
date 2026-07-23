'use strict';

const {MoleculerClientError} = require('moleculer').Errors;
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

module.exports = {
  actions: {
    getCourseStatistics: {
      rest: 'GET /courses/:courseId/statistics',
      async handler(ctx) {
        const {courseId, time, fromDate, toDate, topStudentsLimit} = ctx.params;
        return this.buildCourseStatistics(ctx, courseId, time, fromDate, toDate, topStudentsLimit);
      },
    },

    exportCourseStatistics: {
      rest: 'GET /courses/:courseId/statistics/export',
      async handler(ctx) {
        const {courseId, time, fromDate, toDate, topStudentsLimit} = ctx.params;

        const stats = await this.buildCourseStatistics(ctx, courseId, time, fromDate, toDate, topStudentsLimit);
        const fileName = await this.createCourseStatisticsExcel(stats);
        const filePath = path.join(__dirname, './temp', fileName);
        const fileBuffer = fs.readFileSync(filePath);

        const displayName = 'Thống kê khóa học.xlsx';
        const encodedName = encodeURIComponent(displayName);
        ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        ctx.meta.$responseHeaders = {
          'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
        };

        setTimeout(
          () => {
            fs.unlink(filePath, err => {
              if (err) {
                this.logger.error('Failed to delete temp excel file:', err);
              }
            });
          },
          2 * 60 * 1000,
        );

        return fileBuffer;
      },
    },

    getStudentRankingByCourse: {
      rest: 'GET /courses/:courseId/student-ranking',
      params: {
        courseId: {type: 'string'},
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
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
          'courseId',
          'time',
          'fromDate',
          'toDate',
          'type',
          'filterOrganizationId',
          'filterScenarioId',
          'filterSkillGroupId',
        ],
        ttl: 300,
      },
      async handler(ctx) {
        const {courseId, time, fromDate, toDate, type, filterOrganizationId, filterScenarioId, filterSkillGroupId} =
          ctx.params;

        try {
          const course = await this.broker.call('courses.get', {id: courseId});
          if (!course) {
            throw new MoleculerClientError('Course not found', 404);
          }

          const dateFilter = this.extractQueryTime({time, fromDate, toDate});

          switch (type) {
            case 'all':
              return await this.getRankingByCourseAllUnits(ctx, filterOrganizationId, dateFilter, courseId);
            case 'unit':
              return await this.getRankingByCourseUnit(ctx, filterOrganizationId, dateFilter, courseId);
            case 'scenario':
              return await this.getRankingByCourseScenario(
                ctx,
                filterOrganizationId,
                dateFilter,
                filterScenarioId,
                courseId,
              );
            case 'skillGroup':
              return await this.getRankingByCourseSkillGroup(
                ctx,
                filterOrganizationId,
                dateFilter,
                filterSkillGroupId,
                courseId,
              );
            default:
              return await this.getRankingByCourseAllUnits(ctx, filterOrganizationId, dateFilter, courseId);
          }
        } catch (error) {
          this.logger.error('Error getting course ranking detail:', error);
          throw error;
        }
      },
    },

    getStudentCompletionStatsByCourse: {
      rest: 'GET /courses/:courseId/student-completion-stats',
      params: {
        courseId: {type: 'string'},
        time: {
          type: 'string',
          optional: true,
          enum: ['month', 'week', 'custom'],
        },
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        organizationId: {type: 'string', optional: true},
        sortOrder: {type: 'string', optional: true, enum: ['asc', 'desc'], default: 'desc'},
        limit: {type: 'number', optional: true, integer: true, positive: true},
      },
      cache: {
        keys: ['courseId', 'time', 'fromDate', 'toDate', 'organizationId', 'sortOrder', 'limit'],
        ttl: 300,
      },
      async handler(ctx) {
        const {courseId, time, fromDate, toDate, organizationId, sortOrder, limit} = ctx.params;
        const user = ctx.meta.user;

        try {
          const course = await this.broker.call('courses.get', {id: courseId});
          if (!course) {
            throw new MoleculerClientError('Course not found', 404);
          }

          const dateFilter = this.extractQueryTime({time, fromDate, toDate});

          let targetOrgId = organizationId;
          console.log('user', user);
          if (!targetOrgId && user && user.organizationId && !user.isSystemAdmin) {
            targetOrgId = user.organizationId.toString();
          }

          return await this.buildStudentCompletionStatsByCourse(ctx, course, dateFilter, targetOrgId, sortOrder, limit);
        } catch (error) {
          this.logger.error('Error getting student completion stats by course:', error);
          throw error;
        }
      },
    },

    getScenarioCompletionStatsByCourse: {
      rest: 'GET /courses/:courseId/scenario-completion-stats',
      params: {
        courseId: {type: 'string'},
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
        keys: ['courseId', 'time', 'fromDate', 'toDate', 'organizationId'],
        ttl: 300,
      },
      async handler(ctx) {
        const {courseId, time, fromDate, toDate, organizationId} = ctx.params;
        const user = ctx.meta.user;

        try {
          const course = await this.broker.call('courses.get', {id: courseId});
          if (!course) {
            throw new MoleculerClientError('Course not found', 404);
          }

          const dateFilter = this.extractQueryTime({time, fromDate, toDate});

          let targetOrgId = organizationId;

          if (!targetOrgId && user && user.organizationId && !user.isSystemAdmin) {
            targetOrgId = user.organizationId.toString();
          }

          return await this.buildScenarioCompletionStatsByCourse(ctx, course, dateFilter, targetOrgId);
        } catch (error) {
          this.logger.error('Error getting scenario completion stats by course:', error);
          throw error;
        }
      },
    },
  },

  methods: {
    isSessionCompleted(session, passScore = 70) {
      const score = session.analysisId?.result?.simulationScore;
      const requiredScore = session.aiScenarioId?.passScore || passScore;
      return score !== undefined && score >= requiredScore;
    },

    async buildCourseStatistics(ctx, courseId, time, fromDate, toDate, topStudentsLimit) {
      const course = await this.broker.call('courses.get', {id: courseId});
      if (!course) {
        throw new MoleculerClientError('Course not found', 404);
      }

      const dateFilter = this.extractQueryTime({time, fromDate, toDate});

      const [scenarioCount, totalMembers, enrollmentStats, completionStats, topStudents, averageScore, completionRate] =
        await Promise.all([
          this.getScenarioCount(courseId),
          this.calculateTotalMembers(ctx, course),
          this.getEnrollmentStats(courseId, dateFilter),
          this.getCompletionStats(ctx, courseId, dateFilter),
          this.getAllStudentsStats(ctx, course, dateFilter),
          this.getCourseAverageScore(courseId, dateFilter),
          this.getCourseCompletionRate(ctx, courseId, dateFilter),
        ]);

      return {
        courseId,
        courseName: course.name,
        deadline: course.deadline,
        status: course.status,
        lastReminderSentAt: course.lastReminderSentAt,
        period: {time, fromDate, toDate},
        totalScenarios: scenarioCount,
        totalMembers,
        enrolledStudents: enrollmentStats.totalEnrolled,
        completedStudents: completionStats.totalCompleted,
        notCompletedStudents: totalMembers - completionStats.totalCompleted,
        completionRate: totalMembers > 0 ? ((completionStats.totalCompleted / totalMembers) * 100).toFixed(2) : 0,
        averageScore,
        topStudents,
        generatedAt: new Date(),
        startDate: course.startDate,
      };
    },

    convertDataBadge(badge) {
      switch (badge) {
        case 'In_Progress':
          return 'Đang thực hiện';
        case 'Completed':
          return 'Hoàn thành';
        case 'Overdue':
          return 'Quá hạn';
        case 'Completed_Late':
          return 'Hoàn thành muộn';
        default:
          return 'Chưa thực hiện';
      }
    },

    async createCourseStatisticsExcel(stats) {
      const workbook = XLSX.utils.book_new();

      const overviewData = [
        {'Thông tin': 'Tên khóa học', 'Giá trị': stats.courseName},
        {'Thông tin': 'Tổng số kịch bản', 'Giá trị': String(stats.totalScenarios)},
        {'Thông tin': 'Tổng số học viên', 'Giá trị': String(stats.totalMembers)},
        {'Thông tin': 'Đã hoàn thành', 'Giá trị': String(stats.completedStudents)},
        {'Thông tin': 'Chưa hoàn thành', 'Giá trị': String(stats.notCompletedStudents)},
        {'Thông tin': 'Tỷ lệ hoàn thành (%)', 'Giá trị': String(stats.completionRate)},
        {'Thông tin': 'Điểm trung bình', 'Giá trị': String(stats.averageScore)},
        {'Thông tin': 'Thời gian tạo báo cáo', 'Giá trị': new Date(stats.generatedAt).toLocaleString('vi-VN')},
      ];

      const overviewSheet = XLSX.utils.json_to_sheet(overviewData);
      overviewSheet['!cols'] = [{wch: 50}, {wch: 50}];
      XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Thông tin khóa học');

      const studentsData = (stats.topStudents || []).map((s, index) => ({
        STT: String(index + 1),
        'Họ và tên': s.studentName,
        Email: s.email,
        'Phòng ban': s.organization,
        'Điểm trung bình': String(s.averageScore),
        'Điểm cao nhất': String(s.highestScore),
        'Tổng số phiên học': String(s.totalSessions),
        'Trạng thái': this.convertDataBadge(s.badge),
        'Thời gian hoàn thành': s.lastPracticeAt ? new Date(s.lastPracticeAt).toLocaleString('vi-VN') : '',
      }));

      const studentsSheet = XLSX.utils.json_to_sheet(studentsData);
      studentsSheet['!cols'] = [
        {wch: 5},
        {wch: 20},
        {wch: 25},
        {wch: 15},
        {wch: 12},
        {wch: 12},
        {wch: 15},
        {wch: 15},
        {wch: 20},
      ];
      XLSX.utils.book_append_sheet(workbook, studentsSheet, 'Danh sách nhân viên');

      const fileName = `course_statistics_${Date.now()}.xlsx`;
      const filePath = path.join(__dirname, './temp', fileName);

      if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), {recursive: true});
      }

      XLSX.writeFile(workbook, filePath);
      return fileName;
    },

    async getScenarioCount(courseId) {
      try {
        const scenarios = await this.broker.call('aiscenarios.find', {
          query: {
            courseId: new mongoose.Types.ObjectId(courseId),
            isDeleted: {$ne: true},
            status: {$ne: 'draft'},
          },
        });
        return scenarios.length;
      } catch (error) {
        this.logger.error('Error getting scenario count:', error);
        return 0;
      }
    },

    async getEnrollmentStats(courseId, dateFilter) {
      try {
        const query = {
          courseId: new mongoose.Types.ObjectId(courseId),
          isDeleted: {$ne: true},
          ...dateFilter,
        };

        const sessions = await this.broker.call('roleplaysessions.find', {query});
        const uniqueStudents = new Set(sessions.map(s => s.studentId._id.toString()));
        return {
          totalEnrolled: uniqueStudents.size,
          totalSessions: sessions.length,
          uniqueStudents: uniqueStudents,
        };
      } catch (error) {
        this.logger.error('Error getting enrollment stats:', error);
        return {totalEnrolled: 0, totalSessions: 0};
      }
    },

    async getCompletionStats(ctx, courseId, dateFilter) {
      try {
        const query = {
          courseId: new mongoose.Types.ObjectId(courseId),
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          ...dateFilter,
        };

        const sessions = await this.broker.call('roleplaysessions.find', {
          query,
          populate: ['analysisId', 'aiScenarioId'],
        });

        const completedSessions = sessions.filter(session => this.isSessionCompleted(session));

        const calculateCompletedMembers = await this.calculateCompletedMembers(
          ctx,
          [new mongoose.Types.ObjectId(courseId)],
          dateFilter,
        );

        const uniqueCompletedStudents = new Set(completedSessions.map(s => s.studentId.toString()));
        const completedMembers = Object.values(calculateCompletedMembers)?.[0] || [];

        return {
          totalCompleted: completedMembers.length,
          totalCompletedSessions: completedSessions.length,
          uniqueCompletedStudents: completedMembers,
        };
      } catch (error) {
        this.logger.error('Error getting completion stats:', error);
        return {totalCompleted: 0, totalCompletedSessions: 0};
      }
    },

    async calculateCompletedMembers(ctx, courseIds, dateFilter) {
      try {
        if (!courseIds?.length) return {};

        const allScenarios = await ctx.call('aiscenarios.find', {
          query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}, status: {$ne: 'draft'}},
          fields: ['_id', 'courseId', 'passScore'],
        });

        const scenariosByCourse = {};
        for (const scenario of allScenarios) {
          const courseId = scenario.courseId?._id ? scenario.courseId._id.toString() : scenario.courseId?.toString();
          if (!courseId) continue;
          if (!scenariosByCourse[courseId]) scenariosByCourse[courseId] = [];
          scenariosByCourse[courseId].push(scenario);
        }

        const allSessions = await ctx.call('roleplaysessions.find', {
          query: {
            courseId: {$in: courseIds},
            status: {$in: ['completed', 'analyzed']},
            isDeleted: false,
            analysisId: {$exists: true},
            ...dateFilter,
          },
          fields: ['studentId', 'courseId', 'aiScenarioId', 'analysisId.result.simulationScore'],
        });

        const sessionsByCourse = {};
        for (const session of allSessions) {
          const courseId = session.courseId?._id ? session.courseId._id.toString() : session.courseId?.toString();
          if (!courseId) continue;
          if (!sessionsByCourse[courseId]) sessionsByCourse[courseId] = [];
          sessionsByCourse[courseId].push(session);
        }

        const result = {};

        for (const cId of courseIds) {
          const courseScenarios = scenariosByCourse[cId.toString()] || [];
          if (!courseScenarios.length) {
            result[cId.toString()] = 0;
            continue;
          }

          const scenarioPassScores = {};
          courseScenarios.forEach(s => {
            scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
          });

          const courseSessions = sessionsByCourse[cId.toString()] || [];

          const studentBestScores = {};
          for (const session of courseSessions) {
            const studentId = session.studentId?._id ? session.studentId._id.toString() : session.studentId?.toString();
            const scenarioId = session.aiScenarioId?._id
              ? session.aiScenarioId._id.toString()
              : session.aiScenarioId?.toString();
            const score = session.analysisId?.result?.simulationScore;
            if (!studentId || !scenarioId || score === undefined) continue;
            if (!studentBestScores[studentId]) studentBestScores[studentId] = {};
            const prev = studentBestScores[studentId][scenarioId];
            if (prev === undefined || score > prev) studentBestScores[studentId][scenarioId] = score;
          }

          const passedStudentIds = [];
          for (const studentId in studentBestScores) {
            const bestScores = studentBestScores[studentId];
            let passedAll = true;
            for (const scenarioId in scenarioPassScores) {
              if ((bestScores[scenarioId] ?? -1) < scenarioPassScores[scenarioId]) {
                passedAll = false;
                break;
              }
            }
            if (passedAll) {
              passedStudentIds.push(studentId);
            }
          }

          const courseUserIds = await this.getUserIdsFromCourse(ctx, cId.toString());
          const courseUserIdSet = new Set(courseUserIds);
          const validPassedStudentIds = passedStudentIds.filter(studentId => courseUserIdSet.has(studentId));
          result[cId.toString()] = validPassedStudentIds;
        }

        return result;
      } catch (error) {
        this.logger.error('Error calculating completed members:', error);
        return {};
      }
    },

    async getUserIdsFromCourse(ctx, courseId) {
      const course = await ctx.call('courses.getCourse', {id: courseId});
      if (!course || course.isDeleted) return [];

      const publishedToUsers = course.publishedToUsers || [];
      if (!publishedToUsers.length) return [];

      const orConditions = [];
      if (publishedToUsers.length) {
        orConditions.push({_id: {$in: publishedToUsers}});
      }

      const res = await ctx.call('users.list', {
        query: {
          isDeleted: false,
          $or: orConditions,
        },
        fields: ['_id'],
        pageSize: 10000,
      });

      const users = res?.rows || [];
      return users.map(u => u._id.toString());
    },

    async calculateTotalMembers(ctx, course) {
      try {
        const publishedToUsers = course.publishedToUsers || [];
        if (publishedToUsers.length === 0) return 0;

        const query = {isDeleted: false, _id: {$in: publishedToUsers}};

        return await ctx.call('users.count', {query});
      } catch (error) {
        this.logger.error('Error calculating total members:', error);
        return 0;
      }
    },

    async getTopStudents(courseId, limit = 10, dateFilter) {
      try {
        const query = {
          courseId: new mongoose.Types.ObjectId(courseId),
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          ...dateFilter,
        };

        const sessions = await this.broker.call('roleplaysessions.find', {
          query,
          populate: ['studentId', 'analysisId'],
        });

        const studentScores = {};
        for (const session of sessions) {
          if (!session.analysisId || !session.studentId) continue;
          const studentId = session.studentId._id.toString();
          const score = session.analysisId.result?.simulationScore || 0;
          if (!studentScores[studentId]) {
            studentScores[studentId] = {
              studentId,
              studentName: session.studentId.name || session.studentId.email,
              scores: [],
              totalSessions: 0,
            };
          }
          studentScores[studentId].scores.push(score);
          studentScores[studentId].totalSessions++;
        }

        return Object.values(studentScores)
          .map(student => ({
            ...student,
            averageScore:
              student.scores.length > 0
                ? (student.scores.reduce((sum, score) => sum + score, 0) / student.scores.length).toFixed(2)
                : 0,
            highestScore: student.scores.length > 0 ? Math.max(...student.scores) : 0,
          }))
          .sort((a, b) => parseFloat(b.averageScore) - parseFloat(a.averageScore))
          .slice(0, limit);
      } catch (error) {
        this.logger.error('Error getting top students:', error);
        return [];
      }
    },

    async getAllStudentsStats(ctx, course, dateFilter) {
      try {
        const publishedToUsers = course.publishedToUsers || [];
        if (publishedToUsers.length === 0) return [];

        const query = {isDeleted: false, _id: {$in: publishedToUsers}};

        const students = await this.broker.call('users.find', {query});

        const sessions = await this.broker.call('roleplaysessions.find', {
          query: {
            courseId: course._id,
            isDeleted: false,
            status: {$in: ['completed', 'analyzed']},
            analysisId: {$exists: true},
            ...dateFilter,
          },
          populate: ['studentId', 'analysisId', 'aiScenarioId'],
        });

        const scenarios = await this.broker.call('aiscenarios.find', {
          query: {courseId: course._id, isDeleted: false, status: {$ne: 'draft'}},
          fields: ['_id'],
        });
        const scenarioIdsOfCourse = scenarios.map(s => s._id.toString());

        const sessionMap = {};
        const passedScenarioMap = {};

        sessions.forEach(session => {
          if (!session.studentId || !session.aiScenarioId) return;
          const studentId = session.studentId._id.toString();
          const scenarioId = session.aiScenarioId._id.toString();
          const score = session.analysisId?.result?.simulationScore;
          const passScore = session.aiScenarioId?.passScore || 70;
          const startedAt = session.startedAt ? new Date(session.startedAt) : null;

          if (!sessionMap[studentId]) {
            sessionMap[studentId] = {totalSessions: 0, scores: [], lastPracticeAt: null};
          }
          if (!passedScenarioMap[studentId]) {
            passedScenarioMap[studentId] = {};
          }

          sessionMap[studentId].totalSessions++;

          if (typeof score === 'number') {
            sessionMap[studentId].scores.push(score);
            if (score >= passScore && startedAt) {
              const prev = passedScenarioMap[studentId][scenarioId];
              if (!prev || startedAt > prev) {
                passedScenarioMap[studentId][scenarioId] = startedAt;
              }
            }
          }
        });

        Object.keys(sessionMap).forEach(studentId => {
          const passed = passedScenarioMap[studentId] || {};
          const passedAll = scenarioIdsOfCourse.length > 0 && scenarioIdsOfCourse.every(id => passed[id]);
          if (passedAll) {
            const lastTime = Object.values(passed).sort((a, b) => b - a)[0];
            sessionMap[studentId].lastPracticeAt = lastTime;
          }
        });

        const uniqueStudents = await this.getEnrollmentStats(course?._id, dateFilter);
        const completionStats = await this.getCompletionStats(ctx, course?._id, dateFilter);
        const completedStudentSet = new Set(completionStats?.uniqueCompletedStudents?.map(id => id.toString()));

        return students.map(student => {
          const studentId = student._id.toString();
          const stats = sessionMap[studentId] || {totalSessions: 0, scores: [], lastPracticeAt: null};
          const scores = stats.scores;
          const deadline = course.deadline ? new Date(course.deadline) : null;
          const expired_status = course.expired_status;
          const lastPracticeAt = stats.lastPracticeAt ? new Date(stats.lastPracticeAt) : null;

          let badge = 'Not_Start';
          if (completedStudentSet?.has(studentId)) {
            if (deadline && lastPracticeAt && lastPracticeAt > deadline) {
              badge = 'Completed_Late';
            } else {
              badge = 'Completed';
            }
          } else if (expired_status === 'overdue') {
            badge = 'Overdue';
          } else if (uniqueStudents?.uniqueStudents?.has(studentId)) {
            badge = 'In_Progress';
          }

          return {
            studentId,
            studentName: student.fullName,
            email: student.email,
            organization: student.organizationId?.name,
            totalSessions: stats.totalSessions,
            averageScore: scores.length > 0 ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : null,
            highestScore: scores.length > 0 ? Math.max(...scores) : null,
            lastPracticeAt: stats.lastPracticeAt,
            badge,
          };
        });
      } catch (error) {
        this.logger.error('Error getting all students stats:', error);
        return [];
      }
    },

    async getCourseAverageScore(courseId, dateFilter) {
      try {
        const query = {
          courseId: new mongoose.Types.ObjectId(courseId),
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          ...dateFilter,
        };

        const sessions = await this.broker.call('roleplaysessions.find', {
          query,
          populate: ['analysisId'],
        });

        const scores = sessions
          .filter(session => session.analysisId?.result?.hasOwnProperty('simulationScore'))
          .map(session => session.analysisId.result.simulationScore || 0);

        if (scores.length === 0) return 0;
        return (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2);
      } catch (error) {
        this.logger.error('Error getting course average score:', error);
        return 0;
      }
    },

    async getCourseCompletionRate(ctx, courseId, dateFilter) {
      try {
        const [enrollmentStats, completionStats] = await Promise.all([
          this.getEnrollmentStats(courseId, dateFilter),
          this.getCompletionStats(ctx, courseId, dateFilter),
        ]);

        if (enrollmentStats.totalEnrolled === 0) return 0;
        return ((completionStats.totalCompleted / enrollmentStats.totalEnrolled) * 100).toFixed(2);
      } catch (error) {
        this.logger.error('Error getting course completion rate:', error);
        return 0;
      }
    },

    // ===================== Course Ranking Methods =====================

    async getRankingByCourseAllUnits(ctx, targetOrgId, dateFilter, courseId) {
      const course = await ctx.call('courses.get', {id: courseId});
      const students = await this.getCourseStudentsWithOrg(ctx, course, targetOrgId);
      if (students.length === 0) return [];

      const userIds = students.map(s => s._id);
      const rankingData = await this.getStudentRankingListByCourse(dateFilter, userIds, courseId);

      const studentMap = {};
      students.forEach(s => {
        studentMap[s._id.toString()] = {
          studentId: s._id,
          studentName: s.fullName || s.email,
          organizationName: s.organizationName,
          averageScore: 0,
          totalSessions: 0,
        };
      });

      rankingData.forEach(r => {
        const sid = r.studentId.toString();
        if (studentMap[sid]) {
          studentMap[sid].averageScore = r.averageScore;
          studentMap[sid].totalSessions = r.totalSessions;
        }
      });

      return Object.values(studentMap).sort((a, b) => b.averageScore - a.averageScore);
    },

    async getRankingByCourseUnit(ctx, unitOrgId, dateFilter, courseId) {
      const course = await ctx.call('courses.get', {id: courseId});
      const students = await this.getCourseStudentsWithOrg(ctx, course, unitOrgId);
      if (students.length === 0) return [];

      const userIds = students.map(s => s._id);
      const rankingData = await this.getStudentRankingListByCourse(dateFilter, userIds, courseId);

      const studentMap = {};
      students.forEach(s => {
        studentMap[s._id.toString()] = {
          studentId: s._id,
          studentName: s.fullName || s.email,
          organizationName: s.organizationName,
          averageScore: 0,
          totalSessions: 0,
        };
      });

      rankingData.forEach(r => {
        const sid = r.studentId.toString();
        if (studentMap[sid]) {
          studentMap[sid].averageScore = r.averageScore;
          studentMap[sid].totalSessions = r.totalSessions;
        }
      });

      return Object.values(studentMap).sort((a, b) => b.averageScore - a.averageScore);
    },

    async getRankingByCourseScenario(ctx, targetOrgId, dateFilter, scenarioId, courseId) {
      const course = await ctx.call('courses.get', {id: courseId});
      const students = await this.getCourseStudentsWithOrg(ctx, course, targetOrgId);
      if (students.length === 0) return [];

      const userIds = students.map(s => s._id);

      const matchStage = {
        status: {$in: ['completed', 'analyzed']},
        isDeleted: {$ne: true},
        analysisId: {$exists: true},
        studentId: {$in: userIds.map(id => new mongoose.Types.ObjectId(id))},
        courseId: new mongoose.Types.ObjectId(courseId),
        ...dateFilter,
      };
      if (scenarioId) {
        matchStage.aiScenarioId = new mongoose.Types.ObjectId(scenarioId);
      }

      const pipeline = [
        {$match: matchStage},
        {$lookup: {from: 'RolePlayAnalysis', localField: 'analysisId', foreignField: '_id', as: 'analysis'}},
        {$unwind: '$analysis'},
        {$lookup: {from: 'RoleplayAIScenarios', localField: 'aiScenarioId', foreignField: '_id', as: 'scenario'}},
        {$unwind: {path: '$scenario', preserveNullAndEmptyArrays: true}},
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
          $project: {
            studentId: '$_id',
            scenarioName: 1,
            averageScore: {$round: ['$averageScore', 2]},
            totalSessions: 1,
            _id: 0,
          },
        },
      ];

      const rankingData = await this.broker.call('roleplaysessions.aggregate', {pipeline});

      const studentMap = {};
      let scenarioNameFound = '';

      rankingData.forEach(r => {
        if (r.scenarioName) scenarioNameFound = r.scenarioName;
      });

      students.forEach(s => {
        studentMap[s._id.toString()] = {
          studentId: s._id,
          studentName: s.fullName || s.email,
          organizationName: s.organizationName,
          scenarioName: scenarioNameFound,
          averageScore: 0,
          totalSessions: 0,
        };
      });

      rankingData.forEach(r => {
        const sid = r.studentId.toString();
        if (studentMap[sid]) {
          studentMap[sid].averageScore = r.averageScore;
          studentMap[sid].totalSessions = r.totalSessions;
          studentMap[sid].scenarioName = r.scenarioName;
        }
      });

      return Object.values(studentMap).sort((a, b) => b.averageScore - a.averageScore);
    },

    async getRankingByCourseSkillGroup(ctx, targetOrgId, dateFilter, skillGroupId, courseId) {
      const course = await ctx.call('courses.get', {id: courseId});
      const students = await this.getCourseStudentsWithOrg(ctx, course, targetOrgId);
      if (students.length === 0) return [];

      const userIds = students.map(s => s._id);

      let skillIds = null;
      let skillGroupName = null;
      if (skillGroupId) {
        const skillGroup = await ctx.call('skillgroups.get', {id: skillGroupId});
        skillGroupName = skillGroup?.name || null;

        const scenarios = await ctx.call('aiscenarios.find', {
          query: {
            skillGroupIds: new mongoose.Types.ObjectId(skillGroupId),
            courseId: new mongoose.Types.ObjectId(courseId),
            isDeleted: {$ne: true},
            status: {$ne: 'draft'},
          },
          fields: ['_id'],
        });

        const scenarioIds = scenarios.map(s => s._id);
        const scenarioSkills = await ctx.call('scenarioskills.find', {
          query: {aiScenarioId: {$in: scenarioIds}, isDeleted: {$ne: true}},
          fields: ['skillId'],
        });
        skillIds = [...new Set(scenarioSkills.map(ss => ss.skillId?.toString()).filter(Boolean))];
      }

      const matchStage = {
        status: {$in: ['completed', 'analyzed']},
        isDeleted: {$ne: true},
        analysisId: {$exists: true},
        studentId: {$in: userIds.map(id => new mongoose.Types.ObjectId(id))},
        courseId: new mongoose.Types.ObjectId(courseId),
        ...dateFilter,
      };

      const sessions = await this.broker.call('roleplaysessions.find', {
        query: matchStage,
        populate: ['analysisId'],
      });

      const studentScoresMap = {};

      students.forEach(s => {
        studentScoresMap[s._id.toString()] = {
          studentId: s._id,
          studentName: s.fullName || s.email,
          organizationName: s.organizationName,
          skillGroupName: skillGroupName,
          scores: [],
          averageScore: 0,
          totalAttempts: 0,
        };
      });

      sessions.forEach(session => {
        if (!session.analysisId?.result?.knowledgeAnalysis?.skillAnalyses) return;
        if (!session.studentId) return;

        const studentId = session.studentId._id?.toString() || session.studentId.toString();

        session.analysisId.result.knowledgeAnalysis.skillAnalyses.forEach(skillAnalysis => {
          if (skillAnalysis.score === undefined) return;
          if (skillIds && !skillIds.includes(skillAnalysis.skillId?.toString())) return;

          if (studentScoresMap[studentId]) {
            studentScoresMap[studentId].scores.push(skillAnalysis.score);
          }
        });
      });

      return Object.values(studentScoresMap)
        .map(student => ({
          studentId: student.studentId,
          studentName: student.studentName,
          organizationName: student.organizationName,
          skillGroupName: student.skillGroupName,
          averageScore:
            student.scores.length > 0
              ? parseFloat((student.scores.reduce((sum, s) => sum + s, 0) / student.scores.length).toFixed(2))
              : 0,
          totalAttempts: student.scores.length,
        }))
        .sort((a, b) => b.averageScore - a.averageScore);
    },

    async getStudentRankingListByCourse(dateFilter, userIds, courseId) {
      try {
        const matchStage = {
          status: {$in: ['completed', 'analyzed']},
          isDeleted: {$ne: true},
          analysisId: {$exists: true},
          courseId: new mongoose.Types.ObjectId(courseId),
          ...dateFilter,
        };
        if (userIds) {
          matchStage.studentId = {$in: userIds.map(id => new mongoose.Types.ObjectId(id))};
        }

        const pipeline = [
          {$match: matchStage},
          {$lookup: {from: 'RolePlayAnalysis', localField: 'analysisId', foreignField: '_id', as: 'analysis'}},
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
            $project: {
              studentId: '$_id',
              averageScore: {$round: ['$averageScore', 2]},
              totalSessions: 1,
              _id: 0,
            },
          },
        ];

        return await this.broker.call('roleplaysessions.aggregate', {pipeline});
      } catch (error) {
        this.logger.error('Error getting student ranking list by course:', error);
        return [];
      }
    },

    // ===================== NEW: Student Completion Stats by Course =====================

    async buildStudentCompletionStatsByCourse(ctx, course, dateFilter, targetOrgId, sortOrder, limit) {
      try {
        const courseId = course._id.toString();

        // 1. Lấy tất cả scenarios trong khóa học
        const scenarios = await ctx.call('aiscenarios.find', {
          query: {courseId: new mongoose.Types.ObjectId(courseId), isDeleted: {$ne: true}, status: {$ne: 'draft'}},
          fields: ['_id', 'passScore'],
        });
        const totalScenarios = scenarios.length;
        if (totalScenarios === 0) return [];

        const scenarioPassScores = {};
        scenarios.forEach(s => {
          scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
        });

        // 2. Lấy danh sách học viên thuộc khóa học, lọc theo organization nếu có
        let students = await this.getCourseStudentsWithOrg(ctx, course, targetOrgId);
        if (students.length === 0) return [];

        const studentIds = students.map(s => s._id);

        // 3. Lấy sessions (có lọc theo dateFilter)
        const aggregatedResult = await ctx.call('roleplaysessions.aggregateCompletedSessions', {
          courseIds: [courseId],
          dateFilter,
        });

        // 4. Tính best score cho mỗi student-scenario
        const bestScoresByStudent = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const sid = agg.studentId?.toString();
          const scid = agg.aiScenarioId?.toString();
          if (!sid || !scid) return;
          if (!bestScoresByStudent[sid]) bestScoresByStudent[sid] = {};
          bestScoresByStudent[sid][scid] = agg.bestScore;
        });

        // 5. Tính tiến độ hoàn thành cho mỗi student
        const scenarioIds = Object.keys(scenarioPassScores);

        const result = students.map(student => {
          const uid = student._id.toString();
          const studentScores = bestScoresByStudent[uid] || {};

          let passedScenarios = 0;
          for (const scenarioId of scenarioIds) {
            if ((studentScores[scenarioId] ?? -1) >= scenarioPassScores[scenarioId]) {
              passedScenarios++;
            }
          }

          const completionRate =
            totalScenarios > 0 ? parseFloat(((passedScenarios / totalScenarios) * 100).toFixed(2)) : 0;

          return {
            studentId: student._id,
            studentName: student.fullName || student.email,
            organizationName: student.organizationName || '',
            totalScenarios,
            passedScenarios,
            completionRate,
          };
        });

        // 6. Sắp xếp
        if (sortOrder === 'asc') {
          result.sort((a, b) => a.completionRate - b.completionRate);
        } else {
          result.sort((a, b) => b.completionRate - a.completionRate);
        }

        return limit ? result.slice(0, limit) : result;
      } catch (error) {
        this.logger.error('Error building student completion stats by course:', error);
        return [];
      }
    },

    // ===================== NEW: Scenario Completion Stats by Course =====================

    async buildScenarioCompletionStatsByCourse(ctx, course, dateFilter, targetOrgId) {
      try {
        const courseId = course._id.toString();

        // 1. Lấy tất cả scenarios trong khóa học
        const scenarios = await ctx.call('aiscenarios.find', {
          query: {courseId: courseId, isDeleted: {$ne: true}, status: {$ne: 'draft'}},
          fields: ['_id', 'name', 'passScore'],
        });
        if (scenarios.length === 0) return [];

        // 2. Lấy tất cả học viên thuộc khóa học, lọc theo organization nếu có
        const students = await this.getCourseStudentsWithOrg(ctx, course, targetOrgId);
        const totalStudents = students.length;
        if (totalStudents === 0) {
          return scenarios.map(s => ({
            scenarioId: s._id,
            scenarioName: s.name,
            totalStudents: 0,
            passedStudents: 0,
            failedStudents: 0,
            notAttemptedStudents: 0,
            completionRate: 0,
          }));
        }

        const studentIdSet = new Set(students.map(s => s._id.toString()));
        console.log('studentIdSet', studentIdSet);
        // 3. Lấy best scores (có lọc theo dateFilter)
        const aggregatedResult = await ctx.call('roleplaysessions.aggregateCompletedSessions', {
          courseIds: [courseId],
          dateFilter,
        });

        // scenarioId -> studentId -> bestScore
        const bestScoresByScenario = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const sid = agg.studentId?.toString();
          const scid = agg.aiScenarioId?.toString();
          if (!sid || !scid || !studentIdSet.has(sid)) return;
          if (!bestScoresByScenario[scid]) bestScoresByScenario[scid] = {};
          bestScoresByScenario[scid][sid] = agg.bestScore;
        });

        // 4. Tính thống kê cho mỗi scenario
        const result = scenarios.map(scenario => {
          const scenarioId = scenario._id.toString();
          const passScore = scenario.passScore ?? 70;
          const scenarioStudents = bestScoresByScenario[scenarioId] || {};

          let passedStudents = 0;
          let failedStudents = 0;

          for (const [sid, bestScore] of Object.entries(scenarioStudents)) {
            if (bestScore >= passScore) {
              passedStudents++;
            } else {
              failedStudents++;
            }
          }

          const attemptedStudents = passedStudents + failedStudents;
          const notAttemptedStudents = totalStudents - attemptedStudents;

          return {
            scenarioId: scenario._id,
            scenarioName: scenario.name,
            totalStudents,
            passedStudents,
            failedStudents,
            notAttemptedStudents,
            completionRate: totalStudents > 0 ? parseFloat(((passedStudents / totalStudents) * 100).toFixed(2)) : 0,
          };
        });

        result.sort((a, b) => b.completionRate - a.completionRate);

        return result;
      } catch (error) {
        this.logger.error('Error building scenario completion stats by course:', error);
        return [];
      }
    },

    async getCourseStudentsWithOrg(ctx, course, targetOrgId) {
      const publishedToUsers = course.publishedToUsers || [];
      if (publishedToUsers.length === 0) return [];

      const userIds = publishedToUsers
        .map(u => {
          const uid = u?._id;
          return uid ? new mongoose.Types.ObjectId(uid.toString()) : null;
        })
        .filter(Boolean);

      if (userIds.length === 0) return [];

      const userQuery = {isDeleted: false, _id: {$in: userIds}};

      // // Lọc theo organization nếu có
      if (targetOrgId) {
        const orgIds = await this.resolveOrgIds(ctx, targetOrgId);
        userQuery.organizationId = {$in: orgIds};
      }
      const users = await ctx.call('users.find', {
        query: userQuery,
        populate: ['organizationId'],
        fields: ['_id', 'fullName', 'email', 'organizationId'],
      });
      return users.map(u => ({
        _id: u._id,
        fullName: u.fullName,
        email: u.email,
        organizationName: u.organizationId?.name || '',
      }));
    },
  },
};
