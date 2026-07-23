const DbMongoose = require("../../mixins/dbMongo.mixin");
const Model = require("./settings.model");
const BaseService = require("../../mixins/baseService.mixin");
const AuthRole = require("../../mixins/authRole.mixin");
const {SERVICE_NAME} = require("./settings");
const {USER_CODES} = require("../../constants/constant");
const FunctionsCommon = require("../../mixins/functionsCommon.mixin");

module.exports = {
  name: SERVICE_NAME,
  mixins: [DbMongoose(Model), BaseService, AuthRole, FunctionsCommon],
  settings: {
    populates: {},
    populateOptions: [],
  },
  actions: {
    findOne: {
      rest: {
        path: '/findOne',
        method: 'GET',
      },
      async handler() {
        return await this.adapter.findOne({});
      },
    },
  },

  methods: {
    async seedDB() {
      this.logger.info('Seed Moodle setting...');
      const settingsObj = {
        qdrantUrl: 'http://4.144.174.22:6333',
        qdrantApiKey: '2125d3e4a4dea3cb297acda46c0e30c6673fdbcbf72a77fa9d15a2d987be9ef8',
        sttProvider: 'azure',
      };
      await this.adapter.insert(settingsObj);
      this.logger.info(`Settings seeded!`);
    },
  },

  events: {},

  created() {},

  async started() {},

  async stopped() {},

  async afterConnected() {
    const count = await this.adapter.count();
    if (count === 0) {
      return this.seedDB();
    }
  },
};
