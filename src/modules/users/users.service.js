'use strict';

const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const env = require('../../config/env');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');
const { assetUrl } = require('../../shared/asset-url');
const { toDateOnly } = require('../../shared/dates');
const { hasProtectiveEquipment } = require('../equipment/equipment.service');

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// VolunteerLevel tamamlanan eğitim sayısından türetilir (B.10 — kesin ürün kuralı netleşince güncellenir).
const TRAININGS_PER_LEVEL = 2;
const LEVEL_NAMES = { 1: 'Yeni Gönüllü', 2: 'Aktif Gönüllü', 3: 'Kıdemli Gönüllü' };
function computeVolunteerLevel(completedCount) {
  const level = 1 + Math.floor(completedCount / TRAININGS_PER_LEVEL);
  const intoLevel = completedCount % TRAININGS_PER_LEVEL;
  return {
    level,
    name: LEVEL_NAMES[level] || 'Uzman Gönüllü',
    progressPercent: Math.round((intoLevel / TRAININGS_PER_LEVEL) * 100),
    trainingsRemaining: TRAININGS_PER_LEVEL - intoLevel,
  };
}

/**
 * Kullanıcının en güncel başvuru durumunu döner (yoksa null).
 * Değerler: pending | approved | rejected | requires_revision (applications.status).
 * Auth/onboarding cevaplarında FE'nin ekstra /me round-trip'i atmaması için paylaşılır.
 */
async function getApplicationStatus(userId) {
  const application = await db('applications')
    .where({ user_id: userId })
    .orderBy('submitted_at', 'desc')
    .first('status');
  return application ? application.status : null;
}

async function getMe(userId) {
  const user = await db('users').where({ id: userId, is_active: true }).first();
  if (!user) throw errors.notFound('Kullanıcı bulunamadı');

  const [applicationStatus, completed, hasEquipment] = await Promise.all([
    getApplicationStatus(userId),
    db('user_trainings').where({ user_id: userId, status: 'completed' }).count({ c: '*' }).first(),
    hasProtectiveEquipment(userId),
  ]);

  return {
    id: user.id,
    tcKimlik: user.tc_kimlik,
    ad: user.ad,
    soyad: user.soyad,
    dogumTarihi: toDateOnly(user.dogum_tarihi),
    phone: user.phone,
    eposta: user.eposta,
    adres: user.adres,
    kanGrubu: user.kan_grubu,
    ogrenim: user.ogrenim,
    meslek: user.meslek,
    meslekDiger: user.meslek_diger,
    hobiler: safeJson(user.hobiler, []),
    giysiBedeni: user.giysi_bedeni,
    ayakkabiNumarasi: user.ayakkabi_numarasi != null ? Number(user.ayakkabi_numarasi) : null,
    acil: {
      ad: user.acil_ad,
      soyad: user.acil_soyad,
      telefon: user.acil_telefon,
      yakinlik: user.acil_yakinlik,
    },
    profileComplete: !!user.profile_complete,
    applicationStatus,
    volunteerLevel: computeVolunteerLevel(Number(completed?.c || 0)),
    avatarUrl: assetUrl(user.avatar_path),
    hasProtectiveEquipment: hasEquipment,
  };
}

const PATCH_KEYS = {
  phone: 'phone',
  eposta: 'eposta',
  adres: 'adres',
  kanGrubu: 'kan_grubu',
  ogrenim: 'ogrenim',
  meslek: 'meslek',
  meslekDiger: 'meslek_diger',
  hobiler: 'hobiler',
  giysiBedeni: 'giysi_bedeni',
  ayakkabiNumarasi: 'ayakkabi_numarasi',
};

async function patchMe(userId, body, audit = {}) {
  // hobiler reference-data validasyonu
  if (Array.isArray(body.hobiler)) {
    const allowed = await db('reference_data')
      .where({ category: 'hobiler', is_active: true })
      .pluck('value');
    const invalid = body.hobiler.filter((h) => !allowed.includes(h));
    if (invalid.length > 0) {
      throw errors.validation('Geçersiz hobi değeri', { invalid });
    }
  }

  // Telefon/eposta benzersizlik kontrolü (kontrat 4.1 → 409 phone_taken / email_taken).
  // NOT: PATCH ile doğrudan telefon değişimi destekleniyor; OTP doğrulamalı güvenli akış için
  // /users/me/phone-change/init + /commit uçları korunuyor.
  if (body.phone !== undefined) {
    const taken = await db('users')
      .where({ phone: body.phone, is_active: true })
      .whereNot({ id: userId })
      .first();
    if (taken) throw errors.conflict('Bu telefon başka bir kullanıcıda kayıtlı', undefined, 'phone_taken');
  }
  if (body.eposta !== undefined) {
    const taken = await db('users')
      .where({ eposta: body.eposta, is_active: true })
      .whereNot({ id: userId })
      .first();
    if (taken) throw errors.conflict('Bu e-posta başka bir kullanıcıda kayıtlı', undefined, 'email_taken');
  }

  const update = {};
  for (const [k, col] of Object.entries(PATCH_KEYS)) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      update[col] = k === 'hobiler' ? JSON.stringify(body[k]) : body[k];
    }
  }
  if (body.acil) {
    update.acil_ad = body.acil.ad;
    update.acil_soyad = body.acil.soyad;
    update.acil_telefon = body.acil.telefon;
    update.acil_yakinlik = body.acil.yakinlik;
  }
  // avatarUrl kontratta kabul ediliyor ama avatar yalnızca POST /users/me/avatar ile değişir; no-op.

  if (Object.keys(update).length === 0) {
    throw errors.validation('Güncellenecek alan yok');
  }

  update.updated_at = new Date();
  await db('users').where({ id: userId }).update(update);
  await writeAudit({
    userId,
    action: 'users.patch',
    entity: 'user',
    entityId: userId,
    ip: audit.ip,
    userAgent: audit.userAgent,
    payload: { fields: Object.keys(update).filter((k) => k !== 'updated_at') },
  });
  return getMe(userId);
}

/** PUT /users/me/acil — acil iletişim bilgisini tamamen değiştirir (kontrat 4.2). */
async function updateAcil(userId, body, audit = {}) {
  await db('users').where({ id: userId }).update({
    acil_ad: body.ad,
    acil_soyad: body.soyad,
    acil_telefon: body.telefon,
    acil_yakinlik: body.yakinlik,
    updated_at: new Date(),
  });
  await writeAudit({
    userId,
    action: 'users.acil',
    entity: 'user',
    entityId: userId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
  return getMe(userId);
}

async function setAvatar(userId, file, audit = {}) {
  if (!file) throw errors.validation('Dosya zorunlu');

  const rel = path.relative(env.upload.dir, file.path);
  const previous = await db('users').where({ id: userId }).first('avatar_path');

  await db('users').where({ id: userId }).update({
    avatar_path: rel,
    updated_at: new Date(),
  });

  if (previous?.avatar_path) {
    try {
      await fs.unlink(path.join(env.upload.dir, previous.avatar_path));
    } catch {
      // ignore
    }
  }

  await writeAudit({
    userId,
    action: 'users.avatar',
    entity: 'user',
    entityId: userId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
  return getMe(userId);
}

async function recordConsent(userId, { document, version, ip, userAgent }) {
  const id = uuidv4();
  await db('consents').insert({
    id,
    user_id: userId,
    document,
    version,
    granted: true,
    ip,
    user_agent: userAgent,
  });
  await writeAudit({
    userId,
    action: 'users.consent',
    entity: 'consent',
    entityId: id,
    ip,
    userAgent,
    payload: { document, version },
  });
  return { ok: true };
}

/**
 * KVKK Madde 11 — kullanıcının tüm verilerini JSON olarak döndürür.
 */
async function dataExport(userId, audit = {}) {
  const [user, applications, consents, devices, fireReports] = await Promise.all([
    db('users').where({ id: userId }).first(),
    db('applications').where({ user_id: userId }).select(),
    db('consents').where({ user_id: userId }).select(),
    db('devices').where({ user_id: userId }).select('id', 'platform', 'app_version', 'last_seen_at', 'created_at'),
    db('fire_reports').where({ user_id: userId }).select(
      'id', 'latitude', 'longitude', 'description', 'status', 'created_at',
    ),
  ]);

  if (!user) throw errors.notFound('Kullanıcı bulunamadı');

  await writeAudit({
    userId,
    action: 'users.export',
    entity: 'user',
    entityId: userId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });

  return {
    exportedAt: new Date().toISOString(),
    legalReference: 'KVKK Madde 11',
    user: {
      ...user,
      hobiler: safeJson(user.hobiler, []),
    },
    applications: applications.map((a) => ({
      ...a,
      snapshot: safeJson(a.snapshot, null),
    })),
    consents,
    devices,
    fireReports,
  };
}

/**
 * KVKK silme talebi — soft delete + 30 gün içinde anonimleştirme cron job'u
 * (faz 4'te yapılacak).
 */
async function softDelete(userId, audit = {}) {
  const now = new Date();
  const result = await db('users')
    .where({ id: userId, is_active: true })
    .update({
      is_active: false,
      deleted_at: now,
      updated_at: now,
    });
  if (!result) throw errors.notFound('Kullanıcı bulunamadı veya zaten silinmiş');

  // Tüm aktif refresh token'ları iptal
  await db('refresh_tokens')
    .where({ user_id: userId })
    .whereNull('revoked_at')
    .update({ revoked_at: now });

  // Cihaz token'larını sil (push almasın)
  await db('devices').where({ user_id: userId }).delete();

  await writeAudit({
    userId,
    action: 'users.delete',
    entity: 'user',
    entityId: userId,
    ip: audit.ip,
    userAgent: audit.userAgent,
    payload: { deletedAt: now.toISOString(), purgeAfter: '30 days' },
  });

  return {
    ok: true,
    deletedAt: now.toISOString(),
    purgeAfterDays: 30,
    note:
      'Hesabınız devre dışı bırakıldı. KVKK gereği kişisel verileriniz 30 gün içinde anonimleştirilecek/silinecektir.',
  };
}

module.exports = {
  getMe,
  getApplicationStatus,
  patchMe,
  updateAcil,
  setAvatar,
  recordConsent,
  dataExport,
  softDelete,
};
