const SERVICE_NAME = "users"
exports.SERVICE_NAME = SERVICE_NAME
exports.USER_SERVICE = {
  list: `${SERVICE_NAME}.list`,
  find: `${SERVICE_NAME}.find`,
  count: `${SERVICE_NAME}.count`,
  create: `${SERVICE_NAME}.create`,
  insert: `${SERVICE_NAME}.insert`,
  internalCreate: `${SERVICE_NAME}.internalCreate`,
  update: `${SERVICE_NAME}.update`,
  remove: `${SERVICE_NAME}.remove`,
  get: `${SERVICE_NAME}.get`,
};
