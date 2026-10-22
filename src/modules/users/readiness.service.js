'use strict';

// backend-gereksinimleri.md §1/§7 — hazırlık zincirinin TEK okuma yolu.
// Panel künyesi, mobil profil, QR check-in kapısı ve bildirim hedef kitlesi hep buradan
// okur; hiçbir ekran kendi sorgusuyla ayrı bir "hazır mı" hesabı yapmaz.

const { db } = require('../../config/db');
const derive = require('../../shared/derive');
const { kkdBeden, kkdKalemDurumu, KKD_ITEMS } = require('../../shared/kkd');
const { toDateOnly, toIso } = require('../../shared/dates');

/** Yayında + zorunlu teorik eğitimlerin id listesi (taslak eğitim kapı olamaz). */
async function requiredTheoryIds(trx = db) {
  return trx('online_trainings').where({ is_active: true, required: true }).pluck('id');
}

/**
 * Her gönüllünün EN GÜNCEL komisyon kararı — kaydı olmayan Map'te yer almaz ('pending').
 * Hazırlık zinciri ve KKD teslim kapısı bu tek sorgudan okur.
 * @param {string[]} userIds
 * @returns {Promise<Map<string, object>>} userId → commission_decisions satırı
 */
async function latestCommissionDecisions(userIds, trx = db) {
  const rows = await trx('commission_decisions').whereIn('user_id', userIds).orderBy('decided_at', 'desc');
  const latest = new Map();
  for (const row of rows) if (!latest.has(row.user_id)) latest.set(row.user_id, row);
  return latest;
}

/**
 * Gönüllülerin zincir girdilerini kullanıcı sayısından bağımsız SABİT sayıda sorguyla toplar
 * (liste ucu kişi başı sorgu atmasın).
 * @param {string[]} userIds
 * @returns {Promise<Map<string, object>>} userId → collect() girdisi
 */
async function collectMany(userIds, trx = db) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();

  const [decisions, requiredIds, completedRows, attendanceRows, equipmentRows, users] = await Promise.all([
    latestCommissionDecisions(ids, trx),
    requiredTheoryIds(trx),
    trx('online_training_progress')
      .whereIn('user_id', ids)
      .where({ status: 'completed' })
      .select('user_id', 'training_id'),
    trx('saha_training_applications as sta')
      .join('saha_trainings as st', 'st.id', 'sta.training_id')
      .whereIn('sta.user_id', ids)
      .select('sta.user_id', 'sta.attendance', 'st.grants_competency'),
    trx('equipment').whereIn('user_id', ids),
    trx('users').whereIn('id', ids),
  ]);

  const out = new Map(
    ids.map((id) => [
      id,
      { decision: decisions.get(id), requiredIds, completedIds: [], attendanceRows: [], equipmentRows: [], user: undefined },
    ]),
  );
  for (const r of completedRows) out.get(r.user_id)?.completedIds.push(r.training_id);
  for (const r of attendanceRows) out.get(r.user_id)?.attendanceRows.push(r);
  for (const r of equipmentRows) out.get(r.user_id)?.equipmentRows.push(r);
  for (const u of users) {
    const entry = out.get(u.id);
    if (entry) entry.user = u;
  }
  return out;
}

/**
 * Bir gönüllünün zincir girdilerini tek turda toplar.
 * @param {string} userId
 */
async function collect(userId, trx = db) {
  return (await collectMany([userId], trx)).get(userId);
}

function toReadiness(data) {
  const zincir = derive.hazirlikZinciri({
    decision: data.decision,
    requiredTrainingIds: data.requiredIds,
    completedTrainingIds: data.completedIds,
    attendanceRows: data.attendanceRows,
    equipmentRows: data.equipmentRows,
  });

  return {
    zincir,
    kisiDurumu: derive.kisiDurumu(zincir, { isActive: !!data.user?.is_active }),
    mudahaleYetkisi: derive.mudahaleYetkisi(zincir),
    engeller: derive.katilimEngelleri(zincir),
    komisyon: data.decision
      ? {
          decision: data.decision.decision,
          decidedAt: toIso(data.decision.decided_at),
          decidedBy: data.decision.decided_by || null,
          decisionNo: data.decision.decision_no || null,
        }
      : { decision: 'pending', decidedAt: null, decidedBy: null, decisionNo: null },
  };
}

/**
 * Hazırlık zinciri + kişi durumu + müdahale yetkisi.
 * @param {string} userId
 * @returns {Promise<{zincir:object, kisiDurumu:string, mudahaleYetkisi:boolean, engeller:object[]}>}
 */
async function getReadiness(userId, trx = db) {
  return toReadiness(await collect(userId, trx));
}

/**
 * getReadiness'in toplu hâli — liste uçları içindir.
 * @param {string[]} userIds
 * @returns {Promise<Map<string, ReturnType<typeof toReadiness>>>}
 */
async function getReadinessMany(userIds, trx = db) {
  const data = await collectMany(userIds, trx);
  return new Map([...data].map(([id, d]) => [id, toReadiness(d)]));
}

/** Mobil/panel KKD sekmesi — set bazında zimmet görünümü (beden profilden türer). */
async function kkdSet(userId, trx = db) {
  const [rows, user] = await Promise.all([
    trx('equipment').where({ user_id: userId }).orderBy('assigned_at', 'desc'),
    trx('users').where({ id: userId }).first(),
  ]);

  const latestByKey = new Map();
  for (const row of rows) {
    if (!row.item_key) continue;
    if (!latestByKey.has(row.item_key)) latestByKey.set(row.item_key, row);
  }

  return KKD_ITEMS.map((item) => {
    const row = latestByKey.get(item.key);
    return {
      itemKey: item.key,
      label: item.label,
      lifetimeYears: item.lifetimeYears,
      beden: kkdBeden(item.key, user),
      assigned: !!row,
      serialNo: row?.serial_no || null,
      assignedAt: row ? toDateOnly(row.assigned_at) : null,
      expiresAt: row ? toDateOnly(row.expires_at) : null,
      returnedAt: row?.returned_at ? toIso(row.returned_at) : null,
      status: row ? kkdKalemDurumu(row) : 'yok',
    };
  });
}

module.exports = {
  getReadiness, getReadinessMany, kkdSet, collect, collectMany, requiredTheoryIds, latestCommissionDecisions,
};
