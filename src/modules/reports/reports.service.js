'use strict';

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const env = require('../../config/env');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');

async function fireReport({ user, body, files, ip }) {
  // user başına saatte 5 limit
  if (user?.id) {
    const key = `rl:fire:${user.id}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
    if (count > 5) throw errors.rateLimit('Saatlik yangın bildirim limiti aşıldı');
  } else {
    // anonim için IP başına saatte 3
    const key = `rl:fire:ip:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
    if (count > 3) throw errors.rateLimit('Saatlik anonim bildirim limiti aşıldı');
  }

  const id = uuidv4();
  const photoPaths = (files || []).map((f) => path.relative(env.upload.dir, f.path));

  await db('fire_reports').insert({
    id,
    user_id: user?.id || null,
    anonymous: !user?.id,
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy_m: body.accuracyM || null,
    description: body.description || null,
    photo_paths: JSON.stringify(photoPaths),
    status: 'received',
    ip: ip || null,
  });

  await writeAudit({
    userId: user?.id || null,
    action: 'reports.fire',
    entity: 'fire_report',
    entityId: id,
    ip,
    payload: {
      anonymous: !user?.id,
      latitude: body.latitude,
      longitude: body.longitude,
      photoCount: photoPaths.length,
    },
  });

  return {
    reportId: id,
    status: 'received',
    createdAt: new Date().toISOString(),
    etaResponseSec: 60,
  };
}

module.exports = { fireReport };
