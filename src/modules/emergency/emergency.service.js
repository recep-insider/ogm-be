'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const { errors } = require('../../shared/errors');
const { toIso } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');

const DISPATCH_TARGET = 'OGM Yangın Harekat Merkezi';

async function create({ userId, body, ip, userAgent }) {
  // Kötüye kullanımı sınırla — kullanıcı başına dakikada 5 (kontrat 10.1 → 429).
  const key = `rl:emergency:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  if (count > 5) throw errors.rateLimit('Çok sık acil bildirim gönderiyorsunuz');

  const id = uuidv4();
  const now = new Date();
  await db('emergency_reports').insert({
    id,
    user_id: userId,
    mission_id: body.missionId || null,
    lat: body.coordinates?.lat ?? null,
    lng: body.coordinates?.lng ?? null,
    message: body.message || null,
    dispatched_to: DISPATCH_TARGET,
    ip: ip || null,
    created_at: now,
    updated_at: now,
  });

  await writeAudit({
    userId,
    action: 'emergency.create',
    entity: 'emergency_report',
    entityId: id,
    ip,
    userAgent,
    payload: { missionId: body.missionId || null },
  });

  return {
    ok: true,
    reportId: id,
    submittedAt: toIso(now),
    dispatchedTo: DISPATCH_TARGET,
  };
}

/** Admin (panel) — SOS listesi/geçmişi. @param {{missionId?:string, page?:number, pageSize?:number}} params */
async function adminList({ missionId, page = 1, pageSize = 20 } = {}) {
  const base = db('emergency_reports as er');
  if (missionId) base.where('er.mission_id', missionId);

  const [{ total }] = await base.clone().count({ total: 'er.id' });
  const rows = await base
    .clone()
    .leftJoin('users as u', 'u.id', 'er.user_id')
    .leftJoin('missions as m', 'm.id', 'er.mission_id')
    .select('er.*', 'u.ad as user_ad', 'u.soyad as user_soyad', 'u.phone as user_phone', 'm.title as mission_title')
    .orderBy([
      { column: 'er.created_at', order: 'desc' },
      { column: 'er.id', order: 'desc' }, // unique tie-breaker
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
      user: r.user_id ? { userId: r.user_id, ad: r.user_ad, soyad: r.user_soyad, phone: r.user_phone } : null,
      mission: r.mission_id ? { id: r.mission_id, title: r.mission_title } : null,
    })),
    total: Number(total),
    page,
    pageSize,
  };
}

module.exports = { create, adminList };
