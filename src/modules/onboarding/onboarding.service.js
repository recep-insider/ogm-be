'use strict';

const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { errors } = require('../../shared/errors');
const {
  signAccessToken,
  signRefreshToken,
  accessTokenSeconds,
} = require('../../shared/jwt');
const { toIso, toDateOnly } = require('../../shared/dates');

async function unlinkSafe(file) {
  if (!file) return;
  try {
    await fs.unlink(file.path);
  } catch (err) {
    logger.warn('Dosya silinemedi', { path: file.path, error: err.message });
  }
}

async function complete({ user, registration, data, files, ip, userAgent }) {
  if (!files || !files.saglikRaporu || !files.sabikaKaydi) {
    throw errors.validation('Sağlık raporu ve sabıka kaydı zorunludur', {
      missing: ['saglikRaporu', 'sabikaKaydi'].filter((k) => !files || !files[k]),
    });
  }

  const saglik = files.saglikRaporu[0];
  const sabika = files.sabikaKaydi[0];

  // Hobiler reference-data karşılığı
  if (Array.isArray(data?.kisisel?.hobiler) && data.kisisel.hobiler.length > 0) {
    const allowed = await db('reference_data')
      .where({ category: 'hobiler', is_active: true })
      .pluck('value');
    const invalid = data.kisisel.hobiler.filter((h) => !allowed.includes(h));
    if (invalid.length > 0) {
      throw errors.validation('Geçersiz hobi değeri', { invalid });
    }
  }

  let userId = user?.id;
  let isNewUser = false;

  // tcKimlik conflict kontrolü
  const existsByTc = await db('users')
    .where({ tc_kimlik: data.kimlik.tcKimlik, is_active: true })
    .first();
  if (existsByTc && existsByTc.id !== userId) {
    if (!userId) {
      // registration token akışında zaten o TC mevcutsa engelle
      await Promise.all([unlinkSafe(saglik), unlinkSafe(sabika)]);
      throw errors.conflict('Bu TC kimlik ile bir başvuru zaten mevcut');
    }
  }

  if (!userId) {
    userId = uuidv4();
    isNewUser = true;
  }

  const now = new Date();

  try {
    await db.transaction(async (trx) => {
      const phone = data.iletisim.telefon || registration?.phone || null;

      const userRow = {
        id: userId,
        tc_kimlik: data.kimlik.tcKimlik,
        ad: data.kimlik.ad,
        soyad: data.kimlik.soyad,
        dogum_tarihi: typeof data.kimlik.dogumTarihi === 'string'
          ? data.kimlik.dogumTarihi
          : new Date(data.kimlik.dogumTarihi).toISOString().slice(0, 10),
        phone,
        eposta: data.iletisim.eposta,
        adres: data.iletisim.adres,
        kan_grubu: data.kisisel.kanGrubu,
        ogrenim: data.kisisel.ogrenim,
        meslek: data.kisisel.meslek,
        meslek_diger: data.kisisel.meslekDiger || null,
        hobiler: JSON.stringify(data.kisisel.hobiler),
        acil_ad: data.acil.ad,
        acil_soyad: data.acil.soyad,
        acil_telefon: data.acil.telefon,
        acil_yakinlik: data.acil.yakinlik,
        profile_complete: true,
        is_active: true,
        updated_at: now,
      };

      if (isNewUser) {
        userRow.created_at = now;
        await trx('users').insert(userRow);
      } else {
        await trx('users').where({ id: userId }).update(userRow);
      }

      const applicationId = uuidv4();
      await trx('applications').insert({
        id: applicationId,
        user_id: userId,
        status: 'pending',
        saglik_raporu_path: relativePath(saglik.path),
        sabika_kaydi_path: relativePath(sabika.path),
        snapshot: JSON.stringify(data),
        submitted_at: now,
        created_at: now,
        updated_at: now,
      });

      await trx('audit_log').insert({
        user_id: userId,
        action: 'onboarding.complete',
        entity: 'application',
        entity_id: applicationId,
        ip: ip || null,
        user_agent: userAgent || null,
        payload: JSON.stringify({ source: registration?.source || 'phone' }),
      });
    });
  } catch (err) {
    await Promise.all([unlinkSafe(saglik), unlinkSafe(sabika)]);
    throw err;
  }

  const application = await db('applications').where({ user_id: userId }).orderBy('submitted_at', 'desc').first();
  const userRecord = await db('users').where({ id: userId }).first();

  // Eğer kayıt token ile geldiyse şimdi gerçek auth token'ları üret
  let tokens = null;
  if (registration && !user) {
    const refreshTokenId = uuidv4();
    const refreshToken = signRefreshToken({ sub: userId, jti: refreshTokenId });
    const accessToken = signAccessToken({ sub: userId });
    const refreshHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
    await db('refresh_tokens').insert({
      id: refreshTokenId,
      user_id: userId,
      token_hash: refreshHash,
      user_agent: userAgent || null,
      ip: ip || null,
      expires_at: new Date(Date.now() + 7 * 86400 * 1000),
    });
    tokens = { accessToken, refreshToken, expiresIn: accessTokenSeconds() };
  }

  return {
    applicationId: application.id,
    status: application.status,
    submittedAt: toIso(application.submitted_at),
    user: {
      id: userRecord.id,
      tcKimlik: userRecord.tc_kimlik,
      ad: userRecord.ad,
      soyad: userRecord.soyad,
      dogumTarihi: toDateOnly(userRecord.dogum_tarihi),
      phone: userRecord.phone,
      eposta: userRecord.eposta,
      profileComplete: !!userRecord.profile_complete,
    },
    tokens: tokens || null,
  };
}

function relativePath(absolute) {
  return path.relative(env.upload.dir, absolute) || absolute;
}

module.exports = { complete };
