'use strict';

// user_agent sütunları en çok 255 karakter; daha uzun başlık giriş, onay ve audit kaydında 500'e yol açıyordu.
const MAX_USER_AGENT = 255;

function capUserAgent(req, _res, next) {
  const ua = req.headers['user-agent'];
  if (ua && ua.length > MAX_USER_AGENT) req.headers['user-agent'] = ua.slice(0, MAX_USER_AGENT);
  next();
}

module.exports = { capUserAgent, MAX_USER_AGENT };
