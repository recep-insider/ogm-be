'use strict';

/**
 * Async route handler'ları sarmalayıp hata fırlatınca next(err)'a düşmesini sağlar.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
