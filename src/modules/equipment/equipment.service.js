'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { toDateOnly, toIso } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');
const {
  KKD_ITEMS,
  KKD_ITEM_KEYS,
  KKD_TYPE,
  EXPIRY_WARNING_DAYS,
  kkdItem,
  kkdOmurSonu,
  kkdDurumu,
  eksikKkdKalemleri,
  kkdBeden,
  kkdKalemDurumu,
} = require('../../shared/kkd');
const { komisyonKarari } = require('../../shared/derive');
const { latestCommissionDecisions } = require('../users/readiness.service');

const PROTECTIVE_TYPE = KKD_TYPE;

/** expires_at + eşiğe göre runtime status hesaplar (kontrat 11.1). */
function computeStatus(expiresAt) {
  if (!expiresAt) return 'active';
  const exp = new Date(expiresAt).getTime();
  const now = Date.now();
  if (exp < now) return 'expired';
  if (exp - now <= EXPIRY_WARNING_DAYS * 86400 * 1000) return 'expiring_soon';
  return 'active';
}

function mapEquipment(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    itemKey: row.item_key || null,
    serialNo: row.serial_no || null,
    assignedAt: toDateOnly(row.assigned_at),
    expiresAt: toDateOnly(row.expires_at),
    returnedAt: row.returned_at ? toIso(row.returned_at) : null,
    status: kkdKalemDurumu(row),
    iconName: row.icon_name || undefined,
  };
}

async function listForUser(userId) {
  const rows = await db('equipment').where({ user_id: userId }).orderBy('assigned_at', 'desc');
  return rows.map(mapEquipment);
}

/**
 * Kullanıcının geçerli koruyucu ekipmanı var mı? (UserProfile.hasProtectiveEquipment).
 * Görev katılım kapısı bu değil, hazırlık zincirinin tamamıdır (bkz. users/readiness.service.js).
 */
async function hasProtectiveEquipment(userId) {
  const rows = await db('equipment').where({ user_id: userId, type: PROTECTIVE_TYPE });
  return rows.some((r) => kkdKalemDurumu(r) !== 'expired' && kkdKalemDurumu(r) !== 'returned');
}

/**
 * KKD yalnız komisyon onaylı gönüllüye teslim edilir; karar, hazırlık zincirindeki gibi
 * kullanıcının en güncel commission_decisions satırından okunur.
 * @param {string[]} userIds
 */
async function assertCommissionApproved(userIds, trx = db) {
  if (!userIds.length) return;
  const latest = await latestCommissionDecisions(userIds, trx);
  const notApproved = userIds.filter((id) => komisyonKarari(latest.get(id)) !== 'approved');
  if (notApproved.length) {
    throw errors.conflict(
      'Komisyon onayı olmayan gönüllüye KKD teslim edilemez',
      { userIds: notApproved },
      'commission_not_approved',
    );
  }
}

/**
 * "KKD Seti Teslim Et" — tek işlemle standart beş kalemi açar (backend §6).
 * Zaten geçerli zimmeti olan kalem tekrar açılmaz; yalnızca EKSİK kalemler teslim edilir,
 * böylece saha eğitimi yoklamasından gelen ikinci teslim yolu aynı sete yazar.
 * Ömür sonu kalem tipinden hesaplanır, beden profilden türer — ikisi de girdiden okunmaz.
 *
 * @param {string} userId
 * @param {{serials?:Record<string,string>, itemKeys?:string[], assignedAt?:string}} body
 * @param {{userId?:string|null, ip?:string, userAgent?:string}} actor
 */
async function deliverKkdSet(userId, body = {}, actor = {}, trx = db) {
  const user = await trx('users').where({ id: userId }).whereNull('deleted_at').first();
  if (!user) throw errors.notFound('Kullanıcı bulunamadı', 'user_not_found');
  await assertCommissionApproved([userId], trx);

  const requested = body.itemKeys?.length ? body.itemKeys : KKD_ITEM_KEYS;
  const invalid = requested.filter((k) => !kkdItem(k));
  if (invalid.length) throw errors.validation('Geçersiz KKD kalemi', { invalid });

  const existing = await trx('equipment').where({ user_id: userId });
  const missing = eksikKkdKalemleri(existing).filter((k) => requested.includes(k));

  const assignedAt = body.assignedAt ? new Date(body.assignedAt) : new Date();
  if (Number.isNaN(assignedAt.getTime())) {
    throw errors.validation('Geçersiz teslim tarihi', { assignedAt: body.assignedAt });
  }

  const now = new Date();
  const rows = missing.map((key) => {
    const item = kkdItem(key);
    return {
      id: uuidv4(),
      user_id: userId,
      name: item.label,
      type: PROTECTIVE_TYPE,
      item_key: key,
      serial_no: body.serials?.[key] || null,
      assigned_at: toDateOnly(assignedAt),
      expires_at: toDateOnly(kkdOmurSonu(assignedAt, key)),
      status: 'active',
      created_at: now,
      updated_at: now,
    };
  });

  if (rows.length) await trx('equipment').insert(rows);

  await writeAudit({
    userId: actor.userId || null,
    action: 'equipment.kkd_set.deliver',
    entity: 'user',
    entityId: userId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { delivered: missing, skipped: requested.filter((k) => !missing.includes(k)) },
  }, trx);

  const after = await trx('equipment').where({ user_id: userId });
  return {
    ok: true,
    delivered: missing,
    kkdDurumu: kkdDurumu(after),
    items: KKD_ITEMS.map((item) => ({
      itemKey: item.key,
      label: item.label,
      beden: kkdBeden(item.key, user),
    })),
  };
}

module.exports = {
  listForUser,
  hasProtectiveEquipment,
  deliverKkdSet,
  assertCommissionApproved,
  computeStatus,
  mapEquipment,
  PROTECTIVE_TYPE,
};
