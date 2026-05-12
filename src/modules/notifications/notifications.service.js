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
  await db('devices').insert({
    id,
    user_id: userId,
    fcm_token: token,
    platform,
    app_version: appVersion || null,
  });
  return { id };
}

async function deleteDevice(userId, tokenId) {
  const deleted = await db('devices').where({ id: tokenId, user_id: userId }).delete();
  if (!deleted) throw errors.notFound('Cihaz bulunamadı');
  return { ok: true };
}

module.exports = { registerDevice, deleteDevice };
