const DbMongoose = require("../../../mixins/dbMongo.mixin");
const Model = require("./promotions.model");
const BaseService = require("../../../mixins/baseService.mixin");
const FunctionsCommon = require("../../../mixins/functionsCommon.mixin");

const AuthRole = require("../../../mixins/authRole.mixin");

module.exports = {
  name: "promotions",
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon, AuthRole],
  settings: {
    /** Validator schema for entity */
    entityValidator: {},
    populates: {
      "packageId": "packages.get"
    },
    populateOptions: ["packageId"]
  },

  hooks: {},

  actions: {
    getAvailablePromotions: {
      rest: "GET /getAvailablePromotions",
      async handler(ctx) {
        const activePromotions = await this.adapter.find({
          query: {
            isActive: true,
            startDate: {$lte: new Date()},
            endDate: {$gte: new Date()}
          }
        });
        return activePromotions.reduce((acc, item) => {
          acc[item.packageId] = acc[item.packageId] || {};
          acc[item.packageId][item.priceIndex] = item;
          return acc
        }, {});
      }
    },
    getOne: {
      rest: "GET /getOne",
      async handler(ctx) {
        const {priceIndex, packageId} = ctx.params;
        return await this.adapter.findOne({
          priceIndex, packageId, isActive: true,
          startDate: {$lte: new Date()},
          endDate: {$gte: new Date()}
        });
      }
    },
    create: {
      rest: "POST /",
      async handler(ctx) {
        const {packageId, isActive, priceIndex} = ctx.params;
        if (isActive && packageId && priceIndex) {
          await this.adapter.updateMany({
            isActive: true,
            packageId,
            priceIndex
          }, {isActive: false});
        }
        return await this.adapter.insert(ctx.params);
      }
    },
    activePromotions: {
      rest: "PUT /:id/manager",
      async handler(ctx) {
        const {id, isActive, packageId, priceIndex} = ctx.params;
        //deactivate other promotion
        console.log("packageId, priceIndex", packageId, priceIndex);
        if (isActive) {
          const currentPromotion = await this.adapter.findById(id);
          await this.adapter.updateMany({
            isActive: true,
            packageId: packageId || currentPromotion.packageId,
            priceIndex: priceIndex || currentPromotion.priceIndex
          }, {isActive: false});
          return await this.adapter.updateById(id, {isActive: true, ...ctx.params});
        }
        return await this.adapter.updateById(id, {...ctx.params});

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
