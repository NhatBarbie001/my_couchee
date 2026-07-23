"use strict";

const {USER_CODES} = require("../../constants/constant");
const fs = require("fs");
const path = require("path");
const FileMixin = require("../../mixins/file.mixin");
const storageDir = path.join(__dirname, "storage");

/** @type {ServiceSchema} */
module.exports = {
  name: "rateLimit",
  mixins: [FileMixin],
  /**
   * Settings
   */
  settings: {},
  hooks: {},
  /**
   * Dependencies
   */
  dependencies: [],

  /**
   * Actions
   */
  actions: {
    test: {
      rest: {
        method: "GET",
        path: "/test",
      },
      auth: "required",
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const { index } = ctx.params;
        const fibonacci = (n) => {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
        const result = fibonacci(index);
        await new Promise((resolve) => setTimeout(resolve, 5000));

        return result;
      }
    },
    testFile: {
      auth: "required",
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const {filename} = ctx.meta;
        const uniqueFileName = this.createUniqueFileName(filename);

        const filePath = this.getFilePath(uniqueFileName, storageDir);
        await this.saveToLocalStorage(ctx.params, filePath);

        const stream = fs.createReadStream(filePath);
        stream.on('end', () => {fs.unlinkSync(filePath)});

        await new Promise((resolve) => setTimeout(resolve, 5000));
        return stream;
      }
    },
    testJson: {
      auth: "required",
      rest: "POST /testJson",
      role: USER_CODES.SYSTEM_ADMIN,
      async handler(ctx) {
        const params = ctx.params;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return params;
      }
    }
  },

  /**
   * Events
   */
  events: {
  },

  /**
   * Methods
   */
  methods: {},

  /**
   * Service created lifecycle event handler
   */
  created() {
    this.createFolderIfNotExist(storageDir);
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
};
