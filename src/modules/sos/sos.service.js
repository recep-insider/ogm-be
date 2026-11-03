'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const { errors } = require('../../shared/errors');
const { hitFixedWindow } = require('../../shared/fixed-window');
const { toIso } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');
const { sendPushToUser } = require('../../shared/push-provider');
const { reverseGeocode } = require('../../shared/reverse-geocode');
const { regionForCity, regionLabel } = require('../../shared/regions');
const logger = require('../../config/logger');

const DISPATCH_TARGET = 'OGM Yangın Harekat Merkezi';

// §10: üç değerli sözleşme — mobildeki canlı gösterge ile birebir.
const SOS_STATUS = ['active', 'responded', 'cancelled'];

// Panelin hazır aksiyonları YALNIZCA merkezin kendi yaptığı işlemlerdir; sahadaki
// durumu anlatan kayıtlar ("gönüllü güvende", teşhis) hazır aksiyon olarak sunulmaz —
// merkez bunu bilemez. Operatör sahadan bilgi aldıysa serbest notu kendi adına yazar.
const OPERATOR_ACTIONS = {
  responded: { event: 'Müdahale edildi olarak işaretlendi', status: 'responded' },
};

async function addHistory(sosId, { event, by, byKind }, trx = db) {
  const row = {
    id: uuidv4(),
    sos_id: sosId,
    time: new Date(),
    event,
    by: by || 'Sistem',
    by_kind: byKind || 'sistem',
    created_at: new Date(),
    updated_at: new Date(),
  };
  await trx('sos_history').insert(row);
  return row;
}

// SOS acil yoldur: il/ilçe çağrıyı bekletmez. Kayıttan sonra arka planda koordinattan
// çözülür (bölge kapsamı bu il'den eşleşir); çözülemezse null kalır ve
// scripts/backfill-sos-locations.js ile toparlanır.
async function fillLocation(sosId, lat, lng) {
  try {
    const { il, ilce } = await reverseGeocode(lat, lng, { maxWaitMs: 15000, timeoutMs: 3000 });
    if (!il) return;
    await db('sos_reports').where({ id: sosId }).update({ il, ilce, updated_at: new Date() });
  } catch (err) {
    logger.warn('SOS konumu çözülemedi', { sosId, error: err.message });
  }
}

async function create({ userId, body, ip, userAgent }) {
  // Kötüye kullanımı sınırla — kullanıcı başına dakikada 5 (emergency ile aynı politika, ayrı anahtar).
  await hitFixedWindow(redis, `rl:sos:${userId}`, { max: 5, windowSec: 60, message: 'Çok sık SOS çağrısı gönderiyorsunuz', failOpen: true });

  const user = await db('users').where({ id: userId, is_active: true }).first();
  if (!user) throw errors.notFound('Kullanıcı bulunamadı');

  const activeParticipation = await db('mission_participants as mp')
    .join('missions as m', 'm.id', 'mp.mission_id')
    .where('mp.user_id', userId)
    .where('m.status', 'active')
    .whereIn('mp.status', ['yolda', 'sahada'])
    .orderBy('mp.updated_at', 'desc')
    .first('mp.mission_id');

  const id = uuidv4();
  const now = new Date();
  // Gönüllü başına tek açık çağrı (BUG-023): kullanıcı satırı kilitlenir; açık çağrı varsa yenisi
  // açılmaz, mevcut çağrı döner. Eş zamanlı iki istek de tek çağrı açar. Tekrar basış geçmişe düşer;
  // çağrı konumsuz açıldıysa yeni gelen konum çağrıya eklenir.
  const coords = body.coordinates;
  const open = await db.transaction(async (trx) => {
    await trx('users').where({ id: userId }).forUpdate().first('id');
    // Satır da kilitlenir: aynı anda operatör kapattıysa ya da gönüllü iptal ettiyse tekrar basış kapanmış
    // çağrıya yazılmaz.
    const active = await trx('sos_reports').where({ user_id: userId, status: 'active' }).orderBy('created_at', 'desc').forUpdate().first();
    if (active) {
      const locationAdded = coords != null && active.lat == null;
      if (locationAdded) {
        await trx('sos_reports').where({ id: active.id }).update({ lat: coords.lat, lng: coords.lng, updated_at: now });
      }
      const event = locationAdded ? 'SOS tekrar gönderildi, konum eklendi' : 'SOS tekrar gönderildi';
      await addHistory(active.id, { event, by: 'Mobil', byKind: 'mobil' }, trx);
      return { row: active, locationAdded };
    }
    await trx('sos_reports').insert({
      id,
      user_id: userId,
      mission_id: activeParticipation?.mission_id || null,
      // §10 + mobil §4: konum YALNIZCA koordinattır; serbest metin etiket ve sebep alanı yoktur.
      lat: body.coordinates?.lat ?? null,
      lng: body.coordinates?.lng ?? null,
      status: 'active',
      // Geri arama bilgileri çağrı anında snapshot'lanır — profil sonradan değişse
      // veya hesap silinse (user_id SET NULL) bile operasyon merkezinde kalır.
      ad: user.ad,
      soyad: user.soyad,
      tc_kimlik: user.tc_kimlik,
      phone: user.phone,
      adres: user.adres,
      acil_ad: user.acil_ad,
      acil_soyad: user.acil_soyad,
      acil_telefon: user.acil_telefon,
      acil_yakinlik: user.acil_yakinlik,
      dispatched_to: DISPATCH_TARGET,
      ip: ip || null,
      created_at: now,
      updated_at: now,
    });
    return null;
  });

  if (open) {
    const { row, locationAdded } = open;
    if (locationAdded) fillLocation(row.id, coords.lat, coords.lng);
    await writeAudit({
      userId,
      action: 'sos.repeat',
      entity: 'sos_report',
      entityId: row.id,
      ip,
      userAgent,
      payload: { hasCoordinates: coords != null, locationAdded },
    });
    return {
      ok: true,
      sosId: row.id,
      status: 'active',
      createdAt: toIso(row.created_at),
      dispatchedTo: row.dispatched_to || DISPATCH_TARGET,
      alreadyActive: true,
    };
  }

  if (body.coordinates) fillLocation(id, body.coordinates.lat, body.coordinates.lng);

  await addHistory(id, { event: 'SOS çağrısı gönderildi', by: 'Mobil', byKind: 'mobil' });

  await writeAudit({
    userId,
    action: 'sos.create',
    entity: 'sos_report',
    entityId: id,
    ip,
    userAgent,
    payload: { hasCoordinates: body.coordinates != null },
  });

  return {
    ok: true,
    sosId: id,
    status: 'active',
    createdAt: toIso(now),
    dispatchedTo: DISPATCH_TARGET,
  };
}

/**
 * Gönüllünün mobilden yaptığı iptal (§10, mobil §4) — sinyalin sahibi gönüllüdür,
 * operatör panelden tetikleyemez. Yalnızca `active` çağrı iptal edilebilir.
 */
async function cancel(sosId, { userId, ip, userAgent }) {
  const row = await db('sos_reports').where({ id: sosId }).first();
  if (!row) throw errors.notFound('SOS çağrısı bulunamadı', 'sos_not_found');
  if (row.user_id !== userId) throw errors.forbidden('Bu çağrı size ait değil');
  if (row.status !== 'active') {
    throw errors.conflict('Çağrı zaten kapanmış', { status: row.status }, 'sos_not_active');
  }

  const now = new Date();
  // Koşullu yazım (BUG-025): eş zamanlı iki iptalden yalnız biri yazar; arada operatör "müdahale edildi"
  // dediyse iptal onun kaydını ezmez.
  const cancelled = await db('sos_reports').where({ id: sosId, status: 'active' }).update({
    status: 'cancelled',
    cancelled_at: now,
    updated_at: now,
  });
  if (!cancelled) throw errors.conflict('Çağrı zaten kapanmış', undefined, 'sos_not_active');
  await addHistory(sosId, { event: 'Gönüllü SOS çağrısını iptal etti', by: 'Mobil', byKind: 'mobil' });

  await writeAudit({
    userId,
    action: 'sos.cancel',
    entity: 'sos_report',
    entityId: sosId,
    ip,
    userAgent,
  });

  return { ok: true, sosId, status: 'cancelled', cancelledAt: toIso(now) };
}

/**
 * Yanıt süresi (§10) — çağrı saati ile geçmişteki İLK OPERATÖR kaydı arasındaki fark.
 * Operatör kaydı yoksa (ör. iptal edilen çağrı) hesaplanmaz, null döner.
 */
function responseSeconds(createdAt, historyRows) {
  const firstOperator = historyRows.find((h) => h.by_kind === 'operator');
  if (!firstOperator) return null;
  const diff = new Date(firstOperator.time).getTime() - new Date(createdAt).getTime();
  return diff >= 0 ? Math.round(diff / 1000) : null;
}

function mapHistory(rows) {
  return rows.map((h) => ({ time: toIso(h.time), event: h.event, by: h.by }));
}

/** Mobilin canlı durum ekranı — durum + geçmiş tek kaynaktan okunur. */
async function getForUser(sosId, userId) {
  const row = await db('sos_reports').where({ id: sosId }).first();
  if (!row || row.user_id !== userId) throw errors.notFound('SOS çağrısı bulunamadı', 'sos_not_found');

  const history = await db('sos_history').where({ sos_id: sosId }).orderBy([
    { column: 'time', order: 'asc' },
    { column: 'id', order: 'asc' },
  ]);

  return {
    sosId: row.id,
    status: row.status,
    createdAt: toIso(row.created_at),
    respondedAt: toIso(row.responded_at),
    cancelledAt: toIso(row.cancelled_at),
    coordinates: row.lat != null && row.lng != null ? { lat: Number(row.lat), lng: Number(row.lng) } : null,
    dispatchedTo: row.dispatched_to,
    history: mapHistory(history),
  };
}

/** Gönüllünün açık çağrısı — mobil ana ekran widget'ı bunu okur (aynı 3 durumlu sözleşme). */
async function getActiveForUser(userId) {
  const row = await db('sos_reports')
    .where({ user_id: userId, status: 'active' })
    .orderBy('created_at', 'desc')
    .first();
  return row ? getForUser(row.id, userId) : null;
}

/**
 * Admin (panel) — SOS çağrı listesi.
 * Kan grubu ve acil durum kişisi TÜRETİLİR: gönüllü kaydından okunur (§10). Kullanıcı
 * silinmişse satırdaki snapshot'a düşülür, böylece geri arama bilgisi kaybolmaz.
 * @param {{status?:string, page?:number, pageSize?:number}} params
 */
async function adminList({ status, page = 1, pageSize = 20 } = {}, actor = {}) {
  const base = db('sos_reports as sr');
  if (status) base.where('sr.status', status);

  const [{ total }] = await base.clone().count({ total: 'sr.id' });
  const rows = await base
    .clone()
    .leftJoin('users as u', 'u.id', 'sr.user_id')
    .leftJoin('missions as m', 'm.id', 'sr.mission_id')
    .select(
      'sr.*',
      'm.title as mission_title',
      'u.kan_grubu as live_kan_grubu',
      'u.phone as live_phone',
      'u.acil_ad as live_acil_ad',
      'u.acil_soyad as live_acil_soyad',
      'u.acil_telefon as live_acil_telefon',
      'u.acil_yakinlik as live_acil_yakinlik',
    )
    .orderBy([
      { column: 'sr.created_at', order: 'desc' },
      { column: 'sr.id', order: 'desc' }, // unique tie-breaker
    ])
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const historyBySos = await historyFor(rows.map((r) => r.id));

  // §9: çağrı kartı kan grubu, TC ve acil durum kişisini doğrudan gösterir —
  // görüntülemenin kendisi loglanır (üçüncü kişinin verisi).
  if (rows.length) {
    await writeAudit({
      userId: actor.userId || null,
      action: 'sos.pii.view',
      entity: 'sos_report',
      entityId: rows[0].id,
      ip: actor.ip,
      userAgent: actor.userAgent,
      payload: { count: rows.length, fields: ['tcKimlik', 'kanGrubu', 'emergencyContact'] },
    });
  }

  return {
    items: rows.map((r) => mapAdminSos(r, historyBySos.get(r.id) || [])),
    total: Number(total),
    page,
    pageSize,
  };
}

async function historyFor(sosIds) {
  const map = new Map();
  if (!sosIds.length) return map;
  const rows = await db('sos_history')
    .whereIn('sos_id', sosIds)
    .orderBy([
      { column: 'time', order: 'asc' },
      { column: 'id', order: 'asc' },
    ]);
  for (const row of rows) {
    if (!map.has(row.sos_id)) map.set(row.sos_id, []);
    map.get(row.sos_id).push(row);
  }
  return map;
}

function mapAdminSos(r, history) {
  return {
    id: r.id,
    status: r.status,
    coordinates: r.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : null,
    // Bölge çağrının basıldığı yerden türer; il çözülmemişse yalnızca "Tüm Bölgeler"de görünür.
    il: r.il || null,
    ilce: r.ilce || null,
    region: regionForCity(r.il),
    regionName: regionLabel(regionForCity(r.il)),
    dispatchedTo: r.dispatched_to,
    missionId: r.mission_id || null,
    missionTitle: r.mission_title || null,
    createdAt: toIso(r.created_at),
    respondedAt: toIso(r.responded_at),
    cancelledAt: toIso(r.cancelled_at),
    responseSeconds: responseSeconds(r.created_at, history),
    history: mapHistory(history),
    user: {
      userId: r.user_id,
      ad: r.ad,
      soyad: r.soyad,
      tcKimlik: r.tc_kimlik,
      // Türetilen alanlar canlı kayıttan; kullanıcı silinmişse snapshot yedeği.
      phone: r.live_phone || r.phone,
      kanGrubu: r.live_kan_grubu || null,
      adres: r.adres,
      acil: {
        ad: r.live_acil_ad || r.acil_ad,
        soyad: r.live_acil_soyad || r.acil_soyad,
        telefon: r.live_acil_telefon || r.acil_telefon,
        yakinlik: r.live_acil_yakinlik || r.acil_yakinlik,
      },
    },
  };
}

/**
 * Admin (panel) — geçmişe kayıt ekler ve gerekiyorsa durumu AYNI çağrıda günceller
 * (§10: "iki ayrı istekle durum ve geçmiş ayrışmamalı").
 * Operatör çağrıyı iptal EDEMEZ — `cancelled` yalnızca gönüllünün mobil sinyalidir.
 *
 * @param {string} sosId
 * @param {{action?:string, note?:string, by?:string}} body
 */
async function adminAddHistory(sosId, body, actor = {}) {
  const action = body.action ? OPERATOR_ACTIONS[body.action] : null;
  if (body.action && !action) {
    throw errors.validation('Geçersiz operatör aksiyonu', {
      action: body.action,
      allowed: Object.keys(OPERATOR_ACTIONS),
    });
  }
  const event = action ? action.event : (body.note || '').trim();
  if (!event) throw errors.validation('Aksiyon veya not zorunlu', { field: 'action|note' });

  // İşlemi yapan oturumdaki panel kullanıcısıdır; istemcinin gönderdiği ad kullanılmaz.
  const by = actor.name || 'Operatör';
  const nextStatus = action?.status;

  // Durum okunup yazılırken satır kilitlenir: aynı anda gelen iki "müdahale edildi" ya da
  // kapanma ile not yarışında ikinci istek kapanmış çağrıyı görür (BUG-025, K25).
  const row = await db.transaction(async (trx) => {
    const current = await trx('sos_reports').where({ id: sosId }).forUpdate().first();
    if (!current) throw errors.notFound('SOS çağrısı bulunamadı', 'sos_not_found');
    if (current.status === 'cancelled') {
      throw errors.conflict('Gönüllü çağrıyı iptal etti', undefined, 'sos_cancelled');
    }
    if (current.status !== 'active') {
      throw errors.conflict('Çağrı zaten kapanmış; not eklenemez.', undefined, 'sos_not_active');
    }
    const entry = await addHistory(sosId, { event, by, byKind: 'operator' }, trx);
    if (nextStatus) {
      await trx('sos_reports').where({ id: sosId, status: 'active' }).update({
        status: nextStatus,
        responded_at: nextStatus === 'responded' ? entry.time : current.responded_at,
        updated_at: new Date(),
      });
    }
    return current;
  });

  // K26: gönüllüye yanıt bildirimi kayıt kesinleştikten sonra gider; gönderim hatası yanıtı bozmaz.
  if (nextStatus === 'responded' && row.user_id) {
    try {
      await sendPushToUser(row.user_id, {
        topic: 'acil',
        title: 'SOS çağrınız yanıtlandı',
        body: 'Operasyon merkezi çağrınıza müdahale etti.',
        data: { type: 'sos_responded', sosId },
      });
    } catch (err) {
      logger.warn('SOS yanıt bildirimi gönderilemedi', { sosId, error: err.message });
    }
  }

  await writeAudit({
    userId: actor.userId || null,
    action: 'sos.history.add',
    entity: 'sos_report',
    entityId: sosId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { action: body.action || 'note', status: nextStatus || row.status },
  });

  const history = await db('sos_history').where({ sos_id: sosId }).orderBy([
    { column: 'time', order: 'asc' },
    { column: 'id', order: 'asc' },
  ]);

  return {
    ok: true,
    sosId,
    status: nextStatus || row.status,
    history: mapHistory(history),
    responseSeconds: responseSeconds(row.created_at, history),
  };
}

module.exports = {
  create,
  cancel,
  getForUser,
  getActiveForUser,
  adminList,
  adminAddHistory,
  responseSeconds,
  mapAdminSos,
  SOS_STATUS,
  OPERATOR_ACTIONS,
};
