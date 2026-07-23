'use strict';

const nodemailer = require('nodemailer');
const {getConfig} = require('../../config/config');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const {
  createCourseReminderEmail,
  createCourseEmailPublicToStudents,
  createCourseEmailWarningOverdue,
} = require('./emailtemplate');

module.exports = {
  name: 'email',

  settings: {
    config: getConfig(process.env.NODE_ENV),
  },

  actions: {
    send: {
      params: {
        to: {type: 'string'},
        subject: {type: 'string'},
        html: {type: 'string'},
        from: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {to, subject, html, from} = ctx.params;

        try {
          const transporter = nodemailer.createTransport(this.settings.config.mail);

          const mailOptions = {
            from: from || this.settings.config.mail.auth.user,
            to,
            subject,
            html,
          };

          const info = await transporter.sendMail(mailOptions);

          return {
            success: true,
            messageId: info.messageId,
            to,
          };
        } catch (error) {
          throw new MoleculerClientError('Failed to send email', 500, 'EMAIL_SEND_FAILED', {to, error: error.message});
        }
      },
    },

    sendBatch: {
      params: {
        emails: {
          type: 'array',
          items: {
            type: 'object',
            props: {
              to: {type: 'string'},
              subject: {type: 'string'},
              html: {type: 'string'},
            },
          },
        },
        from: {type: 'string', optional: true},
      },
      async handler(ctx) {
        const {emails, from} = ctx.params;

        const results = await Promise.allSettled(
          emails.map(email =>
            ctx.call('email.send', {
              to: email.to,
              subject: email.subject,
              html: email.html,
              from,
            }),
          ),
        );

        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        return {
          total: emails.length,
          successful,
          failed,
          results: results.map((result, index) => ({
            to: emails[index].to,
            status: result.status,
            value: result.status === 'fulfilled' ? result.value : null,
            reason: result.status === 'rejected' ? result.reason.message : null,
          })),
        };
      },
    },

    generateCourseReminderEmail: {
      params: {
        fullName: {type: 'string'},
        courseName: {type: 'string'},
        courseDescription: {type: 'string', optional: true},
        courseUrl: {type: 'string'},
        lang: {type: 'string', optional: true, default: 'vi'},
      },
      handler(ctx) {
        const {fullName, courseName, courseDescription, courseUrl, lang} = ctx.params;

        return createCourseReminderEmail({
          fullName,
          courseName,
          courseDescription,
          courseUrl,
          lang,
        });
      },
    },

    generateCourseEmailPublicToStudents: {
      params: {
        fullName: {type: 'string'},
        courseName: {type: 'string'},
        courseDescription: {type: 'string', optional: true},
        courseUrl: {type: 'string'},
        lang: {type: 'string', optional: true, default: 'vi'},
      },
      handler(ctx) {
        const {fullName, courseName, courseDescription, courseUrl, lang} = ctx.params;

        return createCourseEmailPublicToStudents({
          fullName,
          courseName,
          courseDescription,
          courseUrl,
          lang,
        });
      },
    },

    generateCourseEmailWarningOverdue: {
      params: {
        fullName: {type: 'string'},
        courseName: {type: 'string'},
        courseDescription: {type: 'string', optional: true},
        courseUrl: {type: 'string'},
        lang: {type: 'string', optional: true, default: 'vi'},
      },
      handler(ctx) {
        const {fullName, courseName, courseDescription, courseUrl, lang} = ctx.params;

        return createCourseEmailWarningOverdue({
          fullName,
          courseName,
          courseDescription,
          courseUrl,
          lang,
        });
      },
    },
  },

  methods: {},

  created() {},

  started() {},
};
