'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const { errors } = require('../../shared/errors');
const { toIso } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');

const DISPATCH_TARGET = 'OGM Yangın Harekat Merkezi';

// §10: üç değerli sözleşme — mobildeki canlı gösterge ile birebir.
const SOS_STATUS = ['active', 'responded', 'cancelled'];

// Panelin hazır aksiyonları YALNIZCA merkezin kendi yaptığı işlemlerdir; sahadaki
// durumu anlatan kayıtlar ("gönüllü güvende", teşhis) hazır aksiyon olarak sunulmaz —
// merkez bunu bilemez. Operatör sahadan bilgi aldıysa serbest notu kendi adına yazar.
const OPERATOR_ACTIONS = {
  called_volunteer: { event: 'Merkez gönüllüyü aradı', status: null },
  called_112: { event: '112 arandı', status: null },
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

async function create({ userId, body, ip, userAgent }) {
  // Kötüye kullanımı sınırla — kullanıcı başına dakikada 5 (emergency ile aynı politika, ayrı anahtar).
  const key = `rl:sos:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  if (count > 5) throw errors.rateLimit('Çok sık SOS çağrısı gönderiyorsunuz');

  const user = await db('users').where({ id: userId, is_active: true }).first();
  if (!user) throw errors.notFound('Kullanıcı bulunamadı');

  const id = uuidv4();
  const now = new Date();
  await db('sos_reports').insert({
    id,
    user_id: userId,
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
  await db('sos_reports').where({ id: sosId }).update({
    status: 'cancelled',
    cancelled_at: now,
    updated_at: now,
  });
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
    .select(
      'sr.*',
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
    dispatchedTo: r.dispatched_to,
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
  const row = await db('sos_reports').where({ id: sosId }).first();
  if (!row) throw errors.notFound('SOS çağrısı bulunamadı', 'sos_not_found');
  if (row.status === 'cancelled') {
    throw errors.conflict('Gönüllü çağrıyı iptal etti', undefined, 'sos_cancelled');
  }

  const action = body.action ? OPERATOR_ACTIONS[body.action] : null;
  if (body.action && !action) {
    throw errors.validation('Geçersiz operatör aksiyonu', {
      action: body.action,
      allowed: Object.keys(OPERATOR_ACTIONS),
    });
  }
  const event = action ? action.event : (body.note || '').trim();
  if (!event) throw errors.validation('Aksiyon veya not zorunlu', { field: 'action|note' });

  const by = body.by || actor.name || 'Operatör';
  const entry = await addHistory(sosId, { event, by, byKind: 'operator' });

  const nextStatus = action?.status;
  if (nextStatus && row.status !== nextStatus) {
    await db('sos_reports').where({ id: sosId }).update({
      status: nextStatus,
      responded_at: nextStatus === 'responded' ? entry.time : row.responded_at,
      updated_at: new Date(),
    });
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
