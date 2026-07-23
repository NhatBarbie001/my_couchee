"use strict";

const {USER_CODES} = require("../constants/constant");
module.exports = {
  actions: {
    create: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    update: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    list: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    get: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    remove: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    getAllWithoutPagination: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    updateMany: {
      role: USER_CODES.SYSTEM_ADMIN,
    },
    deleteMany: {
      role: USER_CODES.SYSTEM_ADMIN,
    }
  }
};
