'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');

async function registerDevice(userId, { token, platform, appVersion }) {
  const existing = await db('devices').where({ fcm_token: token }).first();
  if (existing) {
    await db('devices').where({ id: existing.id }).update({
      user_id: userId,
      platform,
      app_version: appVersion || null,
      last_seen_at: new Date(),
    });
    return { id: existing.id };
  }
  const id = uuidv4();
  try {
    await db('devices').insert({
      id,
      user_id: userId,
      fcm_token: token,
      platform,
      app_version: appVersion || null,
    });
  } catch (err) {
    // Aynı token eş zamanlı iki kez gelirse (BUG-025) ikinci istek mevcut kaydı günceller.
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    return registerDevice(userId, { token, platform, appVersion });
  }
  return { id };
}

async function deleteDevice(userId, tokenId) {
  const deleted = await db('devices').where({ id: tokenId, user_id: userId }).delete();
  if (!deleted) throw errors.notFound('Cihaz bulunamadı');
  return { ok: true };
}

/**
 * Gönüllü bildirime dokunup uygulamayı açtı (K5). Aynı kişinin ikinci açılışı sayılmaz.
 */
async function markOpened(userId, notificationId) {
  const exists = await db('notification_log').where({ id: notificationId }).first('id');
  if (!exists) throw errors.notFound('Bildirim bulunamadı', 'notification_not_found');
  await db('notification_opens')
    .insert({ notification_id: notificationId, user_id: userId, opened_at: new Date() })
    .onConflict(['notification_id', 'user_id'])
    .ignore();
}

module.exports = { registerDevice, deleteDevice, markOpened };
