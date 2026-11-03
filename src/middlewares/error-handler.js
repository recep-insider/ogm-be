'use strict';

const logger = require('../config/logger');
const { AppError } = require('../shared/errors');
const { discardUploads } = require('../shared/discard-uploads');

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
    // SQL hatasının mesajı ve stack'i bağlı değerleri (TC, telefon, sağlık bilgisi) içerir; yalnız kodlar yazılır.
    const sqlError = err.sql !== undefined || err.sqlMessage !== undefined;
    logger.error(sqlError ? 'Veritabanı hatası' : err.message, {
      ...(sqlError
        ? { code: err.code, errno: err.errno, sqlState: err.sqlState }
        : { stack: err.stack }),
      method: req.method,
      path: req.originalUrl,
    });
  } else {
    // Reddedilen istekle yüklenen dosya diskte sahipsiz kalmasın. 5xx'te silinmez: kayıt yazıldıktan
    // sonra da oluşabilir.
    discardUploads(req);
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
