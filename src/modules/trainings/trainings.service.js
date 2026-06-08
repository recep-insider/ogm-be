'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { assetUrl } = require('../../shared/asset-url');
const { toDateOnly } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');

const LAST_SEATS_THRESHOLD = 5;

// ── Online (5.1) ────────────────────────────────────────────
async function listOnline(userId) {
  const trainings = await db('online_trainings')
    .where({ is_active: true })
    .orderBy('sort_order', 'asc');
  const progress = await db('online_training_progress').where({ user_id: userId });
  const byId = new Map(progress.map((p) => [p.training_id, p]));

  return trainings.map((t) => {
    const p = byId.get(t.id);
    return {
      id: t.id,
      title: t.title,
      description: t.description || '',
      durationMin: t.duration_min,
      iconTone: t.icon_tone,
      videoUrl: assetUrl(t.video_path),
      status: p ? p.status : 'not_started',
      progressPercent: p ? p.progress_percent : 0,
    };
  });
}

// ── Saha (5.2) ──────────────────────────────────────────────
async function seatInfo(trainingId, totalSeats) {
  const taken = await db('saha_training_applications')
    .where({ training_id: trainingId })
    .whereIn('status', ['pending', 'approved'])
    .count({ c: '*' })
    .first();
  const used = Number(taken?.c || 0);
  const available = Math.max(0, totalSeats - used);
  return {
    availableSeats: available,
    seatStatus: available > 0 && available <= LAST_SEATS_THRESHOLD ? 'last_seats' : 'available',
  };
}

async function listSaha(userId) {
  const trainings = await db('saha_trainings').where({ is_active: true }).orderBy('start_date', 'asc');
  const myApps = await db('saha_training_applications').where({ user_id: userId }).pluck('training_id');
  const appliedSet = new Set(myApps);

  const out = [];
  for (const t of trainings) {
    const { availableSeats, seatStatus } = await seatInfo(t.id, t.total_seats);
    out.push({
      id: t.id,
      title: t.title,
      location: t.location,
      startDate: toDateOnly(t.start_date),
      startTime: t.start_time,
      endTime: t.end_time,
      instructorName: t.instructor_name,
      instructorAvatar: assetUrl(t.instructor_avatar_path),
      cover: assetUrl(t.cover_path),
      availableSeats,
      seatStatus,
      applied: appliedSet.has(t.id),
    });
  }
  return out;
}

async function applySaha(userId, trainingId, audit = {}) {
  const t = await db('saha_trainings').where({ id: trainingId }).first();
  if (!t) throw errors.notFound('Eğitim bulunamadı', 'not_found');
  if (!t.is_active) throw errors.gone('Eğitim başvuruya kapalı', undefined, 'training_closed');

  const existing = await db('saha_training_applications').where({ user_id: userId, training_id: trainingId }).first();
  if (existing) throw errors.conflict('Bu eğitime zaten başvurdunuz', undefined, 'already_applied');

  const { availableSeats } = await seatInfo(trainingId, t.total_seats);
  if (availableSeats <= 0) throw errors.gone('Eğitim kontenjanı dolu', undefined, 'training_full');

  const id = uuidv4();
  await db('saha_training_applications').insert({
    id,
    user_id: userId,
    training_id: trainingId,
    status: 'pending',
  });

  await writeAudit({
    userId,
    action: 'trainings.apply',
    entity: 'saha_training',
    entityId: trainingId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });

  return { applicationId: id, status: 'pending' };
}

// ── Aldığım Eğitimler (6.1 / 6.2) ───────────────────────────
function mapCompleted(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    durationMin: row.duration_min,
    completedAt: toDateOnly(row.completed_at),
    instructorName: row.instructor_name || null,
    progressPercent: row.progress_percent,
    status: row.status,
    certificateUrl: assetUrl(row.certificate_path),
  };
}

async function listCompleted(userId) {
  const rows = await db('user_trainings').where({ user_id: userId }).orderBy('completed_at', 'desc');
  return rows.map(mapCompleted);
}

async function getCertificate(userId, trainingId) {
  const row = await db('user_trainings').where({ id: trainingId, user_id: userId }).first();
  if (!row) throw errors.notFound('Eğitim bulunamadı', 'not_found');
  if (!row.certificate_path) {
    throw errors.notFound('Sertifika henüz oluşturulmadı', 'certificate_not_issued');
  }
  return { url: assetUrl(row.certificate_path) };
}

module.exports = {
  listOnline,
  listSaha,
  applySaha,
  listCompleted,
  getCertificate,
};
