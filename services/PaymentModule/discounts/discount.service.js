const DbMongoose = require('../../../mixins/dbMongo.mixin');
const Model = require('./discount.model');
const DiscountUsageModel = require('./discount_usage.model');
const BaseService = require('../../../mixins/baseService.mixin');
const FunctionsCommon = require('../../../mixins/functionsCommon.mixin');
const i18next = require('i18next');
const {MoleculerClientError} = require('moleculer').Errors;
const AuthRole = require('../../../mixins/authRole.mixin');

module.exports = {
  name: 'discounts',
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon, AuthRole],
  settings: {
    /** Validator schema for entity */
    entityValidator: {},
    populates: {},
    populateOptions: [],
  },

  hooks: {},

  actions: {
    check: {
      rest: 'GET /check',
      auth: 'required',
      async handler(ctx) {
        const {user} = ctx.meta;
        const {code} = ctx.params;
        const userId = user._id;

        // Get customer ID from user ID
        const customer = await this.broker.call('customers.getOneByUser', {userId});
        if (!customer) {
          throw new MoleculerClientError(i18next.t('customer_not_found'), 404);
        }

        const discount = await this.adapter.findOne({
          code,
          startDate: {$lte: new Date()},
          endDate: {$gte: new Date()},
          isActivate: true,
        });

        if (!discount) {
          throw new MoleculerClientError(i18next.t('incorrect_or_expired'), 422);
        }

        if (discount.numOfUsed >= discount.limit) {
          throw new MoleculerClientError(i18next.t('out_of_limit'), 422);
        }

        // Check if user has already used this discount
        const hasUsed = await this.checkUserDiscountUsage(discount._id, customer._id, userId);
        console.log('hasUsed', hasUsed, discount._id, customer._id);
        if (hasUsed) {
          throw new MoleculerClientError(i18next.t('discount_already_used'), 422);
        }

        return discount;
      },
    },
  },

  methods: {
    /**
     * Check if a user has already used a discount
     * @param {ObjectId} discountId - The discount ID
     * @param {ObjectId} customerId - The customer ID
     * @returns {Promise<boolean>} - Returns true if discount was already used
     */
    async checkUserDiscountUsage(discountId, customerId) {
      const usage = await DiscountUsageModel.findOne({
        discountId,
        customerId,
        isDeleted: false,
      });
      return !!usage;
    },

    /**
     * Track discount usage for a user
     * @param {ObjectId} discountId - The discount ID
     * @param {ObjectId} customerId - The customer ID
     */
    async trackDiscountUsage(discountId, customerId) {
      await DiscountUsageModel.create({
        discountId,
        customerId,
      });
    },
  },

  events: {
    discountsUsed: {
      async handler(payload) {
        const {discountIds, customerId} = payload;
        const discounts = await this.adapter.find({query: {_id: {$in: discountIds}}});

        // Track usage for each discount
        for (const discount of discounts) {
          await this.trackDiscountUsage(discount._id, customerId);
        }

        return await Model.bulkWrite(
          discounts.map(row => ({
            updateOne: {
              filter: {_id: row._id},
              update: {
                $set: {
                  ...row,
                  numOfUsed: row.numOfUsed ? row.numOfUsed + 1 : 1,
                },
              },
              upsert: true,
            },
          })),
        );
      },
    },
  },

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
