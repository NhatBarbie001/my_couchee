const SERVICE_NAME = "images"
exports.SERVICE_NAME = SERVICE_NAME
exports.IMAGE_SERVICE = {
  list: `${SERVICE_NAME}.list`,
  find: `${SERVICE_NAME}.find`,
  count: `${SERVICE_NAME}.count`,
  create: `${SERVICE_NAME}.create`,
  insert: `${SERVICE_NAME}.insert`,
  update: `${SERVICE_NAME}.update`,
  remove: `${SERVICE_NAME}.remove`,
  get: `${SERVICE_NAME}.get`,
  upload: `${SERVICE_NAME}.upload`
};
