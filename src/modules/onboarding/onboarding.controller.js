'use strict';

const { errors } = require('../../shared/errors');
const { onboardingSchema } = require('./onboarding.validators');
const onboardingService = require('./onboarding.service');

async function complete(req, res) {
  let parsed;
  try {
    parsed = req.body.data ? JSON.parse(req.body.data) : null;
  } catch (err) {
    throw errors.validation('`data` alanı geçerli JSON değil', { hint: err.message });
  }
  if (!parsed) throw errors.validation('`data` alanı zorunlu');

  const { value, error } = onboardingSchema.validate(parsed, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });
  if (error) {
    throw errors.validation('Form alanlarında hata var', {
      errors: error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      })),
    });
  }

  const result = await onboardingService.complete({
    user: req.user || null,
    registration: req.registration || null,
    data: value,
    files: req.files,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(201).json(result);
}

module.exports = { complete };
