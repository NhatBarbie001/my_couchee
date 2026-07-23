const DbMongoose = require("../../mixins/dbMongo.mixin");
const Model = require("./permissions.model");
const BaseService = require("../../mixins/baseService.mixin");
const FileMixin = require("../../mixins/file.mixin");
const AuthRole = require("../../mixins/authRole.mixin");
const StudentPermissions = require("./permission.students");
const {SERVICE_NAME} = require("./permissions");
const {ACCESS_ROLE} = require("./permissions.constants");
const {ACCESS_CODE, MEDIA_INPUT_TYPE, INPUT_TYPE} = require("../../constants/constant");

const MEGABYTES = 1024 * 1024;

module.exports = {
  name: SERVICE_NAME,
  mixins: [DbMongoose(Model), BaseService, FileMixin, AuthRole, StudentPermissions],
  settings: {
    populates: {
      "userId": "users.get",
      "subscriptionId": "subscriptions.get",
    },
    populateOptions: ["userId", "subscriptionId"]
  },
  actions: {
    getOne: {
      rest: "GET /getOne",
      async handler(ctx) {
        const {userId, organizationId} = ctx.params;
        return this.adapter.findOne({userId, organizationId});
      }
    },


    testAddOnPackage: {
      rest: "POST /testAddOnPackage",
      async handler(ctx) {
        const packages = await this.broker.call("packages.find", {query: {name: "WRITING 30"}});
        const customerId = "678891d6e1c60a3538a726b0"
        const customer = await this.broker.call("customers.get", {id: customerId});
        await this.broker.emit(
          "addOnPackageOrdered",
          {packages: packages[0], customer}
        );
      }
    },
  },

  events: {
    resourceDeleted: {
      params: {
        resource: "object",
      },
      async handler(ctx) {
        const {resource} = ctx.params;
        const userId = resource.userId?._id;
        const organizationId = resource.organizationId?._id;
        let fileSize = 0;
        switch (resource.type) {
          case "IMAGE":
            fileSize = +resource.imageId?.imageFileId?.size / MEGABYTES || 0;
            ctx.emit("resourceImageDeleted", {id: resource.imageId?._id});
            break;
          case "AUDIO":
            fileSize = +resource.audioId?.audioFileId?.size / MEGABYTES || 0;
            ctx.emit("resourceAudioDeleted", {id: resource.audioId?._id});
            break;
          case "VIDEO":
            if (resource.offlineVideoId?._id) {
              fileSize = +resource.offlineVideoId?.videoFileId.size / MEGABYTES || 0;
              ctx.emit("resourceOfflineVideoDeleted", {id: resource.offlineVideoId?._id});
            } else if (resource.videoId?._id) {
              ctx.call("videos.remove", {id: resource.videoId?._id});
            }
            break;
          case "DOCUMENT":
            if (resource.fileId?._id) {
              fileSize = +resource.fileId.size / MEGABYTES || 0;
              ctx.call("files.remove", {id: resource.fileId?._id});
            } else {
              fileSize = +resource.imageId?.imageFileId?.size / MEGABYTES || 0;
              ctx.emit("resourceImageDeleted", {id: resource.imageId?._id});
            }
            break;
        }

        if (!organizationId) {
          const permission = await this.adapter.findOne({userId});
          permission.accessLimit.capacityUsed -= fileSize;
          return this.adapter.updateById(permission._id, {$set: {accessLimit: permission.accessLimit}});
        } else {
          const orgPermission = await this.adapter.findOne({organizationId, userId: {$exists: false}});
          orgPermission.accessLimit.capacityUsed -= fileSize;

          const userInOrgPermission = await this.adapter.findOne({userId, organizationId});
          userInOrgPermission.accessLimit.capacityUsed -= fileSize;

          await this.adapter.updateById(userInOrgPermission._id, {$set: {accessLimit: userInOrgPermission.accessLimit}});
          return this.adapter.updateById(orgPermission._id, {$set: {accessLimit: orgPermission.accessLimit}});
        }
      }
    },

    fileUploaded: {
      params: {
        file: "object",
      },
      async handler(ctx) {
        let {file, userId, organizationId} = ctx.params;
        const fileSize = +file.size / MEGABYTES;
        if (!organizationId) {
          const userPermissions = await this.checkExistPermission(ctx, userId);
          userPermissions.accessLimit.capacityUsed += fileSize;
          return this.adapter.updateById(userPermissions._id, {$set: {accessLimit: userPermissions.accessLimit}});
        } else {
          userId = ctx.meta?.user?._id;

          const orgPermissions = await this.checkExistPermission(ctx, undefined, organizationId);
          orgPermissions.accessLimit.capacityUsed += fileSize;

          const userInOrgPermissions = await this.checkExistPermission(ctx, userId, organizationId)
          userInOrgPermissions.accessLimit.capacityUsed += fileSize;

          await this.adapter.updateById(userInOrgPermissions._id, {$set: {accessLimit: userInOrgPermissions.accessLimit}});
          return this.adapter.updateById(orgPermissions._id, {$set: {accessLimit: orgPermissions.accessLimit}});
        }
      }
    },

    userSubmited: {
      params: {
        inputType: "string",
      },
      async handler(ctx) {
        try {
          const {inputType, workspaceId} = ctx.params;

          const isMedia = MEDIA_INPUT_TYPE.includes(inputType);
          let organizationId, workspace;
          let userId = ctx.meta?.user?._id;
          if (workspaceId) {
            workspace = await ctx.call("workspaces.get", {id: workspaceId});
            if (workspace.type === "ORGANIZATIONAL") {
              ({organizationId} = workspace);
            } else {
              ({userId} = workspace);
            }
          }
          const userPermissions = await this.checkExistPermission(ctx, userId);
          userPermissions.accessLimit[isMedia ? 'mediaUsed' : 'textUsed']++;

          if (organizationId) {
            const orgPermissions = await this.checkExistPermission(ctx, undefined, organizationId);
            orgPermissions.accessLimit[isMedia ? 'mediaUsed' : 'textUsed']++;

            const userInOrgPermissions = await this.checkExistPermission(ctx, userId, organizationId)
            userInOrgPermissions.accessLimit[isMedia ? 'mediaUsed' : 'textUsed']++;

            await this.adapter.updateById(orgPermissions._id, {$set: {accessLimit: orgPermissions.accessLimit}});
            return this.adapter.updateById(userInOrgPermissions._id, {$set: {accessLimit: userInOrgPermissions.accessLimit}});
          }

          return this.adapter.updateById(userPermissions._id, {$set: {accessLimit: userPermissions.accessLimit}});
        } catch (e) {
          console.log(e);
        }
      }
    },

    // async "user.registered"(payload, sender, event) {
    //   const packageTryClickee = await this.broker.call("packages.find", {
    //     query: {order: 1, type: 'base'}
    //   });
    //
    //   const features = await this.broker.call("features.find", {query: {packageType: packageTryClickee[0].type}});
    //   const accessRole = features.reduce((map, item) => {
    //     map[item.code] = {name: item.name, value: packageTryClickee[0]?.features[item._id]};
    //     return map;
    //   }, {});
    //
    //   const accessLimit = this.getAccessLimit(accessRole);
    //   const permissions = await this.adapter.insert({
    //     userId: payload._id,
    //     accessRole,
    //     accessLimit: {
    //       textLimit: accessLimit.textLimit,
    //       mediaLimit: accessLimit.mediaLimit,
    //       capacityLimit: accessLimit.capacityLimit,
    //       mediaDurationLimit: accessLimit.mediaDurationLimit,
    //       textUsed: 0,
    //       mediaUsed: 0,
    //       capacityUsed: 0
    //     }
    //   });
    // },

    normalUserSubscriptionActive: {
      params: {
        subscription: "object"
      },
      async handler(ctx) {
        const {subscription} = ctx.params;

        const customerId = subscription.customerId?.toString();
        const packageId = subscription.packageId.toString();

        const [customer, packageInfo] = await Promise.all([
          ctx.call("customers.get", {id: customerId}),
          ctx.call("packages.get", {id: packageId}),
        ]);
        const features = await this.broker.call("features.find", {query: {packageType: packageInfo.type}});

        const accessRole = features.reduce((map, item) => {
          map[item.code] = {name: item.name, value: packageInfo.features[item._id]};
          return map;
        }, {});

        const accessLimit = this.getSubscriptionAccessLimit(accessRole);

        const permissions = await this.adapter.findOne({userId: customer.userId});
        await this.adapter.updateById(
          {_id: permissions._id},
          {$set: {accessRole, accessLimit}}
        );
      }
    },
    subscriptionCreated: {
      params: {
        subscription: "object"
      },
      async handler(ctx) {
        const {subscription, customerTarget} = ctx.params;
        const {organizationId, userId} = await ctx.call("customers.get", {id: subscription.customerId.toString()});
        const packageInfo = await ctx.call("packages.get", {id: subscription.packageId.toString()});
        const features = await this.broker.call("features.find", {query: {packageType: packageInfo.type}});
        const accessRole = features.reduce((map, item) => {
          map[item.code] = {name: item.name, value: packageInfo.features[item._id]};
          return map;
        }, {});

        const accessLimit = customerTarget === 'student' ? this.getStudentSubscriptionAccessLimit(accessRole) : this.getSubscriptionAccessLimit(accessRole, customerTarget);
        await this.adapter.insert({
          organizationId,
          subscriptionId: subscription._id.toString(),
          userId,
          accessRole,
          accessLimit,
          type: organizationId ? "organization" : "personal",
        });
      }
    },

    packagesUpdated: {
      params: {
        packageInfo: "object"
      },
      async handler(ctx) {
        const {packageInfo} = ctx.params;
        const features = await this.broker.call("features.find", {query: {packageType: packageInfo.type}});

        const accessRole = features.reduce((map, item) => {
          map[item.code] = {name: item.name, value: packageInfo.features[item._id]};
          return map;
        }, {});


        const accessLimit = packageInfo.customerTarget === 'student' ? this.getStudentAccessLimit(accessRole) : this.getAccessLimit(accessRole);
        const {userIds, organizationIds, subscriptionIds} = await this.getUserAndOrgIds(ctx, packageInfo);
        const queryForStudent = packageInfo.customerTarget === 'student' ? {
          $and: [
            {userId: {$in: userIds}},
            {subscriptionId: {$in: subscriptionIds}}
          ]
        } : {userId: {$in: userIds}};
        const [permissions, permissionOrgs] = await Promise.all([
          this.adapter.find({
            query: queryForStudent
          }),
          this.adapter.find({query: {organizationId: {$in: organizationIds}}})
        ]);
        const bulkWriteOperations = permissions.map(row => this.generateBulkOperation(row, accessRole, accessLimit, packageInfo.customerTarget));
        const bulkWriteOrgsOperations = permissionOrgs.map(row => this.generateBulkOperation(row, accessRole, accessLimit));

        await Promise.all([
          Model.bulkWrite(bulkWriteOperations, {ordered: false}),
          Model.bulkWrite(bulkWriteOrgsOperations, {ordered: false})
        ]);
      }


    },

    addOnPackageOrdered: {
      async handler(ctx) {
        const {packages, customer} = ctx.params;

        const features = await this.broker.call("features.find", {query: {packageType: packages.type}});
        const permissions = await this.actions.getOne({userId: customer.userId});
        const accessRole = features.reduce((map, item) => {
          map[item.code] = {name: item.name, value: packages.features[item._id]};
          return map;
        }, {});
        const accessLimit = packages.customerTarget === 'student' ? this.getStudentAddOnAccessLimit(accessRole) : this.getAddOnAccessLimit(permissions);
        return this.adapter.updateById(permissions._id, {$set: {accessRole, accessLimit}});
      }
    }
  },

  methods: {


    async checkExistPermission(ctx, userId, organizationId) {
      const accessRole = await this.getAccessRole(ctx);
      const Obj = {
        accessRole,
        accessLimit: {
          // textLimit: accessRole[ACCESS_CODE.SUBMIT_TEXT].value,
          // mediaLimit: accessRole[ACCESS_CODE.SUBMIT_MEDIA].value,
          // capacityLimit: accessRole[ACCESS_CODE.MEDIA_CAPACITY].value,
          capacityUsed: 0,
          textUsed: 0,
          mediaUsed: 0
        },
        type: organizationId ? "organization" : "personal",
      }

      const permissions = await this.adapter.findOne({userId, organizationId});
      if (!permissions) {
        return this.adapter.insert({...Obj, userId, organizationId});
      }

      return permissions;
    },

    async getUserAndOrgIds(ctx, packageInfo) {
      const subscription = await ctx.call("subscriptions.find", {
        query: {
          packageId: packageInfo.id,
          status: "ACTIVE",
          customerId: {$exists: true}
        }
      });

      const userIds = subscription.flatMap(row => row.customerId?.userId ? [row.customerId?.userId] : []);
      const organizationIds = subscription.flatMap(row => row.customerId?.organizationId ? [row.customerId?.organizationId] : []);
      const subscriptionIds = subscription.map(row => row._id.toString());

      return {userIds, organizationIds, subscriptionIds};
    },

    generateBulkOperation(row, accessRole, accessLimit, customerTarget) {
      return {
        updateOne: {
          filter: {_id: row._id},
          update: {
            $set: {
              accessRole,
              accessLimit: {
                ...accessLimit,
                ...customerTarget ? {
                  speakingUsed: row.accessLimit.speakingUsed || 0,
                  writingUsed: row.accessLimit.writingUsed || 0,
                } : {
                  textUsed: row.accessLimit.textUsed || 0,
                  mediaUsed: row.accessLimit.mediaUsed || 0,
                  capacityUsed: row.accessLimit.capacityUsed || 0
                }
              }
            }
          },
          upsert: true,
        },
      };
    },

    async seedDB() {
      const accessRole = ACCESS_ROLE;
      const users = await this.broker.call('users.find', {query: {isDeleted: false}});
      const bulkWriteOperations = users.map(row => ({
        updateOne: {
          filter: {userId: row._id},
          update: {
            $set: {
              userId: row._id,
              accessRole,
              accessLimit: {
                textLimit: 30,
                mediaLimit: 10,
                capacityLimit: 500,
                textUsed: 0,
                mediaUsed: 0,
                capacityUsed: 0
              }
            }
          },
          upsert: true,
        },
      }));

      await Model.bulkWrite(bulkWriteOperations, {ordered: false});
    },
    async getAccessRole(ctx) {
      const userId = ctx.meta?.user?._id;
      const subscription = await ctx.call("subscriptions.getActive", {userId});
      if (!subscription && !ctx.meta?.user?.isSystemAdmin || ctx.meta?.user?.role === 'admin') {
        return ACCESS_ROLE;
      }

      const packageInfo = await ctx.call("packages.get", {id: subscription?.packageId?._id.toString()});
      const features = await this.broker.call("features.find", {query: {packageType: packageInfo.type}});
      return features.reduce((map, item) => {
        map[item.code] = {name: item.name, value: packageInfo.features[item._id]};
        return map;
      }, {});
    },

    getAccessLimit(accessRole) {
      const {
        SUBMIT_TEXT,
        SUBMIT_MEDIA,
        MEDIA_CAPACITY,
        INPUT_LIMIT_ON_MEDIA
      } = ACCESS_CODE;
      const textLimit = accessRole[SUBMIT_TEXT]?.value;
      const mediaLimit = accessRole[SUBMIT_MEDIA]?.value;
      const capacityLimit = accessRole[MEDIA_CAPACITY]?.value;
      const mediaDurationLimit = accessRole[INPUT_LIMIT_ON_MEDIA]?.value;
      return {
        textLimit,
        mediaLimit,
        capacityLimit,
        mediaDurationLimit
      };
    },
    getAddOnAccessLimit(permissions) {
      const {accessRole, accessLimit} = permissions
      const {SUBMIT_TEXT_ADD_ON, SUBMIT_MEDIA_ADD_ON, MEDIA_CAPACITY_ADD_ON,} = ACCESS_CODE;
      const textAddOnLimit = accessRole[SUBMIT_TEXT_ADD_ON]?.value;
      const mediaAddOnLimit = accessRole[SUBMIT_MEDIA_ADD_ON]?.value;
      const capacityAddOnLimit = accessRole[MEDIA_CAPACITY_ADD_ON]?.value;
      return {
        textLimit: accessLimit.textLimit,
        mediaLimit: accessLimit.mediaLimit,
        mediaDurationLimit: accessLimit.mediaDurationLimit,
        capacityLimit: accessLimit.capacityLimit,
        textUsed: accessLimit.textUsed,
        mediaUsed: accessLimit.mediaUsed,
        capacityUsed: accessLimit.capacityUsed,
        textAddOnLimit: (+textAddOnLimit || 0) + (+accessLimit.textAddOnLimit || 0),
        mediaAddOnLimit: (+mediaAddOnLimit || 0) + (+accessLimit.mediaAddOnLimit || 0),
        capacityAddOnLimit: (+capacityAddOnLimit || 0) + (+accessLimit.capacityAddOnLimit || 0),
      };
    },
    getSubscriptionAccessLimit(accessRole) {
      const {
        SUBMIT_TEXT,
        SUBMIT_MEDIA,
        MEDIA_CAPACITY,
        INPUT_LIMIT_ON_MEDIA,
      } = ACCESS_CODE;
      const textLimit = accessRole[SUBMIT_TEXT]?.value;
      const mediaLimit = accessRole[SUBMIT_MEDIA]?.value;
      const capacityLimit = accessRole[MEDIA_CAPACITY]?.value;
      const mediaDurationLimit = accessRole[INPUT_LIMIT_ON_MEDIA]?.value;
      return {
        textLimit, mediaLimit, capacityLimit, mediaDurationLimit,
        textUsed: 0,
        mediaUsed: 0,
        capacityUsed: 0
      };
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
