const DbMongoose = require("../../../mixins/dbMongo.mixin");
const Model = require("./features.model");
const BaseService = require("../../../mixins/baseService.mixin");
const FunctionsCommon = require("../../../mixins/functionsCommon.mixin");
const { MoleculerClientError } = require("moleculer").Errors;
const AuthRole = require("../../../mixins/authRole.mixin");
const { USER_CODES } = require("../../../constants/constant");

module.exports = {
  name: "features",
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon, AuthRole],
  settings: {
    /** Validator schema for entity */
    entityValidator: {},
    populates: {},
    populateOptions: []
  },

  hooks: {},

  actions: {
    getAllWithoutPagination: {
      role: USER_CODES.NORMAL,
    }
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
