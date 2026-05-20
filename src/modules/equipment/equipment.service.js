'use strict';

const { db } = require('../../config/db');
const { toDateOnly } = require('../../shared/dates');

const EXPIRING_SOON_DAYS = 30;
const PROTECTIVE_TYPE = 'Koruyucu Ekipman';

/** expires_at + eşiğe göre runtime status hesaplar (kontrat 11.1). */
function computeStatus(expiresAt) {
  if (!expiresAt) return 'active';
  const exp = new Date(expiresAt).getTime();
  const now = Date.now();
  if (exp < now) return 'expired';
  if (exp - now <= EXPIRING_SOON_DAYS * 86400 * 1000) return 'expiring_soon';
  return 'active';
}

function mapEquipment(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    assignedAt: toDateOnly(row.assigned_at),
    expiresAt: toDateOnly(row.expires_at),
    status: computeStatus(row.expires_at),
    iconName: row.icon_name || undefined,
  };
}

async function listForUser(userId) {
  const rows = await db('equipment').where({ user_id: userId }).orderBy('assigned_at', 'desc');
  return rows.map(mapEquipment);
}

/**
 * Kullanıcının geçerli koruyucu ekipmanı var mı? (UserProfile.hasProtectiveEquipment + görev "Katıl" gate'i).
 */
async function hasProtectiveEquipment(userId) {
  const rows = await db('equipment').where({ user_id: userId, type: PROTECTIVE_TYPE });
  return rows.some((r) => computeStatus(r.expires_at) !== 'expired');
}

module.exports = { listForUser, hasProtectiveEquipment, computeStatus, mapEquipment };
