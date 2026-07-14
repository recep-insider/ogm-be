'use strict';

// Creates the first admin account from env (idempotent). No-op when
// ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD are unset; if the email already
// exists it does nothing (NEVER rewrites the password, NEVER logs it).
// Subsequent admins are created via POST /admin/staff.

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const env = require('../src/config/env');

exports.seed = async function seed(knex) {
  const email = env.admin.seedEmail;
  const password = env.admin.seedPassword;
  if (!email || !password) return; // skip when env is not provided

  const existing = await knex('admin_users')
    .whereRaw('LOWER(eposta) = ?', [email.toLowerCase()])
    .first();
  if (existing) return; // idempotent — never touch an existing account

  const passwordHash = await bcrypt.hash(password, env.admin.bcryptRounds);
  await knex('admin_users').insert({
    id: uuidv4(),
    eposta: email,
    ad: env.admin.seedAd,
    soyad: env.admin.seedSoyad,
    password_hash: passwordHash,
    role: 'admin',
    is_active: true,
  });
};
