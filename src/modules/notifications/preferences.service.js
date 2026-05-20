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
};

function mapPrefs(row) {
  return {
    taskCalls: !!row.task_calls,
    trainings: !!row.trainings,
    announcements: !!row.announcements,
    distance: { km: row.distance_km, min: row.distance_min, max: row.distance_max },
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

  const next = {
    user_id: userId,
    task_calls: body.taskCalls !== undefined ? body.taskCalls : current.task_calls,
    trainings: body.trainings !== undefined ? body.trainings : current.trainings,
    announcements: body.announcements !== undefined ? body.announcements : current.announcements,
    distance_km: body.distanceKm !== undefined ? body.distanceKm : current.distance_km,
    distance_min: current.distance_min,
    distance_max: current.distance_max,
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

module.exports = { get, update };
