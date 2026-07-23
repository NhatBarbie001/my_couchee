const DbMongoose = require('../../mixins/dbMongo.mixin');
const OrganizationModel = require('./organizationUser.model');
const BaseService = require('../../mixins/baseService.mixin');
const {SERVICE_NAME} = require('./index');
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const AuthRole = require('../../mixins/authRole.mixin');
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const {RESOURCES} = require('../../constants/permissions');
module.exports = {
  name: SERVICE_NAME,
  mixins: [DbMongoose(OrganizationModel), BaseService, FunctionsCommon, DefaultPermission],
  settings: {
    /** Validator schema for entity */
    defaultResource: RESOURCES.USER,
    entityValidator: {
      userId: {type: 'string', min: 1},
      organizationId: {type: 'string', min: 1},
    },
    populates: {
      organizationId: 'organizations.get',
      userId: 'users.get',
    },
    populateOptions: ['organizationId', 'userId'],
  },

  hooks: {
    after: {
      find(ctx, res) {
        return res;
      },
    },
  },

  actions: {
    list: {
      rest: 'GET /',
      async handler(ctx) {
        const params = this.sanitizeParams(ctx, ctx.params);
        const {query} = params;

        if (query && query.organizationId) {
          params.query = {
            ...query,
            organizationId: query.organizationId,
          };
        }
        return this._list(ctx, params);
      },
    },
  },
  methods: {},
  events: {
    async 'organizationUser.create'(payload, sender, event) {
      this.logger.info('payload', payload, sender, event);
      await this.adapter.insert(payload);
    },
  },
};
