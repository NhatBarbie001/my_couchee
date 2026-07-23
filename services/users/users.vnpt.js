"use strict";
const moment = require("moment");

const DbMongoose = require("../../mixins/dbMongo.mixin");
const {USER_CODES} = require("../../constants/constant");
const {MoleculerClientError} = require("moleculer").Errors;
const bcrypt = require("bcryptjs");
const USER = require("./users.model");
const i18next = require("i18next");
const {sendEmail, generateChangePasswordEmail} = require("../../helpers/emailHelper");
const {getConfig} = require("../../config/config");
const {comparePassword, encryptPassword} = require("./users.helper");
const jwt = require("../../helpers/jwt");
const BaseService = require("../../mixins/baseService.mixin");
const {IMAGE_SERVICE} = require("../Image");
const {ORGANIZATION_SERVICE} = require("../Organization");
const config = getConfig(process.env.NODE_ENV);
const FunctionsCommon = require("../../mixins/functionsCommon.mixin");
const cookie = require("cookie");
const {createRegisterEmail, createWaitListNewUser, createActiveAccountEmail} = require("./emailtemplate/emailtemplate");
const axios = require("axios");
const {USER_STATE} = require("../../constants/constant");
const AuthRole = require("../../mixins/authRole.mixin");

module.exports = {
  actions: {

    forgotPasswordPhone: {
      rest: "POST /forgotPassword",
      params: {
        email: {type: "string"},
      },
      skipToken: true,
      async handler(ctx) {
        let {email} = ctx.params;
        const user = await this.adapter.findOne({email: email, isDeleted: false});
        if (!user) {
          throw new MoleculerClientError(i18next.t("error_email_not_found"), 422);
        }

        if (user.state === USER_STATE.WAITLIST) {
          throw new MoleculerClientError(i18next.t("email_in_waitlist_try_again"), 202)
        }

        if (!user.active) {
          throw new MoleculerClientError(i18next.t("error_account_not_active"), 403);
        }

        let url = this.createResetPasswordLink(user._id, "5m"); // createResetPasswordLink
        let mailOptions = {
          from: `${i18next.t("email_user_create_from")} <${config.mail.auth.user}>`, // sender address
          to: user.email, // list of receivers
          subject: `${i18next.t("email_subject_user_forgot_password")}`, // Subject line
          html: `<p>${i18next.t("email_html1_user_forgot_password")}</p>  </br>
              <p>${i18next.t("email_html2_user_forgot_password")} : ${url} </p>`, // html body
        };

        sendEmail(mailOptions, (err) => {
          if (err) {
            console.log(err);
            return {success: false, message: "Send mail error, please try again"};
          }
        });
        return {success: true, message: i18next.t("check_email_for_reset_link")};
      },
    },

    registerFromPhone: {
      rest: "POST /registerFromPhone",
      params: {
        password: {type: "string", min: 6},
        phone: {type: "string"},
        packageId: {type: "string"},
      },
      async handler(ctx) {
        const data = ctx.params;
        delete data.isSystemAdmin;
        if (data.phone) {
          const checkExistPhone = await this.adapter.findOne({phone: data.phone, isDeleted: false});
          if (checkExistPhone) {
            throw new MoleculerClientError(i18next.t("phone_has_registered"));
          }
        }
        let requiredResetPassword = false;
        if (!data.password) {
          data.password = this.generateRandomPassword();
          data.hasPassword = false;
          requiredResetPassword = true;
        }
        data.fullName = data.phone; // set `fullName`
        data.active = true;
        const user = await this.adapter.insert(data);
        this.broker.emit('userRegisteredFromPhone', {user, packageId: data.packageId});


        const userUpdate = await this.adapter.updateById(user._id, {state: USER_STATE.ACTIVE});
        return await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, userUpdate);
      },
    },

  },

  methods: {},

  events: {},

  async afterConnected() {

  },
};
