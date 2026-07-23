const DbMongoose = require('../../mixins/dbMongo.mixin');
const Model = require('./aiVoice.model');
const BaseService = require('../../mixins/baseService.mixin');
const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const DefaultPermission = require('../../mixins/defaultPermission.mixin');
const {RESOURCES} = require('../../constants/permissions');
const {MoleculerClientError} = require('moleculer').Errors;
const i18next = require('i18next');

module.exports = {
  name: 'aivoice',
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon, DefaultPermission],
  settings: {
    defaultResource: RESOURCES.LLMS_SETTINGS,
    entityValidator: {},
    populates: {
      apiKeyId: 'apikeys.get',
    },
    populateOptions: ['apiKeyId'],
  },

  hooks: {
    before: {
      async create(ctx) {
        if (ctx.params.apiKeyId) {
          const apiKey = await ctx.call('apikeys.get', {id: ctx.params.apiKeyId});
          if (!apiKey || apiKey.serviceType !== 'voice') {
            throw new MoleculerClientError(
              i18next.t('error_api_key_must_be_voice', 'API Key phải có loại dịch vụ là Voice'),
              422,
            );
          }
        }
      },
      async update(ctx) {
        if (ctx.params.apiKeyId) {
          const apiKey = await ctx.call('apikeys.get', {id: ctx.params.apiKeyId});
          if (!apiKey || apiKey.serviceType !== 'voice') {
            throw new MoleculerClientError(
              i18next.t('error_api_key_must_be_voice', 'API Key phải có loại dịch vụ là Voice'),
              422,
            );
          }
        }
      },
      async remove(ctx) {
        const {id} = ctx.params;

        const personaUsage = await ctx.call('aipersonas.count', {
          query: {voiceId: id, isDeleted: false},
        });

        if (personaUsage > 0) {
          throw new MoleculerClientError(
            i18next.t(
              'error_ai_voice_in_use',
              'Không thể xóa AI Voice này vì đang được sử dụng trong {{count}} AI Persona(s)',
              {count: personaUsage}
            ),
            422,
            'AI_VOICE_IN_USE',
          );
        }
      },
    },
  },

  actions: {
    getVoicesByLanguage: {
      rest: 'GET /by-language',
      auth: 'required',
      params: {
        language: {type: 'string', optional: true},
        gender: {type: 'string', optional: true, enum: ['male', 'female']},
      },
      async handler(ctx) {
        const {language, gender} = ctx.params;
        const query = {isDeleted: false};

        if (language) {
          query.languages = language;
        }

        if (gender) {
          query.gender = gender;
        }

        const voices = await this.adapter.find({query});
        return await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, voices);
      },
    },

    getVoiceWithApiKey: {
      rest: 'GET /:id/with-apikey',
      auth: 'required',
      params: {
        id: 'string',
      },
      async handler(ctx) {
        const {id} = ctx.params;
        const voice = await this.adapter.findById(id);

        if (!voice || voice.isDeleted) {
          throw new MoleculerClientError(
            i18next.t('error_voice_config_not_found', 'Cấu hình AI Voice không tồn tại'),
            404,
          );
        }

        const apiKeyData = await ctx.call('apikeys.getOne', {id: voice.apiKeyId.toString()});

        if (!apiKeyData) {
          throw new MoleculerClientError(
            i18next.t('error_api_key_not_found', 'API Key không tồn tại'),
            404,
          );
        }

        return {
          ...voice.toObject(),
          apiKeyData: {
            apiKey: apiKeyData.apiKey,
            serviceProvider: apiKeyData.serviceProvider,
            serviceRegion: apiKeyData.serviceRegion,
            url: apiKeyData.url,
          },
        };
      },
    },

    checkVoiceUsage: {
      rest: 'GET /:id/check-usage',
      auth: 'required',
      params: {
        id: 'string',
      },
      async handler(ctx) {
        const {id} = ctx.params;

        const personaUsage = await ctx.call('aipersonas.count', {
          query: {voiceId: id, isDeleted: false},
        });

        return {
          isUsed: personaUsage > 0,
          usageCount: personaUsage,
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
