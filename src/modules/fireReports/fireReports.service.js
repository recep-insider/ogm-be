'use strict';

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const env = require('../../config/env');
const { errors } = require('../../shared/errors');
const { toIso } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');
const { sendPushToUser } = require('../../shared/push-provider');
const { assetUrl } = require('../../shared/asset-url');
const { reverseGeocode } = require('../../shared/reverse-geocode');
const { ihbarBasliklari, dayKey } = require('../../shared/fire-report-title');
const { regionForCity, regionLabel, applyRegionFilter } = require('../../shared/regions');

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// mobil §7: ihbar durum etiketleri karara bağlandı. Panelin iç modeli değişmedi,
// yalnızca mobile dönen etiketler bu üçüdür.
const STATUS_LABEL = {
  reviewing: 'İnceleniyor',
  confirmed: 'Doğrulandı',
  rejected: 'Reddedildi',
};

function mapReport(row, title) {
  return {
    id: row.id,
    // Başlık adresten değil posta kodu + il/ilçeden türer (§5); açık adres gösterilmez.
    title: title ?? row.title ?? null,
    postalCode: row.postal_code || null,
    il: row.il || null,
    ilce: row.ilce || null,
    locationName: row.location_name || '',
    regionLabel: row.region_label || '',
    // §11: kapsam il alanından türer — panel "Tüm Bölgeler" görünümünde bu anahtarla gruplar.
    region: regionForCity(row.il),
    regionName: regionLabel(regionForCity(row.il)),
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    submittedAt: toIso(row.created_at),
    coordinates: { lat: Number(row.latitude), lng: Number(row.longitude) },
  };
}

/**
 * Sayfadaki kayıtların başlıkları — numaralandırma, o kayıtların posta kodu + gün
 * HAVUZUNUN TAMAMI üzerinden yapılır. Yalnızca eldeki dilime bakmak numaraları
 * sayfadan sayfaya ve kullanıcıdan kullanıcıya kaydırırdı (mobil §7: mobil başlığı
 * panelinkiyle birebir eşleştirmeli).
 * @param {Array<object>} rows
 * @returns {Promise<Map<string,string>>} id → başlık
 */
async function titlesFor(rows) {
  const keys = rows
    .filter((r) => r.postal_code)
    .map((r) => ({ postalCode: r.postal_code, day: dayKey(r.created_at) }));
  if (!keys.length) return ihbarBasliklari(rows);

  const unique = new Map(keys.map((k) => [`${k.postalCode}|${k.day}`, k]));
  const pool = await db('fire_reports')
    .where((b) => {
      for (const { postalCode, day } of unique.values()) {
        b.orWhere((sub) => {
          sub.where('postal_code', postalCode).whereRaw('date(created_at) = ?', [day]);
        });
      }
    })
    .select('id', 'postal_code', 'il', 'ilce', 'location_name', 'created_at');

  // Havuzda olmayan (posta kodsuz) kayıtlar da başlık almalı.
  const poolIds = new Set(pool.map((r) => r.id));
  const merged = [...pool, ...rows.filter((r) => !poolIds.has(r.id))];
  return ihbarBasliklari(merged);
}

async function withTitles(rows, mapper = mapReport) {
  const titles = await titlesFor(rows);
  return rows.map((row) => mapper(row, titles.get(row.id)));
}

async function create({ userId, data, files, ip, userAgent }) {
  if (!files || files.length === 0) {
    throw errors.validation('En az bir medya dosyası zorunludur', { field: 'media' });
  }

  // Saatte 5 (kontrat 9.1 → 429 rate_limited) — üye için userId, guest için IP.
  const key = userId ? `rl:fire:${userId}` : `rl:fire:ip:${ip || 'unknown'}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  if (count > 5) throw errors.rateLimit('Saatlik yangın bildirim limiti aşıldı');

  const { lat, lng } = data.coordinates;
  // İhbar yazma yolu: konum adı "nice to have", ihbarın kaydı hayati. Geocode
  // servisi yavaşsa/kuyruk doluysa placeholder ile devam edilir; eski kayıtlar
  // scripts/backfill-fire-report-locations.js ile toparlanır.
  const { locationName, regionLabel, postalCode, il, ilce } = await reverseGeocode(lat, lng, {
    maxWaitMs: 2000,
    timeoutMs: 3000,
  });
  const id = uuidv4();
  const now = new Date();
  const photoPaths = files.map((f) => path.relative(env.upload.dir, f.path));

  await db('fire_reports').insert({
    id,
    user_id: userId,
    anonymous: !userId,
    latitude: lat,
    longitude: lng,
    description: data.description || null,
    photo_paths: JSON.stringify(photoPaths),
    location_name: locationName,
    region_label: regionLabel,
    postal_code: postalCode,
    il,
    ilce,
    status: 'reviewing',
    ip: ip || null,
    created_at: now,
    updated_at: now,
  });

  await writeAudit({
    userId,
    action: 'fire_reports.create',
    entity: 'fire_report',
    entityId: id,
    ip,
    userAgent,
    payload: { lat, lng, mediaCount: photoPaths.length },
  });

  const row = await db('fire_reports').where({ id }).first();
  return { ok: true, report: (await titleFor(row)) };
}

/** Tek kaydın panel/mobil görünümü — başlığı havuzdan hesaplanır. */
async function titleFor(row) {
  const titles = await titlesFor([row]);
  return mapReport(row, titles.get(row.id));
}

async function listMine(userId) {
  const rows = await db('fire_reports')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc');
  return withTitles(rows);
}

// Admin (panel) — status geçişi + reporter'a push (mobil app çağırmaz).
async function adminSetStatus(id, { status }, actor = {}) {
  const row = await db('fire_reports').where({ id }).first();
  if (!row) throw errors.notFound('Bildirim bulunamadı', 'not_found');

  await db('fire_reports').where({ id }).update({ status, updated_at: new Date() });

  await writeAudit({
    userId: actor.userId || null,
    action: 'fire_reports.status',
    entity: 'fire_report',
    entityId: id,
    payload: { status },
  });

  if (row.user_id) {
    await sendPushToUser(row.user_id, {
      topic: 'taskCalls',
      title: 'Yangın bildiriminiz güncellendi',
      body: status === 'confirmed' ? 'Bildiriminiz onaylandı.' : 'Bildiriminiz değerlendirildi.',
      data: { type: 'fire_report_status', reportId: id, status },
    });
  }

  const updated = await db('fire_reports').where({ id }).first();
  return { ok: true, report: await titleFor(updated) };
}

// Admin (panel) liste/detay görünümü — mapReport + medya, ihbarcı ve açıklama.
// İhbarcı bilgisi yalnızca anonim DEĞİLSE döner; ip sadece detayda (includeIp).
function mapAdminReport(row, { includeIp = false, title } = {}) {
  const report = {
    ...mapReport(row, title),
    description: row.description || '',
    anonymous: !!row.anonymous,
    // §5: bağlı olduğu olay kaydı (bağın tek sahibi ihbardır).
    missionId: row.mission_id || null,
    photoUrls: safeJson(row.photo_paths, []).map(assetUrl),
    // §5 "1. fazda AI yok": güven çipi yerine mevcut veriden türeyen sinyaller.
    signals: {
      // Aynı il/ilçeden aynı gün gelen DİĞER ihbar sayısı — kümelenmeyi gösterir.
      sameAreaCount: row.same_area_count != null ? Number(row.same_area_count) : undefined,
      reporterType: row.anonymous ? 'anonymous' : 'volunteer',
      photoCount: safeJson(row.photo_paths, []).length,
    },
    reporter:
      !row.anonymous && row.user_id
        ? {
            userId: row.user_id,
            ad: row.reporter_ad || null,
            soyad: row.reporter_soyad || null,
            phone: row.reporter_phone || null,
          }
        : null,
  };
  if (includeIp) report.ip = row.ip || null;
  return report;
}

const REPORTER_COLUMNS = ['u.ad as reporter_ad', 'u.soyad as reporter_soyad', 'u.phone as reporter_phone'];

// Aynı il/ilçeden AYNI GÜN gelen diğer ihbarların sayısı (kendisi hariç).
const SAME_AREA_COUNT = db.raw(
  `(select count(*) from fire_reports x
      where x.id <> fr.id
        and x.il <=> fr.il and x.ilce <=> fr.ilce
        and date(x.created_at) = date(fr.created_at)) as same_area_count`,
);

/** Admin (panel) — ihbar listesi. @param {{status?:string, page?:number, pageSize?:number}} params */
async function adminList({ status, region, page = 1, pageSize = 20 } = {}) {
  const base = db('fire_reports as fr');
  if (status) base.where('fr.status', status);
  // Kapsam yalnızca GÖRÜNÜMÜ süzer; "Tüm Bölgeler"de hiçbir kayıt elenmez (§11).
  applyRegionFilter(base, region, 'fr.il');

  const [{ total }] = await base.clone().count({ total: 'fr.id' });
  const rows = await base
    .clone()
    .leftJoin('users as u', 'u.id', 'fr.user_id')
    .select('fr.*', ...REPORTER_COLUMNS, SAME_AREA_COUNT)
    .orderBy([
      { column: 'fr.created_at', order: 'desc' },
      { column: 'fr.id', order: 'desc' }, // unique tie-breaker
    ])
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const titles = await titlesFor(rows);
  return {
    items: rows.map((r) => mapAdminReport(r, { title: titles.get(r.id) })),
    total: Number(total),
    page,
    pageSize,
  };
}

/** Admin (panel) — ihbar detayı (+ip). */
async function adminGetById(id) {
  const row = await db('fire_reports as fr')
    .leftJoin('users as u', 'u.id', 'fr.user_id')
    .select('fr.*', ...REPORTER_COLUMNS, SAME_AREA_COUNT)
    .where('fr.id', id)
    .first();
  if (!row) throw errors.notFound('Bildirim bulunamadı', 'not_found');
  const { title } = await titleFor(row);
  return mapAdminReport(row, { includeIp: true, title });
}

/**
 * İhbarı bir olay kaydına bağlar / bağını kaldırır (§5).
 * Bağın TEK sahibi ihbar kaydıdır (`fire_reports.mission_id`); olay tarafında ayna alan
 * tutulmaz. Bağlanan ihbar "Doğrulandı" (confirmed), bağı kaldırılan ihbar yeniden
 * "İnceleniyor" (reviewing) olur — mobilin gördüğü etiket bu geçişi izler.
 *
 * @param {string} missionId
 * @param {string[]} reportIds
 */
async function linkToMission(missionId, reportIds, actor = {}) {
  const mission = await db('missions').where({ id: missionId }).first('id', 'status');
  if (!mission) throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  const rows = await db('fire_reports').whereIn('id', reportIds);
  const missing = reportIds.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw errors.notFound('İhbar bulunamadı', 'not_found');

  const now = new Date();
  await db('fire_reports')
    .whereIn('id', reportIds)
    .update({ mission_id: missionId, status: 'confirmed', updated_at: now });

  await writeAudit({
    userId: actor.userId || null,
    action: 'fire_reports.link',
    entity: 'mission',
    entityId: missionId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { reportIds },
  });

  return { ok: true, missionId, linked: reportIds };
}

async function unlinkFromMission(missionId, reportId, actor = {}) {
  const row = await db('fire_reports').where({ id: reportId }).first();
  if (!row) throw errors.notFound('İhbar bulunamadı', 'not_found');
  if (row.mission_id !== missionId) {
    throw errors.conflict('İhbar bu olaya bağlı değil', undefined, 'not_linked');
  }

  const now = new Date();
  await db('fire_reports')
    .where({ id: reportId })
    .update({ mission_id: null, status: 'reviewing', updated_at: now });

  await writeAudit({
    userId: actor.userId || null,
    action: 'fire_reports.unlink',
    entity: 'mission',
    entityId: missionId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { reportId },
  });

  return { ok: true, missionId, unlinked: reportId };
}

/**
 * Olaya bağlı ihbarların medyası (§5) — olayın galerisini besler.
 * Panelin operatör onayından geçirdiği galeri ile aynı havuza girer.
 */
async function mediaForMission(missionId) {
  const rows = await db('fire_reports')
    .where({ mission_id: missionId })
    .orderBy('created_at', 'asc')
    .select('id', 'photo_paths');
  return rows.flatMap((r) =>
    safeJson(r.photo_paths, []).map((p) => ({ reportId: r.id, url: assetUrl(p) })),
  );
}

module.exports = {
  create,
  listMine,
  adminSetStatus,
  adminList,
  adminGetById,
  mapReport,
  mapAdminReport,
  withTitles,
  titlesFor,
  titleFor,
  linkToMission,
  unlinkFromMission,
  mediaForMission,
  STATUS_LABEL,
};
