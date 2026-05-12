'use strict';

const { errors } = require('../../shared/errors');
const reportsService = require('./reports.service');
const { fireSchema } = require('./reports.validators');

async function fire(req, res) {
  const numeric = {
    latitude: Number(req.body.latitude),
    longitude: Number(req.body.longitude),
    accuracyM: req.body.accuracyM != null ? Number(req.body.accuracyM) : undefined,
    description: req.body.description,
  };
  const { value, error } = fireSchema.validate(numeric, {
    abortEarly: false,
    convert: true,
    stripUnknown: true,
  });
  if (error) {
    throw errors.validation('Form alanlarında hata var', {
      errors: error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      })),
    });
  }

  const result = await reportsService.fireReport({
    user: req.user || null,
    body: value,
    files: req.files,
    ip: req.ip,
  });
  res.status(201).json(result);
}

module.exports = { fire };
