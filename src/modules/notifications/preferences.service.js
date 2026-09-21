'use strict';

const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');

const DEFAULTS = {
  task_calls: true,
  trainings: true,
  announcements: true,
  distance_km: 50,
  distance_min: 5,
  distance_max: 200,
  base_lat: null,
  base_lng: null,
  base_il: null,
  base_ilce: null,
};

/**
 * backend §4 / mobil §16 — kategoriler ve kanal kuralı:
 *   acil    → SMS + push, KAPATILAMAZ, listenin en üstünde sabit (güvenlik gereksinimi)
 *   gorev   → push
 *   egitim  → push
 *   bilgi   → push
 * Kanal kategoriden TÜRER, kullanıcı/operatör seçmez.
 */
const CATEGORIES = [
  { key: 'acil', label: 'Acil Bildirimler', channel: 'sms+push', closable: false, column: null },
  { key: 'gorev', label: 'Görev Çağrıları', channel: 'push', closable: true, column: 'task_calls' },
  { key: 'egitim', label: 'Eğitim Duyuruları', channel: 'push', closable: true, column: 'trainings' },
  { key: 'bilgi', label: 'Bilgilendirme', channel: 'push', closable: true, column: 'announcements' },
];

function mapPrefs(row) {
  return {
    // Acil sınıfı her zaman açık döner ve kapatma ucu yoktur — tercih değil, kural.
    categories: CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      channel: c.channel,
      closable: c.closable,
      enabled: c.column ? !!row[c.column] : true,
    })),
    taskCalls: !!row.task_calls,
    trainings: !!row.trainings,
    announcements: !!row.announcements,
    distance: { km: row.distance_km, min: row.distance_min, max: row.distance_max },
    // Yarıçapın ölçüleceği nokta; seçilmemişse mobil kullanıcıyı uyarır.
    baseLocation:
      row.base_lat != null && row.base_lng != null
        ? {
            lat: Number(row.base_lat),
            lng: Number(row.base_lng),
            il: row.base_il || null,
            ilce: row.base_ilce || null,
          }
        : null,
    // Acil sınıfı mesafe tercihini BYPASS eder — ekranda belirtilmeli.
    emergencyBypassesDistance: true,
  };
}

async function getRow(userId) {
  const row = await db('notification_preferences').where({ user_id: userId }).first();
  return row || { user_id: userId, ...DEFAULTS };
}

async function get(userId) {
  return mapPrefs(await getRow(userId));
}

// Request: distanceKm (flat) → Response: distance:{km,min,max} (nested) — kontrat 12.2 asimetrisi.
async function update(userId, body) {
  const current = await getRow(userId);

  if (body.distanceKm !== undefined) {
    if (body.distanceKm < current.distance_min || body.distanceKm > current.distance_max) {
      throw errors.validation('Mesafe sınırların dışında', {
        min: current.distance_min,
        max: current.distance_max,
      });
    }
  }

  const base = body.baseLocation;
  const next = {
    user_id: userId,
    task_calls: body.taskCalls !== undefined ? body.taskCalls : current.task_calls,
    trainings: body.trainings !== undefined ? body.trainings : current.trainings,
    announcements: body.announcements !== undefined ? body.announcements : current.announcements,
    distance_km: body.distanceKm !== undefined ? body.distanceKm : current.distance_km,
    distance_min: current.distance_min,
    distance_max: current.distance_max,
    // null gönderilirse baz konum temizlenir (gönüllü seçimini geri alabilir).
    base_lat: base === undefined ? current.base_lat : base?.lat ?? null,
    base_lng: base === undefined ? current.base_lng : base?.lng ?? null,
    base_il: base === undefined ? current.base_il : base?.il ?? null,
    base_ilce: base === undefined ? current.base_ilce : base?.ilce ?? null,
    updated_at: new Date(),
  };

  const exists = await db('notification_preferences').where({ user_id: userId }).first();
  if (exists) {
    await db('notification_preferences').where({ user_id: userId }).update(next);
  } else {
    await db('notification_preferences').insert({ ...next, created_at: new Date() });
  }

  return mapPrefs(next);
}

module.exports = { get, update, CATEGORIES };
