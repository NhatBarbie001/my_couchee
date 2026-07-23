export const messageDefine = (key) => {
  return {
    'string.base': `${key} không đúng`,
    'number.base': `${key} không đúng`,
    'array.base': `${key} không đúng`,
    'string.empty': `${key} là không được bỏ trống`,
    'any.required': `${key} là không được thiếu`,
  };
};

const Joi = require('joi');

export function createValidatorSchema(objSchema, body, method) {
  body = body || {};
  let newSchema = {};
  if (method === 'POST') {
    newSchema = Object.assign({}, objSchema);
  } else {
    for (let key in objSchema) {
      if (objSchema.hasOwnProperty(key) && body.hasOwnProperty(key)) {
        newSchema[key] = objSchema[key];
      }
    }
  }
  return Joi.object().keys(newSchema);
}

export function validate(objSchema, data, method) {
  let schema = createValidatorSchema(objSchema, data, method);
  if (Array.isArray(data)) {
    let validateError = null;
    data.find(itemData => {
      const { value, error } = schema.validate(itemData, { allowUnknown: true, abortEarly: true });
      if (error) validateError = error;
      return error;
    });
    if (validateError && validateError.details) {
      return { validateError };
    }
    return { value: data };
  } else {
    const { value, error } = schema.validate(data, { allowUnknown: true, abortEarly: true });
    if (error && error.details) {
      return { error };
    }
    return { value };
  }
}
