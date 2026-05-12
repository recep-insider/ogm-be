'use strict';

const { errors } = require('../shared/errors');

/**
 * Joi şemaları için validation middleware factory.
 *
 * @param {object} schemas - { body, params, query } Joi şemaları
 */
function validate(schemas = {}) {
  return (req, _res, next) => {
    const errorList = [];

    for (const key of ['body', 'params', 'query']) {
      const schema = schemas[key];
      if (!schema) continue;
      const { value, error } = schema.validate(req[key], {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });
      if (error) {
        for (const detail of error.details) {
          errorList.push({
            field: detail.path.join('.') || key,
            message: detail.message,
          });
        }
      } else {
        req[key] = value;
      }
    }

    if (errorList.length > 0) {
      return next(errors.validation('Form alanlarında hata var', { errors: errorList }));
    }
    return next();
  };
}

module.exports = validate;
