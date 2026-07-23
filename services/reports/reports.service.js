'use strict';

const CarboneMixin = require('../../mixins/carbone.mixin');
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const BaseService = require('../../mixins/baseService.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const {getConfig} = require('../../config/config');
const path = require('path');
const templatesDir = path.join(__dirname, 'templates');
const fs = require('fs');

module.exports = {
  name: 'reports',
  mixins: [FunctionsCommon, BaseService, DefaultPermission, CarboneMixin],

  settings: {
    config: getConfig(process.env.NODE_ENV),
  },

  dependencies: ['courses'],

  actions: {
    exportPublishedUsers: {
      rest: 'GET /courses/:id/export-published-users',
      params: {
        id: {type: 'string'},
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }

        const course = await ctx.call('courses.get', {id});
        if (!course || course.isDeleted) {
          throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
        }

        const publishedUsers = course.publishedToUsers || [];
        if (publishedUsers.length === 0) {
          throw new MoleculerClientError('Không có học viên nào được publish', 400);
        }

        const users = publishedUsers.map((pu, idx) => {
          let roleName = '';
          let orgName = '';
          let parentOrgName = '';

          if (pu.organizationId && typeof pu.organizationId === 'object') {
            orgName = pu.organizationId.name || '';
            if (pu.organizationId.parentOrganizationId && typeof pu.organizationId.parentOrganizationId === 'object') {
              parentOrgName = pu.organizationId.parentOrganizationId.name || '';
            }
          }

          return {
            index: idx + 1,
            fullName: pu.fullName || '',
            email: pu.email || '',
            organization: orgName,
            parentOrganization: parentOrgName,
            role: pu.jobTitleId?.name || '',
            courseType: pu.courseType === 'mandatory' ? 'Bắt buộc' : 'Tuỳ chọn',
          };
        });
        console.log('users', users);
        const templatePath = path.join(templatesDir, 'course_students.xlsx');

        const reportData = {
          courseName: course.name,
          users,
        };

        try {
          const filePath = await this.generateDocument(reportData, templatePath);

          ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          ctx.meta.$responseHeaders = {
            'Content-Disposition': `attachment; filename="Danh_sach_hoc_vien.xlsx"`,
          };

          return fs.createReadStream(filePath, {});
        } catch (error) {
          this.logger.error('Error generating document:', error);
          throw new MoleculerClientError('Lỗi khi tạo file excel/pdf', 500);
        }
      },
    },

    exportCoursesAdmin: {
      rest: 'GET /courses/admin/export',
      params: {
        query: {type: 'string', optional: true},
        searchFields: {type: 'string', optional: true},
        sort: {type: 'any', optional: true},
      },
      async handler(ctx) {
        const user = ctx.meta.user;

        if (!user) {
          throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
        }
        ctx.params.pageSize = 10000;
        ctx.params.page = 1;
        ctx.params.sort = '-createdAt';
        // Gọi action từ courses service để lấy dữ liệu
        const enrichedCourses = await ctx.call('courses.getListAdmin', ctx.params);

        if (!enrichedCourses || enrichedCourses.rows.length === 0) {
          throw new MoleculerClientError(
            i18next.t('error.no_courses_to_export', 'Không có khóa học nào để xuất dữ liệu'),
            404,
          );
        }

        // Thêm STT
        //executionTime chỉ lấy ngày tháng năm, nếu đủ cả startDate và endDate thì nối bằng -> nếu không thì để trống

        const coursesWithSTT = enrichedCourses.rows.map((c, idx) => ({
          ...c,
          updatedAt: c.updatedAt ? c.updatedAt.toLocaleString('vi-VN') : '',
          completedMembersPercentage: `${c.completedMembersPercentage.toFixed(0) || '0'} %`,
          executionTime:
            c.startDate && c.deadline
              ? `${c.startDate.toLocaleDateString('vi-VN')} -> ${c.deadline.toLocaleDateString('vi-VN')}`
              : '',
          status:
            c.status === 'draft'
              ? 'Bản nháp'
              : c.status === 'published'
                ? 'Đã xuất bản'
                : c.status === 'archived'
                  ? 'Đã lưu trữ'
                  : '',
          stt: idx + 1,
        }));
        const templatePath = path.join(templatesDir, 'course_export.xlsx');

        try {
          const filePath = await this.generateDocument(coursesWithSTT, templatePath);

          ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          ctx.meta.$responseHeaders = {
            'Content-Disposition': `attachment; filename="Danh_sach_khoa_hoc.xlsx"`,
          };

          return fs.createReadStream(filePath);
        } catch (error) {
          this.logger.error('Error generating courses export file:', error);
          throw new MoleculerClientError('Lỗi khi tạo file excel', 500);
        }
      },
    },

    exportOverviewCourseCompletion: {
      rest: 'GET /overview/course-completion/export',
      params: {
        organizationId: {type: 'string', optional: true},
        courseId: {type: 'string', optional: true},
        courseType: {type: 'string', optional: true},
        time: {type: 'string', optional: true, enum: ['month', 'week', 'custom']},
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const data = await ctx.call('roleplay.statistics.getOverviewCourseCompletionReport', ctx.params);

        const list = (data || []).map((item, idx) => ({
          stt: idx === data.length - 1 ? 'Tổng' : idx + 1,
          courseName: item.courseName || '',
          totalStudents: item.totalStudents || 0,
          totalScenarios: item.totalScenarios || 0,
          totalScenarioSlots: item.totalScenarioSlots || 0,
          scenariosNotDone: item.scenariosNotDone || 0,
          scenariosPassed: item.scenariosPassed || 0,
          scenariosNotPassed: item.scenariosNotPassed || 0,
          status: item.status === 'completed' ? 'Hoàn thành' : 'Chưa hoàn thành',
          completionRate: item.completionRate || 0,
        }));
        const dataToExport = {
          courses: list,
          fromDate: ctx.params.fromDate ? new Date(Number(ctx.params.fromDate) * 1000).toLocaleDateString('vi-VN') : '',
          toDate: ctx.params.toDate ? new Date(Number(ctx.params.toDate) * 1000).toLocaleDateString('vi-VN') : '',
        };
        const templatePath = path.join(templatesDir, 'overview_course_completion.xlsx');

        try {
          const filePath = await this.generateDocument(dataToExport, templatePath);

          ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          ctx.meta.$responseHeaders = {
            'Content-Disposition': `attachment; filename="Bao_cao_ty_le_hoan_thanh_khoa_hoc.xlsx"`,
          };

          return fs.createReadStream(filePath);
        } catch (error) {
          this.logger.error('Error generating overview course completion export:', error);
          throw new MoleculerClientError('Lỗi khi tạo file excel', 500);
        }
      },
    },

    exportOverviewCompletionByOrganization: {
      rest: 'GET /overview/completion-by-organization/export',
      params: {
        organizationId: {type: 'string', optional: true},
        courseId: {type: 'string', optional: true},
        time: {type: 'string', optional: true, enum: ['month', 'week', 'custom']},
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const data = await ctx.call('roleplay.statistics.getOverviewCompletionByOrganization', ctx.params);
        const orgGroupMap = new Map();
        (data || []).forEach(item => {
          if (item.isSummary) return; // Bỏ qua dòng tổng
          const oid = item.organizationId || '';
          if (!orgGroupMap.has(oid)) {
            orgGroupMap.set(oid, {
              organizationName: item.organizationName || '',
              parentOrganizationName: item.parentOrganizationName || '',
              courses: [],
            });
          }
          orgGroupMap.get(oid).courses.push({
            stt: orgGroupMap.get(oid).courses.length + 1,
            courseName: item.courseName || '',
            totalStudents: item.totalStudents || 0,
            totalScenarios: item.totalScenarios || 0,
            totalScenarioSlots: item.totalScenarioSlots || 0,
            scenariosNotDone: item.scenariosNotDone || 0,
            scenariosPassed: item.scenariosPassed || 0,
            scenariosNotPassed: item.scenariosNotPassed || 0,
            status: item.status === 'completed' ? 'Hoàn thành' : 'Chưa hoàn thành',
            completionRate: item.completionRate || 0,
          });
        });

        const dataToExport = Array.from(orgGroupMap.values()).map((org, idx) => ({
          stt: idx + 1,
          ...org,
          fromDate: ctx.params.fromDate ? new Date(Number(ctx.params.fromDate) * 1000).toLocaleDateString('vi-VN') : '',
          toDate: ctx.params.toDate ? new Date(Number(ctx.params.toDate) * 1000).toLocaleDateString('vi-VN') : '',
        }));
        const templatePath = path.join(templatesDir, 'overview_completion_by_org.xlsx');
        try {
          if (dataToExport.length === 0) {
            // Không có dữ liệu, render template trống
            const emptyData = {
              courses: [],
              fromDate: ctx.params.fromDate
                ? new Date(Number(ctx.params.fromDate) * 1000).toLocaleDateString('vi-VN')
                : '',
              toDate: ctx.params.toDate ? new Date(Number(ctx.params.toDate) * 1000).toLocaleDateString('vi-VN') : '',
            };
            const filePath = await this.generateDocument(emptyData, templatePath);

            ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            ctx.meta.$responseHeaders = {
              'Content-Disposition': `attachment; filename="Chi_tiet_hoan_thanh_theo_don_vi.xlsx"`,
            };

            return fs.createReadStream(filePath);
          }

          // Render từng đơn vị thành 1 file Excel riêng, sau đó merge lại
          const sources = [];
          for (const record of dataToExport) {
            const filePath = await this.generateDocument(record, templatePath);

            let safeSheetName = (record.organizationName || `Don_vi_${record.stt}`)
              .replace(/[\\/*?:\[\]]/g, '')
              .substring(0, 31);
            let finalSheetName = safeSheetName;
            let suffix = 1;
            const existingNames = sources.map(s => s.sheetName);
            while (existingNames.includes(finalSheetName)) {
              const suffixStr = `_${suffix}`;
              finalSheetName = safeSheetName.substring(0, 31 - suffixStr.length) + suffixStr;
              suffix++;
            }

            sources.push({filePath, sheetName: finalSheetName});
          }

          const mergedFilePath = await this.mergeExcelBuffersToMultiSheet(sources);

          ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          ctx.meta.$responseHeaders = {
            'Content-Disposition': `attachment; filename="Chi_tiet_hoan_thanh_theo_don_vi.xlsx"`,
          };

          return fs.createReadStream(mergedFilePath);
        } catch (error) {
          this.logger.error('Error generating completion by organization export:', error);
          throw new MoleculerClientError('Lỗi khi tạo file excel', 500);
        }
      },
    },

    exportOverviewCompletionByStudent: {
      rest: 'GET /overview/completion-by-student/export',
      params: {
        organizationId: {type: 'string', optional: true},
        studentId: {type: 'string', optional: true},
        courseId: {type: 'string', optional: true},
        time: {type: 'string', optional: true, enum: ['month', 'week', 'custom']},
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const data = await ctx.call('roleplay.statistics.getOverviewCompletionByStudent', ctx.params);

        const organization = await ctx.call('organizations.get', {
          id: ctx.params?.organizationId?.toString() || ctx.meta.user?.organizationId?.toString(),
        });

        const list = (data || []).map((item, idx) => ({
          stt: idx === data.length - 1 ? 'Tổng' : idx + 1,
          studentName: item.studentName || '',
          email: item.email || '',
          studentInfo: `${item.studentName || ''} \n ${item.email || ''}`,
          courseName: item.courseName || '',
          totalScenarios: item.totalScenarios || 0,
          totalSessions: item.totalSessions || 0,
          scenariosNotDone: item.scenariosNotDone || 0,
          scenariosPassed: item.scenariosPassed || 0,
          scenariosNotPassed: item.scenariosNotPassed || 0,
          status: item.status === 'completed' ? 'Hoàn thành' : 'Chưa hoàn thành',
          completionRate: item.completionRate || 0,
        }));

        const dataToExport = {
          courses: list,
          fromDate: ctx.params.fromDate ? new Date(Number(ctx.params.fromDate) * 1000).toLocaleDateString('vi-VN') : '',
          toDate: ctx.params.toDate ? new Date(Number(ctx.params.toDate) * 1000).toLocaleDateString('vi-VN') : '',
          organizationName: organization?.name || '',
        };
        const templatePath = path.join(templatesDir, 'overview_completion_by_student.xlsx');

        try {
          const filePath = await this.generateDocument(dataToExport, templatePath);

          ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          ctx.meta.$responseHeaders = {
            'Content-Disposition': `attachment; filename="Bao_cao_hoan_thanh_theo_hoc_vien.xlsx"`,
          };

          return fs.createReadStream(filePath);
        } catch (error) {
          this.logger.error('Error generating completion by student export:', error);
          throw new MoleculerClientError('Lỗi khi tạo file excel', 500);
        }
      },
    },

    exportOverviewLearningProgress: {
      rest: 'GET /overview/learning-progress/export',
      params: {
        organizationId: {type: 'string', optional: true},
        courseId: {type: 'string', optional: true},
        studentId: {type: 'string', optional: true},
        fullName: {type: 'string', optional: true},
        email: {type: 'string', optional: true},
        role: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const data = await ctx.call('roleplay.statistics.getOverviewLearningProgress', ctx.params);
        const list = [];
        (data || []).forEach(student => {
          (student.scenarios || []).forEach(sc => {
            list.push({
              stt: list.length + 1,
              studentName: student.studentName || '',
              email: student.email || '',
              jobTitle: student.jobTitle || '',
              organizationName: student.organizationName || '',
              scenarioName: sc.scenarioName || '',
              totalSessions: sc.totalSessions || 0,
              requiredScore: sc.requiredScore || 0,
              highestScore: sc.highestScore ?? '',
              lowestScore: sc.lowestScore ?? '',
              status: sc.status === 'passed' ? 'Đạt' : 'Chưa đạt',
            });
          });
        });
        if (list.length > 0) list[list.length - 1].stt = 'Tổng';
        const templatePath = path.join(templatesDir, 'overview_learning_progress.xlsx');
        const dataToExport = {
          rows: list,
          fromDate: ctx.params.fromDate ? new Date(Number(ctx.params.fromDate) * 1000).toLocaleDateString('vi-VN') : '',
          toDate: ctx.params.toDate ? new Date(Number(ctx.params.toDate) * 1000).toLocaleDateString('vi-VN') : '',
          studentName: list[0]?.studentName || '',
          organizationName: list[0]?.organizationName || '',
        };
        console.log('dataToExport', dataToExport);
        try {
          const filePath = await this.generateDocument(dataToExport, templatePath);

          ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          ctx.meta.$responseHeaders = {
            'Content-Disposition': `attachment; filename="Bao_cao_tien_do_hoc_tap.xlsx"`,
          };

          return fs.createReadStream(filePath);
        } catch (error) {
          this.logger.error('Error generating learning progress export:', error);
          throw new MoleculerClientError('Lỗi khi tạo file excel', 500);
        }
      },
    },

    exportOverviewCourseCompletionDetail: {
      rest: 'GET /overview/course-completion-detail/export',
      params: {
        organizationId: {type: 'string', optional: true},
        time: {type: 'string', optional: true, enum: ['month', 'week', 'custom']},
        fromDate: {type: 'string', optional: true},
        toDate: {type: 'string', optional: true},
        courseId: {type: 'string', required: true},
      },
      async handler(ctx) {
        const data = await ctx.call('roleplay.statistics.getOverviewCourseCompletionDetail', ctx.params);

        const list = (data || []).map((item, idx) => ({
          stt: idx === data.length - 1 ? 'Tổng' : idx + 1,
          organizationName: item.organizationName || '',
          parentOrganizationName: item.parentOrganizationName || '',
          totalStudents: item.totalStudents || 0,
          totalScenarios: item.totalScenarios || 0,
          totalScenarioSlots: item.totalScenarioSlots || 0,
          scenariosNotDone: item.scenariosNotDone || 0,
          scenariosPassed: item.scenariosPassed || 0,
          scenariosNotPassed: item.scenariosNotPassed || 0,
          status: item.status === 'completed' ? 'Hoàn thành' : 'Chưa hoàn thành',
          completionRate: item.completionRate || 0,
        }));

        const course = await ctx.call('courses.get', {id: ctx.params.courseId});
        const dataToExport = {
          rows: list,
          courseName: course?.name || '',
          fromDate: ctx.params.fromDate ? new Date(Number(ctx.params.fromDate) * 1000).toLocaleDateString('vi-VN') : '',
          toDate: ctx.params.toDate ? new Date(Number(ctx.params.toDate) * 1000).toLocaleDateString('vi-VN') : '',
        };
        const templatePath = path.join(templatesDir, 'overview_course_completion_detail.xlsx');

        try {
          const filePath = await this.generateDocument(dataToExport, templatePath);

          ctx.meta.$responseType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          ctx.meta.$responseHeaders = {
            'Content-Disposition': `attachment; filename="Chi_tiet_hoan_thanh_khoa_hoc.xlsx"`,
          };

          return fs.createReadStream(filePath);
        } catch (error) {
          this.logger.error('Error generating course completion detail export:', error);
          throw new MoleculerClientError('Lỗi khi tạo file excel', 500);
        }
      },
    },
  },
};
