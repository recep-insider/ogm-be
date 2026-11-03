'use strict';

const logger = require('../config/logger');
const { AppError, errors } = require('../shared/errors');
const { discardUploads } = require('../shared/discard-uploads');

function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: `Endpoint bulunamadı: ${req.method} ${req.originalUrl}`,
    },
  });
}

const BODY_ERRORS = {
  'entity.parse.failed': ['invalid_json', 'İstek gövdesi geçerli JSON değil'],
  'entity.too.large': ['payload_too_large', 'İstek gövdesi çok büyük'],
};

// body-parser hataları (bozuk JSON, büyük gövde) istemci kaynaklıdır; http-errors olarak status ve expose taşır.
function fromBodyParser(err) {
  if (!(err.expose && err.status >= 400 && err.status < 500)) return err;
  const [code, message] = BODY_ERRORS[err.type] || ['bad_request', 'Geçersiz istek'];
  return errors.make(err.status, code, message, err.type === 'entity.too.large' ? { limitBytes: err.limit } : undefined);
}

function errorHandler(rawErr, req, res, _next) {
  const err = rawErr instanceof AppError ? rawErr : fromBodyParser(rawErr);
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
