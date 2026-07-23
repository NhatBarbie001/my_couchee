'use strict';

const mongoose = require('mongoose');

module.exports = {
  actions: {
    //Báo cáo tỷ lệ hoàn thành khóa học
    getOverviewCourseCompletionReport: {
      rest: 'GET /overview/course-completion',
      params: {
        organizationId: {type: 'string', optional: true},
        courseId: {type: 'string', optional: true},
        courseType: {type: 'string', optional: true},
        time: {type: 'string', optional: true, enum: ['month', 'week', 'custom']},
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {organizationId, courseId, courseType, time, fromDate, toDate} = ctx.params;
        const user = ctx.meta.user;
        const dateFilter = this.extractQueryTime({time, fromDate, toDate});
        let targetOrgId = organizationId || user?.organizationId?.toString();
        if (!targetOrgId)
          throw new (require('moleculer').Errors.MoleculerClientError)('Organization ID is required', 400);

        const orgIds = await this.resolveOrgIds(ctx, targetOrgId);
        const courseQuery = {
          organizationId: {$in: orgIds},
          isDeleted: {$ne: true},
          status: {$ne: 'draft'},
          isActive: true,
        };
        // Hỗ trợ multi-select courseId (phân tách bởi dấu phẩy)
        if (courseId) {
          const courseIdList = courseId.split(',').map(id => new mongoose.Types.ObjectId(id.trim()));
          courseQuery._id = courseIdList.length === 1 ? courseIdList[0] : {$in: courseIdList};
        }
        // Hỗ trợ multi-select courseType (phân tách bởi dấu phẩy), bỏ loại 'both'
        if (courseType) {
          const types = courseType
            .split(',')
            .map(t => t.trim())
            .filter(Boolean);
          if (types.length > 0) {
            courseQuery.courseType = types.length === 1 ? types[0] : {$in: types};
          }
        }

        const courses = await ctx.call('courses.find', {
          query: courseQuery,
          fields: ['_id', 'name', 'publishedToUsers', 'courseType'],
        });
        if (!courses.length) return [];

        const courseIds = courses.map(c => c._id);
        const [allScenarios, aggregatedResult] = await Promise.all([
          ctx.call('aiscenarios.find', {
            query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}},
            fields: ['_id', 'courseId', 'passScore'],
          }),
          ctx.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: courseIds.map(id => id.toString()),
            dateFilter,
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

        // Map bestScore theo courseId -> studentId -> scenarioId
        const sessionsByCourseStudent = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const cid = agg.courseId?.toString();
          const sid = agg.studentId?.toString();
          const scid = agg.aiScenarioId?.toString();
          if (!cid || !sid || !scid) return;
          if (!sessionsByCourseStudent[cid]) sessionsByCourseStudent[cid] = {};
          if (!sessionsByCourseStudent[cid][sid]) sessionsByCourseStudent[cid][sid] = {};
          sessionsByCourseStudent[cid][sid][scid] = agg.bestScore;
        });

        const rows = courses.map(course => {
          const cid = course._id.toString();
          const scenarios = scenariosByCourse[cid] || [];
          const totalScenarios = scenarios.length;
          const publishedUsers = course.publishedToUsers || [];
          const userIds = publishedUsers
            .map(u => u?.userId?._id?.toString() || u?.userId?.toString() || u?._id?.toString())
            .filter(Boolean);
          const totalStudents = userIds.length;
          const totalScenarioSlots = totalScenarios * totalStudents;

          const scenarioPassScores = {};
          scenarios.forEach(s => {
            scenarioPassScores[s._id.toString()] = s.passScore ?? 70;
          });
          const scenarioIds = Object.keys(scenarioPassScores);

          let scenariosNotDone = 0;
          let scenariosPassed = 0;
          let scenariosNotPassed = 0;

          const courseBest = sessionsByCourseStudent[cid] || {};
          userIds.forEach(uid => {
            const studentScores = courseBest[uid] || {};
            scenarioIds.forEach(scId => {
              if (studentScores[scId] === undefined) {
                // Học viên chưa tham gia kịch bản này
                scenariosNotDone++;
              } else if (studentScores[scId] >= scenarioPassScores[scId]) {
                // Có ít nhất 1 phiên đạt -> tính là Đạt (chỉ đếm 1 lần)
                scenariosPassed++;
              } else {
                // Đã tham gia nhưng chưa có phiên nào đạt -> tính là Chưa đạt (chỉ đếm 1 lần)
                scenariosNotPassed++;
              }
            });
          });

          const completionRate =
            totalScenarioSlots > 0 ? parseFloat(((scenariosPassed / totalScenarioSlots) * 100).toFixed(2)) : 0;
          const status = completionRate >= 100 ? 'completed' : 'incomplete';

          return {
            courseId: cid,
            courseName: course.name,
            totalStudents,
            totalScenarios,
            totalScenarioSlots,
            scenariosNotDone,
            scenariosPassed,
            scenariosNotPassed,
            status,
            completionRate,
          };
        });

        return this.appendSummaryRow(rows, [
          'totalStudents',
          'totalScenarios',
          'totalScenarioSlots',
          'scenariosNotDone',
          'scenariosPassed',
          'scenariosNotPassed',
          'completionRate',
        ]);
      },
    },

    //Báo cáo tỷ lệ hoàn thành theo đơn vị
    getOverviewCompletionByOrganization: {
      rest: 'GET /overview/completion-by-organization',
      params: {
        organizationId: {type: 'string', optional: true},
        courseId: {type: 'string', optional: true},
        time: {type: 'string', optional: true, enum: ['month', 'week', 'custom']},
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {organizationId, courseId, time, fromDate, toDate} = ctx.params;
        const user = ctx.meta.user;
        const dateFilter = this.extractQueryTime({time, fromDate, toDate});
        const defaultOrgId = organizationId || user?.organizationId?.toString();
        if (!defaultOrgId)
          throw new (require('moleculer').Errors.MoleculerClientError)('Organization ID is required', 400);

        const orgIdList = defaultOrgId
          .split(',')
          .map(id => id.trim())
          .filter(Boolean);

        const allOrgsMap = new Map();
        const orgResults = await Promise.all(
          orgIdList.map(async oid => {
            const [targetOrg, descendants] = await Promise.all([
              ctx.call('organizations.get', {id: oid}),
              ctx.call('organizations.getAllDescendants', {orgId: oid}).catch(e => {
                console.log('Error getting descendants for org', oid, e);
                return [];
              }),
            ]);
            return {targetOrg, descendants: (descendants || []).filter(d => !d.isDeleted)};
          }),
        );
        let firstTargetOrg = null;
        orgResults.forEach(({targetOrg, descendants}) => {
          if (!firstTargetOrg) firstTargetOrg = targetOrg;
          if (targetOrg && !targetOrg.isDeleted) {
            allOrgsMap.set(targetOrg._id.toString(), targetOrg);
          }
          descendants.forEach(d => {
            allOrgsMap.set(d._id.toString(), d);
          });
        });
        const allOrgs = Array.from(allOrgsMap.values());
        const allOrgIds = allOrgs.map(o => o._id.toString());

        const orgMap = {};
        allOrgs.forEach(o => {
          orgMap[o._id.toString()] = o;
        });
        const allUsers = await ctx.call('users.find', {
          query: {organizationId: {$in: allOrgIds}},
          fields: ['_id', 'organizationId'],
        });
        const usersByOrg = {};
        allUsers.forEach(u => {
          const oid = u.organizationId?._id ? u.organizationId._id.toString() : u.organizationId?.toString();
          if (oid) {
            if (!usersByOrg[oid]) usersByOrg[oid] = [];
            usersByOrg[oid].push(u._id.toString());
          }
        });

        const courseQuery = {
          organizationId: {$in: allOrgIds},
          isDeleted: {$ne: true},
          status: {$ne: 'draft'},
          isActive: true,
        };

        if (courseId) {
          const courseIdList = courseId.split(',').map(id => new mongoose.Types.ObjectId(id.trim()));
          courseQuery._id = courseIdList.length === 1 ? courseIdList[0] : {$in: courseIdList};
        }
        const courses = await ctx.call('courses.find', {
          query: courseQuery,
          fields: ['_id', 'name', 'publishedToUsers'],
        });
        console.log("courseQuery", courseQuery);
        console.log("allOrgs", allOrgs.length);
        console.log("courses", courses.length);
        // if (!courses.length)
        //   return allOrgs.map(o => ({
        //     organizationId: o._id.toString(),
        //     organizationName: o.name,
        //     parentOrganizationName: this.getParentOrgName(o, orgMap, firstTargetOrg),
        //     courseName: '',
        //     totalStudents: (usersByOrg[o._id.toString()] || []).length,
        //     totalScenarios: 0,
        //     totalScenarioSlots: 0,
        //     scenariosNotDone: 0,
        //     scenariosPassed: 0,
        //     scenariosNotPassed: 0,
        //     status: 'incomplete',
        //     completionRate: 0,
        //   }));

        const courseIds = courses.map(c => c._id);
        const courseNameMap = {};
        courses.forEach(c => {
          courseNameMap[c._id.toString()] = c.name;
        });

        const [allScenarios, aggregatedResult] = await Promise.all([
          ctx.call('aiscenarios.find', {
            query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}},
            fields: ['_id', 'courseId', 'passScore'],
          }),
          ctx.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: courseIds.map(id => id.toString()),
            dateFilter,
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

        // Map bestScore theo studentId -> courseId -> scenarioId
        const bestScores = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const sid = agg.studentId?.toString();
          const cid = agg.courseId?.toString();
          const scid = agg.aiScenarioId?.toString();
          if (!sid || !cid || !scid) return;
          if (!bestScores[sid]) bestScores[sid] = {};
          if (!bestScores[sid][cid]) bestScores[sid][cid] = {};
          bestScores[sid][cid][scid] = agg.bestScore;
        });

        const results = [];
        allOrgs.forEach(org => {
          const oid = org._id.toString();
          const orgUserIds = usersByOrg[oid] || [];
          const orgUserSet = new Set(orgUserIds);

          courses.forEach(course => {
            const cid = course._id.toString();
            const cScenarios = scenariosByCourse[cid] || [];
            const published = course.publishedToUsers || [];
            const validUids = published
              .map(e => e?.userId?._id?.toString() || e?.userId?.toString())
              .filter(uid => uid && orgUserSet.has(uid));
            if (!validUids.length) return;

            const sps = {};
            cScenarios.forEach(s => {
              sps[s._id.toString()] = s.passScore ?? 70;
            });
            const scIds = Object.keys(sps);
            const totalScenarios = scIds.length;
            const totalStudents = validUids.length;
            const totalScenarioSlots = totalScenarios * totalStudents;

            let scenariosNotDone = 0,
              scenariosPassed = 0,
              scenariosNotPassed = 0;

            validUids.forEach(uid => {
              const uScores = bestScores[uid]?.[cid] || {};
              scIds.forEach(scId => {
                if (uScores[scId] === undefined) {
                  scenariosNotDone++;
                } else if (uScores[scId] >= sps[scId]) {
                  scenariosPassed++;
                } else {
                  scenariosNotPassed++;
                }
              });
            });

            const completionRate =
              totalScenarioSlots > 0 ? parseFloat(((scenariosPassed / totalScenarioSlots) * 100).toFixed(2)) : 0;

            results.push({
              organizationId: oid,
              organizationName: org.name,
              parentOrganizationName: this.getParentOrgName(org, orgMap, firstTargetOrg),
              courseId: cid,
              courseName: courseNameMap[cid],
              totalStudents,
              totalScenarios,
              totalScenarioSlots,
              scenariosNotDone,
              scenariosPassed,
              scenariosNotPassed,
              status: completionRate >= 100 ? 'completed' : 'incomplete',
              completionRate,
            });
          });
        });

        return this.appendSummaryRow(results, [
          'totalStudents',
          'totalScenarios',
          'totalScenarioSlots',
          'scenariosNotDone',
          'scenariosPassed',
          'scenariosNotPassed',
          'completionRate',
        ]);
      },
    },

    //Báo cáo tỷ lệ hoàn thành theo học viên
    getOverviewCompletionByStudent: {
      rest: 'GET /overview/completion-by-student',
      params: {
        organizationId: {type: 'string', optional: true},
        studentId: {type: 'string', optional: true},
        courseId: {type: 'string', optional: true},
        time: {type: 'string', optional: true, enum: ['month', 'week', 'custom']},
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {organizationId, studentId, courseId, time, fromDate, toDate} = ctx.params;
        const user = ctx.meta.user;
        const dateFilter = this.extractQueryTime({time, fromDate, toDate});
        let targetOrgId = organizationId || user?.organizationId?.toString();

        // Lấy danh sách user
        const userQuery = {isDeleted: false};
        if (studentId) {
          userQuery._id = new mongoose.Types.ObjectId(studentId);
        } else if (targetOrgId) {
          const orgIds = await this.resolveOrgIds(ctx, targetOrgId);
          userQuery.organizationId = {$in: orgIds};
        }
        const students = await ctx.call('users.find', {query: userQuery, fields: ['_id', 'fullName', 'email']});
        if (!students.length) return [];

        const studentIds = students.map(s => s._id);
        const studentMap = {};
        students.forEach(s => {
          studentMap[s._id.toString()] = s;
        });

        // Lấy khóa học
        const courseQuery = {isDeleted: {$ne: true}, status: {$ne: 'draft'}, isActive: true};
        if (courseId) {
          const courseIdList = courseId.split(',').map(id => new mongoose.Types.ObjectId(id.trim()));
          courseQuery._id = courseIdList.length === 1 ? courseIdList[0] : {$in: courseIdList};
        }
        if (targetOrgId) {
          const orgIds = await this.resolveOrgIds(ctx, targetOrgId);
          courseQuery.organizationId = {$in: orgIds};
        }
        const courses = await ctx.call('courses.find', {
          query: courseQuery,
          fields: ['_id', 'name', 'publishedToUsers'],
        });
        if (!courses.length) return [];

        const courseIds = courses.map(c => c._id);
        const [allScenarios, aggregatedResult] = await Promise.all([
          ctx.call('aiscenarios.find', {
            query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}},
            fields: ['_id', 'courseId', 'passScore'],
          }),
          ctx.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: courseIds.map(id => id.toString()),
            dateFilter,
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

        // Map bestScore theo studentId -> courseId -> scenarioId
        const bestByStudent = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const sid = agg.studentId?.toString();
          const cid = agg.courseId?.toString();
          const scid = agg.aiScenarioId?.toString();
          if (!sid || !cid || !scid) return;
          if (!bestByStudent[sid]) bestByStudent[sid] = {};
          if (!bestByStudent[sid][cid]) bestByStudent[sid][cid] = {};
          bestByStudent[sid][cid][scid] = agg.bestScore;
        });

        // Đếm tổng số phiên thực hành theo student + course
        const allSessionsList = await ctx.call('roleplaysessions.find', {
          query: {
            courseId: {$in: courseIds},
            studentId: {$in: studentIds},
            status: {$in: ['completed', 'analyzed']},
            isDeleted: false,
            analysisId: {$exists: true},
            ...dateFilter,
          },
          fields: ['_id', 'studentId', 'courseId'],
        });
        const sessionCountByStudentCourse = {};
        allSessionsList.forEach(s => {
          const sid = s.studentId?._id ? s.studentId._id.toString() : s.studentId?.toString();
          const cid = s.courseId?._id ? s.courseId._id.toString() : s.courseId?.toString();
          if (!sid || !cid) return;
          const key = `${sid}_${cid}`;
          sessionCountByStudentCourse[key] = (sessionCountByStudentCourse[key] || 0) + 1;
        });

        const results = [];
        students.forEach(student => {
          const uid = student._id.toString();
          courses.forEach(course => {
            const cid = course._id.toString();
            const published = course.publishedToUsers || [];
            const isPublished = published.some(e => {
              const euid = e?.userId?._id?.toString() || e?.userId?.toString() || e?._id?.toString();
              return euid === uid;
            });
            if (!isPublished) return;

            const scenarios = scenariosByCourse[cid] || [];
            const totalScenarios = scenarios.length;
            const sps = {};
            scenarios.forEach(s => {
              sps[s._id.toString()] = s.passScore ?? 70;
            });
            const scIds = Object.keys(sps);
            const uScores = bestByStudent[uid]?.[cid] || {};

            let scenariosNotDone = 0;
            let scenariosPassed = 0;
            let scenariosNotPassed = 0;

            scIds.forEach(scId => {
              if (uScores[scId] === undefined) {
                scenariosNotDone++;
              } else if (uScores[scId] >= sps[scId]) {
                scenariosPassed++;
              } else {
                scenariosNotPassed++;
              }
            });

            const key = `${uid}_${cid}`;
            const totalSessions = sessionCountByStudentCourse[key] || 0;
            const completionRate =
              totalScenarios > 0 ? parseFloat(((scenariosPassed / totalScenarios) * 100).toFixed(2)) : 0;

            results.push({
              studentId: uid,
              studentName: student.fullName || student.email,
              email: student.email,
              courseId: cid,
              courseName: course.name,
              totalScenarios,
              totalSessions,
              scenariosNotDone,
              scenariosPassed,
              scenariosNotPassed,
              status: completionRate >= 100 ? 'completed' : 'incomplete',
              completionRate,
            });
          });
        });
        return this.appendSummaryRow(results, [
          'totalScenarios',
          'totalSessions',
          'scenariosNotDone',
          'scenariosPassed',
          'scenariosNotPassed',
          'completionRate',
        ]);
      },
    },

    //Báo cáo tiến độ học tập
    getOverviewLearningProgress: {
      rest: 'GET /overview/learning-progress',
      params: {
        organizationId: {type: 'string', optional: true},
        courseId: {type: 'string', optional: true},
        studentId: {type: 'string', optional: true},
        fullName: {type: 'string', optional: true},
        email: {type: 'string', optional: true},
        role: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {organizationId, courseId, studentId, fullName, email, role} = ctx.params;
        const user = ctx.meta.user;
        let targetOrgId = organizationId || user?.organizationId?.toString();

        const userQuery = {isDeleted: false};
        if (studentId) {
          userQuery._id = new mongoose.Types.ObjectId(studentId);
        }

        if (fullName) {
          userQuery.fullName = {$regex: fullName, $options: 'i'};
        }
        if (email) {
          userQuery.email = {$regex: email, $options: 'i'};
        }
        // Lọc theo vai trò
        if (role) {
          userQuery.role = role;
        }
        const students = await ctx.call('users.find', {
          query: userQuery,
          fields: ['_id', 'fullName', 'email', 'organizationId', 'jobTitleId'],
          populate: ['organizationId', 'jobTitleId'],
        });
        console.log('students', students);
        if (!students.length) return [];

        const studentIds = students.map(s => s._id);
        const studentMap = {};
        students.forEach(s => {
          studentMap[s._id.toString()] = s;
        });

        const courseQuery = {isDeleted: {$ne: true}, status: {$ne: 'draft'}, isActive: true};
        if (courseId) {
          const courseIdList = courseId.split(',').map(id => new mongoose.Types.ObjectId(id.trim()));
          courseQuery._id = courseIdList.length === 1 ? courseIdList[0] : {$in: courseIdList};
        }
        if (targetOrgId) {
          const orgIds = await this.resolveOrgIds(ctx, targetOrgId);
          courseQuery.organizationId = {$in: orgIds};
        }
        const courses = await ctx.call('courses.find', {query: courseQuery, fields: ['_id', 'publishedToUsers']});
        if (!courses.length) return [];

        const courseIds = courses.map(c => c._id);
        const scenarios = await ctx.call('aiscenarios.find', {
          query: {courseId: {$in: courseIds}, isDeleted: {$ne: true}, status: {$ne: 'draft'}},
          fields: ['_id', 'name', 'passScore', 'courseId'],
        });

        if (!scenarios.length) return [];

        // Lấy published user set cho mỗi khóa
        const publishedUsersByCourse = {};
        courses.forEach(c => {
          const cid = c._id.toString();
          publishedUsersByCourse[cid] = new Set(
            (c.publishedToUsers || [])
              .map(e => e?.userId?._id?.toString() || e?.userId?.toString() || e?._id?.toString())
              .filter(Boolean),
          );
        });
        console.log('publishedUsersByCourse', publishedUsersByCourse);
        const sessions = await ctx.call('roleplaysessions.find', {
          query: {
            courseId: {$in: courseIds},
            studentId: {$in: studentIds},
            status: {$in: ['completed', 'analyzed']},
            isDeleted: false,
            analysisId: {$exists: true},
          },
          populate: ['analysisId'],
        });

        // Group sessions by student + scenario
        const sessionMap = {};
        sessions.forEach(s => {
          const sid = s.studentId?._id ? s.studentId._id.toString() : s.studentId?.toString();
          const scid = s.aiScenarioId?._id ? s.aiScenarioId._id.toString() : s.aiScenarioId?.toString();
          if (!sid || !scid) return;
          const key = `${sid}_${scid}`;
          if (!sessionMap[key]) sessionMap[key] = [];
          sessionMap[key].push(s.analysisId?.result?.simulationScore ?? null);
        });

        const results = [];
        students.forEach(student => {
          const uid = student._id.toString();
          const studentRecords = [];

          scenarios.forEach(scenario => {
            const scid = scenario._id.toString();
            const cid = scenario.courseId?._id ? scenario.courseId._id.toString() : scenario.courseId?.toString();
            // Kiểm tra user có thuộc khóa học không
            if (cid && publishedUsersByCourse[cid] && !publishedUsersByCourse[cid].has(uid)) return;

            const key = `${uid}_${scid}`;
            const scores = (sessionMap[key] || []).filter(s => s !== null);
            const passScore = scenario.passScore ?? 70;
            const highestScore = scores.length > 0 ? Math.max(...scores) : null;
            const lowestScore = scores.length > 0 ? Math.min(...scores) : null;
            const status = highestScore !== null && highestScore >= passScore ? 'passed' : 'not_passed';

            studentRecords.push({
              scenarioId: scid,
              scenarioName: scenario.name,
              totalSessions: scores.length,
              requiredScore: passScore,
              highestScore,
              lowestScore,
              status,
            });
          });
          console.log('studentRecords', studentRecords);
          if (studentRecords.length > 0) {
            results.push({
              studentId: uid,
              studentName: student.fullName || student.email,
              jobTitle: student.jobTitleId?.name || '',
              email: student.email,
              organizationName: student.organizationId?.name || '',
              scenarios: studentRecords,
            });
          }
        });
        return this.appendLearningProgressSummary(results);
      },
    },

    //Chi tiết báo cáo tỷ lệ hoàn thành khóa học
    getOverviewCourseCompletionDetail: {
      rest: 'GET /overview/course-completion-detail',
      params: {
        organizationId: {type: 'string', optional: true},
        time: {type: 'string', optional: true, enum: ['month', 'week', 'custom']},
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        courseId: {type: 'string', required: true},
      },
      async handler(ctx) {
        const {organizationId, time, fromDate, toDate, courseId} = ctx.params;
        const user = ctx.meta.user;
        const dateFilter = this.extractQueryTime({time, fromDate, toDate});
        let targetOrgId = organizationId || user?.organizationId?.toString();
        if (!targetOrgId)
          throw new (require('moleculer').Errors.MoleculerClientError)('Organization ID is required', 400);

        const targetOrg = await ctx.call('organizations.get', {id: targetOrgId});
        let allDescendants = [];
        try {
          allDescendants = (await ctx.call('organizations.getAllDescendants', {orgId: targetOrgId})).filter(
            d => !d.isDeleted,
          );
        } catch (e) {
          console.log('Error getting descendants for org', targetOrgId, e);
        }
        const allOrgs = targetOrg && !targetOrg.isDeleted ? [targetOrg, ...allDescendants] : allDescendants;
        const allOrgIds = allOrgs.map(o => o._id);
        const orgMap = {};
        allOrgs.forEach(o => {
          orgMap[o._id.toString()] = o;
        });

        const allUsers = await ctx.call('users.find', {
          query: {organizationId: {$in: allOrgIds}},
          fields: ['_id', 'organizationId'],
        });
        const usersByOrg = {};
        allUsers.forEach(u => {
          const oid = u.organizationId?._id ? u.organizationId._id.toString() : u.organizationId?.toString();
          if (oid) {
            if (!usersByOrg[oid]) usersByOrg[oid] = [];
            usersByOrg[oid].push(u._id.toString());
          }
        });

        const courses = await ctx.call('courses.find', {
          query: {organizationId: {$in: allOrgIds}, isDeleted: {$ne: true}, status: {$ne: 'draft'}, isActive: true},
          fields: ['_id', 'publishedToUsers'],
        });
        if (!courses.length) {
          return allOrgs.map(o => ({
            organizationId: o._id.toString(),
            organizationName: o.name,
            parentOrganizationName: this.getParentOrgName(o, orgMap, targetOrg),
            totalStudents: (usersByOrg[o._id.toString()] || []).length,
            totalScenarios: 0,
            totalScenarioSlots: 0,
            scenariosNotDone: 0,
            scenariosPassed: 0,
            scenariosNotPassed: 0,
            status: 'incomplete',
            completionRate: 0,
          }));
        }

        const [allScenarios, aggregatedResult] = await Promise.all([
          ctx.call('aiscenarios.find', {
            query: {courseId: courseId, isDeleted: {$ne: true}},
            fields: ['_id', 'courseId', 'passScore'],
          }),
          ctx.call('roleplaysessions.aggregateCompletedSessions', {
            courseIds: [courseId],
            dateFilter,
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

        // Map bestScore theo studentId -> courseId -> scenarioId
        const bestScores = {};
        (aggregatedResult.allSessions || []).forEach(agg => {
          const sid = agg.studentId?.toString();
          const cid = agg.courseId?.toString();
          const scid = agg.aiScenarioId?.toString();
          if (!sid || !cid || !scid) return;
          if (!bestScores[sid]) bestScores[sid] = {};
          if (!bestScores[sid][cid]) bestScores[sid][cid] = {};
          bestScores[sid][cid][scid] = agg.bestScore;
        });

        const rows = allOrgs.map(org => {
          const oid = org._id.toString();
          const orgUserIds = usersByOrg[oid] || [];
          const orgUserSet = new Set(orgUserIds);
          let totalScenarios = 0,
            totalScenarioSlots = 0,
            scenariosNotDone = 0,
            scenariosPassed = 0,
            scenariosNotPassed = 0;

          courses.forEach(course => {
            const cid = course._id.toString();
            const cScenarios = scenariosByCourse[cid] || [];
            if (!cScenarios.length) return;
            const published = course.publishedToUsers || [];
            const validUids = published
              .map(e => e?.userId?._id?.toString() || e?.userId?.toString())
              .filter(uid => uid && orgUserSet.has(uid));
            if (!validUids.length) return;
            const sps = {};
            cScenarios.forEach(s => {
              sps[s._id.toString()] = s.passScore ?? 70;
            });
            const scIds = Object.keys(sps);
            totalScenarios += scIds.length;
            totalScenarioSlots += scIds.length * validUids.length;

            validUids.forEach(uid => {
              const uScores = bestScores[uid]?.[cid] || {};
              scIds.forEach(scId => {
                if (uScores[scId] === undefined) {
                  scenariosNotDone++;
                } else if (uScores[scId] >= sps[scId]) {
                  scenariosPassed++;
                } else {
                  scenariosNotPassed++;
                }
              });
            });
          });

          const totalStudents = orgUserIds.length;
          const completionRate =
            totalScenarioSlots > 0 ? parseFloat(((scenariosPassed / totalScenarioSlots) * 100).toFixed(2)) : 0;

          return {
            organizationId: oid,
            organizationName: org.name,
            parentOrganizationName: this.getParentOrgName(org, orgMap, targetOrg),
            totalStudents,
            totalScenarios,
            totalScenarioSlots,
            scenariosNotDone,
            scenariosPassed,
            scenariosNotPassed,
            status: completionRate >= 100 ? 'completed' : 'incomplete',
            completionRate,
          };
        });

        return this.appendSummaryRow(rows, [
          'totalStudents',
          'totalScenarios',
          'totalScenarioSlots',
          'scenariosNotDone',
          'scenariosPassed',
          'scenariosNotPassed',
          'completionRate',
        ]);
      },
    },
  },

  methods: {
    appendSummaryRow(rows, sumFields) {
      if (!rows || rows.length === 0) return rows;

      const summary = {isSummary: true};
      const firstRow = rows[0];

      // Khởi tạo tất cả field từ row đầu tiên
      Object.keys(firstRow).forEach(key => {
        if (sumFields.includes(key)) {
          summary[key] = 0;
        } else {
          summary[key] = '';
        }
      });

      // Tính tổng cho các field số
      rows.forEach(row => {
        sumFields.forEach(field => {
          summary[field] = (summary[field] || 0) + (row[field] || 0);
        });
      });

      // Tính lại completionRate trung bình nếu có
      if (sumFields.includes('completionRate') && rows.length > 0) {
        summary.completionRate = parseFloat((summary.completionRate / rows.length).toFixed(2));
      }

      // Gán status dựa trên completionRate tổng
      if ('status' in firstRow) {
        summary.status = summary.completionRate >= 100 ? 'completed' : 'incomplete';
      }

      rows.push(summary);
      return rows;
    },

    appendLearningProgressSummary(results) {
      if (!results || results.length === 0) return results;

      // Flatten all scenarios across all students to compute totals
      let totalSessions = 0;
      let totalHighest = 0;
      let totalLowest = 0;
      let countHighest = 0;
      let countLowest = 0;
      let passedCount = 0;
      let totalScenarios = 0;

      results.forEach(student => {
        (student.scenarios || []).forEach(sc => {
          totalSessions += sc.totalSessions || 0;
          if (sc.highestScore !== null && sc.highestScore !== undefined) {
            totalHighest += sc.highestScore;
            countHighest++;
          }
          if (sc.lowestScore !== null && sc.lowestScore !== undefined) {
            totalLowest += sc.lowestScore;
            countLowest++;
          }
          if (sc.status === 'passed') passedCount++;
          totalScenarios++;
        });
      });

      results.push({
        isSummary: true,
        studentId: '',
        studentName: '',
        email: '',
        organizationName: '',
        scenarios: [
          {
            scenarioId: '',
            scenarioName: '',
            totalSessions,
            requiredScore: '',
            highestScore: countHighest > 0 ? parseFloat((totalHighest / countHighest).toFixed(2)) : '',
            lowestScore: countLowest > 0 ? parseFloat((totalLowest / countLowest).toFixed(2)) : '',
            status: totalScenarios > 0 ? `${passedCount}/${totalScenarios} đạt` : '',
            isSummary: true,
          },
        ],
      });

      return results;
    },
  },
};
