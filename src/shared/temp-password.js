'use strict';

const crypto = require('crypto');

// Karışan karakterler (0/O, 1/l/I) çıkarıldı; şifre elle yazılacak.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const PASSWORD_LENGTH = 20;

function generateTempPassword(length = PASSWORD_LENGTH) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

module.exports = { generateTempPassword, ALPHABET };
