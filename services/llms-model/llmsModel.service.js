const FunctionsCommon = require('../../mixins/functionsCommon.mixin');
const DashboardModel = require('./llmsModel.model');
const DbMongoose = require('../../mixins/dbMongo.mixin');
const BaseService = require('../../mixins/baseService.mixin');
const DefaultPermission = require('../../mixins/defaultPermission.mixin');

const {USER_CODES} = require('../../constants/constant');
const {RESOURCES, ACTIONS} = require('../../constants/permissions');
const {MoleculerClientError} = require('moleculer').Errors;
const i18next = require('i18next');

module.exports = {
  name: 'llmsmodel',
  mixins: [DbMongoose(DashboardModel), BaseService, FunctionsCommon, DefaultPermission],
  settings: {
    defaultResource: RESOURCES.LLMS_SETTINGS,
    populates: {
      apiKeyId: 'apikeys.get',
    },
    populateOptions: ['apiKeyId'],
  },
  hooks: {
    before: {
      getAllWithoutPagination: async ctx => {
        ctx.params.sort = '-createdAt';
      },
      create: async function (ctx) {
        if (ctx.params.apiKeyId) {
          const apiKey = await ctx.call('apikeys.get', {id: ctx.params.apiKeyId});
          // if (!apiKey || apiKey.serviceType !== 'llm') {
          //   throw new MoleculerClientError(
          //     i18next.t('error_api_key_must_be_llm', 'API Key phải có loại dịch vụ là LLM'),
          //     422,
          //   );
          // }
        }

        if (ctx.params.isDefault !== true) {
          const existingModels = await this.adapter.find({query: {isDeleted: false}});
          if (!existingModels || existingModels?.length === 0) {
            ctx.params.isDefault = true;
          }
        }

        if (ctx.params.isDefault === true) {
          await this.adapter.updateMany({isDefault: true, isDeleted: false}, {$set: {isDefault: false}});
        }
      },
      update: async function (ctx) {
        if (ctx.params.apiKeyId) {
          // const apiKey = await ctx.call('apikeys.get', {id: ctx.params.apiKeyId});
          // if (!apiKey || apiKey.serviceType !== 'llm') {
          //   throw new MoleculerClientError(
          //     i18next.t('error_api_key_must_be_llm', 'API Key phải có loại dịch vụ là LLM'),
          //     422,
          //   );
          // }
        }

        if (ctx.params.isDefault === true) {
          await this.adapter.updateMany(
            {isDefault: true, isDeleted: false, _id: {$ne: ctx.params.id}},
            {$set: {isDefault: false}},
          );
        }
      },
      remove: async function (ctx) {
        const {id} = ctx.params;

        const personaUsage = await ctx.call('aipersonas.count', {
          query: {llmModelId: id, isDeleted: false},
        });

        if (personaUsage > 0) {
          throw new MoleculerClientError(
            i18next.t(
              'error_llm_model_in_use',
              'Không thể xóa LLM Model này vì đang được sử dụng trong {{count}} AI Persona(s)',
              {count: personaUsage},
            ),
            422,
            'LLM_MODEL_IN_USE',
          );
        }
      },
    },
  },

  actions: {
    findOne: {
      rest: {
        method: 'GET',
        path: '/findOne',
      },
      permission: {resource: RESOURCES.LLMS_SETTINGS, action: ACTIONS.VIEW},
      async handler(ctx) {
        const {gptModel} = ctx.params;
        const data = await this.adapter.findOne({gptModel});
        if (!data) {
          return;
        }
        const dataTrans = await this.transformDocuments(ctx, {populate: ['apiKeyId']}, data);
        return dataTrans;
      },
    },

    getOneByModel: {
      rest: {
        method: 'GET',
        path: '/getOneByModel',
      },
      permission: {resource: RESOURCES.LLMS_SETTINGS, action: ACTIONS.VIEW},
      async handler(ctx) {
        const {gptModel, instructionId} = ctx.params;

        if (!gptModel) {
          return;
        }

        const data = await this.adapter.findOne({gptModel});

        if (!data) {
          return;
        }
        const {apiKeyId, maxTokens} = data;
        console.log('data', data);
        if (!apiKeyId) {
          return;
        }

        const apiKeyData = await ctx.call('apikeys.get', {id: apiKeyId.toString()});
        if (!apiKeyData) {
          return;
        }

        const {apiKey, modelInterface, url} = apiKeyData;

        return {
          maxTokens,
          apiKey,
          modelInterface,
          instructionId,
          url,
        };
      },
    },

    getDetailsModel: {
      rest: {
        method: 'GET',
        path: '/:id/details',
      },
      async handler(ctx) {
        const {id} = ctx.params;

        if (!id) {
          return;
        }

        const data = await this.adapter.findById(id);

        if (!data) {
          return;
        }
        const dataTrans = await this.transformDocuments(ctx, {}, data);
        const apiKeyData = await this.broker.call('apikeys.getOne', {id: dataTrans.apiKeyId.toString()});
        if (dataTrans && dataTrans.apiKeyId) {
          return {
            ...dataTrans,
            apiKey: apiKeyData.apiKey,
            modelInterface: apiKeyData.modelInterface,
            endpoint: apiKeyData.endpoint,
            model: dataTrans.gptModel,
          };
        }

        return dataTrans;
      },
    },

    getDefaultModel: {
      rest: {
        method: 'GET',
        path: '/default',
      },
      // permission: {resource: RESOURCES.LLMS_SETTINGS, action: ACTIONS.VIEW},
      async handler(ctx) {
        const data = await this.adapter.findOne({isDefault: true, isDeleted: false});
        if (!data) {
          return null;
        }

        // Populate apiKeyId để lấy thông tin apiKey
        const dataTrans = await this.transformDocuments(ctx, {}, data);
        const apiKeyData = await this.broker.call('apikeys.getOne', {id: dataTrans.apiKeyId.toString()});
        // Trả về kèm thông tin apiKey để các service khác sử dụng
        if (dataTrans && dataTrans.apiKeyId) {
          return {
            ...dataTrans,
            apiKey: apiKeyData.apiKey,
            modelInterface: apiKeyData.modelInterface,
            endpoint: apiKeyData.endpoint,
            model: dataTrans.gptModel,
          };
        }

        return dataTrans;
      },
    },

    setDefaultModel: {
      rest: {
        method: 'PUT',
        path: '/:id/set-default',
      },
      permission: {resource: RESOURCES.LLMS_SETTINGS, action: ACTIONS.UPDATE},
      params: {
        id: 'string',
      },
      async handler(ctx) {
        const {id} = ctx.params;

        const model = await this.adapter.findById(id);
        if (!model || model.isDeleted) {
          throw new Error('Mô hình không tồn tại');
        }

        await this.adapter.updateMany({isDefault: true, isDeleted: false, _id: {$ne: id}}, {$set: {isDefault: false}});

        const updatedModel = await this.adapter.updateById(id, {$set: {isDefault: true}});
        return await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, updatedModel);
      },
    },
  },

  methods: {},
};
