#!/usr/bin/env node
'use strict';

// Gömülü süper admin hesabını oluşturur; kilitlenmede --reset ile kurtarır.
//
// Kullanım (sunucuda):
//   docker compose exec -T backend npm run super-admin:create -- --email superadmin@ogm.gov.tr
//   docker compose exec -T backend npm run super-admin:create -- --email superadmin@ogm.gov.tr --reset
//
// Geçici şifre yalnız stdout'a bir kez yazılır: uygulama logger'ına ve dosyaya yazılmaz.

const { parseArgs } = require('util');
const { v4: uuidv4 } = require('uuid');
const { generateTempPassword, ALPHABET } = require('../src/shared/temp-password');

const DEFAULT_NAME = 'Sistem Yöneticisi';

async function createSuperAdmin({ db, auth, email, name = DEFAULT_NAME, reset = false }) {
  const normalized = auth.normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Geçerli bir --email gerekli');

  const existing = await db('panel_users').where({ email: normalized }).first();
  if (existing && !reset) return { status: 'exists', id: existing.id };
  // Gömülü hesap panelden düşürülmüş ya da pasifleştirilmiş olabilir; kurtarma yine çalışmalı.
  if (existing && existing.role !== 'super_admin' && !existing.is_system) {
    throw new Error(`Bu e-posta bir süper admine ait değil (rol: ${existing.role}); --reset yalnız süper adminde çalışır`);
  }

  const password = generateTempPassword();
  const passwordHash = await auth.hashPassword(password);
  const now = new Date();

  if (existing) {
    await db('panel_users').where({ id: existing.id }).update({
      password_hash: passwordHash,
      must_change_password: true,
      role: 'super_admin',
      status: 'active',
      updated_at: now,
    });
    await auth.revokeAllForUser(existing.id);
    await auth.writePanelAudit({ targetId: existing.id, action: 'auth.super_admin_reset' });
    return { status: 'reset', id: existing.id, password };
  }

  const id = uuidv4();
  await db('panel_users').insert({
    id,
    name,
    email: normalized,
    password_hash: passwordHash,
    role: 'super_admin',
    status: 'active',
    is_system: true,
    must_change_password: true,
    approved_at: now,
    created_at: now,
    updated_at: now,
  });
  await auth.writePanelAudit({ targetId: id, action: 'auth.super_admin_create' });
  return { status: 'created', id, password };
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      reset: { type: 'boolean', default: false },
    },
  });
  if (!values.email) throw new Error('--email gerekli');

  const { db } = require('../src/config/db');
  const auth = require('../src/modules/admin/auth/panelAuth.service');
  try {
    const result = await createSuperAdmin({ db, auth, ...values });
    if (result.status === 'exists') {
      console.log(`Bu e-postayla panel kullanıcısı zaten var (id: ${result.id}); değişiklik yapılmadı.`);
      console.log('Şifreyi sıfırlamak için --reset ekleyin.');
      return;
    }
    console.log(result.status === 'created' ? 'Süper admin oluşturuldu.' : 'Şifre sıfırlandı, tüm oturumlar kapatıldı.');
    console.log(`E-posta: ${auth.normalizeEmail(values.email)}`);
    console.log(`Geçici şifre: ${result.password}`);
    console.log('Bu şifre yalnız şimdi gösterilir ve hiçbir yere kaydedilmez. İlk girişte değiştirilmesi zorunludur.');
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Süper admin oluşturulamadı:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { createSuperAdmin, generateTempPassword, ALPHABET };
