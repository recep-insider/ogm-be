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

module.exports = { create };
