'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ACCESS = 'access';
const REFRESH = 'refresh';
const REGISTRATION = 'registration';

function signAccessToken(payload) {
  return jwt.sign({ ...payload, typ: ACCESS }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn,
    issuer: 'ogm-gonullu-api',
  });
}

function signRefreshToken(payload) {
  return jwt.sign({ ...payload, typ: REFRESH }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
    issuer: 'ogm-gonullu-api',
  });
}

function signRegistrationToken(payload) {
  return jwt.sign({ ...payload, typ: REGISTRATION }, env.jwt.accessSecret, {
    expiresIn: env.jwt.registrationExpiresIn,
    issuer: 'ogm-gonullu-api',
  });
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.jwt.accessSecret, { issuer: 'ogm-gonullu-api' });
  if (payload.typ !== ACCESS) {
    throw new jwt.JsonWebTokenError('access token bekleniyor');
  }
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.jwt.refreshSecret, { issuer: 'ogm-gonullu-api' });
  if (payload.typ !== REFRESH) {
    throw new jwt.JsonWebTokenError('refresh token bekleniyor');
  }
  return payload;
}

function verifyRegistrationToken(token) {
  const payload = jwt.verify(token, env.jwt.accessSecret, { issuer: 'ogm-gonullu-api' });
  if (payload.typ !== REGISTRATION) {
    throw new jwt.JsonWebTokenError('registration token bekleniyor');
  }
  return payload;
}

function accessTokenSeconds() {
  return resolveExpiresIn(env.jwt.accessExpiresIn);
}

function registrationTokenSeconds() {
  return resolveExpiresIn(env.jwt.registrationExpiresIn);
}

function resolveExpiresIn(value) {
  if (typeof value === 'number') return value;
  const m = String(value).match(/^(\d+)\s*(s|m|h|d)?$/i);
  if (!m) return 900;
  const n = Number(m[1]);
  switch ((m[2] || 's').toLowerCase()) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return n;
  }
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  signRegistrationToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyRegistrationToken,
  accessTokenSeconds,
  registrationTokenSeconds,
};
