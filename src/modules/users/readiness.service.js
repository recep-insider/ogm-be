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
 * Bir gönüllünün zincir girdilerini tek turda toplar.
 * @param {string} userId
 */
async function collect(userId, trx = db) {
  const [decision, requiredIds, completedIds, attendanceRows, equipmentRows, user] = await Promise.all([
    trx('commission_decisions').where({ user_id: userId }).orderBy('decided_at', 'desc').first(),
    requiredTheoryIds(trx),
    trx('online_training_progress')
      .where({ user_id: userId, status: 'completed' })
      .pluck('training_id'),
    trx('saha_training_applications as sta')
      .join('saha_trainings as st', 'st.id', 'sta.training_id')
      .where('sta.user_id', userId)
      .select('sta.attendance', 'st.grants_competency'),
    trx('equipment').where({ user_id: userId }),
    trx('users').where({ id: userId }).first(),
  ]);

  return { decision, requiredIds, completedIds, attendanceRows, equipmentRows, user };
}

/**
 * Hazırlık zinciri + kişi durumu + müdahale yetkisi.
 * @param {string} userId
 * @returns {Promise<{zincir:object, kisiDurumu:string, mudahaleYetkisi:boolean, engeller:object[]}>}
 */
async function getReadiness(userId, trx = db) {
  const data = await collect(userId, trx);
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

module.exports = { getReadiness, kkdSet, collect, requiredTheoryIds };
