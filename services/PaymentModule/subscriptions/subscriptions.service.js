const DbMongoose = require("../../../mixins/dbMongo.mixin");
const Model = require("./subscription.model");
const BaseService = require("../../../mixins/baseService.mixin");
const FunctionsCommon = require("../../../mixins/functionsCommon.mixin");
const StudentSubscriptions = require("./subscriptions.students");
const {MoleculerClientError} = require("moleculer").Errors;
const {ACCESS_CODE} = require("../../../constants/constant");
const AuthRole = require("../../../mixins/authRole.mixin");
const {USER_CODES} = require("../../../constants/constant");
const i18next = require("i18next");

module.exports = {
  name: "subscriptions",
  mixins: [DbMongoose(Model), BaseService, FunctionsCommon, AuthRole, StudentSubscriptions],
  settings: {
    /** Validator schema for entity */
    entityValidator: {},
    populates: {
      packageId: "packages.get",
      customerId: "customers.get",
    },
    populateOptions: ["packageId", "customerId"]
  },

  hooks: {},

  actions: {
    create: {
      rest: "POST /",
      async handler(ctx) {
        const entity = ctx.params;
        const subscription = await this.adapter.insert(entity);
        ctx.emit("subscriptionCreated", {subscription});
        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, subscription);
      }
    },
    testPaymentDone: {
      rest: "POST /testPaymentDone",
      async handler(ctx) {
        const {subscriptionId, customerId} = ctx.params;
        const customer = await this.broker.call("customers.get", {id: customerId});
        await this.broker.emit("subscriptionUpdateStatus", {subscriptionId, customer});
      }
    },
    getByCustomer: {
      rest: "GET /customer",
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const {_id: userId} = ctx.meta.user;
        const customer = await this.broker.call("customers.getOneByUser", {userId});

        const subscription = await this.adapter.findOne({customerId: customer._id, status: 'ACTIVE'});
        return this.transformDocuments(ctx, {populate: this.settings.populateOptions}, subscription);
      }
    },

    subscriptionOrder: {
      rest: "POST /order",
      async handler(ctx) {
        const {packageId, userId, discountIds, price, isRenew, paymentGateway = 'vnpay'} = ctx.params;
        const customer = await this.broker.call("customers.getOneByUser", {userId});
        const order = await this.createOrder(packageId, price, discountIds, customer._id);
        const subscription = await this.createSubscription(customer._id, packageId, price, isRenew);
        const transaction = await this.insertTransaction(subscription._id, packageId, discountIds, customer._id, order.amount, price);

        const paymentGateways = {
          "vnpay": "vnpay.createPaymentUrl",
          "vnptpay": "vnptpay.createPaymentUrl",
          "vnptqr": "vnptpay.createQRCode",
        };

        let paymentUrl;
        if (paymentGateways[paymentGateway]) {
          paymentUrl = await this.broker.call(paymentGateways[paymentGateway], {
            order,
            customer: {id: customer._id},
            transactionId: transaction._id
          });
        } else {
          throw new MoleculerClientError(i18next.t("error_payment_gateway_not_found"), 400);
        }

        await this.broker.emit(`sse.${transaction._id}`, transaction);
        return {trasactionId: transaction._id, paymentUrl};
      }
    },

    buyMore: {
      rest: "POST /buyMore",
      async handler(ctx) {
        const {packageId, userId, discountIds, price, paymentGateway = 'vnpay'} = ctx.params;
        const customer = await this.broker.call("customers.getOneByUser", {userId});
        const order = await this.createOrder(packageId, price, discountIds, customer._id, price.quantity);
        const subscription = await this.adapter.findOne({customerId: customer._id, status: 'ACTIVE'});
        const {quantity} = price;
        const transaction = await this.insertTransaction(subscription._id, packageId, discountIds, customer._id, order.amount, price, quantity);

        const paymentGateways = {
          "vnpay": "vnpay.createPaymentUrl",
          "vnptpay": "vnptpay.createPaymentUrl",
          "vnptqr": "vnptpay.createQRCode",
        };

        let paymentUrl;
        if (paymentGateways[paymentGateway]) {
          paymentUrl = await this.broker.call(paymentGateways[paymentGateway], {
            order,
            customer: {id: customer._id},
            transactionId: transaction._id
          });
        } else {
          throw new MoleculerClientError(i18next.t("error_payment_gateway_not_found"), 400);
        }

        await this.broker.emit(`sse.${transaction._id}`, transaction);
        return {trasactionId: transaction._id, paymentUrl};
      }
    },

    getActive: {
      rest: "GET /active",
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const {userId} = ctx.params;
        const customer = await this.broker.call("customers.getOneByUser", {userId});
        const subscriptions = await this.adapter.findOne({customerId: customer?._id, status: 'ACTIVE'});
        return this.transformDocuments(ctx, {
          populate: this.settings.populateOptions,
          fields: ['packageId', 'startDate', 'endDate', 'status', "customerId"]
        }, subscriptions);
      }
    },
    dateInfo: {
      rest: "GET /dateInfo",
      async handler(ctx) {
        const {unitPrice, intervalCount, subscriptionId} = ctx.params;
        const currentSubscription = await this.adapter.findOne({_id: subscriptionId});
        const startDate = new Date(currentSubscription?.endDate);
        startDate.setDate(startDate.getDate() + 1);
        const endDate = new Date(startDate);
        if (unitPrice === "month") {
          const month = startDate.getMonth() + intervalCount ? intervalCount : 1;
          endDate.setMonth(endDate.getMonth() + 1 * month);
        } else {
          endDate.setFullYear(endDate.getFullYear() + 1);
        }

        return {startDate, endDate};
      }
    },
    getUserTrialExpiredNoUpgrade: {
      rest: "GET /trial-expired-no-upgrade",
      async handler(ctx) {
        try {
          const results = await this.getTrialExpiredNoUpgradeSimple();
          this.logger.info(`Found ${results.length} users with expired trial and no upgrade`);
          return results;

        } catch (error) {
          this.logger.error("Error in getUserTrialExpiredNoUpgrade:", error);
          return [];
        }
      }
    },

  },
  methods: {

    /**
     * Phiên bản đơn giản hơn của aggregation pipeline để debug
     */
    async getTrialExpiredNoUpgradeSimple() {
      const currentDate = new Date();

      try {
        // Bước 1: Tìm expired trial subscriptions và group theo customerId
        const expiredTrialCustomers = await this.adapter.model.aggregate([
          {
            $match: {
              isFree: true,
              endDate: { $lt: currentDate }
            }
          },
          {
            $group: {
              _id: "$customerId",
              customerId: { $first: "$customerId" }
            }
          }
        ]);

        if (expiredTrialCustomers.length === 0) {
          return [];
        }

        // Bước 2: Lấy danh sách customerIds
        const customerIds = expiredTrialCustomers.map(item => item.customerId);

        // Bước 3: Tìm customers có paid subscriptions
        const customersWithPaidSubs = await this.adapter.model.aggregate([
          {
            $match: {
              customerId: { $in: customerIds },
              isFree: false
            }
          },
          {
            $group: {
              _id: "$customerId"
            }
          }
        ]);

        const customerIdsWithPaidSubs = new Set(
          customersWithPaidSubs.map(item => item._id.toString())
        );

        // Bước 4: Lọc customers chưa có paid subscriptions
        const customerIdsWithoutPaidSubs = customerIds.filter(
          id => !customerIdsWithPaidSubs.has(id.toString())
        );

        if (customerIdsWithoutPaidSubs.length === 0) {
          return [];
        }

        // Bước 5: Lấy thông tin customers và userIds
        const results = [];

        for (const customerId of customerIdsWithoutPaidSubs) {
          try {
            const customers = await this.broker.call("customers.find", {
              query: {
                _id: customerId.toString(),
                isDeleted: false
              }
            });

            if (customers.length > 0 && customers[0].userId) {
              results.push(customers[0].userId);
            }
          } catch (error) {
            console.error(`Error getting customer ${customerId}:`, error.message);
          }
        }
        return results;

      } catch (error) {
        console.error("Error in getTrialExpiredNoUpgradeSimple:", error);
        throw error;
      }
    },

    async createSubscription(customerId, packageId, price, isRenew = false) {
      const currentSubscription = await this.adapter.findOne({customerId, status: 'ACTIVE'});
      const {startDate: newStartDate, endDate: newEndDate} = isRenew
        ? currentSubscription
        : {startDate: new Date(), endDate: new Date()};
      const {unitName, intervalCount} = price;
      const unitPrice = unitName === "month" ? "month" : "year";
      if (unitName === "month") {
        newEndDate.setMonth(newEndDate.getMonth() + 1 * intervalCount);
      } else {
        newEndDate.setFullYear(newEndDate.getFullYear() + 1 * intervalCount);
      }
      const [packageDetail, features] = await Promise.all([
        this.broker.call("packages.get", {id: packageId, populate: []}),
        this.broker.call("features.find", {query: {packageType: "base"}}),
      ]);

      const accessRole = features.reduce((map, item) => {
        map[item.code] = {name: item.name, value: packageDetail.features[item._id]};
        return map;
      }, {});

      const accessLimit = {
        textLimit: accessRole[ACCESS_CODE.SUBMIT_TEXT].value,
        mediaLimit: accessRole[ACCESS_CODE.SUBMIT_MEDIA].value,
        capacityLimit: accessRole[ACCESS_CODE.MEDIA_CAPACITY].value,
        textUsed: 0,
        mediaUsed: 0,
        capacityUsed: 0
      };
      return this.adapter.insert({
        customerId,
        packageId,
        status: 'INACTIVE',
        accessRole,
        accessLimit,
        startDate: newStartDate,
        endDate: newEndDate,
        unitPrice: [unitPrice, currentSubscription?.unitPrice].includes("year") && isRenew ? "year" : unitPrice,
        isRenew
      });
    },
    async insertTransaction(subscriptionId, packageId, discountIds, customerId, cost, price, quantity = 1) {
      return this.broker.call("transactions.insert", {
        entity: {
          subscriptionId,
          discountIds,
          customerId,
          packageId,
          content: "",
          paymentCode: "",
          paymentUnit: "",
          packageQuantity: quantity,
          unitPrice: price.unitName,
          cost,
          state: "processing",
        }
      });
    },
    async createOrder(packageId, price, discountIds, customerId, quantity = 1) {
      const packageSubscription = await this.broker.call("packages.get", {id: packageId});
      let amount = quantity * (+price.unitAmount);
      if (discountIds) {
        const discounts = await this.broker.call("discounts.find", {query: {_id: {$in: discountIds}}});
        discounts.forEach(discount => {
          if (discount.type === 'FIXED') {
            amount = amount - discount.discount;
          } else {
            amount = amount - (amount * discount.discount / 100);
          }
        });
      }
      return {amount, service: packageSubscription.name};
    },

    async seedDB() {

    }
  },
  events: {
    async customerCreated({customer, userType = "student"}) {
      let query = {paidType: "free", type: 'base', customerTarget: "student"};
      if (userType === "teacher") {
        query = {paidType: "free", type: 'base', customerTarget: "teacher"};
      }
      const packageFree = await this.broker.call("packages.find", {query});
      console.log("packageFree", packageFree)
      const expiredDays = packageFree[0]?.prices[0]?.intervalCount || 7;
      const entity = {
        customerId: customer._id,
        packageId: packageFree[0]?._id,
        isFree: true,
        startDate: new Date(),
        endDate: new Date(new Date().getTime() + expiredDays * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      };
      const subscription = await this.adapter.insert(entity);
      await this.broker.emit("subscriptionCreated", {subscription, customerTarget: userType});
    },

    customerUseGiftCode: {
      params: {
        customer: "object",
        giftCodeInfo: "object"
      },
      async handler(ctx) {
        const {customer, giftCodeInfo} = ctx.params;
        // create new subscriptions
        const price = giftCodeInfo.packageId.prices[0];
        const isAddOnPackage = giftCodeInfo.packageId.type === "addon";

        if (isAddOnPackage) {
          return this.broker.emit("addOnPackageOrdered", {packages: giftCodeInfo.packageId, customer});
        }


        let endDate = new Date();
        if (price.unitName === "month") {
          endDate.setMonth(endDate.getMonth() + Number(price.intervalCount));
        } else {
          endDate.setFullYear(endDate.getFullYear() + Number(price.intervalCount));
        }
        const subscriptionObj = {
          customerId: customer._id,
          packageId: giftCodeInfo.packageId._id,
          isFree: false,
          startDate: new Date(),
          endDate,
          status: 'ACTIVE',
        }
        const subscription = await this.adapter.insert(subscriptionObj);

        await this.broker.emit("normalUserSubscriptionActive", {subscription});
        await this.adapter.updateMany(
          {customerId: subscription.customerId, _id: {$ne: subscription._id}},
          {status: "INACTIVE"}
        );
      }
    },

    async personaChosen(user) {
      const customer = await this.broker.call("customers.getOneByUser", {userId: user._id});
      let query = {paidType: "free", type: 'base', customerTarget: "teacher"};
      if (user.type === "student") {
        query = {paidType: "free", type: 'base', customerTarget: "student"};
      }
      const packageFree = await this.broker.call("packages.find", {query});
      const expiredDays = packageFree[0]?.prices[0]?.intervalCount || 6;
      const entity = {
        customerId: customer._id,
        packageId: packageFree[0]?._id,
        isFree: true,
        startDate: new Date(),
        endDate: new Date(new Date().getTime() + expiredDays * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      };
      const subscription = await this.adapter.insert(entity);
      await this.broker.emit("subscriptionCreated", {subscription, customerTarget: user.type});
    },

    subscriptionUpdateStatus: {
      params: {
        subscriptionId: "string",
      },
      async handler(ctx) {
        const {subscriptionId, customer} = ctx.params;
        const subscription = await this.adapter.updateById(subscriptionId, {status: "ACTIVE"});
        const user = await ctx.call("users.get", {id: customer.userId.toString()});
        if (user.type === "student") return this.studentPaymentDone(subscription, customer);
        await ctx.emit("normalUserSubscriptionActive", {subscription});
        await this.adapter.updateMany(
          {customerId: subscription.customerId, _id: {$ne: subscriptionId}},
          {status: "INACTIVE"}
        );
      }
    }

  },
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
    const count = await this.adapter.count();
    if (count === 0) {
      return this.seedDB();
    }
  },
};
