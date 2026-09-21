'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { assetUrl } = require('../../shared/asset-url');
const { toDateOnly, toIso } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');
const { deliverKkdSet } = require('../equipment/equipment.service');

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
      // mobil §8: "Zorunlu" rozeti ve yüz yüze/online ayrımı panelle birebir alanlardan gelir.
      required: !!t.required,
      delivery: t.delivery,
      videoUrl: assetUrl(t.video_path),
      status: p ? p.status : 'not_started',
      progressPercent: p ? p.progress_percent : 0,
    };
  });
}

// ── Saha (5.2) ──────────────────────────────────────────────
/**
 * Katılım sayaçları — backend-gereksinimleri.md §8: "Kayıtlı 28/30 · Katılan 24".
 * Tek bir `enrolled` sayısı yetmez. Kontenjan yalnızca BİLGİ amaçlıdır; doluluk ne
 * başvuruyu engeller ne de bir "yedek" durumu üretir (yedek kavramı kaldırıldı).
 */
async function seatInfo(trainingId, totalSeats) {
  const rows = await db('saha_training_applications')
    .where({ training_id: trainingId })
    .select('attendance')
    .count({ c: '*' })
    .groupBy('attendance');
  const enrolled = rows.reduce((sum, r) => sum + Number(r.c), 0);
  const attended = Number(rows.find((r) => r.attendance === 'katildi')?.c || 0);
  const available = Math.max(0, totalSeats - enrolled);
  return {
    enrolled,
    attended,
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
    const { availableSeats, seatStatus, enrolled, attended } = await seatInfo(t.id, t.total_seats);
    out.push({
      id: t.id,
      title: t.title,
      location: t.location,
      // §8: yetkinlik bayrağı — bayraksız kayıt (buluşma, tanıtım) müdahale kapısından geçirmez.
      grantsCompetency: !!t.grants_competency,
      enrolled,
      attended,
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

  // §8: başvuru onayı OTOMATİKTİR — 1. fazda manuel onay kuyruğu yoktur ve kontenjan
  // dolu diye ayrı bir "yedek" durumuna düşme yoktur. Kontenjan bilgi amaçlı kalır.
  const id = uuidv4();
  await db('saha_training_applications').insert({
    id,
    user_id: userId,
    training_id: trainingId,
    status: 'approved',
    attendance: 'kayitli',
  });

  await writeAudit({
    userId,
    action: 'trainings.apply',
    entity: 'saha_training',
    entityId: trainingId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });

  return { applicationId: id, status: 'approved', attendance: 'kayitli' };
}

// ── Aldığım Eğitimler (mobil §15) ───────────────────────────
// Liste YOKLAMADAN gelir; elle işaretlenen bir "tamamladım" yoktur. Teorik ve
// uygulamalı AYRI listelenir — biri diğerinin yerine geçmez (backend §7).
// Tek kaynak: teorik için tamamlama kaydı, uygulamalı için yetkinlik bayraklı saha
// eğitiminin yoklaması.

function mapTheoryCompletion(row) {
  return {
    id: row.training_id,
    kind: 'teorik',
    title: row.title,
    description: row.description || '',
    durationMin: row.duration_min,
    delivery: row.delivery,
    required: !!row.required,
    completedAt: toIso(row.completed_at),
    certificateUrl: assetUrl(row.certificate_path),
  };
}

function mapFieldCompletion(row) {
  return {
    id: row.training_id,
    kind: 'uygulamali',
    title: row.title,
    location: row.location,
    instructorName: row.instructor_name,
    // Yetkinlik kazandırmayan kayıtlar (buluşma, tanıtım) da listelenir ama
    // müdahale kapısından geçirmedikleri bu bayraktan görünür.
    grantsCompetency: !!row.grants_competency,
    completedAt: toIso(row.attendance_at),
    certificateUrl: assetUrl(row.certificate_path),
  };
}

async function listCompleted(userId) {
  const [theory, field] = await Promise.all([
    db('online_training_progress as p')
      .join('online_trainings as t', 't.id', 'p.training_id')
      .where({ 'p.user_id': userId, 'p.status': 'completed' })
      .orderBy('p.completed_at', 'desc')
      .select('p.training_id', 'p.completed_at', 'p.certificate_path', 't.title', 't.description', 't.duration_min', 't.delivery', 't.required'),
    db('saha_training_applications as a')
      .join('saha_trainings as t', 't.id', 'a.training_id')
      .where({ 'a.user_id': userId, 'a.attendance': 'katildi' })
      .orderBy('a.attendance_at', 'desc')
      .select('a.training_id', 'a.attendance_at', 'a.certificate_path', 't.title', 't.location', 't.instructor_name', 't.grants_competency'),
  ]);

  return {
    teorik: theory.map(mapTheoryCompletion),
    uygulamali: field.map(mapFieldCompletion),
  };
}

/** Sertifika — teorik tamamlama veya saha yoklaması kaydından okunur. */
async function getCertificate(userId, trainingId) {
  const theory = await db('online_training_progress')
    .where({ user_id: userId, training_id: trainingId, status: 'completed' })
    .first();
  const field = theory
    ? null
    : await db('saha_training_applications')
        .where({ user_id: userId, training_id: trainingId, attendance: 'katildi' })
        .first();

  const row = theory || field;
  if (!row) throw errors.notFound('Eğitim bulunamadı', 'not_found');
  if (!row.certificate_path) {
    throw errors.notFound('Sertifika henüz oluşturulmadı', 'certificate_not_issued');
  }
  return { url: assetUrl(row.certificate_path) };
}

// ── Admin (panel) görünümleri ───────────────────────────────
// Mobil listOnline/listSaha kullanıcı-bazlıdır (progress/isApplied);
// admin uçları kullanıcıdan bağımsız aggregate sayaçlar döner.

/** Admin — online eğitim listesi + kayıt/tamamlama sayaçları. @param {{isActive?:boolean}} params */
async function adminListOnline({ isActive } = {}) {
  const base = db('online_trainings as t');
  if (isActive !== undefined) base.where('t.is_active', isActive);

  const rows = await base
    .select('t.*', ...onlineAdminCounts())
    .orderBy([
      { column: 't.sort_order', order: 'asc' },
      { column: 't.id', order: 'asc' },
    ]);

  return { items: rows.map(mapAdminOnlineRow), total: rows.length };
}

function onlineAdminCounts() {
  return [
    db.raw('(select count(*) from online_training_progress p where p.training_id = t.id) as enrolled'),
    db.raw("(select count(*) from online_training_progress p where p.training_id = t.id and p.status = 'completed') as completed"),
  ];
}

function mapAdminOnlineRow(t) {
  return {
    id: t.id,
    title: t.title,
    description: t.description || '',
    durationMin: t.duration_min,
    iconTone: t.icon_tone,
    required: !!t.required,
    delivery: t.delivery,
    sortOrder: t.sort_order,
    videoUrl: assetUrl(t.video_path),
    isActive: !!t.is_active,
    enrolled: Number(t.enrolled || 0),
    completed: Number(t.completed || 0),
    createdAt: toIso(t.created_at),
  };
}

/** Tek kaydın admin görünümü — create/update dönüşleri tüm listeyi çekmesin diye. */
async function adminGetOnline(id) {
  const row = await db('online_trainings as t')
    .select('t.*', ...onlineAdminCounts())
    .where('t.id', id)
    .first();
  return row ? mapAdminOnlineRow(row) : null;
}

/** Admin — saha eğitim listesi + başvuru sayaçları. @param {{isActive?:boolean}} params */
async function adminListSaha({ isActive } = {}) {
  const base = db('saha_trainings as t');
  if (isActive !== undefined) base.where('t.is_active', isActive);

  const rows = await base
    .select('t.*', ...sahaAdminCounts())
    .orderBy([
      { column: 't.start_date', order: 'desc' },
      { column: 't.id', order: 'desc' },
    ]);

  return { items: rows.map(mapAdminSahaRow), total: rows.length };
}

function sahaAdminCounts() {
  return [
    db.raw('(select count(*) from saha_training_applications a where a.training_id = t.id) as enrolled_count'),
    db.raw("(select count(*) from saha_training_applications a where a.training_id = t.id and a.attendance = 'katildi') as attended_count"),
  ];
}

function mapAdminSahaRow(t) {
  // §8: sayaç ayrışır — "Kayıtlı N/kontenjan · Katılan N".
  const enrolled = Number(t.enrolled_count || 0);
  const attended = Number(t.attended_count || 0);
  return {
    id: t.id,
    title: t.title,
    location: t.location,
    startDate: toDateOnly(t.start_date),
    startTime: t.start_time,
    endTime: t.end_time,
    instructorName: t.instructor_name,
    instructorAvatar: assetUrl(t.instructor_avatar_path),
    instructorAvatarPath: t.instructor_avatar_path || null, // panel roundtrip
    cover: assetUrl(t.cover_path),
    coverPath: t.cover_path || null, // panel roundtrip — URL'den path'e geri çevirmek kırılgan
    totalSeats: t.total_seats,
    availableSeats: Math.max(0, t.total_seats - enrolled),
    grantsCompetency: !!t.grants_competency,
    enrolled,
    attended,
    isActive: !!t.is_active,
    createdAt: toIso(t.created_at),
  };
}

/** Tek kaydın admin görünümü — create/update dönüşleri tüm listeyi çekmesin diye. */
async function adminGetSaha(id) {
  const row = await db('saha_trainings as t')
    .select('t.*', ...sahaAdminCounts())
    .where('t.id', id)
    .first();
  return row ? mapAdminSahaRow(row) : null;
}

// ── Admin (panel) yazma uçları ──────────────────────────────

function onlineToRow(body) {
  const row = {};
  if (body.title !== undefined) row.title = body.title;
  if (body.description !== undefined) row.description = body.description || null;
  if (body.durationMin !== undefined) row.duration_min = body.durationMin;
  if (body.iconTone !== undefined) row.icon_tone = body.iconTone;
  if (body.required !== undefined) row.required = body.required;
  if (body.delivery !== undefined) row.delivery = body.delivery;
  if (body.sortOrder !== undefined) row.sort_order = body.sortOrder;
  if (body.videoPath !== undefined) row.video_path = body.videoPath || null;
  if (body.isActive !== undefined) row.is_active = body.isActive;
  return row;
}

async function adminCreateOnline(body, actor = {}) {
  const id = uuidv4();
  const now = new Date();
  // sortOrder verilmezse listenin sonuna ekle
  let sortOrder = body.sortOrder;
  if (sortOrder === undefined) {
    const max = await db('online_trainings').max({ m: 'sort_order' }).first();
    sortOrder = Number(max?.m || 0) + 1;
  }
  await db('online_trainings').insert({
    id,
    icon_tone: 'primary',
    ...onlineToRow(body),
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
  });
  await writeAudit({
    userId: actor.userId || null,
    action: 'trainings.online.create',
    entity: 'online_training',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { title: body.title },
  });
  return adminGetOnline(id);
}

async function adminUpdateOnline(id, body, actor = {}) {
  const existing = await db('online_trainings').where({ id }).first();
  if (!existing) throw errors.notFound('Eğitim bulunamadı', 'training_not_found');
  await db('online_trainings').where({ id }).update({ ...onlineToRow(body), updated_at: new Date() });
  await writeAudit({
    userId: actor.userId || null,
    action: 'trainings.online.update',
    entity: 'online_training',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { fields: Object.keys(body) },
  });
  return adminGetOnline(id);
}

/** DİKKAT: kalıcı siler; online_training_progress kayıtları FK CASCADE ile birlikte silinir. */
async function adminRemoveOnline(id, actor = {}) {
  const existing = await db('online_trainings').where({ id }).first();
  if (!existing) throw errors.notFound('Eğitim bulunamadı', 'training_not_found');
  await db('online_trainings').where({ id }).del();
  await writeAudit({
    userId: actor.userId || null,
    action: 'trainings.online.delete',
    entity: 'online_training',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { title: existing.title },
  });
}

function sahaToRow(body) {
  const row = {};
  if (body.title !== undefined) row.title = body.title;
  if (body.location !== undefined) row.location = body.location;
  if (body.startDate !== undefined) row.start_date = body.startDate;
  if (body.startTime !== undefined) row.start_time = body.startTime;
  if (body.endTime !== undefined) row.end_time = body.endTime;
  if (body.instructorName !== undefined) row.instructor_name = body.instructorName;
  if (body.instructorAvatarPath !== undefined) row.instructor_avatar_path = body.instructorAvatarPath || null;
  if (body.coverPath !== undefined) row.cover_path = body.coverPath || null;
  if (body.totalSeats !== undefined) row.total_seats = body.totalSeats;
  if (body.grantsCompetency !== undefined) row.grants_competency = body.grantsCompetency;
  if (body.isActive !== undefined) row.is_active = body.isActive;
  return row;
}

async function adminCreateSaha(body, actor = {}) {
  const id = uuidv4();
  const now = new Date();
  await db('saha_trainings').insert({ id, ...sahaToRow(body), created_at: now, updated_at: now });
  await writeAudit({
    userId: actor.userId || null,
    action: 'trainings.saha.create',
    entity: 'saha_training',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { title: body.title },
  });
  return adminGetSaha(id);
}

async function adminUpdateSaha(id, body, actor = {}) {
  const existing = await db('saha_trainings').where({ id }).first();
  if (!existing) throw errors.notFound('Eğitim bulunamadı', 'training_not_found');
  await db('saha_trainings').where({ id }).update({ ...sahaToRow(body), updated_at: new Date() });
  await writeAudit({
    userId: actor.userId || null,
    action: 'trainings.saha.update',
    entity: 'saha_training',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { fields: Object.keys(body) },
  });
  return adminGetSaha(id);
}

/** DİKKAT: kalıcı siler; saha_training_applications kayıtları FK CASCADE ile birlikte silinir. */
async function adminRemoveSaha(id, actor = {}) {
  const existing = await db('saha_trainings').where({ id }).first();
  if (!existing) throw errors.notFound('Eğitim bulunamadı', 'training_not_found');
  await db('saha_trainings').where({ id }).del();
  await writeAudit({
    userId: actor.userId || null,
    action: 'trainings.saha.delete',
    entity: 'saha_training',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { title: existing.title },
  });
}

/** Admin — saha eğitimi başvuru listesi. @param {{status?:string}} params */
async function adminListSahaApplications(trainingId, { status } = {}) {
  const training = await db('saha_trainings').where({ id: trainingId }).first('id', 'title', 'start_date', 'grants_competency');
  if (!training) throw errors.notFound('Eğitim bulunamadı', 'training_not_found');

  const query = db('saha_training_applications as a')
    .leftJoin('users as u', 'u.id', 'a.user_id')
    .where('a.training_id', trainingId)
    .select('a.*', 'u.ad as user_ad', 'u.soyad as user_soyad', 'u.phone as user_phone')
    .orderBy([
      { column: 'a.created_at', order: 'desc' },
      { column: 'a.id', order: 'desc' },
    ]);
  if (status) query.where('a.status', status);

  const rows = await query;
  // §8: eğitim tarihinden ÖNCE başvuru listesi, tarih geçince YOKLAMA listesi döner —
  // panel aynı ekranı iki modda gösteriyor, kaynağı bu bayrak.
  const today = toDateOnly(new Date());
  const mode = toDateOnly(training.start_date) <= today ? 'yoklama' : 'basvuru';
  return {
    training: {
      id: training.id,
      title: training.title,
      startDate: toDateOnly(training.start_date),
      grantsCompetency: !!training.grants_competency,
    },
    mode,
    items: rows.map((a) => ({
      applicationId: a.id,
      status: a.status,
      // §8: katılımcı durumu yalnızca kayitli | katildi.
      attendance: a.attendance,
      attendanceAt: toIso(a.attendance_at),
      kkdDelivered: !!a.kkd_delivered,
      createdAt: toIso(a.created_at),
      user: a.user_id ? { userId: a.user_id, ad: a.user_ad, soyad: a.user_soyad, phone: a.user_phone } : null,
    })),
    total: rows.length,
  };
}

/** Admin — saha başvurusu onay/red. Bildirim göndermez (application status ucuyla aynı ilke). */
async function adminSetSahaApplicationStatus(applicationId, { status }, actor = {}) {
  const application = await db('saha_training_applications').where({ id: applicationId }).first();
  if (!application) throw errors.notFound('Başvuru bulunamadı', 'application_not_found');

  await db('saha_training_applications').where({ id: applicationId }).update({
    status,
    updated_at: new Date(),
  });

  await writeAudit({
    userId: actor.userId || null,
    action: 'trainings.saha.application.status',
    entity: 'saha_training_application',
    entityId: applicationId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { trainingId: application.training_id, from: application.status, to: status },
  });

  return { applicationId, status };
}

/**
 * Yoklama (backend-gereksinimleri.md §8) — saha eğitiminin tamamlandığını işaretleyen
 * TEK mekanizma. Yetkinlik bayraklı bir eğitimde "katıldı" işaretlenmesi uygulamalı eğitim
 * adımını kapatır; bayraksız kayıtlar (buluşma, tanıtım) yetkinlik kazandırmaz.
 *
 * Aynı satırda "KKD teslim" işaretlenirse eksik kalemler o anda AYNI zimmet kaydına
 * yazılır (§6, ikinci teslim yolu) — gönüllü zaten fiziksel olarak oradadır.
 *
 * Yoklamada "gelmedi" AÇIK SORUDUR (prd.md §14): veri modeli yalnızca kayitli/katildi
 * bilir, bu yüzden attended:false yalnızca kaydı `kayitli`ye geri alır.
 *
 * @param {string} trainingId
 * @param {{entries: Array<{userId:string, attended:boolean, kkdDelivered?:boolean}>}} body
 */
async function adminSaveAttendance(trainingId, body, actor = {}) {
  const training = await db('saha_trainings').where({ id: trainingId }).first();
  if (!training) throw errors.notFound('Eğitim bulunamadı', 'training_not_found');

  const entries = body.entries || [];
  const userIds = entries.map((e) => e.userId);
  const applications = await db('saha_training_applications')
    .where({ training_id: trainingId })
    .whereIn('user_id', userIds);
  const byUser = new Map(applications.map((a) => [a.user_id, a]));

  const unknown = userIds.filter((id) => !byUser.has(id));
  if (unknown.length) {
    throw errors.validation('Eğitime kaydı olmayan gönüllü', { userIds: unknown });
  }

  const now = new Date();
  const results = [];

  for (const entry of entries) {
    const application = byUser.get(entry.userId);
    const attendance = entry.attended ? 'katildi' : 'kayitli';
    await db('saha_training_applications').where({ id: application.id }).update({
      attendance,
      attendance_at: entry.attended ? now : null,
      kkd_delivered: entry.attended ? !!entry.kkdDelivered : false,
      updated_at: now,
    });

    let kkd = null;
    if (entry.attended && entry.kkdDelivered) {
      kkd = await deliverKkdSet(entry.userId, {}, actor);
    }

    results.push({
      userId: entry.userId,
      attendance,
      kkdDelivered: !!(entry.attended && entry.kkdDelivered),
      kkdDurumu: kkd?.kkdDurumu,
    });
  }

  await writeAudit({
    userId: actor.userId || null,
    action: 'trainings.saha.attendance',
    entity: 'saha_training',
    entityId: trainingId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: {
      grantsCompetency: !!training.grants_competency,
      attended: results.filter((r) => r.attendance === 'katildi').length,
      total: results.length,
    },
  });

  return {
    trainingId,
    grantsCompetency: !!training.grants_competency,
    saved: results.length,
    items: results,
  };
}

module.exports = {
  listOnline,
  listSaha,
  applySaha,
  listCompleted,
  getCertificate,
  adminListOnline,
  adminListSaha,
  adminCreateOnline,
  adminUpdateOnline,
  adminRemoveOnline,
  adminCreateSaha,
  adminUpdateSaha,
  adminRemoveSaha,
  adminListSahaApplications,
  adminSetSahaApplicationStatus,
  adminSaveAttendance,
};
