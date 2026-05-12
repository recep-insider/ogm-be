'use strict';

const healthService = require('./health.service');

async function liveness(_req, res) {
  res.status(200).json(healthService.getLiveness());
}

async function readiness(_req, res, next) {
  try {
    const result = await healthService.getReadiness();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { liveness, readiness };
