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
const { sendPushToUser } = require('../../shared/push-provider');
const readinessService = require('../users/readiness.service');
const assemblyPoints = require('./assemblyPoints.service');
const { regionForCity, regionLabel, applyRegionFilter } = require('../../shared/regions');
const { coversTarget } = require('../../shared/geo-distance');

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// backend §3: gönüllünün olaydaki durumu — her geçişin doğrulanabilir bir sinyali vardır.
//   cagrildi (bildirim) · yolda | katilamiyor (mobil buton) · sahada (QR check-in) ·
//   tamamladi (olayın arşivlenmesi). Operatör bunları elle değiştiremez.
const EVENT_STATUS = ['cagrildi', 'yolda', 'sahada', 'tamamladi', 'katilamiyor'];

// Gönüllünün mobilden verebileceği TEK sinyal çifti — sahada/tamamladi mobilden gelmez.
const VOLUNTEER_SIGNALS = ['yolda', 'katilamiyor'];

async function statusFor(userId, missionId) {
  if (!userId) return 'not_joined';
  const row = await db('mission_participants').where({ user_id: userId, mission_id: missionId }).first();
  return row ? row.status : 'not_joined';
}

/**
 * Sahadaki gönüllü sayısı (§1) — TEK kaynak check-in kaydıdır. Panel, mobil ve toplanma
 * noktası ekranı aynı sayıyı gösterir. Olay arşivlendiğinde sıfırlanır; check-in
 * kayıtları geçmiş olarak korunur.
 */
async function sahadakiSayisi(missionId, mission) {
  const m = mission || (await db('missions').where({ id: missionId }).first('status'));
  if (m && m.status === 'archived') return 0;
  const row = await db('check_ins').where({ mission_id: missionId }).count({ c: '*' }).first();
  return Number(row?.c || 0);
}

/** Check-in trendi — "son 15 dk +3" penceresi (§1). */
async function checkInTrend(missionId, windowMinutes = 15) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const row = await db('check_ins')
    .where({ mission_id: missionId })
    .where('checked_in_at', '>=', since)
    .count({ c: '*' })
    .first();
  return { windowMinutes, count: Number(row?.c || 0) };
}

/** Olayın toplanma noktası — olay başına TEK nokta vardır. */
async function assemblyPointFor(missionId) {
  const row = await db('assembly_points').where({ mission_id: missionId }).first();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    address: row.address || null,
    coordinates: { lat: Number(row.lat), lng: Number(row.lng) },
    isOpen: !!row.is_open,
  };
}

function mapActiveSummary(m, userStatus) {
  return {
    id: m.id,
    // mobil §5: görev adı ve rol etiketi YOK — olayın kendisi gösterilir.
    title: m.title,
    shortLocation: m.short_location,
    iconName: m.icon_name,
    status: m.status, // active | archived (arşivlendi terminaldir)
    userStatus,
  };
}

function mapActiveDetail(m, userStatus, { onSiteCount, trend, assemblyPoint, userId, linkedMedia = [] }) {
  return {
    ...mapActiveSummary(m, userStatus),
    regionLabel: m.region_label || '',
    fullTitle: m.full_title || m.title,
    description: m.description || '',
    // §5: bağlı ihbarların fotoğraf/videoları olayın medya havuzunu besler.
    gallery: [...safeJson(m.gallery, []).map(assetUrl), ...linkedMedia.map((x) => x.url)],
    // §12 / mobil §6: tahmini alan, ihtiyaç listesi, kapsama yarıçapı, şiddet, hava
    // durumu ve ekip sayıları KALDIRILDI — merkez operatörünün doğrulayamayacağı saha
    // verisi. Sahadaki gönüllü sayısının tek kaynağı check-in'dir.
    stats: { volunteers: onSiteCount },
    checkInTrend: trend,
    locationLabel: m.location_label || m.short_location,
    startedAt: toIso(m.started_at),
    archivedAt: toIso(m.archived_at),
    coordinates: { lat: Number(m.lat), lng: Number(m.lng) },
    // mobil §6: olay başına tek toplanma noktası; nokta değişirse sunucu otomatik bildirir.
    assemblyPoint,
    // Gönüllünün sahaya girişini doğrulayan tek yol — "Vardınız mı?" onayı yoktur.
    qrPayload: qrPayloadFor(userId),
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
    status: m.status,
    cover: assetUrl(m.cover_path),
  };
}

function mapHistoryDetail(m, volunteers) {
  return {
    ...mapHistorySummary(m),
    subtitle: m.subtitle || null,
    gallery: safeJson(m.gallery, []).map(assetUrl),
    summary: m.summary || '',
    stats: { volunteers },
  };
}

async function listActive(userId) {
  const rows = await db('missions')
    .where({ is_active: true, status: 'active' })
    .orderBy('started_at', 'desc');
  const out = [];
  for (const m of rows) {
    out.push(mapActiveSummary(m, await statusFor(userId, m.id)));
  }
  return out;
}

/** Gönüllüye özel QR (§13) — panelin parseVolunteerQr()'ı ile eşleşir. */
function qrPayloadFor(userId) {
  return userId ? `OGM:VOL:${userId}` : null;
}

async function getActive(userId, id) {
  const m = await db('missions').where({ id, is_active: true }).first();
  if (!m || m.status === 'archived') throw errors.notFound('Görev bulunamadı', 'mission_not_found');
  // §12: "saha güncellemeleri akışı" kaldırıldı — merkez operatörünün doğrulayamayacağı
  // saha verisiydi; duyurular artık Bildirim Merkezi'nden gider.
  const [onSiteCount, trend, assemblyPoint, linkedMedia] = await Promise.all([
    sahadakiSayisi(id, m),
    checkInTrend(id),
    assemblyPointFor(id),
    require('../fireReports/fireReports.service').mediaForMission(id),
  ]);
  return mapActiveDetail(m, await statusFor(userId, id), {
    onSiteCount,
    trend,
    assemblyPoint,
    userId,
    linkedMedia,
  });
}

/**
 * Gönüllünün katılım kararı (§3, mobil §6) — "Katılmak istiyorum" / "Katılamıyorum".
 * Sinyalin sahibi gönüllüdür; operatör bu durumu elle değiştiremez.
 *
 * KURAL, İSTİSNASIZ (§5): eksiği olan gönüllü hiçbir göreve katılamaz. Destek rolüyle
 * katılma seçeneği YOKTUR — engel varsa eksik adım gösterilir. Uygunluk canlı bir
 * değerdir, sahaya varışta (check-in) YENİDEN değerlendirilir.
 *
 * @param {'yolda'|'katilamiyor'} decision
 */
async function respond(userId, id, decision, audit = {}) {
  if (!VOLUNTEER_SIGNALS.includes(decision)) {
    throw errors.validation('Geçersiz katılım kararı', { decision, allowed: VOLUNTEER_SIGNALS });
  }

  const m = await db('missions').where({ id, is_active: true }).first();
  if (!m || m.status === 'archived') throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  if (decision === 'yolda') {
    const { engeller } = await readinessService.getReadiness(userId);
    if (engeller.length) {
      throw errors.make(403, 'readiness_incomplete', 'Hazırlık zincirinde eksik adım var', {
        engeller,
      });
    }
  }

  const now = new Date();
  const existing = await db('mission_participants').where({ user_id: userId, mission_id: id }).first();
  if (existing) {
    if (['sahada', 'tamamladi'].includes(existing.status)) {
      throw errors.conflict('Bu görevde durumunuz kapanmış', { status: existing.status }, 'status_locked');
    }
    await db('mission_participants').where({ id: existing.id }).update({
      status: decision,
      responded_at: now,
      updated_at: now,
    });
  } else {
    await db('mission_participants').insert({
      id: uuidv4(),
      user_id: userId,
      mission_id: id,
      status: decision,
      responded_at: now,
      joined_at: now,
    });
  }

  await writeAudit({
    userId,
    action: 'missions.respond',
    entity: 'mission',
    entityId: id,
    ip: audit.ip,
    userAgent: audit.userAgent,
    payload: { decision },
  });

  return { ok: true, userStatus: decision };
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

/** QR içeriğini çözer — format `OGM:VOL:{gönüllü id}` (§13). */
function parseVolunteerQr(payload) {
  if (typeof payload !== 'string') return null;
  const match = /^OGM:VOL:(.+)$/.exec(payload.trim());
  return match ? match[1] : null;
}

/**
 * Yangın sahası giriş kaydı (§13) — saha amiri (officer) çağrısı.
 *
 * Gönüllü QR'ıyla veya QR okutulamazsa TC kimlik numarasıyla (yedek yöntem) kaydedilir.
 * Katılım engeli varsa check-in ENGELLENİR: yalnızca uyarı değil, KAYIT OLUŞMAZ ve
 * sahadaki sayıya girmez. Uygunluk çağrı anından beri değişmiş olabilir (KKD ömrü
 * dolmuş, zimmet iade alınmış) — bu yüzden sahaya varışta yeniden değerlendirilir.
 * Arama bölge kapsamıyla sınırlı DEĞİLDİR: başka bölgeden gelen destek gönüllüsü de
 * kayıt olabilir.
 *
 * @param {string} missionId
 * @param {{userId?:string, qr?:string, tcKimlik?:string, scannedAt?:string, token?:string, method?:string}} body
 */
async function scan(missionId, body, actor = {}) {
  const m = await db('missions').where({ id: missionId, is_active: true }).first();
  if (!m) throw errors.notFound('Görev bulunamadı', 'mission_not_found');
  if (m.status === 'archived') {
    throw errors.conflict('Olay arşivlendi, yeni giriş kaydı alınamaz', undefined, 'mission_archived');
  }

  // Kimlik üç yoldan gelebilir: QR içeriği, doğrudan userId, TC kimlik (yedek yöntem).
  let userId = parseVolunteerQr(body.qr) || body.userId || null;
  let method = body.qr || body.userId ? 'qr' : null;
  if (!userId && body.tcKimlik) {
    const found = await db('users').where({ tc_kimlik: body.tcKimlik }).whereNull('deleted_at').first('id');
    if (!found) throw errors.notFound('Gönüllü bulunamadı', 'volunteer_not_found');
    userId = found.id;
    method = 'tc_manual';
  }
  if (!userId) throw errors.validation('QR, userId veya TC kimlik zorunlu', { field: 'qr|userId|tcKimlik' });

  if (!verifyScanToken(body.token, userId, missionId)) {
    throw errors.make(400, 'invalid_qr', 'QR doğrulaması başarısız');
  }

  const user = await db('users').where({ id: userId }).whereNull('deleted_at').first();
  if (!user) throw errors.notFound('Gönüllü bulunamadı', 'volunteer_not_found');

  // Katılım kapısı check-in ANINDA yeniden değerlendirilir.
  const readiness = await readinessService.getReadiness(userId);
  if (readiness.engeller.length) {
    throw errors.make(403, 'readiness_incomplete', 'Hazırlık zincirinde eksik adım var', {
      engeller: readiness.engeller,
    });
  }

  const checkedInAt = body.scannedAt ? new Date(body.scannedAt) : new Date();
  const existing = await db('check_ins').where({ mission_id: missionId, user_id: userId }).first();
  if (!existing) {
    await db('check_ins').insert({
      id: uuidv4(),
      mission_id: missionId,
      user_id: userId,
      checked_in_at: checkedInAt,
      method: method || 'qr',
      recorded_by: actor.name || actor.role || 'officer',
    });
  }

  // Olay durumu check-in sinyalinden türer; katılım kaydı yoksa burada açılır
  // (başka bölgeden destek için gelen gönüllü çağrılmamış olabilir).
  const participant = await db('mission_participants')
    .where({ user_id: userId, mission_id: missionId })
    .first();
  const now = new Date();
  if (participant) {
    if (participant.status !== 'sahada') {
      await db('mission_participants').where({ id: participant.id }).update({
        status: 'sahada',
        on_site_at: checkedInAt,
        updated_at: now,
      });
    }
  } else {
    await db('mission_participants').insert({
      id: uuidv4(),
      user_id: userId,
      mission_id: missionId,
      status: 'sahada',
      joined_at: checkedInAt,
      on_site_at: checkedInAt,
    });
  }

  await writeAudit({
    userId,
    action: 'missions.checkin',
    entity: 'mission',
    entityId: missionId,
    payload: { actor: actor.role || 'officer', method: method || 'qr' },
  });

  await sendPushToUser(userId, {
    topic: 'taskCalls',
    title: m.title,
    body: 'Yangın sahasına girişiniz kaydedildi.',
    data: { type: 'mission_checkin', missionId, userStatus: 'sahada' },
  });

  // Okutma anında gösterilecek künye — hepsi mevcut kayıttan türer, sahada elle bilgi girilmez.
  return {
    ok: true,
    userStatus: 'sahada',
    checkedInAt: toIso(checkedInAt),
    method: method || 'qr',
    onSite: await sahadakiSayisi(missionId, m),
    volunteer: {
      userId: user.id,
      ad: user.ad,
      soyad: user.soyad,
      tcKimlikMasked: user.tc_kimlik ? `${user.tc_kimlik.slice(0, 3)}******${user.tc_kimlik.slice(-2)}` : null,
      kisiDurumu: readiness.kisiDurumu,
      kkdDurumu: readiness.zincir.kkdDurumu,
      egitim: {
        teorik: readiness.zincir.steps.find((x) => x.key === 'teorik')?.done,
        uygulamali: readiness.zincir.steps.find((x) => x.key === 'uygulamali')?.done,
      },
      stk: user.stk_text || null,
      mission: { id: m.id, title: m.title },
    },
  };
}

async function submitPhoto(userId, missionId, file, audit = {}) {
  if (!file) throw errors.validation('Dosya zorunlu');
  const m = await db('missions').where({ id: missionId, is_active: true }).first();
  if (!m) throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  const participant = await db('mission_participants').where({ user_id: userId, mission_id: missionId }).first();
  if (!participant || participant.status !== 'sahada') {
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
  const volunteers = await db('check_ins').where({ mission_id: id }).count({ c: '*' }).first();
  return mapHistoryDetail(m, Number(volunteers?.c || 0));
}

// Admin (panel) görünümü — tüm alanlar camelCase + cover URL + bekleyen foto sayısı.
function mapAdminMission(m) {
  return {
    id: m.id,
    title: m.title,
    fullTitle: m.full_title || m.title,
    shortLocation: m.short_location,
    regionLabel: m.region_label || '',
    il: m.il || null,
    ilce: m.ilce || null,
    // §11: bölge il alanından türer; panel "Tüm Bölgeler" görünümünde bununla gruplar.
    region: regionForCity(m.il),
    regionName: regionLabel(regionForCity(m.il)),
    locationLabel: m.location_label || m.short_location,
    description: m.description || '',
    iconName: m.icon_name,
    status: m.status,
    isActive: !!m.is_active,
    startDate: toDateOnly(m.start_date),
    endDate: toDateOnly(m.end_date),
    startedAt: toIso(m.started_at),
    endedAt: toIso(m.ended_at),
    coordinates: m.lat != null && m.lng != null ? { lat: Number(m.lat), lng: Number(m.lng) } : null,
    archivedAt: toIso(m.archived_at),
    // §1: sahadaki gönüllü sayısının tek kaynağı check-in kaydıdır; olay arşivlenince sıfırlanır.
    stats: { volunteers: m.status === 'archived' ? 0 : Number(m.on_site_count || 0) },
    cover: assetUrl(m.cover_path),
    pendingPhotos: Number(m.pending_photos || 0),
    createdAt: toIso(m.created_at),
  };
}

/** Admin (panel) — görev listesi. @param {{status?:string, isActive?:boolean, page?:number, pageSize?:number}} params */
async function adminList({ status, region, isActive, page = 1, pageSize = 20 } = {}) {
  const base = db('missions as m');
  if (status) base.where('m.status', status);
  if (isActive !== undefined) base.where('m.is_active', isActive);
  // Kapsam yalnızca görünümü süzer (§11); "Tüm Bölgeler"de hiçbir kayıt elenmez.
  applyRegionFilter(base, region, 'm.il');

  const [{ total }] = await base.clone().count({ total: 'm.id' });
  const rows = await base
    .clone()
    .select(
      'm.*',
      db.raw("(select count(*) from mission_photos mp where mp.mission_id = m.id and mp.status = 'pending') as pending_photos"),
      db.raw('(select count(*) from check_ins ci where ci.mission_id = m.id) as on_site_count'),
    )
    .orderBy([
      { column: 'm.created_at', order: 'desc' },
      { column: 'm.id', order: 'desc' }, // unique tie-breaker
    ])
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items: rows.map(mapAdminMission), total: Number(total), page, pageSize };
}

/** Admin (panel) — görev fotoğraf/moderasyon kuyruğu. @param {{status?:string}} params */
async function adminListPhotos(missionId, { status } = {}) {
  const mission = await db('missions').where({ id: missionId }).first('id', 'title');
  if (!mission) throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  const query = db('mission_photos as mp')
    .leftJoin('users as u', 'u.id', 'mp.user_id')
    .where('mp.mission_id', missionId)
    .select('mp.*', 'u.ad as user_ad', 'u.soyad as user_soyad')
    .orderBy('mp.submitted_at', 'desc');
  if (status) query.where('mp.status', status);

  const rows = await query;
  return {
    mission: { id: mission.id, title: mission.title },
    items: rows.map((p) => ({
      submissionId: p.id,
      kind: p.kind,
      status: p.status,
      url: assetUrl(p.file_path),
      submittedAt: toIso(p.submitted_at),
      reviewedAt: toIso(p.reviewed_at),
      user: p.user_id ? { userId: p.user_id, ad: p.user_ad, soyad: p.user_soyad } : null,
    })),
    total: rows.length,
  };
}

// ── Admin (panel) — olay kaydı yaşam döngüsü (§2) ────────────────────────────

/**
 * Olay kaydı oluşturur. Olay HER ZAMAN `active` durumunda başlar; `callVolunteers`
 * yalnızca gönüllü çağrısının hemen gidip gitmeyeceğini belirler, durumu etkilemez.
 * Toplanma noktası ZORUNLUDUR (§7): olaysız/noktasız kayıt oluşmaz, ikisi birlikte açılır.
 *
 * Bölge filtresi yalnızca GÖRÜNÜMÜ süzer, oluşturmayı engellemez (§11) — operatör
 * "Marmara" görünümündeyken "Ege"de olay açabilir.
 */
async function adminCreate(body, actor = {}) {
  const id = uuidv4();
  const now = new Date();

  await db.transaction(async (trx) => {
    await trx('missions').insert({
      id,
      title: body.title,
      full_title: body.fullTitle || null,
      short_location: body.shortLocation,
      region_label: body.regionLabel || null,
      location_label: body.locationLabel || null,
      description: body.description || null,
      icon_name: body.iconName || 'helmet',
      il: body.il || null,
      ilce: body.ilce || null,
      status: 'active',
      lat: body.coordinates?.lat ?? null,
      lng: body.coordinates?.lng ?? null,
      started_at: body.startedAt ? new Date(body.startedAt) : now,
      start_date: body.startDate || null,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    await trx('assembly_points').insert({
      id: uuidv4(),
      mission_id: id,
      name: body.assemblyPoint.name,
      address: body.assemblyPoint.address || null,
      lat: body.assemblyPoint.coordinates.lat,
      lng: body.assemblyPoint.coordinates.lng,
      is_open: true,
      created_at: now,
      updated_at: now,
    });

    // İhbardan olay oluşturulduysa bağ kalıcıdır ve ihbar "Doğrulandı" olur
    // (§5, mobil §7); bağın tek sahibi fire_reports.mission_id'dir.
    if (body.linkedReportIds?.length) {
      await trx('fire_reports')
        .whereIn('id', body.linkedReportIds)
        .update({ mission_id: id, status: 'confirmed', updated_at: now });
    }
  });

  let called = null;
  if (body.callVolunteers) called = await callReadyVolunteers(id, actor);

  await writeAudit({
    userId: actor.userId || null,
    action: 'missions.create',
    entity: 'mission',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { callVolunteers: !!body.callVolunteers, linkedReports: body.linkedReportIds?.length || 0 },
  });

  return { ok: true, missionId: id, status: 'active', called };
}

/**
 * Otomatik gönüllü çağrısı (§4) — olay Aktif olduğunda YALNIZCA `Hazır` gönüllülere
 * push gider; katılamayacak kişiye çağrı gönderilmez. Yarıçap admin'de GİRİLMEZ:
 * gönüllünün kendi mesafe tercihi (baz konumundan ölçülür) tek belirleyicidir.
 * Gönüllüler bölgeye göre SÜZÜLMEZ (§11): "şu bölgenin gönüllüsü" diye bir kavram yok.
 */
async function callReadyVolunteers(missionId, actor = {}) {
  const mission = await db('missions').where({ id: missionId }).first();
  if (!mission) throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  const target =
    mission.lat != null && mission.lng != null
      ? { lat: Number(mission.lat), lng: Number(mission.lng) }
      : null;

  // Gönüllüler bölgeye göre SÜZÜLMEZ (§11) — havuz her zaman tüm gönüllülerdir.
  const candidates = await db('users as u')
    .leftJoin('notification_preferences as np', 'np.user_id', 'u.id')
    .where({ 'u.is_guest': false, 'u.is_active': true })
    .whereNull('u.deleted_at')
    .select('u.id', 'np.distance_km', 'np.base_lat', 'np.base_lng');

  const now = new Date();
  let called = 0;
  let outOfRange = 0;
  let notReady = 0;
  let withoutBaseLocation = 0;

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const { kisiDurumu } = await readinessService.getReadiness(candidate.id);
    if (kisiDurumu !== 'hazir') {
      notReady += 1;
      continue;
    }

    const base =
      candidate.base_lat != null && candidate.base_lng != null
        ? { lat: Number(candidate.base_lat), lng: Number(candidate.base_lng) }
        : null;
    const reach = coversTarget(base, candidate.distance_km ?? null, target);
    if (!reach.covered) {
      outOfRange += 1;
      continue;
    }
    if (!reach.measurable) withoutBaseLocation += 1;

    // eslint-disable-next-line no-await-in-loop
    const existing = await db('mission_participants')
      .where({ user_id: candidate.id, mission_id: missionId })
      .first();
    if (!existing) {
      // eslint-disable-next-line no-await-in-loop
      await db('mission_participants').insert({
        id: uuidv4(),
        user_id: candidate.id,
        mission_id: missionId,
        status: 'cagrildi',
        called_at: now,
        joined_at: now,
      });
    }

    // eslint-disable-next-line no-await-in-loop
    await sendPushToUser(candidate.id, {
      topic: 'taskCalls',
      title: mission.title,
      body: 'Yeni bir yangın olayı için gönüllü çağrısı yapıldı.',
      data: { type: 'mission_call', missionId },
    });
    called += 1;
  }

  await writeAudit({
    userId: actor.userId || null,
    action: 'missions.call',
    entity: 'mission',
    entityId: missionId,
    payload: { called, outOfRange, notReady, withoutBaseLocation },
  });

  // withoutBaseLocation: mesafesi ölçülemediği için kapsayıcı davranışla çağrılanlar —
  // eksik veri sayı olarak görünür kalsın diye raporlanır.
  return { called, outOfRange, notReady, withoutBaseLocation };
}

/**
 * Arşivleme (§2) — operatör kararıdır, otomatik değişmez ve TERMİNALDİR: aynı kayıt
 * tekrar Aktif'e alınamaz. Yeniden alevlenirse yeni bir olay kaydı açılır.
 * Yeni gönüllü çağrısı durur, toplanma noktası kapanır, sahadaki gönüllüler `tamamladi`
 * olur ve görev geçmişine işlenir.
 */
async function adminArchive(missionId, actor = {}) {
  const mission = await db('missions').where({ id: missionId }).first();
  if (!mission) throw errors.notFound('Görev bulunamadı', 'mission_not_found');
  if (mission.status === 'archived') {
    throw errors.conflict('Olay zaten arşivlendi', undefined, 'already_archived');
  }

  const now = new Date();
  await db.transaction(async (trx) => {
    await trx('missions').where({ id: missionId }).update({
      status: 'archived',
      archived_at: now,
      ended_at: mission.ended_at || now,
      updated_at: now,
    });
    await trx('mission_participants')
      .where({ mission_id: missionId })
      .whereIn('status', ['cagrildi', 'yolda', 'sahada'])
      .update({ status: 'tamamladi', completed_at: now, updated_at: now });
    await assemblyPoints.close(missionId, trx);
  });

  await writeAudit({
    userId: actor.userId || null,
    action: 'missions.archive',
    entity: 'mission',
    entityId: missionId,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { ok: true, missionId, status: 'archived', archivedAt: toIso(now) };
}

/** Panel — olayın check-in listesi (kim, ne zaman, hangi yöntemle girdi). */
async function adminCheckIns(missionId) {
  const mission = await db('missions').where({ id: missionId }).first('id', 'title', 'status');
  if (!mission) throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  const rows = await db('check_ins as ci')
    .join('users as u', 'u.id', 'ci.user_id')
    .where('ci.mission_id', missionId)
    .orderBy('ci.checked_in_at', 'desc')
    .select('ci.*', 'u.ad', 'u.soyad', 'u.phone', 'u.stk_text');

  return {
    mission: { id: mission.id, title: mission.title, status: mission.status },
    onSite: mission.status === 'archived' ? 0 : rows.length,
    trend: await checkInTrend(missionId),
    items: rows.map((r) => ({
      userId: r.user_id,
      ad: r.ad,
      soyad: r.soyad,
      phone: r.phone,
      stk: r.stk_text || null,
      method: r.method,
      recordedBy: r.recorded_by || null,
      checkedInAt: toIso(r.checked_in_at),
    })),
  };
}

module.exports = {
  listActive,
  getActive,
  respond,
  scan,
  parseVolunteerQr,
  qrPayloadFor,
  sahadakiSayisi,
  checkInTrend,
  adminCreate,
  adminArchive,
  adminCheckIns,
  callReadyVolunteers,
  EVENT_STATUS,
  VOLUNTEER_SIGNALS,
  submitPhoto,
  moderatePhoto,
  listHistory,
  getHistory,
  adminList,
  adminListPhotos,
  mapAdminMission,
};
