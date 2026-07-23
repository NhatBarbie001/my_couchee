const DbMongoose = require('../../mixins/dbMongo.mixin');
const Model = require('./apiKey.model');
const BaseService = require('../../mixins/baseService.mixin');
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const {RESOURCES} = require('../../constants/permissions');
const {MoleculerClientError} = require('moleculer').Errors;
const i18next = require('i18next');

module.exports = {
  name: 'apikeys',
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon, DefaultPermission],
  settings: {
    defaultResource: RESOURCES.LLMS_SETTINGS,
    populates: {},
    populateOptions: [],
  },

  hooks: {
    before: {
      remove: async function (ctx) {
        const {id} = ctx.params;

        const llmUsage = await ctx.call('llmsmodel.count', {
          query: {apiKeyId: id, isDeleted: false},
        });

        const voiceUsage = await ctx.call('aivoice.count', {
          query: {apiKeyId: id, isDeleted: false},
        });

        const totalUsage = llmUsage + voiceUsage;

        if (totalUsage > 0) {
          const usageDetails = [];
          if (llmUsage > 0) {
            usageDetails.push(`${llmUsage} LLM Model(s)`);
          }
          if (voiceUsage > 0) {
            usageDetails.push(`${voiceUsage} AI Voice(s)`);
          }

          throw new MoleculerClientError(
            i18next.t(
              'error_api_key_in_use',
              'Không thể xóa API Key này vì đang được sử dụng trong {{details}}',
              {details: usageDetails.join(' và ')}
            ),
            422,
            'API_KEY_IN_USE',
          );
        }
      },
    },
  },

  actions: {
    getOne: {
      rest: 'GET /:id/getOne',
      auth: 'required',
      async handler(ctx) {
        const {id} = ctx.params;
        return await this.adapter.findById(id);
      },
    },

    getByServiceType: {
      rest: 'GET /by-service-type/:serviceType',
      auth: 'required',
      params: {
        serviceType: {type: 'string', enum: ['llm', 'voice']},
      },
      async handler(ctx) {
        const {serviceType} = ctx.params;
        return await this.adapter.find({
          query: {serviceType, isDeleted: false},
        });
      },
    },

    checkApiKeyUsage: {
      rest: 'GET /:id/check-usage',
      auth: 'required',
      params: {
        id: 'string',
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const apiKey = await this.adapter.findById(id);

        if (!apiKey) {
          throw new MoleculerClientError(i18next.t('error_api_key_not_found', 'API Key không tồn tại'), 404);
        }

        let isUsed = false;
        let usageDetails = {};

        if (apiKey.serviceType === 'llm') {
          const llmUsage = await ctx.call('llmsmodel.count', {
            query: {apiKeyId: id, isDeleted: false},
          });
          isUsed = llmUsage > 0;
          usageDetails.llmModels = llmUsage;
        } else if (apiKey.serviceType === 'voice') {
          const voiceUsage = await ctx.call('aivoice.count', {
            query: {apiKeyId: id, isDeleted: false},
          });
          isUsed = voiceUsage > 0;
          usageDetails.voiceConfigs = voiceUsage;
        }

        return {
          isUsed,
          usageDetails,
        };
      },
    },
  },
  methods: {},
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

  async afterConnected() {},
};
