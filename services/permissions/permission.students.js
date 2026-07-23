"use strict";

const {ACCESS_CODE, INPUT_TYPE, MEDIA_INPUT_TYPE} = require("../../constants/constant");
module.exports = {
  actions: {
    testStudentSubmited: {
      rest: {
        method: "POST",
        path: "/testStudentSubmited",
      },
      async handler(ctx) {
        ctx.emit("studentSubmited", {inputType: INPUT_TYPE.STUDENT_SPEAKING})
      }
    },
    checkQuota: {
      rest: "GET /checkQuota",
      async handler(ctx) {
        const userId = ctx.params.userId || ctx.meta?.user?._id;
        const permissions = await ctx.call("permissions.find", {query: {userId}});

        let remainingSpeaking = 0;
        let remainingWriting = 0;
        permissions.forEach(item => {
          if (item.subscriptionId?.startDate <= new Date()) {
            remainingSpeaking += item.accessLimit.speakingLimit ? Number(item.accessLimit.speakingLimit) - item.accessLimit.speakingUsed : 0
            remainingWriting += item.accessLimit.writingLimit ? Number(item.accessLimit.writingLimit) - item.accessLimit.writingUsed : 0
          }
        })
        return remainingSpeaking + remainingWriting <= 3
      }
    }
  },
  methods: {

    async permissionInUse(ctx, userId, subscriptionsActive, inputType) {
      const isSpeaking = inputType === INPUT_TYPE.STUDENT_SPEAKING;
      const usedKey = isSpeaking ? "speakingUsed" : "writingUsed";
      const limitKey = isSpeaking ? "speakingLimit" : "writingLimit";

      const filterAndSortPermissions = (subscriptions) => {
        return subscriptions
          .filter(item => Number(item.accessLimit[limitKey]) > Number(item.accessLimit[usedKey]))
          .sort((a, b) => new Date(a.subscriptionId.startDate) - new Date(b.subscriptionId.startDate));
      };

      const getPermissions = async (subscriptionIds) => {
        return await ctx.call("permissions.find", {
          query: {
            userId,
            subscriptionId: {$in: subscriptionIds}
          }
        });
      };

      const baseSubscriptionIds = subscriptionsActive
        .filter(item => item.packageId.type === "base")
        .map(item => item._id);

      const addSubscriptionIds = subscriptionsActive
        .filter(item => item.packageId.type === "addon")
        .map(item => item._id);

      const basePermissions = await getPermissions(baseSubscriptionIds);
      const addonPermissions = await getPermissions(addSubscriptionIds);

      let permissionHaveAccess = filterAndSortPermissions(basePermissions);

      if (!permissionHaveAccess.length) {
        permissionHaveAccess = filterAndSortPermissions(addonPermissions);
      }

      return permissionHaveAccess[0] || null;
    },

    getStudentAccessLimit(accessRole) {
      const {
        SUBMIT_WRITING,
        SUBMIT_SPEAKING
      } = ACCESS_CODE;
      const writingLimit = accessRole[SUBMIT_WRITING]?.value;
      const speakingLimit = accessRole[SUBMIT_SPEAKING]?.value;
      return {writingLimit, speakingLimit}
    },

    getStudentAddOnAccessLimit(permissions) {
      const {accessRole, accessLimit} = permissions
      const {SUBMIT_WRITING_ADD_ON, SUBMIT_SPEAKING_ADD_ON} = ACCESS_CODE;
      const writingAddOnLimit = accessRole[SUBMIT_WRITING_ADD_ON]?.value;
      const speakingAddOnLimit = accessRole[SUBMIT_SPEAKING_ADD_ON]?.value;
      return {
        writingLimit: accessLimit.writingLimit,
        speakingLimit: accessLimit.speakingLimit,
        writingUsed: accessLimit.writingUsed,
        speakingUsed: accessLimit.speakingUsed,
        writingAddOnLimit: (+writingAddOnLimit || 0) + (+accessLimit.writingAddOnLimit || 0),
        speakingAddOnLimit: (+speakingAddOnLimit || 0) + (+accessLimit.speakingAddOnLimit || 0),
      }
    },
    getStudentSubscriptionAccessLimit(accessRole) {
      console.log("accessRole", accessRole)
      const {SUBMIT_WRITING, SUBMIT_SPEAKING, SUBMIT_WRITING_ADD_ON, SUBMIT_SPEAKING_ADD_ON} = ACCESS_CODE;
      const speakingLimit = accessRole[SUBMIT_SPEAKING]?.value || accessRole[SUBMIT_SPEAKING_ADD_ON]?.value;
      const writingLimit = accessRole[SUBMIT_WRITING]?.value || accessRole[SUBMIT_WRITING_ADD_ON]?.value;
      return {
        speakingLimit,
        writingLimit,
        speakingUsed: 0,
        writingUsed: 0,
      }
    }

  },
  events: {
    studentSubscriptionActive: {
      params: {
        subscription: "object"
      },
      async handler(ctx) {
        const {subscription, customer} = ctx.params;
        const packageId = subscription.packageId.toString();

        const packageInfo = await ctx.call("packages.get", {id: packageId})
        const features = await this.broker.call("features.find", {query: {packageType: packageInfo.type}});

        const accessRole = features.reduce((map, item) => {
          map[item.code] = {name: item.name, value: packageInfo.features[item._id]};
          return map;
        }, {});

        const accessLimit = this.getStudentSubscriptionAccessLimit(accessRole);
        return this.adapter.insert({
          userId: customer.userId,
          subscriptionId: subscription._id,
          accessLimit,
          accessRole
        });
      }
    },
    studentSubmited: {
      async handler(ctx) {
        try {
          const {inputType} = ctx.params;
          const userId = ctx.meta?.user?._id;

          if (!userId) {
            throw new Error("User ID is missing in the context metadata.");
          }

          const customer = await ctx.call("customers.getOneByUser", {userId});

          if (!customer) {
            throw new Error(`No customer found for user ID: ${userId}`);
          }

          const subscriptionsActive = await ctx.call("subscriptions.find", {
            query: {
              customerId: customer._id,
              status: "ACTIVE",
              startDate: {$lte: new Date()},
              endDate: {$gte: new Date(new Date().setHours(23, 59, 59, 999))},
            }
          });
          console.log("subscriptionsActive", subscriptionsActive)
          if (subscriptionsActive.length === 0) {
            throw new Error(`No active subscription in use found for customer ID: ${customer._id}`);
          }

          const userPermissions = await this.permissionInUse(ctx, userId, subscriptionsActive, inputType);
          if (!userPermissions) {
            throw new Error(`No permissions found for user ID: ${userId} and subscription ID: ${userPermissions._id}`);
          }

          const isSpeaking = inputType === INPUT_TYPE.STUDENT_SPEAKING;
          const accessLimitKey = isSpeaking ? 'speakingUsed' : 'writingUsed';

          userPermissions.accessLimit[accessLimitKey]++;

          return this.adapter.updateById(userPermissions._id, {$set: {accessLimit: userPermissions.accessLimit}});
        } catch (e) {
          console.error("Error in handler:", e);
          throw e; // Re-throw the error to ensure it's handled upstream
        }
      }
    },

  },
};
