const DbMongoose = require("../../../mixins/dbMongo.mixin");
const Model = require("./package.model");
const BaseService = require("../../../mixins/baseService.mixin");
const FunctionsCommon = require("../../../mixins/functionsCommon.mixin");
const AuthRole = require("../../../mixins/authRole.mixin");
const {MoleculerClientError} = require("moleculer").Errors;
const {USER_CODES} = require("../../../constants/constant");

module.exports = {
  name: "packages",
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon, AuthRole],
  settings: {
    /** Validator schema for entity */
    entityValidator: {},
    populates: {
      "featureIds": "features.get",
    },
    populateOptions: ["featureIds"],
  },

  hooks: {},

  actions: {
    getAllWithoutPagination: {
      role: USER_CODES.NORMAL
    },
    get: {
      role: USER_CODES.NORMAL
    },
    update: {
      rest: {
        method: "PUT",
        path: "/:id",
      },
      async handler(ctx) {
        ctx.emit("packagesUpdated", {packageInfo: ctx.params});
        return ctx;
      }
    },

  },
  methods: {},
  events: {},
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

  },
};
