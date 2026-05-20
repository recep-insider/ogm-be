'use strict';

const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const env = require('../../config/env');
const { errors } = require('../../shared/errors');
const { assetUrl } = require('../../shared/asset-url');
const { toIso, toDateOnly } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');
const { hasProtectiveEquipment } = require('../equipment/equipment.service');
const { sendPushToUser } = require('../../shared/push-provider');

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function statusFor(userId, missionId) {
  if (!userId) return 'not_joined';
  const row = await db('mission_participants').where({ user_id: userId, mission_id: missionId }).first();
  return row ? row.status : 'not_joined';
}

function mapActiveSummary(m, userStatus) {
  return {
    id: m.id,
    category: m.category,
    title: m.title,
    shortLocation: m.short_location,
    iconName: m.icon_name,
    status: m.status === 'completed' ? 'staffed' : m.status,
    userStatus,
  };
}

function mapActiveDetail(m, userStatus, announcements) {
  return {
    ...mapActiveSummary(m, userStatus),
    regionLabel: m.region_label || '',
    fullTitle: m.full_title || m.title,
    description: m.description || '',
    gallery: safeJson(m.gallery, []).map(assetUrl),
    needs: safeJson(m.needs, []),
    stats: { volunteers: m.stat_volunteers, hectares: m.stat_hectares },
    locationLabel: m.location_label || m.short_location,
    startedAt: toIso(m.started_at),
    coordinates: { lat: Number(m.lat), lng: Number(m.lng) },
    coverageRadiusKm: m.coverage_radius_km,
    operational: {
      meetingPoint: m.meeting_point || '',
      requiredEquipment: m.required_equipment || '',
    },
    announcements: announcements.map((a) => ({
      id: a.id,
      message: a.message,
      publishedAt: toIso(a.published_at),
      severity: a.severity,
    })),
  };
}

// FireMissionSummary (kontrat 8.1) — geçmiş/katılınan görevler.
function mapHistorySummary(m) {
  return {
    id: m.id,
    title: m.full_title || m.title,
    location: m.location_label || m.short_location,
    startDate: toDateOnly(m.start_date),
    endDate: toDateOnly(m.end_date),
    status: m.status === 'completed' ? 'completed' : 'active',
    cover: assetUrl(m.cover_path),
  };
}

function mapHistoryDetail(m) {
  return {
    ...mapHistorySummary(m),
    subtitle: m.subtitle || null,
    gallery: safeJson(m.gallery, []).map(assetUrl),
    summary: m.summary || '',
    stats: { hectares: m.stat_hectares, volunteers: m.stat_volunteers },
  };
}

async function listActive(userId) {
  const rows = await db('missions')
    .where({ is_active: true })
    .whereIn('status', ['active', 'staffed'])
    .orderBy('started_at', 'desc');
  const out = [];
  for (const m of rows) {
    out.push(mapActiveSummary(m, await statusFor(userId, m.id)));
  }
  return out;
}

async function getActive(userId, id) {
  const m = await db('missions').where({ id, is_active: true }).first();
  if (!m || m.status === 'completed') throw errors.notFound('Görev bulunamadı', 'mission_not_found');
  const announcements = await db('mission_announcements')
    .where({ mission_id: id })
    .orderBy('published_at', 'asc');
  return mapActiveDetail(m, await statusFor(userId, id), announcements);
}

async function join(userId, id, audit = {}) {
  const m = await db('missions').where({ id, is_active: true }).first();
  if (!m || m.status === 'completed') throw errors.notFound('Görev bulunamadı', 'mission_not_found');
  if (m.status === 'staffed') throw errors.conflict('Görev için yeterli gönüllü mevcut', undefined, 'mission_full');

  const existing = await db('mission_participants').where({ user_id: userId, mission_id: id }).first();
  if (existing) throw errors.conflict('Bu göreve zaten katıldınız', undefined, 'already_joined');

  if (!(await hasProtectiveEquipment(userId))) {
    throw errors.make(403, 'equipment_required', 'Bu göreve katılmak için geçerli koruyucu ekipman gerekli');
  }

  await db('mission_participants').insert({
    id: uuidv4(),
    user_id: userId,
    mission_id: id,
    status: 'accepted',
    joined_at: new Date(),
  });
  await db('missions').where({ id }).increment('stat_volunteers', 1);

  await writeAudit({
    userId,
    action: 'missions.join',
    entity: 'mission',
    entityId: id,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
  return { ok: true, userStatus: 'accepted' };
}

function verifyScanToken(token, userId, missionId) {
  if (!env.admin.scanHmacSecret) return true; // HMAC kapalıysa officer-auth'a güven
  if (!token) return false;
  const expected = crypto
    .createHmac('sha256', env.admin.scanHmacSecret)
    .update(`${userId}:${missionId}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// Saha amiri (officer) çağrısı — accepted → on_site (kontrat 7.4).
async function scan(missionId, { userId, scannedAt, token }, actor = {}) {
  const m = await db('missions').where({ id: missionId, is_active: true }).first();
  if (!m) throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  if (!verifyScanToken(token, userId, missionId)) {
    throw errors.make(400, 'invalid_qr', 'QR doğrulaması başarısız');
  }

  const participant = await db('mission_participants').where({ user_id: userId, mission_id: missionId }).first();
  if (!participant) throw errors.make(409, 'not_joined', 'Kullanıcı bu göreve katılmamış');

  if (participant.status !== 'on_site') {
    await db('mission_participants').where({ id: participant.id }).update({
      status: 'on_site',
      on_site_at: scannedAt ? new Date(scannedAt) : new Date(),
      updated_at: new Date(),
    });
  }

  await writeAudit({
    userId,
    action: 'missions.scan',
    entity: 'mission',
    entityId: missionId,
    payload: { actor: actor.role || 'officer' },
  });

  await sendPushToUser(userId, {
    topic: 'taskCalls',
    title: m.title,
    body: 'Görev yerine girişiniz onaylandı.',
    data: { type: 'mission_scan', missionId, userStatus: 'on_site' },
  });

  return { ok: true, userStatus: 'on_site' };
}

async function submitPhoto(userId, missionId, file, audit = {}) {
  if (!file) throw errors.validation('Dosya zorunlu');
  const m = await db('missions').where({ id: missionId, is_active: true }).first();
  if (!m) throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  const participant = await db('mission_participants').where({ user_id: userId, mission_id: missionId }).first();
  if (!participant || participant.status !== 'on_site') {
    throw errors.make(403, 'not_on_site', 'Fotoğraf yüklemek için görev yerinde olmalısınız');
  }

  const id = uuidv4();
  const submittedAt = new Date();
  const kind = (file.mimetype || '').startsWith('video/') ? 'video' : 'image';
  await db('mission_photos').insert({
    id,
    mission_id: missionId,
    user_id: userId,
    file_path: path.relative(env.upload.dir, file.path),
    kind,
    status: 'pending',
    submitted_at: submittedAt,
  });

  await writeAudit({
    userId,
    action: 'missions.photo',
    entity: 'mission_photo',
    entityId: id,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });

  return { ok: true, submissionId: id, status: 'pending', submittedAt: toIso(submittedAt) };
}

async function listHistory(userId) {
  const rows = await db('missions')
    .join('mission_participants', 'missions.id', 'mission_participants.mission_id')
    .where('mission_participants.user_id', userId)
    .orderBy('missions.start_date', 'desc')
    .select('missions.*');
  return rows.map(mapHistorySummary);
}

// Admin (panel) — görev fotoğrafı moderasyonu (kontrat 7.5 notu, mobil çağırmaz).
async function moderatePhoto(missionId, submissionId, { status }, actor = {}) {
  const photo = await db('mission_photos').where({ id: submissionId, mission_id: missionId }).first();
  if (!photo) throw errors.notFound('Gönderi bulunamadı', 'not_found');

  await db('mission_photos').where({ id: submissionId }).update({
    status,
    reviewed_at: new Date(),
    reviewed_by: actor.userId || null,
    updated_at: new Date(),
  });

  await writeAudit({
    userId: actor.userId || null,
    action: 'missions.photo.moderate',
    entity: 'mission_photo',
    entityId: submissionId,
    payload: { status },
  });

  return { ok: true, submissionId, status };
}

async function getHistory(userId, id) {
  const m = await db('missions').where({ id }).first();
  if (!m) throw errors.notFound('Görev bulunamadı', 'mission_not_found');
  const participant = await db('mission_participants').where({ user_id: userId, mission_id: id }).first();
  if (!participant) throw errors.make(403, 'not_participated', 'Bu görevde yer almadınız');
  return mapHistoryDetail(m);
}

module.exports = {
  listActive,
  getActive,
  join,
  scan,
  submitPhoto,
  moderatePhoto,
  listHistory,
  getHistory,
};
