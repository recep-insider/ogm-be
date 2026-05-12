'use strict';

class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const errorFactories = {
  validation: (message, details) =>
    new AppError(message, { status: 400, code: 'VALIDATION_ERROR', details }),
  unauthorized: (message = 'Kimlik doğrulanamadı') =>
    new AppError(message, { status: 401, code: 'UNAUTHORIZED' }),
  forbidden: (message = 'Bu işlem için yetkiniz yok') =>
    new AppError(message, { status: 403, code: 'FORBIDDEN' }),
  notFound: (message = 'Kaynak bulunamadı') =>
    new AppError(message, { status: 404, code: 'NOT_FOUND' }),
  conflict: (message, details) =>
    new AppError(message, { status: 409, code: 'CONFLICT', details }),
  business: (message, details) =>
    new AppError(message, { status: 422, code: 'BUSINESS_ERROR', details }),
  rateLimit: (message = 'İstek limiti aşıldı') =>
    new AppError(message, { status: 429, code: 'RATE_LIMIT' }),
  internal: (message = 'Sunucu hatası') =>
    new AppError(message, { status: 500, code: 'INTERNAL_ERROR' }),
};

module.exports = { AppError, errors: errorFactories };
