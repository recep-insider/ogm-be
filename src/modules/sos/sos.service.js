'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const { errors } = require('../../shared/errors');
const { toIso } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');

const DISPATCH_TARGET = 'OGM Yangın Harekat Merkezi';

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
    lat: body.coordinates?.lat ?? null,
    lng: body.coordinates?.lng ?? null,
    message: body.message || null,
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
    createdAt: toIso(now),
    dispatchedTo: DISPATCH_TARGET,
  };
}

/** Admin (panel) — SOS çağrı listesi. @param {{page?:number, pageSize?:number}} params */
async function adminList({ page = 1, pageSize = 20 } = {}) {
  const base = db('sos_reports as sr');

  const [{ total }] = await base.clone().count({ total: 'sr.id' });
  const rows = await base
    .clone()
    .orderBy([
      { column: 'sr.created_at', order: 'desc' },
      { column: 'sr.id', order: 'desc' }, // unique tie-breaker
    ])
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map((r) => ({
      id: r.id,
      message: r.message || '',
      coordinates: r.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : null,
      dispatchedTo: r.dispatched_to,
      createdAt: toIso(r.created_at),
      // Kullanıcı bilgileri satırdaki snapshot'tan gelir; hesap silinse de geri arama bilgisi korunur.
      user: {
        userId: r.user_id,
        ad: r.ad,
        soyad: r.soyad,
        tcKimlik: r.tc_kimlik,
        phone: r.phone,
        adres: r.adres,
        acil: {
          ad: r.acil_ad,
          soyad: r.acil_soyad,
          telefon: r.acil_telefon,
          yakinlik: r.acil_yakinlik,
        },
      },
    })),
    total: Number(total),
    page,
    pageSize,
  };
}

module.exports = { create, adminList };
