"use strict";
const {MoleculerClientError} = require("moleculer").Errors;
const i18next = require("i18next");
const {INPUT_TYPE} = require("../../../constants/constant");
module.exports = {
  actions: {
    check: {
      rest: "GET /check",
      async handler(ctx) {
        const {packageId} = ctx.params;
        const userId = ctx.params.userId || ctx.meta?.user?._id;

        if (!userId) {
          throw new Error("User ID is missing from the request context.");
        }

        const customer = await this.broker.call("customers.getOneByUser", {userId});

        if (!customer) {
          throw new Error(`No customer found for user ID: ${userId}`);
        }

        const activeSubscriptions = await this.broker.call("subscriptions.find", {
          query: {
            customerId: customer._id,
            packageId,
            status: "ACTIVE"
          }
        });

        const hasActiveSubscription = activeSubscriptions.length > 0;

        return hasActiveSubscription ? {
          state: "exist",
          message: i18next.t("you_have_active_subscription")
        } : {
          state: "not_exist"
        };
      }
    },

    studentOrder: {
      rest: "POST /order/student",
      async handler(ctx) {
        const {packageId, discountIds, price, priceIndex, paymentGateway = "vnpay"} = ctx.params;
        const userId = ctx.params.userId || ctx.meta?.user?._id;
        const [customer, promotion] = await Promise.all([
          this.broker.call("customers.getOneByUser", {userId}),
          this.broker.call("promotions.getOne", {packageId, priceIndex})
        ]);
        const order = await this.getOrderInformation(packageId, customer._id, price, discountIds, promotion);
        const paymentMethod = order.amount < 5000 ? "cash" : paymentGateway;
        const subscriptionStatus = paymentMethod === paymentGateway ? "INACTIVE" : "ACTIVE";
        const subscription = await this.createStudentSubscription(customer._id, packageId, price, subscriptionStatus);
        const transaction = await this.insertStudentTransaction(subscription._id, packageId, customer._id, discountIds, promotion, order.amount, price, paymentMethod);

        if (paymentMethod === "cash") {
          await this.broker.emit("transactionUpdateState", {
            transactionId: transaction._id.toString(),
            state: "done",
            responseMessage: 'Confirm Success',
          });
          return transaction
        }

        const paymentGateways = {
          "vnpay": "vnpay.createPaymentUrl",
          "vnptpay": "vnptpay.createPaymentUrl",
          "vnptqr": "vnptpay.createQRCode",
        };
        const paymentUrl = await ctx.call(paymentGateways[paymentGateway], {
          order,
          customer: {id: customer._id},
          transactionId: transaction._id
        });
        this.broker.call("transactions.update", {
          id: transaction._id.toString(),
          paymentUrl: paymentUrl.paymentUrl,
          vnpExpireDate: paymentUrl.vnpExpireDate,
        });
        await this.broker.emit(`sse.${transaction._id}`, transaction);
        return {transactionId: transaction._id, paymentUrl};
      }
    },
    currentPackage: {
      rest: "GET /currentPackage",
      async handler(ctx) {
        const userId = ctx.params.userId || ctx.meta?.user?._id;

        if (!userId) {
          throw new Error("User ID is missing from the request context.");
        }

        const customer = await this.broker.call("customers.getOneByUser", {userId});

        if (!customer) {
          throw new Error(`No customer found for user ID: ${userId}`);
        }

        // Get active subscriptions
        let subscriptions = await this.broker.call("subscriptions.find", {
          query: {
            customerId: customer._id,
            status: "ACTIVE",
            endDate: {$gte: new Date()},
            // startDate: {$lte: new Date()}
          }
        });

        if (!subscriptions || subscriptions.length === 0) {
          return [];
        }

        // Create a map of subscription IDs to package IDs
        const mapPackage = subscriptions.reduce((map, subscription) => {
          map[subscription._id.toString()] = subscription.packageId;
          return map;
        }, {});

        // Get permissions for these subscriptions
        const permissions = await this.broker.call("permissions.find", {
          query: {
            subscriptionId: {$in: this.extractIdFromList(subscriptions)}
          }
        });

        if (!permissions || permissions.length === 0) {
          return [];
        }

        // Process permissions to create initial result
        const initialResult = permissions.map(permission => {
          const {speakingLimit, speakingUsed, writingLimit, writingUsed} = permission.accessLimit;
          const packageId = mapPackage[permission.subscriptionId._id.toString()];

          return {
            ...permission.subscriptionId,
            accessLimit: permission.accessLimit,
            remainingSpeaking: speakingLimit ? Number(speakingLimit) - Number(speakingUsed) : null,
            remainingWriting: writingLimit ? Number(writingLimit) - Number(writingUsed) : null,
            packageId: packageId,
            packageType: typeof packageId === 'object' ? packageId.type : null
          };
        });

        // Group addon packages by packageId
        const packageGroups = {};
        const nonAddonPackages = [];

        // Separate addon and non-addon packages
        initialResult.forEach(item => {
          // Check if it's an addon package
          if (item.packageType === 'addon') {
            const packageIdStr = typeof item.packageId === 'object' ? item.packageId._id.toString() : item.packageId.toString();

            if (!packageGroups[packageIdStr]) {
              packageGroups[packageIdStr] = [];
            }
            packageGroups[packageIdStr].push(item);
          } else {
            nonAddonPackages.push(item);
          }
        });

        // Aggregate addon packages with the same packageId
        const aggregatedAddons = Object.values(packageGroups).map(group => {
          if (group.length <= 1) {
            return group[0]; // No need to aggregate if there's only one
          }

          // Use the first item as a base
          const base = { ...group[0] };
          const accessLimit = { ...base.accessLimit };

          // Aggregate numeric values in accessLimit
          group.slice(1).forEach(item => {
            Object.keys(item.accessLimit).forEach(key => {
              // Only aggregate numeric limits (not used values)
              if (key.endsWith('Limit') && !isNaN(Number(item.accessLimit[key]))) {
                const baseValue = Number(accessLimit[key] || 0);
                const itemValue = Number(item.accessLimit[key] || 0);
                accessLimit[key] = String(baseValue + itemValue);
              }
              if (key.endsWith('Used') && !isNaN(Number(item.accessLimit[key]))) {
                const baseValue = Number(accessLimit[key] || 0);
                const itemValue = Number(item.accessLimit[key] || 0);
                accessLimit[key] = String(baseValue + itemValue);
              }
            });
          });
          // Recalculate remaining values
          const speakingLimit = accessLimit.speakingLimit ? Number(accessLimit.speakingLimit) : null;
          const speakingUsed = accessLimit.speakingUsed ? Number(accessLimit.speakingUsed) : 0;
          const writingLimit = accessLimit.writingLimit ? Number(accessLimit.writingLimit) : null;
          const writingUsed = accessLimit.writingUsed ? Number(accessLimit.writingUsed) : 0;

          return {
            ...base,
            accessLimit,
            remainingSpeaking: speakingLimit ? speakingLimit - speakingUsed : null,
            remainingWriting: writingLimit ? writingLimit - writingUsed : null
          };
        });
        console.log("aggregatedAddons", aggregatedAddons);

        // Combine non-addon packages with aggregated addon packages
        return [...nonAddonPackages, ...aggregatedAddons];
      }
    },

    addSubscriptionToPermission: {
      rest: "POST /addSubscriptionToPermission",
      async handler(ctx) {

        const packageFree = await this.broker.call("packages.find", {
          query: {
            paidType: "free", type: 'base', customerTarget: "student"
          }
        });
        const allSubscription = await this.broker.call("subscriptions.find", {
          query: {
            packageId: packageFree[0]?._id, status: "ACTIVE"
          }
        })
        const mapUserSubscription = allSubscription.reduce((map, subscription) => {
          map[subscription?.customerId?.userId] = subscription._id;
          return map;
        }, {})
        const permissions = await this.broker.call("permissions.find", {
          query: {
            userId: allSubscription.map(subscription => subscription?.customerId?.userId).filter(item => !!item),
          }
        })
        const mcallContents = permissions.map(({_id, userId}, index) => ({
          action: 'permissions.update',
          params: {subscriptionId: mapUserSubscription[userId?._id], id: _id}
        }));
        await this.broker.mcall(mcallContents);
        return this.broker.call("permissions.find", {
          query: {
            userId: allSubscription.map(subscription => subscription?.customerId?.userId).filter(item => !!item),
          }
        })
      }
    },

    checkExpiringSubscription: {
      rest: "GET /checkExpiringSubscription",
      async handler(ctx) {
        const userId = ctx.params.userId || ctx.meta?.user?._id;
        const customer = await this.broker.call("customers.getOneByUser", {userId});
        const activeSubscriptions = await this.broker.call("subscriptions.find", {
          query: {
            customerId: customer._id,
            status: "ACTIVE",
            endDate: {
              $gte: new Date(),
            },
            isFree: false
          }
        });
        const subscriptionsGroupedByPackage = activeSubscriptions.reduce((map, subscription) => {
          const packageId = subscription.packageId._id.toString();
          if (!map[packageId]) {
            map[packageId] = [];
          }
          map[packageId].push(subscription);
          return map;
        }, {});

        const expiringSubscriptions = Object.values(subscriptionsGroupedByPackage).flatMap(s => {
          if (s.length === 1 && s[0].endDate.getTime() - new Date().getTime() <= 3 * 24 * 60 * 60 * 1000 && s[0].packageId.type === "base") {
            return s[0];
          }
          return [];
        });
        return expiringSubscriptions.length > 0
      }
    },

    unActive: {
      rest: "POST /unActive",
      async handler(ctx) {
        const {userId, packageId} = ctx.params;
        const customer = await this.broker.call("customers.getOneByUser", {userId});
        console.log("userId", userId)
        console.log("customer", customer)
        return this.adapter.updateMany({customerId: customer._id, packageId, status: "ACTIVE"}, {status: "INACTIVE"})
      }
    },

    renewPackage: {
      rest: "POST /renewPackage",
      async handler(ctx) {
        const {subscriptions} = ctx.params;
        const isInUse = subscriptions.endDate > new Date()
        const startDate = isInUse ? subscriptions.endDate : new Date();
        const entity = {
          customerId: subscriptions.customerId,
          packageId: subscriptions.packageId,
          startDate: startDate,
          endDate: new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000),
          status: 'ACTIVE',
        };
        const subscription = await this.adapter.insert(entity);
        this.broker.emit("subscriptionCreated", {subscription, customerTarget: "student"});
        return subscription
      }
    }

  },
  methods: {
    extractIdFromList(list) {
      return list.map(item => item._id);
    },

    async studentPaymentDone(subscription, customer) {
      await this.broker.emit("studentSubscriptionActive", {subscription, customer});
      const packageFree = await this.broker.call("packages.find", {
        query: {
          paidType: "free", type: 'base', customerTarget: "student"
        }
      });
      await this.adapter.updateMany(
        {customerId: subscription.customerId, packageId: packageFree[0]?._id, status: "ACTIVE"},
        {status: "INACTIVE"}
      );
    },
    async getOrderInformation(packageId, customerId, price, discountIds, promotion, quantity = 1) {
      const packageSubscription = await this.broker.call("packages.get", {id: packageId});
      let amount = quantity * (+price.unitAmount);

      //apply promotion
      if (promotion) {
        if (promotion.type === 'fixed') {
          amount = amount - promotion.discount;
        } else if (promotion.type === 'percentage') {
          amount = amount - (amount * promotion.discount / 100);
        }
      }

      // apply discount
      if (discountIds) {
        const discounts = await this.broker.call("discounts.find", {query: {_id: {$in: discountIds}}});
        discounts.forEach(discount => {
          if (discount.type === 'fixed') {
            amount = amount - discount.discount;
          } else {
            amount = amount - (amount * discount.discount / 100);
          }
        });
      }
      if (amount < 5000) amount = 0
      return {amount, service: packageSubscription.name};
    },
    async createStudentSubscription(customerId, packageId, price, status = "INACTIVE") {
      const DAY_IN_MS = 24 * 60 * 60 * 1000;
      let startDate = new Date();
      // mặc đinh endDate sau 10 năm
      let endDate = new Date(startDate.getTime() + 10 * 365 * DAY_IN_MS);
      // Fetch active subscriptions for the customer
      const packageInfo = await this.broker.call("packages.get", {id: packageId});

      if (packageInfo.type === 'base') {
        const activeSubscriptions = await this.adapter.find({
          query: {
            customerId,
            packageId,
            status: 'ACTIVE'
          }
        });
        if (activeSubscriptions.length > 0) {
          // Find the subscription with the latest endDate
          const latestSubscription = activeSubscriptions.reduce((latest, subscription) =>
            subscription.endDate > latest.endDate ? subscription : latest, activeSubscriptions[0]
          );
          // Set startDate to one day after the latest endDate
          startDate = new Date(latestSubscription.endDate.getTime() + DAY_IN_MS);
        }
        // Calculate the endDate based on the price unit
        endDate = new Date(startDate);
        if (price.unitName === "month") {
          endDate.setMonth(endDate.getMonth() + Number(price.intervalCount));
        } else if (price.unitName === "year") {
          endDate.setFullYear(endDate.getFullYear() + Number(price.intervalCount));
        }
      }
      // Insert the new subscription
      return this.adapter.insert({
        customerId,
        packageId,
        status,
        isFree: false,
        startDate,
        endDate,
        unitPrice: price.unitName,
        intervalCount: price.intervalCount
      });
    },

    async insertStudentTransaction(subscriptionId, packageId, customerId, discountIds, promotion, cost, price, paymentMethod = "vnpay", quantity = 1) {
      return this.broker.call("transactions.insert", {
        entity: {
          subscriptionId,
          discountIds,
          customerId,
          promotionId: promotion?._id,
          packageId,
          content: "",
          paymentCode: "",
          paymentUnit: "",
          packageQuantity: quantity,
          unitPrice: price.unitName,
          intervalCount: price.intervalCount,
          cost,
          paymentMethod: paymentMethod,
          state: paymentMethod === "cash" ? "done" : "processing",
        }
      });
    },
  },
  events: {
    async customerCreatedFromPhone({customer, packageId}) {

      const entity = {
        customerId: customer._id,
        packageId,
        startDate: new Date(),
        endDate: new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      };
      const subscription = await this.adapter.insert(entity);
      await this.broker.emit("subscriptionCreated", {subscription, customerTarget: "student"});
    },

  },
};
