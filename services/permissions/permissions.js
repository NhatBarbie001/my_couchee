const SERVICE_NAME = "permissions"
exports.SERVICE_NAME = SERVICE_NAME
exports.FILE_SERVICE = {
  list: `${SERVICE_NAME}.list`,
  find: `${SERVICE_NAME}.find`,
  count: `${SERVICE_NAME}.count`,
  create: `${SERVICE_NAME}.create`,
  insert: `${SERVICE_NAME}.insert`,
  update: `${SERVICE_NAME}.update`,
  remove: `${SERVICE_NAME}.remove`,
  save: `${SERVICE_NAME}.save`,
  get: `${SERVICE_NAME}.get`,
  stream: `${SERVICE_NAME}.stream`,
  data: `${SERVICE_NAME}.data`,
  // filePath: `${SERVICE_NAME}.filePath`,
};
