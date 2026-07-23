"use strict";

const DbService = require("moleculer-db");
const MongooseAdapter = require("moleculer-db-adapter-mongoose");

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 * @typedef {import('moleculer-db').MoleculerDB} MoleculerDB  Moleculer's DB Service Schema
 */

module.exports = function (mongooseModel) {
  const mongoDbUri =
    // process.env.MONGO_URI || "mongodb://lingo:thinklabs2023@113.160.181.249:4014/lingotutorsuite?authSource=lingotutorsuite&authMechanism=SCRAM-SHA-256";
    // process.env.MONGO_URI || "mongodb://root:thinklAb202x@113.160.181.249:4014/clickee-coach?authSource=admin&authMechanism=SCRAM-SHA-256";
    // process.env.MONGO_URI || "mongodb://clickee:Thinklabs2024@113.160.181.249:4014/clickeebackup?authSource=clickeebackup&authMechanism=SCRAM-SHA-256";
    // process.env.MONGO_URI || "mongodb+srv://clickee:ClickeeThinklabs@cluster0.472nj.mongodb.net/coach?authSource=admin&authMechanism=SCRAM-SHA-256";
    // process.env.MONGO_URI || "mongodb://clickee:ThinklabS202x@103.124.95.232:17017/clickee?connectTimeoutMS=10000&authSource=clickee&authMechanism=SCRAM-SHA-1";
    // process.env.MONGO_URI || "mongodb+srv://clickee:ClickeeThinklabs@cluster0.472nj.mongodb.net/";
    // process.env.MONGO_URI || "mongodb://127.0.0.1:27017/clickee-coach";
    // process.env.MONGO_URI || "mongodb://user:464db119ce585bb26b1d115c04740ac958497e16098ef8e5c0557a8ae1a2debcS@135.171.154.127:27017/coach-staging?authSource=coach-staging&directConnection=true";
    process.env.MONGO_URI || "mongodb://root:d4893701b86ae3ec22a5b62b354ff1846585578cc14692c70ce6f1b5a190e50d@160.187.146.60:31062/coach-dev?authSource=admin&authMechanism=SCRAM-SHA-1&directConnection=true";


  return {
    mixins: [DbService],
    adapter: new MongooseAdapter(mongoDbUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }),
    model: mongooseModel,
    actions: {
      create: {
        visibility: "published",
        auth: "required",
      },
      update: {
        visibility: "published",
        auth: "required",
      },
      list: {
        visibility: "published",
        auth: "required",
      },
      get: {
        visibility: "published",
        auth: "required",
      },
      remove: {
        visibility: "published",
        auth: "required",
      },
      insertMany: {
        auth: "required",
        async handler(ctx) {
          return this.adapter.insertMany(ctx.params);
        },
      },
    },
  };
};
