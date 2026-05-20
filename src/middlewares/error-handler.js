'use strict';

const logger = require('../config/logger');
const { AppError } = require('../shared/errors');

function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: `Endpoint bulunamadı: ${req.method} ${req.originalUrl}`,
    },
  });
}

function errorHandler(err, req, res, _next) {
  const isAppError = err instanceof AppError;
  const status = isAppError ? err.status : 500;
  const code = isAppError ? err.code : 'internal_error';
  const message = isAppError ? err.message : 'Sunucu hatası';

  if (status >= 500) {
    logger.error(err.message, {
      stack: err.stack,
      method: req.method,
      path: req.originalUrl,
    });
  } else {
    logger.warn(err.message, {
      code,
      method: req.method,
      path: req.originalUrl,
    });
  }

  const body = { error: { code, message } };
  if (isAppError && err.details !== undefined) body.error.details = err.details;

  res.status(status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
