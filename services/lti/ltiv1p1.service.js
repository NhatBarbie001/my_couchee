'use strict';
const queryString = require('qs');
const moment = require('moment');
const DbMongoose = require('../../mixins/dbMongo.mixin');
const { USER_CODES, USER_STATE } = require('../../constants/constant');
const { MoleculerClientError } = require('moleculer').Errors;
const i18next = require('i18next');
const { getConfig } = require('../../config/config');
const config = getConfig(process.env.NODE_ENV);
const oauthSignature = require('oauth-signature');
const { v4: uuidv4 } = require('uuid');
const jwt = require('../../helpers/jwt');

module.exports = {
  name: 'ltiv1p1',
  settings: {
    rest: '/lti',
    JWT_SECRET: process.env.JWT_SECRET || 'jwt-tradar-secret',
    fields: ['_id', 'email', 'fullName', 'username', 'active', 'state', 'role'],
  },

  actions: {
    launch: {
      rest: 'POST /launch',
      auth: false, // LTI handles its own auth via OAuth 1.0a signature
      skipToken: true,
      async handler(ctx) {
        try {
          const data = ctx.params;
          const CONSUMER_KEY = process.env.LTI_CONSUMER_KEY || 'coacheekey';
          const CONSUMER_SECRET = process.env.LTI_CONSUMER_SECRET || 'coacheesecret';

          // 1. Validate Consumer Key
          if (data.oauth_consumer_key !== CONSUMER_KEY) {
            throw new MoleculerClientError('Invalid Consumer Key', 401);
          }

          // 2. Validate Signature
          const httpMethod = 'POST';
          const url = `${config.backend_base_url}/api/lti/launch`;

          const removeParams = ['oauth_signature'];
          const parameters = {};
          for (const key in data) {
            if (!removeParams.includes(key) && key.indexOf('/') === -1) {
              parameters[key] = data[key];
            }
          }

          const generatedSignature = oauthSignature.generate(httpMethod, url, parameters, CONSUMER_SECRET, null, {
            encodeSignature: false,
          });

          if (generatedSignature !== data.oauth_signature) {
            this.logger.warn(`LTI Signature Mismatch. Expected: ${generatedSignature}, Got: ${data.oauth_signature}`);
          }

          // 3. Provision/Find User
          const email = data.lis_person_contact_email_primary;
          const fullName = data.lis_person_name_full || 'LTI User';
          const ltiUserId = data.user_id;

          let user;
          if (email) {
            user = await ctx.call('users.findOne', { email: email });
          }

          if (user) {
            if (!user.moodleUserId && ltiUserId) {
              await this.broker.call('users.update', {
                id: user._id.toString(),
                email: email,
                $set: { moodleUserId: Number(ltiUserId) },
              });
            }
          } else {
            user = await ctx.call('users.internalCreate', {
              email: email || `${ltiUserId}@lti.user`,
              fullName: fullName,
              role: data.roles && data.roles.includes('Instructor') ? USER_CODES.TEACHER : USER_CODES.STUDENT,
              type: data.roles && data.roles.includes('Instructor') ? USER_CODES.TEACHER : USER_CODES.STUDENT,
              moodleUserId: Number(ltiUserId),
            });
          }

          // 4. Generate Session Tokens
          const accessToken = jwt.issue({ id: user._id, isUser: true }, '24h', this.settings.JWT_SECRET);

          // Generate Refresh Token (Logic duplicated from users.service.js)
          let expRefreshToken;
          const nowTimeStamp = new Date().getTime();
          let expTimeStamp = nowTimeStamp + 30 * 24 * 60 * 60 * 1000;
          const nextExpDay = moment(new Date(expTimeStamp)).add(1, 'days').format('YYYY-MM-DD 18:00:00');
          const expDay = moment(new Date(expTimeStamp)).format('YYYY-MM-DD 18:00:00');
          const nextExpDayTimeStamp = new Date(nextExpDay).getTime();
          const expDayTimeStamp = new Date(expDay).getTime();

          let expiresDateTime;
          if (expTimeStamp > expDayTimeStamp) {
            expRefreshToken = nextExpDayTimeStamp - nowTimeStamp;
            expiresDateTime = nextExpDay;
          } else {
            expRefreshToken = expDayTimeStamp - nowTimeStamp;
            expiresDateTime = expDay;
          }

          const refreshToken = jwt.issue(
            { id: user._id, isUser: true },
            expRefreshToken / 1000 + 's',
            this.settings.JWT_SECRET,
          );

          await ctx.call('refreshToken.create', {
            userId: user._id,
            refreshToken: refreshToken,
            expiresDate: expiresDateTime,
          });

          // 5. Redirect
          let redirectUrl = `${config.domain}/student/courses`;
          console.log('data.context_id', data);
          const moodleCourseId = data.context_id;
          if (moodleCourseId) {
            try {
              const courses = await ctx.call('courses.find', {
                query: {
                  moodleCourseId: Number(moodleCourseId),
                  isDeleted: false,
                },
                limit: 1,
              });
              const course = courses && courses.length > 0 ? courses[0] : null;

              if (course) {
                redirectUrl = `${config.domain}/role-play/session/${course._id}`;
              } else {
                this.logger.warn(`LTI Launch: Course with moodleID ${moodleCourseId} not found in DB.`);
              }
            } catch (err) {
              this.logger.error('Error finding course for LTI launch:', err);
            }
          }

          const serialize = require('cookie').serialize;
          const cookieOptions = {
            httpOnly: true,
            secure: true,
            path: '/',
            maxAge: 30 * 24 * 60 * 60, // 30 days
          };

          const cookieAccessToken = serialize('accessToken', accessToken, cookieOptions);
          const cookieRefreshToken = serialize('refreshToken', refreshToken, cookieOptions);

          ctx.meta.$responseHeaders = {
            'Set-Cookie': [cookieAccessToken, cookieRefreshToken],
            Location: redirectUrl,
          };

          ctx.meta.$statusCode = 302;
          ctx.meta.$location = redirectUrl;
          this.logger.info('Redirect headers set. Location:', redirectUrl);
          return;
        } catch (error) {
          this.logger.error('Error updating grade in Moodle:', error);
          return new MoleculerClientError('Cannot launch Virtual Coach', 404);
        }
      },
    },
  },

  methods: {
    async getMoodleSettings() {
      const moodleSettings = await this.broker.call('moodle.findOne');

      if (!moodleSettings) {
        throw new Error('Moodle settings not found in database');
      }

      if (moodleSettings.status !== 'active') {
        throw new Error('Moodle integration is currently inactive. Please contact administrator.');
      }

      if (moodleSettings.isDeleted) {
        throw new Error('Moodle settings have been deleted');
      }

      return moodleSettings;
    },
  },

  events: {
    async 'roleplay.analysis.completed'(ctx) {
      const { sessionId, analysisData } = ctx.params;
      this.logger.info(`[LTI] handling roleplay.analysis.completed for session ${sessionId}`);

      try {
        // 1. Get Session to find moodleAssignmentId and studentId
        const session = await ctx.call('roleplaysessions.get', { id: sessionId });
        const aiScenario = await ctx.call('aiscenarios.get', { id: session?.aiScenarioId?.toString() });
        if (!aiScenario || !aiScenario.moodleAssignmentId) {
          this.logger.warn(`[LTI] Session ${sessionId} has no moodleAssignmentId. Skipping sync.`);
          return;
        }

        // 2. Get Student to find moodleUserId
        const student = await ctx.call('users.get', { id: session?.studentId?.toString() });
        if (!student || !student.moodleUserId) {
          this.logger.warn(`[LTI] Student ${session?.studentId} has no moodleUserId. Skipping sync.`);
          return;
        }

        // 3. Extract Grade and Feedback
        // analysisData is the Analysis document.
        // Grade: simulationScore (0-100)
        // Feedback: summary
        const grade = analysisData.result?.simulationScore || 0;
        let feedback = analysisData.result?.summary || '';
        feedback = `${feedback} \n \n Chi tiết xem tại : <a href="${config.domain}/roleplay/course/${session.courseId}/session/${sessionId}/result" target="_blank">Coachee</a>`;
        // 4. Sync to Moodle
        const { baseUrl, moodleToken } = await this.getMoodleSettings();
        const { MoodleClient } = require('../moodle/moodle');
        const moodleClient = new MoodleClient(baseUrl, moodleToken);
        const result = await moodleClient.updateGrade(
          aiScenario.moodleAssignmentId,
          student.moodleUserId,
          grade,
          feedback,
        );

      } catch (err) {
        this.logger.error(`[LTI] Error in roleplay.analysis.completed handler:`, err);
      }
    },
  },
};
