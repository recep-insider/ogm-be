'use strict';

const { db } = require('../../config/db');
const env = require('../../config/env');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');
const { assetUrl } = require('../../shared/asset-url');
const { toIso, toDateOnly } = require('../../shared/dates');
const { hasProtectiveEquipment, PROTECTIVE_TYPE } = require('../equipment/equipment.service');

// applications.status enum'u ile aynı (migrations/20260427120200_create_applications.js).
const APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'requires_revision'];

/**
 * Bir gönüllünün EN GÜNCEL başvurusunun durumunu günceller (admin paneli / onay akışı).
 * Bildirim (push/SMS) GÖNDERMEZ — yalnızca status + review meta + audit. FE accessLevel'i
 * applications.status üzerinden türetir (users.service.getMe -> applicationStatus).
 *
 * @param {string} userId      Hedef gönüllünün id'si
 * @param {{status:string, note?:string}} body
 * @param {{userId?:string|null, ip?:string, userAgent?:string}} actor  İşlemi yapan admin
 */
async function setApplicationStatus(userId, { status, note }, actor = {}) {
  if (!APPLICATION_STATUSES.includes(status)) {
    throw errors.validation('Geçersiz başvuru durumu', { status, allowed: APPLICATION_STATUSES });
  }

  const application = await db('applications')
    .where({ user_id: userId })
    .orderBy('submitted_at', 'desc')
    .first();
  if (!application) throw errors.notFound('Başvuru bulunamadı', 'application_not_found');

  const reviewedAt = new Date();
  // Boş/yok not mevcut reviewer_note'u EZMEZ; yalnızca dolu not gelirse günceller.
  const reviewerNote = note && note.trim() ? note : (application.reviewer_note ?? null);
  await db('applications').where({ id: application.id }).update({
    status,
    reviewer_note: reviewerNote,
    reviewed_at: reviewedAt,
    reviewed_by: actor.userId || null,
    updated_at: reviewedAt,
  });

  await writeAudit({
    userId: actor.userId || null,
    action: 'admin.application.status',
    entity: 'application',
    entityId: application.id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { targetUserId: userId, from: application.status, to: status },
  });

  return {
    applicationId: application.id,
    userId,
    status,
    reviewedAt: reviewedAt.toISOString(),
  };
}

function mapVolunteerListItem(row) {
  return {
    userId: row.id,
    ad: row.ad,
    soyad: row.soyad,
    phone: row.phone,
    eposta: row.eposta,
    profileComplete: !!row.profile_complete,
    isActive: !!row.is_active,
    applicationStatus: row.application_status || null,
    submittedAt: toIso(row.submitted_at),
    egitim: Number(row.completed_trainings || 0) > 0,
    donanim: Number(row.protective_equipment || 0) > 0,
  };
}

/**
 * Gönüllü listesi (admin paneli). Misafir ve silinmiş kullanıcılar hariç;
 * her kullanıcı EN GÜNCEL başvurusuyla eşlenir. PII gözetimi: tc_kimlik
 * listede DÖNMEZ (yalnızca getVolunteer detayında).
 *
 * @param {{status?:string, q?:string, page?:number, pageSize?:number}} params
 */
async function listVolunteers({ status, q, page = 1, pageSize = 20 } = {}) {
  const base = db('users as u')
    .leftJoin('applications as a', function joinLatestApplication() {
      this.on('a.user_id', '=', 'u.id').andOn(
        'a.id',
        '=',
        db.raw('(select a2.id from applications a2 where a2.user_id = u.id order by a2.submitted_at desc limit 1)'),
      );
    })
    .where('u.is_guest', false)
    .whereNull('u.deleted_at');

  if (status) base.where('a.status', status);
  if (q) {
    // whereLike KULLANMA: knex'in MySQL dialekti 'COLLATE utf8_bin' ekler ve
    // utf8mb4 bağlantıda ER_COLLATION_CHARSET_MISMATCH (1253) ile patlar.
    // Düz LIKE, utf8mb4_*_ci collation ile zaten case-insensitive arar.
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    base.where((b) => {
      b.where('u.ad', 'like', like)
        .orWhere('u.soyad', 'like', like)
        .orWhere('u.phone', 'like', like)
        .orWhere('u.eposta', 'like', like);
    });
  }

  const [{ total }] = await base.clone().count({ total: 'u.id' });
  const rows = await base
    .clone()
    .select(
      'u.id', 'u.ad', 'u.soyad', 'u.phone', 'u.eposta', 'u.profile_complete', 'u.is_active',
      'a.status as application_status', 'a.submitted_at',
      db.raw("(select count(*) from user_trainings ut where ut.user_id = u.id and ut.status = 'completed') as completed_trainings"),
      db.raw('(select count(*) from equipment e where e.user_id = u.id and e.type = ? and (e.expires_at is null or e.expires_at >= now())) as protective_equipment', [PROTECTIVE_TYPE]),
    )
    .orderBy([
      { column: 'a.submitted_at', order: 'desc' },
      { column: 'u.created_at', order: 'desc' },
      { column: 'u.id', order: 'desc' }, // unique tie-breaker: offset sayfalamada tekrar/atlama olmasın
    ])
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items: rows.map(mapVolunteerListItem), total: Number(total), page, pageSize };
}

/** Gönüllü detayı (admin paneli) — PII burada döner: tcKimlik, adres, acil kişi, belgeler. */
async function getVolunteer(userId) {
  const user = await db('users').where({ id: userId }).whereNull('deleted_at').first();
  if (!user) throw errors.notFound('Kullanıcı bulunamadı', 'user_not_found');

  const [application, completed, hasEquipment] = await Promise.all([
    db('applications').where({ user_id: userId }).orderBy('submitted_at', 'desc').first(),
    db('user_trainings').where({ user_id: userId, status: 'completed' }).count({ c: '*' }).first(),
    hasProtectiveEquipment(userId),
  ]);

  return {
    user: {
      userId: user.id,
      tcKimlik: user.tc_kimlik,
      ad: user.ad,
      soyad: user.soyad,
      dogumTarihi: toDateOnly(user.dogum_tarihi),
      phone: user.phone,
      eposta: user.eposta,
      adres: user.adres,
      kanGrubu: user.kan_grubu,
      acil: {
        ad: user.acil_ad,
        soyad: user.acil_soyad,
        telefon: user.acil_telefon,
        yakinlik: user.acil_yakinlik,
      },
      avatarUrl: assetUrl(user.avatar_path),
      profileComplete: !!user.profile_complete,
      isActive: !!user.is_active,
      egitim: Number(completed?.c || 0) > 0,
      donanim: hasEquipment,
      createdAt: toIso(user.created_at),
    },
    application: application
      ? {
          applicationId: application.id,
          status: application.status,
          submittedAt: toIso(application.submitted_at),
          reviewedAt: toIso(application.reviewed_at),
          reviewedBy: application.reviewed_by,
          reviewerNote: application.reviewer_note,
          saglikRaporu: assetUrl(application.saglik_raporu_path),
          sabikaKaydi: assetUrl(application.sabika_kaydi_path),
        }
      : null,
  };
}

// ── Dashboard & Raporlar (Ö4) ───────────────────────────────

function statusCounts(rows) {
  const out = {};
  for (const r of rows) out[r.status] = Number(r.c);
  return out;
}

/** Operasyon Merkezi / sidebar sayaçları — tek istekte tüm özet. */
async function dashboardSummary() {
  const startOfToday = db.raw('curdate()');
  const [
    volunteerTotal, appStatuses, fireStatuses, fireToday, missionStatuses,
    pendingPhotos, sahaPending, emergencyTotal, emergencyToday, blogActive,
  ] = await Promise.all([
    db('users').where({ is_guest: false }).whereNull('deleted_at').count({ c: '*' }).first(),
    db('users as u')
      .join('applications as a', function joinLatestApplication() {
        this.on('a.user_id', '=', 'u.id').andOn(
          'a.id', '=',
          db.raw('(select a2.id from applications a2 where a2.user_id = u.id order by a2.submitted_at desc limit 1)'),
        );
      })
      .where('u.is_guest', false)
      .whereNull('u.deleted_at')
      .select('a.status')
      .count({ c: '*' })
      .groupBy('a.status'),
    db('fire_reports').select('status').count({ c: '*' }).groupBy('status'),
    db('fire_reports').where('created_at', '>=', startOfToday).count({ c: '*' }).first(),
    db('missions').select('status').count({ c: '*' }).groupBy('status'),
    db('mission_photos').where({ status: 'pending' }).count({ c: '*' }).first(),
    db('saha_training_applications').where({ status: 'pending' }).count({ c: '*' }).first(),
    db('emergency_reports').count({ c: '*' }).first(),
    db('emergency_reports').where('created_at', '>=', startOfToday).count({ c: '*' }).first(),
    db('blog_posts').select('is_active').count({ c: '*' }).groupBy('is_active'),
  ]);

  const app = statusCounts(appStatuses);
  const fire = statusCounts(fireStatuses);
  const mission = statusCounts(missionStatuses);
  const blog = { published: 0, draft: 0 };
  for (const r of blogActive) {
    if (r.is_active) blog.published = Number(r.c);
    else blog.draft = Number(r.c);
  }

  return {
    volunteers: {
      total: Number(volunteerTotal?.c || 0),
      pending: app.pending || 0,
      approved: app.approved || 0,
      rejected: app.rejected || 0,
      requiresRevision: app.requires_revision || 0,
    },
    fireReports: {
      reviewing: fire.reviewing || 0,
      confirmed: fire.confirmed || 0,
      rejected: fire.rejected || 0,
      today: Number(fireToday?.c || 0),
    },
    missions: {
      active: mission.active || 0,
      staffed: mission.staffed || 0,
      completed: mission.completed || 0,
    },
    pendingPhotos: Number(pendingPhotos?.c || 0),
    sahaApplications: { pending: Number(sahaPending?.c || 0) },
    emergency: { total: Number(emergencyTotal?.c || 0), today: Number(emergencyToday?.c || 0) },
    blog,
  };
}

/** İhbar doğruluğu: confirmed / (confirmed + rejected) yüzdesi; karar yoksa 0. */
function computeAccuracy(confirmed, rejected) {
  const denominator = confirmed + rejected;
  if (denominator === 0) return 0;
  return Math.round((confirmed / denominator) * 100);
}

/** [from,to) penceresinin hemen öncesindeki eşit uzunlukta pencere. */
function previousWindow(from, to) {
  const length = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - length), to: new Date(from) };
}

async function windowKpis(from, to) {
  const [fireByStatus, newVolunteers, activeVolunteers] = await Promise.all([
    db('fire_reports')
      .where('created_at', '>=', from)
      .where('created_at', '<', to)
      .select('status')
      .count({ c: '*' })
      .groupBy('status'),
    db('users').where({ is_guest: false }).whereNull('deleted_at').where('created_at', '<', to).count({ c: '*' }).first(),
    db('mission_participants')
      .where('joined_at', '>=', from)
      .where('joined_at', '<', to)
      .countDistinct({ c: 'user_id' })
      .first(),
  ]);
  const fire = statusCounts(fireByStatus);
  const confirmed = fire.confirmed || 0;
  const rejected = fire.rejected || 0;
  return {
    fires: confirmed, // FIRES domain'i yokken "yangın sayısı" = onaylanmış ihbar (en dürüst vekil metrik)
    volunteersTotal: Number(newVolunteers?.c || 0), // pencere SONU itibarıyla kümülatif gönüllü
    activeVolunteers: Number(activeVolunteers?.c || 0), // pencere içinde göreve katılan tekil gönüllü
    reportAccuracy: computeAccuracy(confirmed, rejected),
  };
}

/** Raporlar sayfası KPI'ları — [from,to) penceresi + bir önceki eşit pencereyle kıyas. */
async function reportsSummary({ from, to }) {
  const prev = previousWindow(from, to);
  const [current, previous] = await Promise.all([windowKpis(from, to), windowKpis(prev.from, prev.to)]);
  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    kpis: {
      fires: { current: current.fires, previous: previous.fires },
      volunteersTotal: { current: current.volunteersTotal, previous: previous.volunteersTotal },
      activeVolunteers: { current: current.activeVolunteers, previous: previous.activeVolunteers },
      reportAccuracy: { current: current.reportAccuracy, previous: previous.reportAccuracy },
    },
  };
}

// metric/interval değerleri Joi enum'undan gelir; format string'leri içeriden seçilir (SQL injection yüzeyi yok).
const SERIES_METRICS = {
  fireReports: { table: 'fire_reports', column: 'created_at', filter: null },
  confirmedFireReports: { table: 'fire_reports', column: 'created_at', filter: (q) => q.where({ status: 'confirmed' }) },
  emergency: { table: 'emergency_reports', column: 'created_at', filter: null },
  // volunteersTotal (windowKpis) ile tutarlı: misafir ve soft-delete hariç
  newUsers: { table: 'users', column: 'created_at', filter: (q) => q.where({ is_guest: false }).whereNull('deleted_at') },
};
const SERIES_INTERVALS = {
  day: '%Y-%m-%d',
  week: '%x-W%v', // ISO yıl-hafta
  month: '%Y-%m',
};

// Kovalar rapor saat dilimine göre etiketlenir (env.reports.tzOffset, varsayılan TR UTC+3).
// created_at UTC saklanır — convert_tz olmadan gece 00:00-03:00 TR kayıtları önceki güne
// yazılır ve pencere başı kovası panelin zero-fill anahtarlarıyla eşleşmeyip grafikten düşer.
const REPORT_TZ_OFFSET = env.reports.tzOffset;

/** Raporlar grafiği — metriğin [from,to) içinde gün/hafta/ay kovalarındaki sayıları (TR günü). */
async function reportsSeries({ metric, interval, from, to }) {
  const m = SERIES_METRICS[metric];
  const fmt = SERIES_INTERVALS[interval];
  const query = db(m.table)
    .select(db.raw(`date_format(convert_tz(${m.column}, '+00:00', ?), ?) as bucket`, [REPORT_TZ_OFFSET, fmt]))
    .count({ c: '*' })
    .where(m.column, '>=', from)
    .where(m.column, '<', to)
    .groupBy('bucket')
    .orderBy('bucket', 'asc');
  if (m.filter) m.filter(query);

  const rows = await query;
  return {
    metric,
    interval,
    series: rows.map((r) => ({ bucket: r.bucket, count: Number(r.c) })),
  };
}

module.exports = {
  setApplicationStatus,
  listVolunteers,
  getVolunteer,
  mapVolunteerListItem,
  dashboardSummary,
  reportsSummary,
  reportsSeries,
  computeAccuracy,
  previousWindow,
  SERIES_METRICS,
  SERIES_INTERVALS,
  APPLICATION_STATUSES,
};
