'use strict';
const moment = require('moment');

const DbMongoose = require('../../mixins/dbMongo.mixin');
const { USER_CODES } = require('../../constants/constant');
const { MoleculerClientError } = require('moleculer').Errors;
const bcrypt = require('bcryptjs');
const USER = require('./users.model');
const i18next = require('i18next');
const { sendEmail, generateChangePasswordEmail } = require('../../helpers/emailHelper');
const { getConfig } = require('../../config/config');
const { comparePassword, encryptPassword } = require('./users.helper');
const { validateUsername, validatePassword, validateFullName, validateEmail } = require('../../helpers/validationHelper');
const { RESOURCES, ACTIONS } = require('../../constants/permissions');
const jwt = require('../../helpers/jwt');
const BaseService = require('../../mixins/baseService.mixin');
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const { IMAGE_SERVICE } = require('../Image');
const { ORGANIZATION_SERVICE } = require('../Organization');
const config = getConfig(process.env.NODE_ENV);
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const cookie = require('cookie');
const { createRegisterEmail, createWaitListNewUser, createActiveAccountEmail } = require('./emailtemplate/emailtemplate');
const axios = require('axios');
const { USER_STATE } = require('../../constants/constant');
const VNPTUser = require('./users.vnpt');
const {
  Types: { ObjectId },
} = require('mongoose');

module.exports = {
  name: 'users',
  mixins: [DbMongoose(USER), BaseService, FunctionsCommon, VNPTUser, DefaultPermission],
  // dependencies: ["settings"],
  /**
   * Default settings
   */
  settings: {
    defaultResource: RESOURCES.USER,
    /** REST Basepath */
    rest: '/users',
    /** Secret for JWT */
    JWT_SECRET: process.env.JWT_SECRET || 'jwt-tradar-secret',
    JWT_RESET_PASSWORD_SECRET: process.env.JWT_RESET_PASSWORD_SECRET || 'jwt-tradar-reset-password-secret',
    JWT_ACTIVATION_SECRET: process.env.JWT_ACTIVATION_SECRET || 'jwt-tradar-activation-secret',

    /** Public fields */
    fields: [
      '_id',
      'email',
      'fullName',
      'avatar',
      'username',
      'active',
      'phone',
      'gender',
      'lastVisit',
      'state',
      'isDeveloper',
      'imageAvatarId',
      'organizationId',
      'isSystemAdmin',
      'lastLogin',
      'type',
      'role',
      'isShowAdmin',
      'hasPassword',
      'createdAt',
      'updatedAt',
      'roleId',
      'moodleUserId',
      'isDeleted',
      'jobTitleId',
    ],

    /** Validator schema for entity */
    entityValidator: {
      email: { type: 'email' },
      avatar: { type: 'string', optional: true },
    },
    populates: {
      imageAvatarId: IMAGE_SERVICE.get,
      organizationId: ORGANIZATION_SERVICE.get,
      roleId: 'roles.get',
      jobTitleId: 'jobtitles.get',
    },
    populateOptions: ['imageAvatarId', 'organizationId.avatarId', 'organizationId.parentOrganizationId', 'roleId', 'jobTitleId'],
  },

  actions: {
    login: {
      rest: 'POST /login',
      params: {
        username: { type: 'string', optional: true },
        email: { type: 'string', optional: true }, // backward compatibility
        phone: { type: 'string', optional: true },
        password: { type: 'string', min: 1 },
      },
      skipToken: true,
      async handler(ctx) {
        let { username, email, phone, password, deviceToken } = ctx.params;

        let userQuery;
        if (username) {
          userQuery = { username, isDeleted: false };
        } else if (email) {
          userQuery = { email, isDeleted: false };
        } else if (phone) {
          userQuery = { phone, isDeleted: false };
        } else {
          throw new MoleculerClientError(i18next.t('login_fail'));
        }

        let user = await this.adapter.findOne(userQuery);
        if (!user) {
          throw new MoleculerClientError(i18next.t('login_fail'));
        }

        // Kiem tra trang thai cua tai khoan
        if (user.state && user.state !== USER_STATE.ACTIVE) {
          const checkState = await this.checkUserStateLogin(ctx, user);
          if (!checkState) {
            throw new MoleculerClientError(i18next.t('email_in_waitlist_try_again'), 202);
          }
          user = await this.adapter.updateById(user._id, { state: USER_STATE.ACTIVE });
        }

        let authenticated;
        if (!authenticated && user?.password) {
          authenticated = await this.comparePassword(password, user.password);
        }
        if (!authenticated) {
          throw new MoleculerClientError(i18next.t('login_fail'));
        }

        if (!user.active) {
          throw new MoleculerClientError(i18next.t('error_account_not_active'), 403);
        }

        if (user.hasLocked) {
          throw new MoleculerClientError(i18next.t('error_account_locked'), 403);
        }

        const accessToken = jwt.issue({ id: user._id, isUser: true }, '72h', this.settings.JWT_SECRET);
        const refreshToken = await this.refreshTokenCreator(ctx, user);

        this.setTokenToCookies(ctx, accessToken, refreshToken);
        await this.findAndRemoveDeviceToken(deviceToken);
        await this.addOrUpdateDeviceToken(user, deviceToken);
        user.password = undefined;
        if (!user.lastLogin) {
          await this.adapter.updateById(user._id, { lastLogin: new Date() });
        }
        delete user.__v;
        const userTransform = await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, user);
        const subscription = await ctx.call('subscriptions.getActive', { userId: userTransform._id });
        return { user: { ...userTransform, subscription } };
      },
    },

    loginGoogle: {
      rest: 'POST /google',
      skipToken: true,
      async handler(ctx) {
        const { code } = ctx.params;
        const data = await this.getOauthGoogleToken(code); // Gửi authorization code để lấy Google OAuth token
        const { id_token, access_token, refresh_token } = data; // Lấy ID token và access token từ kết quả trả về

        const googleUser = await this.getGoogleUser(id_token, access_token); // Gửi Google OAuth token để lấy thông tin người dùng từ Google
        // Kiểm tra email đã được xác minh từ Google
        if (!googleUser.verified_email) {
          throw new MoleculerClientError(i18next.t('google_email_not_verified'));
        }

        let user = await ctx.call('users.findOne', { email: googleUser.email });
        // Neu chua co tai khoan thi dang ki moi
        if (!user) {
          user = await this.actions.register({
            email: googleUser.email,
            fullName: googleUser.name,
          });
        }

        // Kiem tra trang thai cua tai khoan
        if (user.state && user.state !== USER_STATE.ACTIVE) {
          const checkState = await this.checkUserStateLogin(ctx, user);
          if (checkState !== USER_STATE.ACTIVE) {
            throw new MoleculerClientError(i18next.t('email_in_waitlist_try_again'), 202);
          }
          user = await this.adapter.updateById(user._id, { state: USER_STATE.ACTIVE, active: true });
        } else if (user.message) {
          throw new MoleculerClientError(user.message);
        }

        if (!user.active) {
          await this.adapter.updateById(user._id, { active: true });
        }

        // Tạo manual_access_token và manual_refresh_token sử dụng JWT (JSON Web Token)
        const accessToken = jwt.issue({ id: user._id, isUser: true }, '24h', this.settings.JWT_SECRET);
        const refreshToken = await this.refreshTokenCreator(ctx, user);

        this.setTokenToCookies(ctx, accessToken, refreshToken);
        user.password = undefined;
        delete user.__v;
        return { user };
      },
    },
    findOne: {
      rest: 'GET /findOne',
      params: {
        email: { type: 'string' },
      },
      async handler(ctx) {
        return this.adapter.findOne({ ...ctx.params });
      },
    },
    forgotPasswordMail: {
      rest: 'POST /forgotPassword',
      params: {
        email: { type: 'string' },
      },
      skipToken: true,
      async handler(ctx) {
        let { email } = ctx.params;
        const user = await this.adapter.findOne({ email: email, isDeleted: false });
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_email_not_found'), 422);
        }

        if (user.state === USER_STATE.WAITLIST) {
          throw new MoleculerClientError(i18next.t('email_in_waitlist_try_again'), 202);
        }

        if (!user.active) {
          throw new MoleculerClientError(i18next.t('error_account_not_active'), 403);
        }

        let url = this.createResetPasswordLink(user._id, '5m'); // createResetPasswordLink
        let mailOptions = {
          from: `${i18next.t('email_user_create_from')} <${config.mail.auth.user}>`, // sender address
          to: user.email, // list of receivers
          subject: `${i18next.t('email_subject_user_forgot_password')}`, // Subject line
          html: `<p>${i18next.t('email_html1_user_forgot_password')}</p>  </br>
              <p>
                ${i18next.t('email_html2_user_forgot_password')} :
                <a href="${url}" target="_blank" rel="noopener noreferrer">
                  ${url}
                </a>
              </p>`, // html body
        };

        sendEmail(mailOptions, err => {
          if (err) {
            console.log(err);
            return { success: false, message: 'Send mail error, please try again' };
          }
        });
        return { success: true, message: i18next.t('check_email_for_reset_link') };
      },
    },

    register: {
      rest: 'POST /register',
      params: {
        // password: { type: "string", min: 6 },
        email: { type: 'email' },
        fullName: { type: 'string', min: 1 },
        avatar: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const data = ctx.params;
        await this.validateEntity(data);

        data.state = USER_STATE.WAITLIST;
        delete data.isSystemAdmin;

        // Check email
        const checkMail = await this.adapter.findOne({ email: data.email });
        if (checkMail) {
          throw new MoleculerClientError(i18next.t('account_already_exists'));
        }

        if (data.phone) {
          const checkExistPhone = await this.adapter.findOne({ phone: data.phone, isDeleted: false });
          if (checkExistPhone) {
            throw new MoleculerClientError(i18next.t('phone_has_registered'));
          }
        }
        let requiredResetPassword = false;
        if (!data.password) {
          data.password = this.generateRandomPassword();
          data.hasPassword = false;
          requiredResetPassword = true;
        }

        const user = await this.adapter.insert(data);
        this.broker.emit('user.registered', user);

        const state = await this.checkUserState(ctx, user, requiredResetPassword);
        if (state !== USER_STATE.ACTIVE) {
          return { success: true, message: i18next.t('email_added_to_waitlist') };
        }

        const userUpdate = await this.adapter.updateById(user._id, { state: USER_STATE.ACTIVE });
        return await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, userUpdate);
      },
    },

    restore: {
      rest: 'POST /:id/restore',
      auth: 'required',
      permission: { resource: RESOURCES.USER, action: ACTIONS.RESTORE },
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        const { id } = ctx.params;

        const user = await this.adapter.findById(id);
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }

        const restored = await this.adapter.updateById(id, { isDeleted: false }, { new: true });
        return {
          success: true,
          message: i18next.t('user_restored_successfully'),
          data: restored,
        };
      },
    },

    create: {
      rest: 'POST /',
      auth: 'required',
      permission: { resource: RESOURCES.USER, action: ACTIONS.CREATE },
      params: {
        username: { type: 'string', min: 6, max: 32 },
        email: { type: 'email' },
        fullName: { type: 'string', min: 1, max: 100 },
        password: { type: 'string', min: 8, optional: true },
        roleId: { type: 'array', items: 'string', optional: true },
        organizationId: { type: 'string', optional: true },
        gender: { type: 'enum', values: ['Nam', 'Nữ', 'Khác'], optional: true },
        phone: { type: 'string', optional: true },
        avatar: { type: 'string', optional: true },
        jobTitleId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const data = ctx.params;
        // data.active = true;

        // Validate username
        const usernameValidation = validateUsername(data.username);
        if (!usernameValidation.valid) {
          throw new MoleculerClientError(i18next.t(usernameValidation.error), 422);
        }

        // Validate fullName
        const fullNameValidation = validateFullName(data.fullName);
        if (!fullNameValidation.valid) {
          throw new MoleculerClientError(i18next.t(fullNameValidation.error), 422);
        }

        // Validate email
        const emailValidation = validateEmail(data.email);
        if (!emailValidation.valid) {
          throw new MoleculerClientError(i18next.t(emailValidation.error), 422);
        }

        // Check unique username
        const existingUsername = await this.adapter.findOne({ username: data.username.toLowerCase() });
        if (existingUsername) {
          throw new MoleculerClientError(i18next.t('error_username_exists'), 422);
        }

        // Check unique email
        const checkMail = await this.adapter.findOne({ email: data.email });
        if (checkMail) {
          throw new MoleculerClientError(i18next.t('user_email_has_registered'), 422);
        }

        // Check unique phone
        if (data.phone) {
          const checkExistPhone = await this.adapter.findOne({ phone: data.phone, isDeleted: false });
          if (checkExistPhone) {
            throw new MoleculerClientError(i18next.t('phone_has_registered'), 422);
          }
        }

        // Validate and check roleId exists
        if (data.roleId && data.roleId.length > 0) {
          const roles = await ctx.call('roles.find', {
            query: { _id: { $in: data.roleId }, isDeleted: false },
          });

          if (roles.length !== data.roleId.length) {
            throw new MoleculerClientError(i18next.t('error_role_not_found'), 404);
          }
        }

        let requiredResetPassword = false;
        if (!data.password) {
          data.password = this.generateRandomPassword();
          data.hasPassword = false;
          requiredResetPassword = true;
        } else {
          // Validate password strength
          const passwordValidation = validatePassword(data.password);
          if (!passwordValidation.valid) {
            throw new MoleculerClientError(i18next.t(passwordValidation.error), 422);
          }
        }

        data.username = data.username.toLowerCase();
        const user = await this.adapter.insert(data);

        // Nếu có organizationId, thêm user vào danh sách members của organization đó
        if (data.organizationId) {
          await this.broker.call('organizationUsers.create', {
            userId: user._id.toString(),
            organizationId: data.organizationId.toString(),
            isAdmin: data.role === USER_CODES.ORG_ADMIN,
          });
        }
        const activateLink = config.domain;
        this.broker.emit('user.registered', user);
        if (data.email) {
          let mailOptions = {
            from: `${i18next.t('email_user_create_from')} <${config.mail.auth.user}>`,
            to: data.email,
            subject: i18next.t('email_user_register_html1'),
            html: createRegisterEmail({ account: data.username, fullName: data.fullName, password: data.password }, activateLink),
          };

          sendEmail(mailOptions, err => {
            if (err) {
              console.log(err);
            }
          });
        }

        return this.transformDocuments(ctx, {}, user);
      },
    },

    internalCreate: {
      // Action này không nên được expose ra ngoài qua REST
      visibility: 'protected',
      params: {
        email: { type: 'email' },
        fullName: { type: 'string', min: 1 },
        organizationId: { type: 'string', optional: true },
        role: { type: 'string', optional: true },
        type: { type: 'string', optional: true },
        moodleUserId: { type: 'number', optional: true },
      },
      async handler(ctx) {
        const data = ctx.params;
        data.active = true;

        await this.validateEntity(data);

        const checkMail = await this.adapter.findOne({ email: data.email });
        if (checkMail) {
          throw new MoleculerClientError(i18next.t('user_email_has_registered'));
        }

        data.password = this.generateRandomPassword();
        data.hasPassword = false;

        const user = await this.adapter.insert(data);
        const activateLink = this.createResetPasswordLink(user._id, '30d');
        this.broker.emit('user.registered', user);

        let mailOptions = {
          from: `${i18next.t('email_user_create_from')} <${config.mail.auth.user}>`,
          to: data.email,
          subject: i18next.t('email_user_register_html1'),
          html: createRegisterEmail({ account: data.email, fullName: data.fullName }, activateLink),
        };

        sendEmail(mailOptions, err => err && console.log(err));

        return user;
      },
    },
    changePassword: {
      rest: 'POST /changePassword',
      params: {
        oldPassword: { type: 'string', min: 1 },
        newPassword: { type: 'string', min: 1 },
        // currentRefreshToken: { type: "string", min: 6 },
      },
      auth: 'required',
      skipToken: true,
      async handler(ctx) {
        let { oldPassword, newPassword, currentRefreshToken } = ctx.params;
        let { userID } = ctx.meta;
        const user = await this.adapter.findOne({ isDeleted: false, _id: userID });
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_old_password_wrong'), 400);
        }

        const authenticated = comparePassword(oldPassword, user.password);
        if (!authenticated) {
          throw new MoleculerClientError(i18next.t('error_old_password_wrong'), 400);
        }

        const encryptedPass = encryptPassword(newPassword);

        let userUpdate = await this.adapter.updateById(userID, {
          hasPassword: true,
          password: encryptedPass,
          neverLogin: false,
          lastChangePassword: new Date(),
        });

        if (userUpdate) {
          await this.timeout(1000);
          // Create new access token
          userUpdate.accessToken = jwt.issue({ id: user?.id, isUser: user?.isUser }, '24h', this.settings.JWT_SECRET);
        }

        if (currentRefreshToken) {
          // Ngoại trừ refreshtoken hiện tại thì xóa toàn bộ các refresh token khác của user hiện tại trong DB
          await ctx.call('refreshToken.deleteMany', {
            userId: user?._id,
            refreshToken: { $ne: currentRefreshToken },
          });
        } else {
          // Xóa toàn bộ các refresh token khác của user hiện tại trong DB
          await ctx.call('refreshToken.deleteMany', { userId: user?._id });
        }
        const emailContent = generateChangePasswordEmail(userUpdate.fullName, config.domain);

        let mailOptions = {
          from: `${i18next.t('email_user_create_from')} <${config.mail.auth.user}>`, // sender address
          to: userUpdate.email, // list of receivers
          subject: i18next.t('error_user_change_message_successful'), // Subject line
          html: emailContent, // html body
        };

        sendEmail(mailOptions, err => {
          if (err) {
            console.log(err);
          }
        });
        return await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, userUpdate);
      },
    },

    resetPassword: {
      rest: 'POST /resetPassword',
      auth: 'required',
      skipToken: true,
      async handler(ctx) {
        const user = await this.adapter.findOne({ isDeleted: false, _id: ctx.meta.userID });
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'));
        }
        const encryptedPass = encryptPassword(ctx.params.password);

        const userUpdate = await this.adapter.updateById(
          user._id,
          {
            password: encryptedPass,
            hasPassword: true,
          },
          { new: true },
        );

        let mailOptions = {
          from: `${i18next.t('email_user_create_from')} <${config.mail.auth.user}>`, // sender address
          to: userUpdate.email, // list of receivers
          subject: i18next.t('change_password_successfully'), // Subject line
          html: generateChangePasswordEmail(userUpdate.fullName, config.domain),
        };

        sendEmail(mailOptions, err => {
          if (err) {
            console.log(err);
          }
        });
        return { success: true, message: i18next.t('reset_password_successfully') };
      },
    },

    confirmRegister: {
      rest: 'POST /confirmRegister',
      skipToken: true,
      async handler(ctx) {
        await this.validateEntity(ctx.params);
        const { email, password, fullName, organizationId } = ctx.params;

        // Check email
        const checkMail = await this.adapter.findOne({ email });
        if (checkMail) {
          throw new MoleculerClientError(i18next.t('account_already_exists'));
        }

        //Them email vao waitlist
        await ctx.call('whitelist.create', { email: email, organizationId: organizationId });

        const member = await ctx.call('invitations.find', { query: { email, organizationId } });

        // Tao tai khoan moi
        const user = await this.adapter.insert({
          email,
          password,
          fullName,
          organizationId,
          role: member[0]?.role,
          state: USER_STATE.ACTIVE,
          active: true,
        });

        this.broker.emit('user.registered', user);
        ctx.emit('userConfirmedRegister', { user });
        return await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, user);
      },
    },
    /**
     * Get user by JWT token (for API GW authentication)
     *
     * @actions
     * @param {String} token - JWT token
     *
     * @returns {Object} Resolved user
     */
    resolveToken: {
      cache: {
        keys: ['token'],
        ttl: 30 * 60 * 60 * 24, // 1 day
      },
      params: {
        accessToken: 'string',
      },
      async handler(ctx) {
        const decoded = await jwt.verifyToken(ctx.params.accessToken, this.settings.JWT_SECRET);
        if (decoded?.id) {
          const user = await this.getById(decoded.id);
          return this.transformDocuments(ctx, {}, user);
        }
      },
    },
    resolveResetPasswordToken: {
      cache: {
        keys: ['token'],
        ttl: 60 * 5, // 5 minutes
      },
      params: {
        resetPasswordToken: 'string',
      },
      async handler(ctx) {
        const decoded = await jwt.verifyToken(ctx.params.resetPasswordToken, this.settings.JWT_RESET_PASSWORD_SECRET);
        if (decoded?.id) {
          const user = await this.getById(decoded.id);
          return this.transformDocuments(ctx, {}, user);
        }
      },
    },
    resolveActivationToken: {
      cache: {
        keys: ['token'],
        ttl: 60 * 60 * 24 * 365, // 1 year
      },
      params: {
        activationToken: 'string',
      },
      async handler(ctx) {
        const decoded = await jwt.verifyToken(ctx.params.activationToken, this.settings.JWT_ACTIVATION_SECRET);
        if (decoded?.id) {
          const user = await this.getById(decoded.id);
          return this.transformDocuments(ctx, {}, user);
        }
      },
    },

    me: {
      rest: 'GET /me',
      auth: 'required',
      skipUser: true,
      skipToken: true,
      async handler(ctx) {
        const user = await this.getById(ctx.meta.user._id);
        if (!user) throw new MoleculerClientError(i18next.t('error_user_not_found'), 400);

        const userTransformed = await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, user);
        userTransformed.version = '1.3.1 - 2025-04-01__01';
        delete userTransformed.password;
        userTransformed.hasPassword = !!userTransformed.hasPassword;

        return { ...userTransformed };
      },
    },

    logout: {
      rest: 'GET /logout',
      skipToken: true,
      async handler(ctx) {
        this.setTokenToCookies(ctx, '', '');
        return { success: true };
      },
    },

    updateInfo: {
      rest: 'PATCH /info',
      auth: 'required',
      async handler(ctx) {
        const id = ctx.meta.user._id;
        const value = ctx.params;

        delete value.hasPassword;
        delete value.password;
        delete value.role;
        delete value.isSystemAdmin;
        delete value.permissions;
        delete value.active;
        delete value.lastLogin;
        delete value.isDeleted;
        // check unique email
        if (value.email) {
          const checkMail = await this.adapter.findOne(
            {
              email: value.email,
              isDeleted: false,
              _id: { $ne: id },
            },
            { _id: 1 },
          );
          if (checkMail) {
            throw new MoleculerClientError(i18next.t('user_email_has_registered'), 422);
          }
        }

        if (value.phone) {
          const checkExistPhone = await this.adapter.findOne({
            phone: value.phone,
            isDeleted: false,
            _id: { $ne: id },
          });
          if (checkExistPhone) {
            throw new MoleculerClientError(i18next.t('phone_number_already_exists'));
          }
        }
        const user = await this.adapter.updateById(id, value, { new: true });

        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }

        if (user.email) {
          let mailOptions = {
            from: `${i18next.t('email_user_create_from')} <${config.mail.auth.user}>`, // sender address
            to: value.email, // list of receivers
            subject: i18next.t('account_information_updated_successfully'), // Subject line
            //text: 'Pass moi la 123455', // plaintext body
            html: `<h2>${i18next.t('account_information')}</h2>
              <div><strong>${i18next.t('full_name')}: </strong>${user.fullName}</div>
              <div><strong>${i18next.t('phone')}: </strong>${user.phone || ''}</div>
              <div><strong>${i18next.t('email')}: </strong>${user.email}</div>
              <div>${i18next.t('sign_in')} <a href="${config.domain}">Link</a></div>`, // html body
          };
          sendEmail(mailOptions, err => {
            if (err) {
              console.log(err);
            }
          });
        }
        return await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, user);
      },
    },

    remove: {
      rest: 'DELETE /:id',
      auth: 'required',
      permission: { resource: RESOURCES.USER, action: ACTIONS.DELETE },
      params: {
        id: { type: 'string', min: 3 },
      },
      async handler(ctx) {
        const { id } = ctx.params;
        const user = await this.adapter.findById(id);

        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }

        if (user.isSystemAdmin) {
          throw new MoleculerClientError(i18next.t('error_cannot_delete_sysadmin'), 403);
        }

        // Soft delete only
        const deleted = await this.adapter.updateById(id, { isDeleted: true }, { new: true });

        return {
          success: true,
          message: i18next.t('user_deleted_successfully'),
          data: deleted,
        };
      },
    },
    update: {
      rest: 'PUT /:id',
      auth: 'required',
      permission: { resource: RESOURCES.USER, action: ACTIONS.UPDATE },
      params: {
        id: { type: 'string', min: 3 },
        fullName: { type: 'string', min: 1, max: 100, optional: true },
        email: { type: 'email', optional: true },
        roleId: { type: 'array', items: 'string', optional: true },
        organizationId: { type: 'string', optional: true },
        gender: { type: 'enum', values: ['Nam', 'Nữ', 'Khác'], optional: true },
        phone: { type: 'string', optional: true },
        active: { type: 'boolean', optional: true },
        moodleUserId: { type: 'number', optional: true },
      },
      async handler(ctx) {
        const { id, ...value } = ctx.params;

        // Username is readonly - cannot be updated
        delete value.password;
        delete value.isSystemAdmin;

        // Validate fullName if provided
        if (value.fullName) {
          const fullNameValidation = validateFullName(value.fullName);
          if (!fullNameValidation.valid) {
            throw new MoleculerClientError(i18next.t(fullNameValidation.error), 422);
          }
        }

        // Validate email if provided
        if (value.email) {
          const emailValidation = validateEmail(value.email);
          if (!emailValidation.valid) {
            throw new MoleculerClientError(i18next.t(emailValidation.error), 422);
          }

          // Check unique email
          const checkMail = await this.adapter.findOne({ _id: { $ne: id }, email: value.email });
          if (checkMail) {
            throw new MoleculerClientError(i18next.t('user_email_has_registered'), 422);
          }
        }

        // Check unique phone
        if (value.phone) {
          const checkExistPhone = await this.adapter.findOne({
            phone: value.phone,
            isDeleted: false,
            _id: { $ne: id },
          });
          if (checkExistPhone) {
            throw new MoleculerClientError(i18next.t('phone_has_registered'), 422);
          }
        }

        // Validate and check roleId exists
        if (value.roleId && value.roleId.length > 0) {
          const roles = await ctx.call('roles.find', {
            query: { _id: { $in: value.roleId }, isDeleted: false },
          });

          if (roles.length !== value.roleId.length) {
            throw new MoleculerClientError(i18next.t('error_role_not_found'), 404);
          }
        }

        const oldUser = await this.adapter.findById(id);
        if (!oldUser) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }

        const updatePayload = { ...value };
        const isRemovingFromOrg =
          updatePayload.organizationId === null ||
          updatePayload.organizationId === '';

        if (isRemovingFromOrg) {
          // Nếu xóa khỏi tổ chức, dùng $unset
          delete updatePayload.organizationId;
          updatePayload.$unset = { organizationId: '' };
        }

        const user = await this.adapter.updateById(id, updatePayload, { new: true });
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }

        const oldOrgId = oldUser.organizationId;
        const newOrgId = isRemovingFromOrg ? undefined : user.organizationId;

        if (oldOrgId?.toString() !== newOrgId?.toString()) {
          if (oldOrgId) {
            await this.broker.call('organizationUsers.updateMany', {
              query: { userId: user._id, organizationId: oldOrgId },
              update: { $set: { isDeleted: true } },
            });
          }
          // Tạo bản ghi quan hệ mới
          if (newOrgId) {
            await this.broker.call('organizationUsers.create', {
              userId: user._id.toString(),
              organizationId: newOrgId.toString(),
              isAdmin: user.role === USER_CODES.ORG_ADMIN,
            });
          }
        }

        if (user.email) {
          let mailOptions = {
            from: `${i18next.t('email_user_create_from')} <${config.mail.auth.user}>`,
            to: value.email || user.email,
            subject: i18next.t('account_information_updated_successfully'),
            html: `<h2>${i18next.t('account_information')}</h2>
              <div><strong>${i18next.t('full_name')}: </strong>${user.fullName}</div>
              <div><strong>${i18next.t('email')}: </strong>${user.email}</div>
              <div>${i18next.t('sign_in')} <a href="${config.domain}">Link</a></div>`,
          };

          sendEmail(mailOptions, err => {
            if (err) {
              console.log(err);
            }
          });
        }

        return await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, user);
      },
    },

    updatePersona: {
      rest: 'PUT /:id/persona',
      auth: 'required',
      params: {
        id: { type: 'string', min: 3 },
      },
      async handler(ctx) {
        const value = ctx.params;

        const user = await this.adapter.findById(value.id);
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }
        const userUpdated = await this.adapter.updateById(value.id, value, { new: true });
        const userTransformed = await this.transformDocuments(
          ctx,
          { populate: this.settings.populateOptions },
          userUpdated,
        );
        await this.broker.emit('personaChosen', userTransformed);
        return userTransformed;
      },
    },

    updateHearAboutUs: {
      rest: 'PUT /:id/hearAboutUs',
      auth: 'required',
      params: {
        id: { type: 'string', min: 3 },
      },
      async handler(ctx) {
        const value = ctx.params;

        const user = await this.adapter.findById(value.id);
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }
        const userUpdated = await this.adapter.updateById(value.id, value, { new: true });
        return await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, userUpdated);
      },
    },

    lastVisit: {
      rest: 'PUT /:id/lastVisit',
      params: {
        id: { type: 'string', min: 3 },
      },
      async handler(ctx) {
        const { id } = ctx.params;
        return await this.adapter.updateById(id, { lastVisit: new Date() }, { new: true });
      },
    },

    generateAccessToken: {
      rest: 'POST /generateAccessToken',
      async handler(ctx) {
        const { refreshToken } = ctx.meta;
        if (!refreshToken) {
          throw new MoleculerClientError(i18next.t('error_unauthorized'), 401);
        }
        const decoded = await jwt.verifyToken(refreshToken, this.settings.JWT_SECRET);
        if (decoded?.id) {
          const user = await this.getById(decoded.id);
          const accessToken = jwt.issue({ id: user?._id, isUser: true }, '72h', this.settings.JWT_SECRET);
          this.setTokenToCookies(ctx, accessToken, refreshToken);
        }
      },
    },

    getOneByEmail: {
      rest: 'GET /getOneByEmail',
      async handler(ctx) {
        const { email } = ctx.params;
        const user = await this.adapter.findOne({ email });
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }
        return await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, user);
      },
    },
    getListUserByOrganization: {
      rest: 'GET /getListUserByOrganization',
      auth: 'required',

      async handler(ctx) {
        const user = await this.adapter.findById(ctx.meta.user._id);
        const orgId = user?.organizationId;

        if (!orgId) {
          throw new MoleculerClientError(i18next.t('organization_users_not_found'), 404);
        }

        // BFS lấy toàn bộ orgId (bao gồm org hiện tại + org con)
        const getAllOrgIdsBFS = async rootOrgId => {
          const visited = new Set();
          const root = rootOrgId.toString();
          const queue = [root];
          const allOrgIds = [root];

          while (queue.length > 0) {
            const currentOrgId = queue.shift();
            if (visited.has(currentOrgId)) continue;
            visited.add(currentOrgId);

            const children = await this.broker.call('organizations.find', {
              query: {
                parentOrganizationId: currentOrgId,
                isDeleted: { $ne: true }, // 👈 THÊM DÒNG NÀY
              },
              fields: ['_id'],
            });

            for (const child of children) {
              const childId = child._id.toString();
              queue.push(childId);
              allOrgIds.push(childId);
            }
          }

          return allOrgIds; // dạng string
        };

        // 🔥 Lấy danh sách tất cả organizationId dạng string
        const allOrgIds = await getAllOrgIdsBFS.call(this, orgId);

        // ❗ Quan trọng: convert sang ObjectId để query User
        const objectIds = allOrgIds.map(id => ObjectId(id));

        // 🔥 Truy vấn user theo organizationId
        const orgQuery = {
          organizationId: { $in: objectIds },
        };

        // Xử lý query search
        let searchParams = {};
        if (ctx.params.query) {
          try {
            const parsedQuery = typeof ctx.params.query === 'string' ? JSON.parse(ctx.params.query) : ctx.params.query;

            searchParams = {
              email: parsedQuery.email,
              role: parsedQuery.role,
              hasLocked: parsedQuery.hasLocked,
              organizationName: parsedQuery.organizationName,
            };
          } catch (e) {
            this.logger.warn('Invalid JSON query:', ctx.params.query);
          }
        }

        // Pagination + sort
        const paramsList = this.extractParamsPage(ctx.params);
        const sort = paramsList.sort;
        let sortAggregate = {};

        if (sort) {
          if (sort.startsWith('-')) {
            sortAggregate = { [sort.slice(1)]: -1 };
          } else {
            sortAggregate = { [sort]: 1 };
          }
        } else {
          sortAggregate = { createdAt: -1 };
        }

        // Gọi trackingUsers
        const [result] = await this.trackingUsers(ctx, searchParams, orgQuery, paramsList, sortAggregate);

        return result;
      },
    },
    statisticUser: {
      rest: 'GET /statisticMemberOrganization',
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        return this.countSubmitAndCapacityByUser(ctx.params.query);
      },
    },

    active: {
      rest: 'POST /activeAccount',
      skipToken: true,
      async handler(ctx) {
        const user = await this.adapter.findOne({ isDeleted: false, _id: ctx.meta.userID });
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }
        if (user.active) {
          throw new MoleculerClientError(i18next.t('activation_account_has_expired'), 400);
        }

        const userUpdate = await this.adapter.updateById(user._id, { active: true }, { new: true });

        return await this.transformDocuments(ctx, { populate: this.settings.populateOptions }, userUpdate);
      },
    },
    resendActiveAccountLink: {
      rest: 'POST /resendActiveAccountLink',
      async handler(ctx) {
        const { email } = ctx.params;
        const user = await this.adapter.findOne({ email });
        if (!user) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }
        if (user.active) {
          throw new MoleculerClientError(i18next.t('account_has_been_activated'), 400);
        }

        if (user.state && user.state !== USER_STATE.ACTIVE) {
          throw new MoleculerClientError(i18next.t('email_in_waitlist_try_again'), 202);
        }

        let activateLink = this.createActivateAccountLink(user._id, '30d');
        let mailOptions = {
          from: `${i18next.t('email_user_create_from')} <${config.mail.auth.user}>`, // sender address
          to: user.email, // list of receivers
          subject: 'Kích hoạt tài khoản', // Subject line
          //text: 'Pass moi la 123455', // plaintext body
          html: createActiveAccountEmail({ account: user.email, fullName: user.fullName }, activateLink),
        };

        sendEmail(mailOptions, err => {
          if (err) {
            console.log(err);
          }
        });
        return { success: true, message: i18next.t('check_email_for_active_account_link') };
      },
    },
    getList: {
      rest: 'GET /getList',
      permission: { resource: RESOURCES.USER, action: ACTIONS.VIEW },
      auth: 'required',
      async handler(ctx) {
        try {
          const { query: queryString = '{}', sort, showDeleted } = ctx.params;

          let parsedQuery = {};
          try {
            parsedQuery = JSON.parse(queryString);
          } catch (e) {
            this.logger.warn('Invalid JSON query:', queryString);
          }

          const query = {
            ...parsedQuery,
          };

          query.isDeleted = showDeleted === 'true' || showDeleted === true;

          if (!query.organizationId) {
            query.organizationId = ctx.meta.user?.organizationId?.toString();
          }

          if (query.organizationId) {
            const orgId = typeof query.organizationId === 'string'
              ? query.organizationId
              : query.organizationId.toString();

            const allOrgIds = await this.getAllDescendantOrgIds(orgId);
            const objectIds = allOrgIds.map(id => ObjectId(id));

            query.organizationId = { $in: objectIds };
          }

          const params = this.constructParamsGetList(ctx.params, query, sort);
          return ctx.call('users.list', params);
        } catch (error) {
          this.logger.error('Error in getList handler:', error);
          throw error;
        }
      },
    },
    updateOrganizationId: {
      params: {
        id: { type: 'string' },
        organizationId: { type: 'string' },
      },
      async handler(ctx) {
        const { id, organizationId } = ctx.params;
        return this.adapter.updateById(id, { $set: { organizationId } });
      },
    },
    toggleLock: {
      rest: 'POST /:id/toggle-lock',
      auth: 'required',
      role: USER_CODES.ORG_ADMIN,
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        const { id } = ctx.params;

        const userToLock = await this.adapter.findById(id);

        if (!userToLock) {
          throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
        }

        // if (userToLock.role === USER_CODES.ORG_ADMIN) {
        //   throw new MoleculerClientError(i18next.t('error_permission_denied'), 403);
        // }

        return this.adapter.updateById(id, { $set: { hasLocked: !userToLock.hasLocked } }, { new: true });
      },
    },
  },

  methods: {
    /**
     * BFS để lấy tất cả organizationId (bao gồm org hiện tại + org con/cháu)
     * @param {string} rootOrgId - ID của tổ chức gốc
     * @returns {string[]} Mảng tất cả organization IDs (dạng string)
     */
    async getAllDescendantOrgIds(rootOrgId) {
      const visited = new Set();
      const root = rootOrgId.toString();
      const queue = [root];
      const allOrgIds = [root];

      while (queue.length > 0) {
        const currentOrgId = queue.shift();
        if (visited.has(currentOrgId)) continue;
        visited.add(currentOrgId);

        const children = await this.broker.call('organizations.find', {
          query: {
            parentOrganizationId: currentOrgId,
            isDeleted: { $ne: true },
          },
          fields: ['_id'],
        });

        for (const child of children) {
          const childId = child._id.toString();
          queue.push(childId);
          allOrgIds.push(childId);
        }
      }

      return allOrgIds;
    },

    async refreshTokenCreator(ctx, user) {
      if (!user) {
        throw new MoleculerClientError(i18next.t('error_user_not_found'), 404);
      }
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
        { id: user?._id, isUser: true },
        expRefreshToken / 1000 + 's',
        this.settings.JWT_SECRET,
      );
      await ctx.call('refreshToken.create', {
        userId: user._id,
        refreshToken: refreshToken,
        expiresDate: expiresDateTime,
      });
      return refreshToken;
    },

    async getGoogleUser(id_token, access_token) {
      const { data } = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
        params: {
          access_token,
          alt: 'json',
        },
        headers: {
          Authorization: `Bearer ${id_token}`,
        },
      });
      return data;
    },
    async getOauthGoogleToken(code) {
      const body = {
        code,
        client_id: config.client_id,
        client_secret: config.client_secret,
        redirect_uri: config.redirect_uri,
        grant_type: 'authorization_code',
        access_type: 'offline',
      };
      const { data } = await axios.post('https://oauth2.googleapis.com/token', body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      return data;
    },

    constructParamsGetList(params, query, sort) {
      return {
        ...this.extractParamsPage(params),
        searchFields: params.searchFields,
        query: JSON.stringify(query),
        populate: this.settings.populateOptions,
        sort,
      };
    },

    async timeout(delay) {
      return new Promise(res => setTimeout(res, delay));
    },

    async migrateUserTypes() {
      try {
        this.logger.info('Starting user type migration...');

        // Chuyển teacher (string) → ['admin']
        const teacherResult = await this.adapter.updateMany({ type: 'teacher' }, { $set: { type: ['admin'] } });
        if (teacherResult.modifiedCount > 0) {
          this.logger.info(`Migrated ${teacherResult.modifiedCount} users from teacher → ['admin']`);
        }

        // Chuyển student (string) → ['normal']
        const studentResult = await this.adapter.updateMany({ type: 'student' }, { $set: { type: ['normal'] } });
        if (studentResult.modifiedCount > 0) {
          this.logger.info(`Migrated ${studentResult.modifiedCount} users from student → ['normal']`);
        }

        this.logger.info('User type migration completed successfully');
      } catch (error) {
        this.logger.error('Error during user type migration:', error);
      }
    },

    async seedDB() {
      this.logger.info('Seed Users DB...');
      // Create system admin
      const systemAdmin = {
        code: USER_CODES.SYSTEM_ADMIN,
        email: 'tradar_admin@thinklabs.com.vn',
        password: 'thinklabs@36',
        fullName: 'System Admin',
        isSystemAdmin: true,
        active: true,
        state: USER_STATE.ACTIVE,
      };
      await this.adapter.insert(systemAdmin);

      this.logger.info(`Generated system admin user!`);
      return this.clearCache();
    },
    comparePassword(unHashPassword, hashedPassword) {
      return bcrypt.compare(unHashPassword, hashedPassword);
    },
    /**
     * Generate a JWT token from user entity
     *
     * @param {Object} user
     */
    generateJWT(user) {
      const today = new Date();
      const exp = new Date(today);
      exp.setDate(today.getDate() + 60);

      return jwt.issue({ id: user._id, email: user.email }, Math.floor(exp.getTime() / 1000), this.settings.JWT_SECRET);
    },

    /**
     * Transform returned user entity. Generate JWT token if neccessary.
     *
     * @param {Object} user
     * @param {Boolean} withToken
     */
    transformEntity(user, withToken, token) {
      if (user) {
        //user.image = user.image || "https://www.gravatar.com/avatar/" + crypto.createHash("md5").update(user.email).digest("hex") + "?d=robohash";
        user.image = user.image || '';
        if (withToken) user.token = token || this.generateJWT(user);
      }

      return { user };
    },

    /**
     * Transform returned user entity as profile.
     *
     * @param {Context} ctx
     * @param {Object} user
     * @param {Object?} loggedInUser
     */
    async transformProfile(ctx, user, loggedInUser) {
      //user.image = user.image || "https://www.gravatar.com/avatar/" + crypto.createHash("md5").update(user.email).digest("hex") + "?d=robohash";
      user.image = user.image || 'https://static.productionready.io/images/smiley-cyrus.jpg';

      if (loggedInUser) {
        user.following = await ctx.call('follows.has', {
          user: loggedInUser._id.toString(),
          follow: user._id.toString(),
        });
      } else {
        user.following = false;
      }

      return { profile: user };
    },
    async findAndRemoveDeviceToken(deviceToken) {
      if (deviceToken) {
        let userHasToken = await this.adapter.findOne({ deviceTokens: deviceToken });
        if (userHasToken) {
          userHasToken.deviceTokens = userHasToken.deviceTokens.filter(element => element !== deviceToken);
          await this.adapter.insert(userHasToken);
        }
      }
    },
    addOrUpdateDeviceToken: async function (userInfo, deviceToken) {
      if (userInfo && deviceToken) {
        let deviceTokens = userInfo.deviceTokens ? userInfo.deviceTokens : [];
        let deviceIndex = deviceTokens.indexOf(deviceToken);
        if (deviceIndex === -1) {
          deviceTokens.push(deviceToken);
          await this.adapter.updateById(userInfo._id, { deviceTokens: deviceTokens }, { new: true });
        }
      }
    },
    generateRandomPassword() {
      return Math.random().toString(36).slice(-8);
    },
    createResetPasswordLink(userId, expiresIn) {
      const resetPasswordToken = jwt.issue({ id: userId }, expiresIn, this.settings.JWT_RESET_PASSWORD_SECRET);
      return config.domain + '/reset-password?resetPasswordToken=' + resetPasswordToken;
    },
    createActiveMemberLink(userId, expiresIn) {
      const accessToken = jwt.issue({ id: userId }, expiresIn, this.settings.JWT_SECRET);
      return config.domain + '/confirm-register?accessToken=' + accessToken;
    },
    createActivateAccountLink(userId, expiresIn) {
      const activationToken = jwt.issue({ id: userId }, expiresIn, this.settings.JWT_ACTIVATION_SECRET);
      return config.domain + '/activeAccount?activationToken=' + activationToken;
    },
    countSubmitAndCapacityByUser(query) {
      const { memberId, page, pageSize, sortAggregate, permission, textSubmit, mediaSubmit } = query;

      return USER.aggregate([
        {
          $match: {
            _id: { $in: memberId },
            isDeleted: false,
          },
        },
        {
          $addFields: {
            textSubmit: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: textSubmit,
                    as: 'input',
                    cond: { $eq: ['$$input._id', '$_id'] },
                  },
                },
                0,
              ],
            },
            mediaSubmit: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: mediaSubmit,
                    as: 'input',
                    cond: { $eq: ['$$input._id', '$_id'] },
                  },
                },
                0,
              ],
            },
            permissions: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: permission,
                    as: 'input',
                    cond: { $eq: ['$$input.userId', '$_id'] },
                  },
                },
                0,
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            fullName: 1,
            email: 1,
            lastVisit: 1,
            textSubmit: { $ifNull: ['$textSubmit.numberSubmit', 0] },
            mediaSubmit: { $ifNull: ['$mediaSubmit.numberSubmit', 0] },
            capacityUsed: { $ifNull: ['$permissions.accessLimit.capacityUsed', 0] },
          },
        },
        // { $sort: sortAggregate },
        // {
        //   $facet: {
        //     rows: [
        //       { $skip: (page - 1) * pageSize },
        //       { $limit: pageSize }
        //     ],
        //     metadata: [
        //       { $count: "total" },
        //       {
        //         $addFields: {
        //           page: page,
        //           pageSize: pageSize,
        //           totalPages: { $ceil: { $divide: ["$total", pageSize] } }
        //         }
        //       }
        //     ]
        //   }
        // },
        // { $replaceRoot: { newRoot: { $mergeObjects: ["$$ROOT", { $arrayElemAt: ["$metadata", 0] }] } } },
        // { $unset: "metadata" }
      ]);
    },
    async checkUserState(ctx, user, requiredResetPassword) {
      const [whiteListEmail, setting, totalUser] = await Promise.all([
        ctx.call('whitelist.getOne', { email: user.email, isDeleted: false }),
        this.broker.call('settings.getOne'),
        this.broker.call('users.count'),
      ]);

      let newState;
      let formHtml;
      if (whiteListEmail || totalUser - 1 < setting.limitedNumberUser) {
        const activateLink = requiredResetPassword
          ? this.createResetPasswordLink(user._id, '30d')
          : this.createActivateAccountLink(user._id, '30d');

        formHtml = createRegisterEmail({ account: user.email, fullName: user.fullName }, activateLink);
        newState = USER_STATE.ACTIVE;
      } else {
        formHtml = createWaitListNewUser({ account: user.email, fullName: user.fullName });
        await ctx.call('waitlist.create', {
          email: user.email,
          fullName: user.fullName,
          requiredResetPassword: requiredResetPassword,
        });

        newState = USER_STATE.WAITLIST;
      }

      await this.sendEmailWithTemplate(user, formHtml);
      return newState;
    },
    sendEmailWithTemplate(data, formHtml) {
      let mailOptions = {
        from: `${i18next.t('email_user_create_from')} <${config.mail.auth.user}>`, // sender address
        to: data.email, // list of receivers
        subject: i18next.t('email_user_register_html1'), // Subject line
        //text: 'Pass moi la 123455', // plaintext body
        html: formHtml,
      };
      sendEmail(mailOptions, err => {
        if (err) {
          console.log(err);
        }
      });
    },

    setTokenToCookies(ctx, accessToken, refreshToken) {
      const cookieOptions = {
        httpOnly: true,
        secure: true,
        path: '/',
        maxAge: 30 * 24 * 60 * 60, // 30 day
      };
      const cookieAccessToken = cookie.serialize('accessToken', accessToken, cookieOptions);
      const cookieRefreshToken = cookie.serialize('refreshToken', refreshToken, cookieOptions);

      ctx.meta.$responseHeaders = {
        'Set-Cookie': [cookieAccessToken, cookieRefreshToken],
      };
    },
    async checkUserStateLogin(ctx, user) {
      const [waitList, setting, totalUser] = await Promise.all([
        ctx.call('waitlist.getOne', { email: user.email, isDeleted: false }),
        this.broker.call('settings.getOne'),
        this.broker.call('users.count'),
      ]);

      if (totalUser - 1 < setting.limitedNumberUser) {
        const activateLink = waitList?.requiredResetPassword
          ? this.createResetPasswordLink(user._id, '30d')
          : this.createActivateAccountLink(user._id, '30d');

        const formHtml = createRegisterEmail({ account: user.email, fullName: user.fullName }, activateLink);
        await this.sendEmailWithTemplate(user, formHtml);

        ctx.call('waitlist.remove', { id: waitList?._id });

        return true;
      } else {
        return false;
      }
    },
    async userManager() {
      return USER.aggregate([
        {
          $match: {
            isDeleted: false,
          },
        },
        {
          $project: {
            fullName: 1,
            email: 1,
            createdAt: 1,
            isDeveloper: 1,
            type: 1,
          },
        },
      ]);
    },
    async trackingUsers(ctx, { email, role, hasLocked, organizationName }, query = {}, paramsList, sortAggregate) {
      // Chuyển đổi hasLocked từ string ('true', 'false') sang boolean nếu cần
      let hasLockedBoolean;
      if (hasLocked === 'true') hasLockedBoolean = true;
      else if (hasLocked === 'false') hasLockedBoolean = false;
      else hasLockedBoolean = hasLocked;

      return USER.aggregate([
        {
          $match: {
            ...query, // Áp dụng query được truyền vào
            $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }],

            ...(email && {
              email: typeof email === 'string' ? { $regex: email, $options: 'i' } : { $regex: email },
            }),
            ...(role && {
              role: typeof role === 'string' ? { $regex: role, $options: 'i' } : { $regex: role },
            }),
            ...(typeof hasLockedBoolean === 'boolean' && {
              hasLocked: hasLockedBoolean,
            }),
          },
        },
        {
          $lookup: {
            from: 'Organization',
            localField: 'organizationId',
            foreignField: '_id',
            as: 'organizationId',
          },
        },
        {
          $lookup: {
            from: 'Role',
            localField: 'roleId',
            foreignField: '_id',
            as: 'roleId',
          },
        },
        {
          $lookup: {
            from: 'JobTitle',
            localField: 'jobTitleId',
            foreignField: '_id',
            as: 'jobTitleId',
          },
        },
        {
          $set: {
            organizationId: {
              $cond: [{ $gt: [{ $size: '$organizationId' }, 0] }, { $arrayElemAt: ['$organizationId', 0] }, '$$REMOVE'],
            },
            jobTitleId: {
              $cond: [{ $gt: [{ $size: '$jobTitleId' }, 0] }, { $arrayElemAt: ['$jobTitleId', 0] }, '$$REMOVE'],
            },
            // roleId là mảng nên giữ nguyên dạng mảng sau $lookup
          },
        },
        {
          $lookup: {
            from: 'Organization',
            localField: 'organizationId.parentOrganizationId',
            foreignField: '_id',
            as: 'organizationId.parentOrganizationId',
          },
        },
        {
          $set: {
            'organizationId.parentOrganizationId': {
              $cond: [
                {
                  $and: [
                    { $isArray: '$organizationId.parentOrganizationId' },
                    { $gt: [{ $size: '$organizationId.parentOrganizationId' }, 0] },
                  ],
                },
                { $arrayElemAt: ['$organizationId.parentOrganizationId', 0] },
                '$organizationId.parentOrganizationId',
              ],
            },
          },
        },
        {
          $match: {
            ...(organizationName && { 'organizationId.name': { $regex: organizationName, $options: 'i' } }),
          },
        },
        { $sort: sortAggregate },
        {
          $project: {
            password: 0,
            deviceTokens: 0,
            'organizationId.members': 0,
            // verificationCode: 0,
            'roleId.permissions': 0,
            __v: 0,
          },
        },
        {
          $facet: {
            rows: [
              { $skip: ((paramsList.page || 1) - 1) * (paramsList.pageSize || 10) },
              { $limit: paramsList.pageSize || 10 },
            ],
            metadata: [
              { $count: 'total' },
              {
                $addFields: {
                  page: paramsList.page || 1,
                  pageSize: paramsList.pageSize || 10,
                  totalPages: {
                    $ceil: { $divide: ['$total', paramsList.pageSize || 10] },
                  },
                },
              },
            ],
          },
        },
        {
          $project: {
            rows: 1,
            metadata: {
              $cond: {
                if: { $eq: [{ $size: '$metadata' }, 0] },
                then: [{ total: 0, page: 0, pageSize: 0, totalPages: 0 }],
                else: '$metadata',
              },
            },
          },
        },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: ['$$ROOT', { $arrayElemAt: ['$metadata', 0] }],
            },
          },
        },
        { $unset: 'metadata' },
      ]);
    },
  },

  events: {
    async 'user.activeStateUser'(payload) {
      try {
        const [user, waitlist] = await Promise.all([
          this.adapter.findOne({ email: payload.email }),
          this.broker.call('waitlist.getOne', { query: { email: payload.email } }),
        ]);

        const activateLink = waitlist?.requiredResetPassword
          ? this.createResetPasswordLink(user._id, '30d')
          : this.createActivateAccountLink(user._id, '30d');

        const formHtml = createRegisterEmail({ account: user.email, fullName: user.fullName }, activateLink);
        await this.sendEmailWithTemplate(user, formHtml);

        await this.adapter.updateById(user._id, { state: USER_STATE.ACTIVE });
      } catch (error) {
        console.log(error);
      }
    },
    memberRemoved: {
      params: {
        member: 'object',
      },
      async handler(ctx) {
        const { member } = ctx.params;
        const user = await this.adapter.findOne({ email: member.email });

        if (!user) {
          return null; // Or handle the error as you see fit
        }

        const [orgWorkspace] = await ctx.call('workspaces.find', { query: { organizationId: user.organizationId } });

        if (orgWorkspace) {
          await ctx.call('share.unshareAllInWorkspace', {
            workspaceId: orgWorkspace._id,
            userId: user._id,
          });
        }

        if (user.organizationId) {
          return await this.adapter.updateById(user._id, {
            $set: { organizationId: undefined, role: 'normal' },
          });
        }

        return user;
      },
    },

    async 'organization.removed'(payload, sender, event) {
      const users = await this.adapter.find({ query: { organizationId: payload?.id } });

      await Promise.all(
        users.map(user => {
          return this.broker.emit('memberRemoved', { member: user });
        }),
      );
    },

    userRoleUpdate: {
      params: {
        email: 'string',
        role: 'string',
      },
      async handler(context) {
        const { email, role } = context.params;
        const user = await this.adapter.findOne({ email });
        return this.adapter.updateById(user._id, { role });
      },
    },
  },

  async started() {
    // migrate user with old type: teacher to admin, student to normal
    await this.migrateUserTypes();
  },
  async afterConnected() {
    const count = await this.adapter.count();
    if (count === 0) {
      return this.seedDB();
    }
  },
};
