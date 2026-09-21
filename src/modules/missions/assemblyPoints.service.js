'use strict';

// backend-gereksinimleri.md §4 (otomatik tetikleyiciler) + §12 — toplanma noktası.
// Olay başına TEK nokta vardır; bağın tek kaynağı assembly_points.mission_id'dir.
// Kontenjan alanı yoktur: toplanma noktası açık bir alandır, kapasitesi ölçülemez.

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');
const { sendPushToUser } = require('../../shared/push-provider');
const { sendSms } = require('../../shared/sms-provider');
const logger = require('../../config/logger');

function mapPoint(row) {
  return {
    id: row.id,
    missionId: row.mission_id,
    name: row.name,
    address: row.address || null,
    coordinates: { lat: Number(row.lat), lng: Number(row.lng) },
    isOpen: !!row.is_open,
  };
}

async function getByMission(missionId) {
  const row = await db('assembly_points').where({ mission_id: missionId }).first();
  return row ? mapPoint(row) : null;
}

/**
 * Toplanma noktası konumu DEĞİŞTİĞİNDE operatör elle bildirim yazmaz — sunucu üç
 * kitleye ayrı ayrı gönderir (§4):
 *   yola çıkmamış (cagrildi/katilamiyor) → sessiz
 *   yolda                                → zorunlu push VE SMS
 *   sahada                               → push
 * Zorunlu gönderim `acil` sınıfındadır: gönüllünün bildirim tercihini bypass eder.
 */
async function notifyLocationChange(missionId, point) {
  const mission = await db('missions').where({ id: missionId }).first('title');
  const rows = await db('mission_participants as mp')
    .join('users as u', 'u.id', 'mp.user_id')
    .where('mp.mission_id', missionId)
    .whereIn('mp.status', ['yolda', 'sahada'])
    .select('mp.status', 'u.id as user_id', 'u.phone');

  const title = mission?.title || 'Toplanma noktası değişti';
  const body = `Toplanma noktası güncellendi: ${point.name}`;
  const summary = { yolda: 0, sahada: 0, sms: 0 };

  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await sendPushToUser(row.user_id, {
      // Acil sınıfı kapatılamaz; topic opt-in'i bu bildirimi engellememelidir.
      topic: 'acil',
      title,
      body,
      data: { type: 'assembly_point_changed', missionId, ...point.coordinates },
    });
    summary[row.status] += 1;

    if (row.status === 'yolda' && row.phone) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await sendSms(row.phone, `${title}. ${body}`);
        summary.sms += 1;
      } catch (err) {
        logger.error('Toplanma noktası SMS gönderilemedi', { userId: row.user_id, error: err.message });
      }
    }
  }
  return summary;
}

/** Olay oluşturulurken toplanma noktası ZORUNLUDUR — olaysız/noktasız kayıt oluşmaz (§7). */
async function upsert(missionId, body, actor = {}) {
  const mission = await db('missions').where({ id: missionId }).first();
  if (!mission) throw errors.notFound('Görev bulunamadı', 'mission_not_found');
  if (mission.status === 'archived') {
    throw errors.conflict('Olay arşivlendi, toplanma noktası kapandı', undefined, 'mission_archived');
  }

  const existing = await db('assembly_points').where({ mission_id: missionId }).first();
  const now = new Date();
  const row = {
    name: body.name,
    address: body.address || null,
    lat: body.coordinates.lat,
    lng: body.coordinates.lng,
    is_open: body.isOpen !== undefined ? body.isOpen : true,
    updated_at: now,
  };

  let locationChanged = false;
  if (existing) {
    locationChanged =
      Number(existing.lat) !== Number(row.lat) || Number(existing.lng) !== Number(row.lng);
    await db('assembly_points').where({ id: existing.id }).update(row);
  } else {
    await db('assembly_points').insert({ id: uuidv4(), mission_id: missionId, created_at: now, ...row });
  }

  const point = await getByMission(missionId);

  let notified = null;
  if (locationChanged) notified = await notifyLocationChange(missionId, point);

  await writeAudit({
    userId: actor.userId || null,
    action: existing ? 'assembly_point.update' : 'assembly_point.create',
    entity: 'mission',
    entityId: missionId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { locationChanged, notified },
  });

  return { ok: true, assemblyPoint: point, locationChanged, notified };
}

/** Olay arşivlenince nokta kapanır — yeni gönüllü çağrısı durur. */
async function close(missionId, trx = db) {
  await trx('assembly_points').where({ mission_id: missionId }).update({
    is_open: false,
    updated_at: new Date(),
  });
}

module.exports = { getByMission, upsert, close, notifyLocationChange, mapPoint };
