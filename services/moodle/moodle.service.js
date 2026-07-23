const DbMongoose = require('../../mixins/dbMongo.mixin');
const Model = require('./moodle.model');
const BaseService = require('../../mixins/baseService.mixin');
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const {RESOURCES} = require('../../constants/permissions');

module.exports = {
  name: 'moodle',
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon, DefaultPermission],
  settings: {
    defaultResource: RESOURCES.LLMS_SETTINGS,
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
    },
  },

  events: {},

  created() {},

  /**
   * Service started lifecycle event handler
   */
  async started() {},

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() {},

  async afterConnected() {
    const count = await this.adapter.count();
    if (count === 0) {
      return this.seedDB();
    }
  },
};
