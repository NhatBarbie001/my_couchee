"use strict";

const { RESOURCES, ACTIONS } = require('../constants/permissions');

module.exports = {
  merged(schema) {
    const defaultResource = schema.settings?.defaultResource || schema.name;

    const actionPermissionMap = {
      list: { resource: defaultResource, action: ACTIONS.VIEW },
      // find: { resource: defaultResource, action: ACTIONS.VIEW },
      // get: { resource: defaultResource, action: ACTIONS.VIEW },
      getAllWithoutPagination: { resource: defaultResource, action: ACTIONS.VIEW },
      create: { resource: defaultResource, action: ACTIONS.CREATE },
      // insert: { resource: defaultResource, action: ACTIONS.CREATE },
      update: { resource: defaultResource, action: ACTIONS.UPDATE },
      remove: { resource: defaultResource, action: ACTIONS.DELETE },
    };

    if (schema.actions) {
      Object.keys(schema.actions).forEach(actionName => {
        const action = schema.actions[actionName];

        // Chỉ thêm permission nếu:
        // 1. Action có trong mapping
        // 2. Action chưa có permission được định nghĩa
        // 3. Action có auth: 'required'
        if (actionPermissionMap[actionName]) {
          if (typeof action === 'object' && action !== null) {
            if (!action.permission && action.auth === 'required') {
              action.permission = actionPermissionMap[actionName];
            }
          }
        }
      });
    }
  }
};
