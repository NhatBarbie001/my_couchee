const DbMongoose = require("../../../mixins/dbMongo.mixin");
const REFRESH_TOKEN = require("./refreshToken.model");
const BaseService = require("../../../mixins/baseService.mixin");
const AuthRole = require("../../../mixins/authRole.mixin");

module.exports = {
  name: "refreshToken",
  mixins: [DbMongoose(REFRESH_TOKEN), BaseService, AuthRole],
  actions: {
    create: {
      rest: "POST /",
      async handler(ctx) {
        return this.adapter.insert(ctx.params)
      }
    },
    deleteMany: {
      async handler(ctx) {
        return this.adapter.removeMany(ctx.params);
      }
    }
  }
}
