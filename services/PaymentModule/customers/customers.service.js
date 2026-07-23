const DbMongoose = require("../../../mixins/dbMongo.mixin");
const Model = require("./customers.model");
const BaseService = require("../../../mixins/baseService.mixin");
const FunctionsCommon = require("../../../mixins/functionsCommon.mixin");
const i18next = require("i18next");
const {MoleculerClientError} = require("moleculer").Errors;
const AuthRole = require("../../../mixins/authRole.mixin")
const {USER_CODES} = require("../../../constants/constant");

module.exports = {
  name: "customers",
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon, AuthRole],
  settings: {
    /** Validator schema for entity */
    entityValidator: {},
    populates: {},
    populateOptions: []
  },

  hooks: {},

  actions: {
    getOneByUser: {
      rest: "GET /getOneByUser",
      auth: "required",
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const {userId} = ctx.params;
        const customer = await this.adapter.findOne({userId});
        if (!customer) {
          throw new MoleculerClientError(i18next.t("error_customer_not_found"), 404, "NOT_FOUND");
        }
        return customer;
      }
    }
  },
  methods: {
    async seedDB() {
      const users = await this.broker.call('users.find', {query: {isDeleted: false}});
      const bulkWriteOperations = users.map(row => ({
        updateOne: {
          filter: {userId: row._id},
          update: {
            $set: {
              userId: row._id,
              fullName: row.fullName,
              email: row.email,
              isDeleted: false
            }
          },
          upsert: true,
        },
      }));

      await Model.bulkWrite(bulkWriteOperations, {ordered: false});
    },
  },
  events: {
    async "user.registered"(payload, sender, event) {
      const customer = await this.adapter.insert({
        userId: payload._id,
        email: payload.email,
        fullName: payload.fullName
      });

      // this.broker.emit('customerCreated', {customer});
    },
    async "userRegisteredFromPhone"(payload, sender, event) {
      const {user, packageId} = payload;
      const customer = await this.adapter.insert({
        userId: user._id,
        phone: user.phone,
        fullName: user.phone
      });

      this.broker.emit('customerCreatedFromPhone', {customer, packageId});
    },

  },
  created() {
  },

  /**
   * Service started lifecycle event handler
   */
  async started() {
  },

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() {
  },

  async afterConnected() {
    const count = await this.adapter.count();
    if (count === 0) {
      return this.seedDB();
    }
  },
};
