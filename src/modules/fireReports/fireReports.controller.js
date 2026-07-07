'use strict';

const { errors } = require('../../shared/errors');
const service = require('./fireReports.service');
const { fireReportDataSchema } = require('./fireReports.validators');

async function create(req, res) {
  let parsed;
  try {
    parsed = req.body.data ? JSON.parse(req.body.data) : null;
  } catch (err) {
    throw errors.validation('`data` alanı geçerli JSON değil', { hint: err.message });
  }
  if (!parsed) throw errors.validation('`data` alanı zorunlu');

  const { value, error } = fireReportDataSchema.validate(parsed, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });
  if (error) {
    throw errors.validation('Form alanlarında hata var', {
      errors: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  const result = await service.create({
    userId: req.user?.id || null,
    data: value,
    files: req.files,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(200).json(result);
}

async function listMine(req, res) {
  res.status(200).json(await service.listMine(req.user.id));
}

async function adminSetStatus(req, res) {
  const result = await service.adminSetStatus(req.params.id, req.body, {
    userId: req.user?.id || null,
    role: req.actor?.role,
  });
  res.status(200).json(result);
}

module.exports = { create, listMine, adminSetStatus };
