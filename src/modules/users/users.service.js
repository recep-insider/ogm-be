'use strict';

const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const env = require('../../config/env');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildAvatarUrl(rel) {
  if (!rel) return null;
  if (env.upload.publicBaseUrl) {
    return `${env.upload.publicBaseUrl.replace(/\/$/, '')}/${rel.replace(/^\//, '')}`;
  }
  return `${env.api.baseUrl}/v1/users/me/avatar/${path.basename(rel)}`;
}

async function getMe(userId) {
  const user = await db('users').where({ id: userId, is_active: true }).first();
  if (!user) throw errors.notFound('Kullanıcı bulunamadı');

  const application = await db('applications')
    .where({ user_id: userId })
    .orderBy('submitted_at', 'desc')
    .first();

  return {
    id: user.id,
    tcKimlik: user.tc_kimlik,
    ad: user.ad,
    soyad: user.soyad,
    dogumTarihi: user.dogum_tarihi,
    phone: user.phone,
    eposta: user.eposta,
    adres: user.adres,
    kanGrubu: user.kan_grubu,
    ogrenim: user.ogrenim,
    meslek: user.meslek,
    meslekDiger: user.meslek_diger,
    hobiler: safeJson(user.hobiler, []),
    acil: {
      ad: user.acil_ad,
      soyad: user.acil_soyad,
      telefon: user.acil_telefon,
      yakinlik: user.acil_yakinlik,
    },
    profileComplete: !!user.profile_complete,
    applicationStatus: application ? application.status : null,
    volunteerLevel: {
      level: 1,
      name: 'Yeni Gönüllü',
      progressPercent: 0,
      trainingsRemaining: 4,
    },
    avatarUrl: buildAvatarUrl(user.avatar_path),
  };
}

const PATCH_KEYS = {
  eposta: 'eposta',
  adres: 'adres',
  kanGrubu: 'kan_grubu',
  ogrenim: 'ogrenim',
  meslek: 'meslek',
  meslekDiger: 'meslek_diger',
  hobiler: 'hobiler',
};

async function patchMe(userId, body, audit = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    throw errors.validation('Telefon değişikliği için /users/me/phone-change uçlarını kullanın');
  }

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
  return { avatarUrl: buildAvatarUrl(rel) };
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

module.exports = { getMe, patchMe, setAvatar, recordConsent, dataExport, softDelete };
