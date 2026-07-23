'use strict';

const ApiGateway = require('moleculer-web');
const i18next = require('i18next');
const backend = require('i18next-node-fs-backend');
const _ = require('lodash');
const { enTranslation } = require('../locales/en/translation.js');
const { viTranslation } = require('../locales/vi/translation.js');
const cookie = require('cookie');
const { MoleculerClientError, MoleculerError } = require('moleculer').Errors;
const fs = require('fs');
const { hasPermission } = require('../helpers/permissionHelper');

const resources = {
  en: {
    translation: enTranslation,
  },
  vi: {
    translation: viTranslation,
  },
};
i18next
  .use(backend)
  .init({
    fallbackLng: 'en', // Fallback language
    preload: ['en', 'vi'], // Preload all supported languages
    resources: resources,
    ns: ['translation'],
    backend: {
      loadPath: 'locales/{{lng}}/{{ns}}.js',
    },
  })
  .then(() => console.log('i18next initialized'));

const SSE_RETRY_TIMEOUT = 15000; // 15 seconds
const SSE_HEADERS = {
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
};

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 * @typedef {import('http').IncomingMessage} IncomingRequest Incoming HTTP Request
 * @typedef {import('http').ServerResponse} ServerResponse HTTP Server Response
 * @typedef {import('moleculer-web').ApiSettingsSchema} ApiSettingsSchema API Setting Schema
 */
module.exports = {
  name: 'api',
  mixins: [ApiGateway],

  /** @type {ApiSettingsSchema} More info about settings: https://moleculer.services/docs/0.14/moleculer-web.html */
  settings: {
    // Exposed port
    port: process.env.PORT || 3000,

    // Exposed IP
    ip: '0.0.0.0',

    cors: {
      origin: [
        'http://localhost:3000',
        'http://localhost:8080',
        'https://coach-staging.clickee.vn',
        'https://coach.clickee.vn',
        'https://coach.clickee.ai',
        'https://api.coach.clickee.vn',
        'https://api.coach.clickee.vn',
        'https://api.coach-staging.clickee.vn',
        'https://lms.thinklabs.com.vn',
        'http://localhost',
        'http://127.0.0.1',
        'null', // For some local file/redirect cases
      ],

      credentials: true,

      methods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'],

      allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language', 'i18nextlng'],
    },

    routes: [
      {
        path: '/api',

        whitelist: ['**'],

        // Route-level Express middlewares. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Middlewares
        use: [],

        // Enable/disable parameter merging method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Disable-merging
        mergeParams: true,

        // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication
        authentication: true,

        // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization
        authorization: true,

        // The auto-alias feature allows you to declare your route alias directly in your services.
        // The gateway will dynamically build the full routes from service schema.
        autoAliases: true,

        aliases: {
          'GET '(request, response) {
            response.writeHead(404);
            response.end();
          },
        },

        /**
         * Before call hook. You can check the request.
         * @param {Context} ctx
         * @param {Object} route
         * @param {IncomingRequest} req
         * @param {ServerResponse} res
         * @param {Object} data
         *
         onBeforeCall(ctx, route, req, res) {
         // Set request headers to context meta
         ctx.meta.userAgent = req.headers["user-agent"];
         }, */

        /**
         * After call hook. You can modify the data.
         * @param {Context} ctx
         * @param {Object} route
         * @param {IncomingRequest} req
         * @param {ServerResponse} res
         * @param {Object} data
         onAfterCall(ctx, route, req, res, data) {
         // Async function which return with Promise
         return doSomething(ctx, res, data);
         }, */
        // Calling options. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Calling-options
        callingOptions: {},

        bodyParsers: {
          json: {
            strict: false,
            limit: '10MB',
          },
          urlencoded: {
            extended: true,
            limit: '10MB',
          },
        },

        // Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy
        mappingPolicy: 'all', // Available values: "all", "restrict"

        // Enable/disable logging
        logging: true,
        // Route error handler
        onBeforeCall(ctx, route, req, res) {
          const lang = req.headers.i18nextlng || 'vi';
          const requestHost = req.headers['x-forwarded-host'] || req.headers.host;
          const requestProto = req.headers['x-forwarded-proto'];
          if (requestHost) {
            ctx.meta.host = requestHost;
            ctx.meta.hostname = requestHost.split(':')[0];
            if (requestProto && ctx.meta.hostname) {
              ctx.meta.domain = `${requestProto}://${ctx.meta.hostname}`;
            }
          }
          if (req.query?.token) {
            req.headers.authorization = `Bearer ${req.query?.token}`;
            delete req.query.token;
          }
          if (req.$action.name === 'blockchain.create') {
            ctx.meta.token = req.headers.authorization;
          }
          if (req.$action.service.name === 'bs') {
            let [_, clickeeAPIKey] = req.headers.authorization.split(' ');
            ctx.meta.clickeeAPIKey = clickeeAPIKey;
          }
          i18next.changeLanguage(lang);
          ctx.meta.lang = lang;
          ctx.meta.client_ip =
            req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress;
        },
        onError(req, res, err) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(err.statusCode || err.code || 500);
          res.end(
            JSON.stringify({
              success: false,
              message: err.message || err,
              code: err.code || 500,
              data: err.data || {},
            }),
          );
        },
      },
      {
        path: '/upload',

        // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication
        authentication: true,

        // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization
        authorization: true,

        // You should disable body parsers
        bodyParsers: {
          json: true,
          urlencoded: false,
        },

        aliases: {
          // File upload from HTML form
          'POST /file': 'multipart:files.upload',
          'POST /uploadVideo': 'multipart:files.uploadVideo',
          'POST /extractText': 'multipart:files.extractTextFromFile',
          'POST /': 'multipart:files.save',
          'POST /image': 'multipart:images.upload',
          'POST /uploadWithoutCheckAccess': 'multipart:images.uploadWithoutCheckAccess',
          'POST /imageToText': 'multipart:images.imageToText',
          'POST /imageToDescription': 'multipart:images.imageToDescription',
          'POST /folder': 'files.folder',
          'POST /imageTemplate': 'multipart:templates.upload',
          'POST /imageProject': 'multipart:projects.upload',
          'POST /resource': 'multipart:resources.upload',
          'POST /offlinevideo': 'multipart:offlinevideos.upload',
          'POST /organizationAvatar': 'multipart:organizations.upload',
          'POST /docxTemplates': 'multipart:docxtemplates.upload',
          'PUT /updateDocxTemplate': 'multipart:docxtemplates.updateTemplate',
          'POST /uploadOrgTemplate': 'multipart:docxtemplates.uploadOrgTemplate',
          'POST /uploadDataset': 'multipart:conversations.uploadDataset',
          'POST /uploadVoices': 'multipart:voices.upload',
          'POST /exercisesAudio': 'multipart:exercises.upload',
          'POST /marketingUsers': 'multipart:mktusers.uploadExcel',
          'POST /testFile': 'multipart:rateLimit.testFile',
          'POST /references/file': 'multipart:references.uploadFile',
          'POST /references': 'multipart:references.uploadAndCreate',
          'POST /trainingdata': 'multipart:trainingdata.uploadBatchFile',
          'POST /roleplayVideo': 'multipart:roleplaysessions.uploadSessionVideo',
          'GET '(request, response) {
            response.writeHead(404);
            response.end();
          },
        },

        onBeforeCall(ctx, route, req, res) {
          if (req.headers.range) {
            ctx.meta.range = req.headers.range;
          }
        },

        // https://github.com/mscdex/busboy#busboy-methods
        busboyConfig: {
          limits: {
            files: 1,
          },
        },

        callOptions: {
          meta: {},
          timeout: 5 * 60 * 1000,
        },
        mappingPolicy: 'restrict',
      },
      {
        path: '/api/responses/:responseId',
        authentication: true,
        aliases: {
          'GET stream-content'(request, response) {
            const { responseId } = request.$params;
            response.writeHead(200, SSE_HEADERS);
            response.$service.addSSEListener(response, responseId);
            response.$ctx.emit(`listenResponse`, { responseId });
          },
        },
      },
      {
        path: '/api/transactions/:transactionId',
        authentication: true,
        aliases: {
          'GET stream-payment'(request, response) {
            const { transactionId } = request.$params;
            response.writeHead(200, SSE_HEADERS);
            response.$service.addSSEListener(response, transactionId);
            response.$ctx.emit(`listenCreateTransaction`, { transactionId });
          },
        },
      },
      {
        path: '/api/projects/:projectId',
        authentication: true,
        aliases: {
          'GET stream-mark-test'(request, response) {
            const { projectId } = request.$params;
            response.writeHead(200, SSE_HEADERS);
            response.$service.addSSEListener(response, projectId);
            response.$ctx.emit(`listenProject`, { projectId });
          },
        },
      },
      {
        path: '/api/files/:fileId',
        authentication: true,
        aliases: {
          async 'GET stream-media'(request, response) {
            try {
              const { fileId } = request.$params;
              const file = await response.$ctx.call(`files.get`, { id: fileId });
              const videoPath = await response.$ctx.call(`files.filePath`, { id: fileId });
              const videoSize = fs.statSync(videoPath).size;
              let range = request.headers.range;
              if (!range) {
                const head = {
                  'Content-Type': file.mimetype || 'video/mp4',
                  'Content-Length': videoSize,
                };
                response.writeHead(200, head);
                fs.createReadStream(videoPath).pipe(response);
              } else {
                const CHUNK_SIZE = 10 ** 6;
                const start = Number(range.replace(/\D/g, ''));
                const end = Math.min(start + CHUNK_SIZE, videoSize - 1);
                const contentLength = end - start + 1;
                const headers = {
                  'Content-Range': `bytes ${start}-${end}/${videoSize}`,
                  'Accept-Ranges': 'bytes',
                  'Content-Length': contentLength,
                  'Content-Type': file.mimetype || 'video/mp4',
                };
                response.writeHead(206, headers);
                const readStream = fs.createReadStream(videoPath, { start, end });
                readStream.pipe(response);
              }
            } catch (e) {
              console.log(e);
              response.writeHead(404);
              response.end();
            }
          },
        },
      },
      {
        path: '/api/ipa/:word',
        authentication: true,
        aliases: {
          async 'GET speak-word'(request, response) {
            try {
              const { word } = request.$params;
              const wordPath = await response.$ctx.call(`files.wordPath`, { word });
              const videoSize = fs.statSync(wordPath).size;
              let range = request.headers.range;
              if (!range) {
                const head = {
                  'Content-Type': 'video/mp4',
                  'Content-Length': videoSize,
                };
                response.writeHead(200, head);
                fs.createReadStream(wordPath).pipe(response);
              } else {
                const CHUNK_SIZE = 10 ** 6;
                const start = Number(range.replace(/\D/g, ''));
                const end = Math.min(start + CHUNK_SIZE, videoSize - 1);
                const contentLength = end - start + 1;
                const headers = {
                  'Content-Range': `bytes ${start}-${end}/${videoSize}`,
                  'Accept-Ranges': 'bytes',
                  'Content-Length': contentLength,
                  'Content-Type': 'video/mp4',
                };
                response.writeHead(206, headers);
                const readStream = fs.createReadStream(wordPath, { start, end });
                readStream.pipe(response);
              }
            } catch (e) {
              console.log(e);
              response.writeHead(404);
              response.end();
            }
          },
        },
      },
      {
        path: '/',
        whitelist: [],
        aliases: {
          'GET '(request, response) {
            response.writeHead(404);
            response.end();
          },
        },
      },
    ],

    // Do not log client side errors (does not log an error response when the error.code is 400<=X<500)
    log4XXResponses: true,
    // Logging the request parameters. Set to any log level to enable it. E.g. "info"
    logRequestParams: null,
    // Logging the response data. Set to any log level to enable it. E.g. "info"
    logResponseData: null,

    // Serve assets from "public" folder. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Serve-static-files
    assets: {
      folder: 'public',

      // Options to `server-static` module
      options: {},
    },
    JWT_SECRET: process.env.JWT_SECRET || 'jwt-tradar-secret',
    // Global error handler
    onError(req, res, err) {
      res.setHeader('Content-Type', 'text/plain');
      res.writeHead(err.statusCode || err.code || 501);
      res.end(
        JSON.stringify({
          success: false,
          code: err.code,
          message: err.message,
        }),
      );
    },
  },

  methods: {
    /**
     * Authenticate the request. It check the `Authorization` token value in the request header.
     * Check the token value & resolve the user by the token.
     * The resolved user will be available in `ctx.meta.user`
     *
     * @param {Context} ctx
     * @param {Object} route
     * @param {IncomingRequest} req
     * @returns {Promise}
     */
    async authenticate(ctx, route, req) {
      let accessToken, refreshToken, resetPasswordToken, activationToken;
      if (req.headers.cookie) {
        const cookieHeaders = req.headers.cookie.split(';');
        cookieHeaders.forEach(cookieItem => {
          const [type, token] = cookieItem.trim().split('=');
          if (type === 'accessToken') accessToken = token;
          if (type === 'refreshToken') refreshToken = token;
        });
      }

      const urlResetPasswordCheckBearer = req.originalUrl.includes('resetPassword');
      const urlActivationCheckBearer = req.originalUrl.includes('activeAccount');

      if (req.headers.authorization) {
        let [type, token] = req.headers.authorization.split(' ');
        if (type === 'Token' || type === 'Bearer') {
          if (urlResetPasswordCheckBearer) resetPasswordToken = token;
          if (urlActivationCheckBearer) activationToken = token;
        }
      }

      ctx.meta.refreshToken = refreshToken;
      let user;

      if (activationToken) {
        user = await ctx.call('users.resolveActivationToken', { activationToken });
        if (user) {
          await ctx.call('users.lastVisit', { id: user._id });
          this.logger.info('Authenticated via JWT: ', user.username);
          ctx.meta.activationToken = activationToken;
          ctx.meta.userID = user._id;
          return _.pick(user, [
            '_id',
            'email',
            'isDeleted',
            'isSystemAdmin',
            'organizationId',
            'type',
            'role',
            'persona',
            'fullName',
          ]);
        } else {
          throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS');
        }
      }

      if (resetPasswordToken) {
        user = await ctx.call('users.resolveResetPasswordToken', { resetPasswordToken });
        if (user) {
          await ctx.call('users.lastVisit', { id: user._id });
          this.logger.info('Authenticated via JWT: ', user.username);
          ctx.meta.resetPasswordToken = resetPasswordToken;
          ctx.meta.userID = user._id;
          return _.pick(user, [
            '_id',
            'email',
            'isDeleted',
            'isSystemAdmin',
            'organizationId',
            'type',
            'role',
            'persona',
            'fullName',
          ]);
        } else {
          throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS');
        }
      }

      if (accessToken) {
        // Verify JWT accessToken
        try {
          user = await ctx.call('users.resolveToken', { accessToken });
          if (user) {
            ctx.call('users.lastVisit', { id: user._id });
            this.logger.info('Authenticated via JWT: ', user.username);
            // Reduce user fields (it will be transferred to other nodes)
            // ctx.meta.user = user;
            ctx.meta.accessToken = accessToken;
            ctx.meta.userID = user._id;
            return _.pick(user, [
              '_id',
              'email',
              'isDeleted',
              'isSystemAdmin',
              'organizationId',
              'type',
              'role',
              'persona',
              'fullName',
              'phone',
              'roleId',
            ]);
          }
        } catch (err) {
          // Ignored because we continue processing if user doesn't exists
        }
      }
    },

    /**
     * Authorize the request. Check that the authenticated user has right to access the resource.
     *
     * PLEASE NOTE, IT'S JUST AN EXAMPLE IMPLEMENTATION. DO NOT USE IN PRODUCTION!
     *
     * @param {Context} ctx
     * @param {Object} route
     * @param {IncomingRequest} req
     * @returns {Promise}
     */
    async authorize(ctx, route, req) {
      // Get the authenticated user.
      const user = ctx.meta.user;
      req.user = user;
      //Check and change language
      let lang = req.headers.i18nextlng;
      i18next.changeLanguage(lang);
      // It check the `auth` property in action schema.
      // if (req.$action.auth === "required" && !user && !req.$action.skipUser) {
      if (req.$action.auth === 'required' && !user) {
        throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS');
      }

      // Check RBAC permissions (new permission system)
      if (req.$action.permission && user) {
        const { resource, action } = req.$action.permission;
        const hasAccess = await hasPermission(ctx, resource, action);

        if (!hasAccess) {
          throw new MoleculerClientError(i18next.t('error_permission_denied'), 403);
        }
      }
    },

    addSSEListener(stream, event) {
      if (!stream.write) throw new MoleculerError('Only writable can listen to SSE.');

      const listeners = this.sseListeners.get(event) || new Set();
      listeners.add(stream);
      this.sseListeners.set(event, listeners);
      this.sseIds.set(stream, 0);

      // Biến để lưu trữ ID của timeout
      let timeoutId = null;

      // Hàm tạo hoặc reset timeout
      const resetTimeout = () => {
        // Xóa timeout hiện tại nếu có
        if (timeoutId) clearTimeout(timeoutId);

        // Tạo timeout mới
        timeoutId = setTimeout(() => {
          if (this.sseIds.has(stream)) {
            stream.end('event: timeout\ndata: {"message":"Connection timeout"}\n\n');
            listeners.delete(stream);
            this.sseIds.delete(stream);
          }
        }, this.sseRetry * 2);
      };

      // Thiết lập timeout ban đầu
      resetTimeout();

      // Tạo heartbeat và đảm bảo nó reset timeout
      const heartbeatInterval = setInterval(
        () => {
          if (this.sseIds.has(stream)) {
            stream.write('event: heartbeat\ndata: {}\n\n');
            resetTimeout(); // Reset timeout sau mỗi lần heartbeat
          } else {
            clearInterval(heartbeatInterval);
          }
        },
        Math.floor(this.sseRetry / 3),
      );

      // Override phương thức write để reset timeout mỗi khi có dữ liệu được gửi
      const originalWrite = stream.write;
      stream.write = function (...args) {
        resetTimeout();
        return originalWrite.apply(this, args);
      };

      stream.on('close', () => {
        clearTimeout(timeoutId);
        clearInterval(heartbeatInterval);
        this.sseIds.delete(stream);
        listeners.delete(stream);
      });

      stream.on('error', () => {
        clearTimeout(timeoutId);
        clearInterval(heartbeatInterval);
        this.sseIds.delete(stream);
        listeners.delete(stream);
        stream.end();
      });
    },
    handleSSE(context) {
      const { eventName, params } = context;
      const event = eventName.replace('sse.', '');
      if (!this.sseListeners.has(event)) return;
      const listeners = this.sseListeners.get(event);
      const isEnd = params.state === 'done' || params.state === 'error';
      for (const stream of listeners.values()) {
        const id = this.sseIds.get(stream) || 0;
        const message = this.createSSEMessage(params, event, id);
        stream.write(message);
        this.sseIds.set(stream, id + 1);
        if (isEnd) {
          stream.end();
          listeners.delete(stream);
          this.sseIds.delete(stream);
        }
      }
    },
    createSSEMessage(data, event, id) {
      return `event: ${event}\ndata: ${JSON.stringify(data)}\nid: ${id}\nretry: ${this.sseRetry}\n\n`;
    },
  },
  started() {
    this.sseListeners = new Map();
    this.sseIds = new WeakMap();
    this.sseRetry = SSE_RETRY_TIMEOUT;
  },

  stopped() {
    for (const listeners of this.sseListeners.values()) {
      for (const stream of listeners.values()) {
        if (stream.end) stream.end();
        listeners.delete(stream);
        this.sseIds.delete(stream);
      }
    }
  },
  events: {
    'sse.*'(context) {
      this.handleSSE(context);
    },
  },
};
