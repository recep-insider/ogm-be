'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const env = require('../config/env');

function generateOtp(length = env.sms.otpLength) {
  let out = '';
  while (out.length < length) {
    const buf = crypto.randomBytes(length);
    for (const b of buf) {
      if (out.length >= length) break;
      out += String(b % 10);
    }
  }
  return out;
}

async function hashOtp(code) {
  return bcrypt.hash(code, 8);
}

async function verifyOtp(code, hash) {
  return bcrypt.compare(code, hash);
}

module.exports = { generateOtp, hashOtp, verifyOtp };
