'use strict';

// KVKK — silme talebinden (users.softDelete) 30 gün sonra kişisel veriler anonimleştirilir.
// Operasyon ve istatistik kayıtları (görev katılımı, yoklama, zimmet, ihbar/SOS içeriği)
// kalır; kimliği belirleyen her alan ve kullanıcının yüklediği kişisel belgeler silinir.
// Satır `anonymized_at` ile işaretlenir: iş bir kez çalışır, tekrar çalışması zararsızdır.

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const env = require('../../config/env');
const logger = require('../../config/logger');

const ANONYMIZE_AFTER_DAYS = 30;
const INTERVAL_MS = 60 * 60 * 1000;
const LOCK_KEY = 'lock:kvkk-anonymize';
const LOCK_TTL_SEC = 60 * 60;
// Kilit yalnız sahibince bırakılır: süresi dolup başka süreç aldıysa ona dokunulmaz.
const RELEASE_LOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

const USER_PII = {
  tc_kimlik: null,
  ad: null,
  soyad: null,
  dogum_tarihi: null,
  phone: null,
  eposta: null,
  adres: null,
  il: null,
  ilce: null,
  kan_grubu: null,
  ogrenim: null,
  meslek: null,
  meslek_diger: null,
  hobiler: null,
  giysi_bedeni: null,
  ayakkabi_numarasi: null,
  stk_text: null,
  acil_ad: null,
  acil_soyad: null,
  acil_telefon: null,
  acil_yakinlik: null,
  avatar_path: null,
};

// SOS kaydı arama anında profilden kopyalanır; hesap anonimleşince kopyası da temizlenir.
const SOS_PII = {
  ad: null,
  soyad: null,
  tc_kimlik: null,
  phone: null,
  adres: null,
  acil_ad: null,
  acil_soyad: null,
  acil_telefon: null,
  acil_yakinlik: null,
  ip: null,
};

const CERTIFICATE_TABLES = ['online_training_progress', 'saha_training_applications', 'user_trainings'];

async function personalFiles(userId) {
  const [user, applications, ...certificates] = await Promise.all([
    db('users').where({ id: userId }).first('avatar_path'),
    db('applications').where({ user_id: userId }).select('saglik_raporu_path', 'sabika_kaydi_path'),
    ...CERTIFICATE_TABLES.map((table) => db(table).where({ user_id: userId }).pluck('certificate_path')),
  ]);
  return [
    user?.avatar_path,
    ...applications.flatMap((a) => [a.saglik_raporu_path, a.sabika_kaydi_path]),
    ...certificates.flat(),
  ].filter(Boolean);
}

async function removeUpload(rel) {
  const root = path.resolve(env.upload.dir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) {
    logger.warn('KVKK: yükleme dizini dışındaki yol silinmedi', { path: rel });
    return;
  }
  try {
    await fs.unlink(abs);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/** Tek hesabın kişisel verilerini siler/anonimleştirir. */
async function anonymizeUser(userId, now = new Date()) {
  // Önce dosyalar: silinemeyen dosya varsa DB'deki yolu kalır, sonraki koşu yeniden dener.
  for (const rel of await personalFiles(userId)) {
    // eslint-disable-next-line no-await-in-loop
    await removeUpload(rel);
  }

  await db.transaction(async (trx) => {
    const byUser = (table) => trx(table).where({ user_id: userId });
    await trx('users').where({ id: userId }).update({ ...USER_PII, anonymized_at: now, updated_at: now });
    await byUser('applications').update({
      saglik_raporu_path: null,
      sabika_kaydi_path: null,
      snapshot: null,
      reviewer_note: null,
      updated_at: now,
    });
    for (const table of CERTIFICATE_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await byUser(table).update({ certificate_path: null, updated_at: now });
    }
    await byUser('commission_decisions').update({ sms_phone: null, note: null, updated_at: now });
    await byUser('consents').update({ ip: null, user_agent: null, updated_at: now });
    // Denetim izi içeriği kişisel veri taşıyabilir (ör. telefon değişiminde newPhone): kullanıcının yazdığı
    // ve onun hakkındaki (entity_id) kayıtların payload'ı silinir; işlem/aktör/zaman kalır.
    await byUser('audit_log').update({ ip: null, user_agent: null, payload: null });
    await trx('audit_log').where({ entity_id: userId }).update({ payload: null });
    await byUser('sos_reports').update({ ...SOS_PII, user_id: null, updated_at: now });
    await byUser('fire_reports').update({ user_id: null, ip: null, updated_at: now });
    await byUser('emergency_reports').update({ user_id: null, ip: null, updated_at: now });
    await byUser('devices').delete();
    await byUser('refresh_tokens').delete();
    await byUser('notification_preferences').delete();
  });
}

/** Silinme tarihinden 30 gün geçmiş, henüz anonimleşmemiş tüm hesaplar. */
async function anonymizeDue(now = new Date()) {
  const cutoff = new Date(now.getTime() - ANONYMIZE_AFTER_DAYS * 86400 * 1000);
  const ids = await db('users').where('deleted_at', '<=', cutoff).whereNull('anonymized_at').pluck('id');

  let anonymized = 0;
  const failed = [];
  for (const id of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await anonymizeUser(id, now);
      anonymized += 1;
    } catch (err) {
      failed.push(id);
      logger.error('KVKK anonimleştirme başarısız', { userId: id, error: err.message });
    }
  }
  if (ids.length) logger.info('KVKK anonimleştirme tamamlandı', { due: ids.length, anonymized, failed: failed.length });
  return { due: ids.length, anonymized, failed };
}

/** Süreçler (API, elle CLI) arasında tek koşu — kilit atomik SET NX EX ile alınır. */
async function runExclusive(now = new Date()) {
  const token = crypto.randomUUID();
  const acquired = await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_SEC, 'NX');
  if (!acquired) return { skipped: true };
  try {
    return await anonymizeDue(now);
  } finally {
    await redis.eval(RELEASE_LOCK, 1, LOCK_KEY, token).catch((err) => {
      logger.warn('KVKK anonimleştirme kilidi bırakılamadı', { error: err.message });
    });
  }
}

/** API sürecinde açılışta ve saatte bir çalışır. */
function startSchedule() {
  const tick = () => runExclusive().catch((err) => {
    logger.error('KVKK anonimleştirme çalıştırılamadı', { error: err.message });
  });
  tick();
  return setInterval(tick, INTERVAL_MS).unref();
}

module.exports = { anonymizeUser, anonymizeDue, runExclusive, startSchedule, ANONYMIZE_AFTER_DAYS, LOCK_KEY };
