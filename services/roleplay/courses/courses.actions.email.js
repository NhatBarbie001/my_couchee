'use strict';

const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const {RESOURCES, ACTIONS} = require('../../../constants/permissions');

/**
 * Courses Service - Email Actions
 * Contains: sendEmailToStudents, sendEmailOverdueMultiCourses, sendCourseReminderEmails
 */

module.exports = {
  sendEmailToStudents: {
    visibility: 'protected',
    params: {
      id: {type: 'string'},
      userIds: {type: 'array', items: 'string', min: 1},
    },
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      const {id, userIds} = ctx.params;

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      const users = await ctx.call('users.find', {
        query: {
          _id: {$in: userIds},
          isDeleted: false,
          email: {$exists: true},
        },
        fields: ['_id', 'fullName', 'email'],
      });

      if (!users || users.length === 0) {
        throw new MoleculerClientError('Không tìm thấy người dùng hợp lệ với email', 404);
      }

      const courseUrl = `${this.settings.config.domain}/role-play/session/${id}`;

      const emailPromises = users.map(async targetUser => {
        try {
          const emailHtml = await ctx.call('email.generateCourseEmailPublicToStudents', {
            fullName: targetUser.fullName,
            courseName: course.name,
            courseDescription: course.description,
            courseUrl,
            lang: ctx.meta.lang || 'vi',
          });

          return {
            to: targetUser.email,
            subject: `Thông báo khóa học mới: ${course.name}`,
            html: emailHtml,
          };
        } catch (error) {
          this.logger.error(`Error generating email for user ${targetUser._id}:`, error);
          return null;
        }
      });

      const emails = (await Promise.all(emailPromises)).filter(email => email !== null);

      if (emails.length === 0) {
        throw new MoleculerClientError('Không thể tạo email cho bất kỳ người dùng nào', 500);
      }

      const result = await ctx.call('email.sendBatch', {
        emails,
        from: this.settings.config.mail.auth.user,
      });

      return {
        success: true,
        courseId: id,
        courseName: course.name,
        totalRequested: userIds.length,
        totalUsersFound: users.length,
        emailsSent: result.successful,
        emailsFailed: result.failed,
        details: result.results,
      };
    },
  },

  sendEmailOverdueMultiCourses: {
    visibility: 'protected',
    params: {
      courseUserMap: {type: 'object'},
    },
    async handler(ctx) {
      const {courseUserMap} = ctx.params;

      const courseIds = Object.keys(courseUserMap);
      if (!courseIds.length) {
        return {success: true, emailsSent: 0};
      }

      const courses = await this.adapter.find({
        query: {_id: {$in: courseIds}, isDeleted: false},
      });

      const courseMap = {};
      courses.forEach(c => {
        courseMap[c._id.toString()] = c;
      });

      const allUserIds = new Set();
      Object.values(courseUserMap).forEach(list => {
        list.forEach(id => allUserIds.add(id));
      });

      const users = await ctx.call('users.find', {
        query: {
          _id: {$in: [...allUserIds]},
          isDeleted: false,
          email: {$exists: true},
        },
        fields: ['_id', 'fullName', 'email'],
      });

      const userMap = {};
      users.forEach(u => {
        userMap[u._id.toString()] = u;
      });

      const emails = [];

      for (const courseId of courseIds) {
        const course = courseMap[courseId];
        if (!course) continue;

        const userIds = courseUserMap[courseId] || [];
        const courseUrl = `${this.settings.config.domain}/role-play/session/${courseId}`;

        for (const uid of userIds) {
          const user = userMap[uid];
          if (!user) continue;

          try {
            const emailHtml = await ctx.call('email.generateCourseEmailWarningOverdue', {
              fullName: user.fullName,
              courseName: course.name,
              deadline: course.deadline,
              courseUrl,
              lang: ctx.meta.lang || 'vi',
            });

            emails.push({
              to: user.email,
              subject: `Nhắc nhở hoàn thành khóa học: ${course.name}`,
              html: emailHtml,
            });
          } catch (err) {
            this.logger.error('Generate email error', err);
          }
        }
      }

      if (!emails.length) {
        this.logger.info('No emails to send');
        return {success: true, emailsSent: 0};
      }

      this.logger.info(`Total emails prepared: ${emails.length}`);

      const chunkArray = (arr, size) => {
        const result = [];
        for (let i = 0; i < arr.length; i += size) {
          result.push(arr.slice(i, i + size));
        }
        return result;
      };

      const batches = chunkArray(emails, 200);

      let totalSuccess = 0;
      let totalFailed = 0;

      const sleep = ms => new Promise(r => setTimeout(r, ms));

      for (const batch of batches) {
        const result = await ctx.call('email.sendBatch', {
          emails: batch,
          from: this.settings.config.mail.auth.user,
        });

        totalSuccess += result.successful || 0;
        totalFailed += result.failed || 0;

        await sleep(1000);
      }

      this.logger.info(
        `Email sending finished | Total: ${emails.length} | Success: ${totalSuccess} | Failed: ${totalFailed}`,
      );

      return {
        success: true,
        totalCourses: courseIds.length,
        totalUsers: allUserIds.size,
        totalEmailsPrepared: emails.length,
        emailsSent: totalSuccess,
        emailsFailed: totalFailed,
      };
    },
  },

  sendCourseReminderEmails: {
    rest: 'POST /:id/send-reminder',
    params: {
      id: {type: 'string'},
      userIds: {type: 'array', items: 'string', min: 1},
    },
    permission: {resource: RESOURCES.COURSE, action: ACTIONS.VIEW},
    async handler(ctx) {
      const {id, userIds} = ctx.params;
      const user = ctx.meta.user;

      if (!user) {
        throw new MoleculerClientError(i18next.t('error.unauthorized', 'Bạn chưa đăng nhập'), 401);
      }

      const course = await this.adapter.findById(id);
      if (!course || course.isDeleted) {
        throw new MoleculerClientError(i18next.t('error.course_not_found', 'Không tìm thấy khóa học'), 404);
      }

      const users = await ctx.call('users.find', {
        query: {
          _id: {$in: userIds},
          isDeleted: false,
          email: {$exists: true},
        },
        fields: ['_id', 'fullName', 'email'],
      });

      if (!users || users.length === 0) {
        throw new MoleculerClientError('Không tìm thấy người dùng hợp lệ với email', 404);
      }

      const courseUrl = `${this.settings.config.domain}/role-play/session/${id}`;

      const emailPromises = users.map(async targetUser => {
        try {
          const emailHtml = await ctx.call('email.generateCourseReminderEmail', {
            fullName: targetUser.fullName,
            courseName: course.name,
            courseDescription: course.description,
            courseUrl,
            lang: ctx.meta.lang || 'vi',
          });

          return {
            to: targetUser.email,
            subject: `Nhắc nhở thực hành khóa học: ${course.name}`,
            html: emailHtml,
          };
        } catch (error) {
          this.logger.error(`Error generating email for user ${targetUser._id}:`, error);
          return null;
        }
      });

      const emails = (await Promise.all(emailPromises)).filter(email => email !== null);

      if (emails.length === 0) {
        throw new MoleculerClientError('Không thể tạo email cho bất kỳ người dùng nào', 500);
      }

      const result = await ctx.call('email.sendBatch', {
        emails,
        from: this.settings.config.mail.auth.user,
      });

      if (result.successful > 0) {
        await this.adapter.updateById(id, {
          lastReminderSentAt: new Date(),
        });

        const successfulUserIds = users.filter(u => emails.some(e => e.to === u.email)).map(u => u._id.toString());

        if (successfulUserIds.length > 0) {
          await ctx
            .call('coursereminders.createReminders', {
              courseId: id,
              userIds: successfulUserIds,
              sentBy: user._id.toString(),
              message: `Nhắc nhở thực hành khóa học: ${course.name}`,
            })
            .catch(err => this.logger.error('Error saving course reminders:', err));
        }
      }

      return {
        success: true,
        courseId: id,
        courseName: course.name,
        totalRequested: userIds.length,
        totalUsersFound: users.length,
        emailsSent: result.successful,
        emailsFailed: result.failed,
        details: result.results,
      };
    },
  },
};
