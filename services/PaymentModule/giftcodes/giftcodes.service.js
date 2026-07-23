const DbMongoose = require("../../../mixins/dbMongo.mixin");
const Model = require("./giftcodes.model");
const BaseService = require("../../../mixins/baseService.mixin");
const FunctionsCommon = require("../../../mixins/functionsCommon.mixin");
const i18next = require("i18next");
const {MoleculerClientError} = require("moleculer").Errors;

module.exports = {
  name: "giftcodes",
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon],
  settings: {
    /** Validator schema for entity */
    entityValidator: {},
    populates: {
      "packageId": "packages.get",
      "createdBy": "users.get",
    },
    populateOptions: ["packageId", "createdBy"]
  },

  hooks: {},

  actions: {
    create: {
      rest: "POST /",
      auth: "required",
      async handler(ctx) {
        const entity = ctx.params;
        entity.createdBy = ctx.meta.user._id;
        return this.adapter.insert(entity);
      }
    },
    useGiftCode: {
      rest: "POST /useGiftCode",
      auth: "required",
      async handler(ctx) {
        const {giftCode} = ctx.params;
        const {user} = ctx.meta;
        const userId = ctx.params.userId || user._id;
        const giftCodeInfo = await this.adapter.findOne({giftCode});
        // logic use gift code
        if (!giftCodeInfo) {
          throw new MoleculerClientError(i18next.t("error_gift_code_not_found"), 404, "NOT_FOUND");
        }
        // check limit
        if (giftCodeInfo.used >= giftCodeInfo.limit) {
          throw new MoleculerClientError(i18next.t("out_of_limit"), 422);
        }
        // check gift code out of date
        if (giftCodeInfo.startDate > new Date() || giftCodeInfo.endDate < new Date()) {
          throw new MoleculerClientError(i18next.t("error_gift_code_out_of_date"), 422);
        }


        const customer = await this.broker.call("customers.getOneByUser", {userId: userId});

        if (!customer) {
          throw new MoleculerClientError(i18next.t("error_customer_not_found"), 404, "NOT_FOUND");
        }
        const giftCodeTransformed = await this.transformDocuments(ctx, {populate: this.settings.populateOptions}, giftCodeInfo);
        //emit to customer use gift code
        await this.broker.emit("customerUseGiftCode", {customer, giftCodeInfo: giftCodeTransformed});
        return this.adapter.updateById({_id: giftCodeInfo._id}, {$inc: {used: 1}});
      }
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
