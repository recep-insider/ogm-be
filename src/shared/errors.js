'use strict';

class AppError extends Error {
  constructor(message, { status = 500, code = 'internal_error', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// Frontend `error.code` üzerinden switch yaptığı için kodlar snake_case (BACKEND_API_CONTRACT.md 0.4).
// Endpoint-spesifik kodlar (örn. already_applied, mission_full) son argümanla override edilir.
const errorFactories = {
  validation: (message, details, code = 'validation_error') =>
    new AppError(message, { status: 400, code, details }),
  unauthorized: (message = 'Kimlik doğrulanamadı', code = 'unauthorized') =>
    new AppError(message, { status: 401, code }),
  forbidden: (message = 'Bu işlem için yetkiniz yok', code = 'forbidden') =>
    new AppError(message, { status: 403, code }),
  notFound: (message = 'Kaynak bulunamadı', code = 'not_found') =>
    new AppError(message, { status: 404, code }),
  conflict: (message, details, code = 'conflict') =>
    new AppError(message, { status: 409, code, details }),
  gone: (message = 'Kaynak artık geçerli değil', details, code = 'gone') =>
    new AppError(message, { status: 410, code, details }),
  business: (message, details, code = 'business_error') =>
    new AppError(message, { status: 422, code, details }),
  rateLimit: (message = 'İstek limiti aşıldı', code = 'rate_limited') =>
    new AppError(message, { status: 429, code }),
  internal: (message = 'Sunucu hatası', code = 'internal_error') =>
    new AppError(message, { status: 500, code }),
  make: (status, code, message, details) =>
    new AppError(message, { status, code, details }),
};

module.exports = { AppError, errors: errorFactories };
