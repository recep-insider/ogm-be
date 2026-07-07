'use strict';

const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { redis } = require('../../config/redis');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { errors } = require('../../shared/errors');
const { toIso } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');
const { sendPushToUser } = require('../../shared/push-provider');
const { assetUrl } = require('../../shared/asset-url');

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapReport(row) {
  return {
    id: row.id,
    locationName: row.location_name || '',
    regionLabel: row.region_label || '',
    status: row.status,
    submittedAt: toIso(row.created_at),
    coordinates: { lat: Number(row.latitude), lng: Number(row.longitude) },
    needs: safeJson(row.needs, []),
  };
}

// Koordinattan locationName/regionLabel türet (Nominatim varsa, yoksa placeholder).
async function reverseGeocode(lat, lng) {
  if (!env.geo.nominatimUrl) {
    return { locationName: 'Bilinmeyen Konum', regionLabel: `${lat.toFixed(2)}, ${lng.toFixed(2)}` };
  }
  try {
    const { data } = await axios.get(`${env.geo.nominatimUrl.replace(/\/$/, '')}/reverse`, {
      params: { lat, lon: lng, format: 'jsonv2' },
      timeout: 8000,
      headers: { 'User-Agent': 'ogm-gonullu-api' },
    });
    const a = data.address || {};
    const locationName = data.name || a.neighbourhood || a.suburb || a.village || a.town || a.city || 'Bilinmeyen Konum';
    const region = [a.state || a.province, a.county || a.town || a.city].filter(Boolean).join(' / ');
    return { locationName, regionLabel: region || locationName };
  } catch (err) {
    logger.warn('Reverse geocode başarısız', { error: err.message });
    return { locationName: 'Bilinmeyen Konum', regionLabel: `${lat.toFixed(2)}, ${lng.toFixed(2)}` };
  }
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
  const { locationName, regionLabel } = await reverseGeocode(lat, lng);
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
    needs: JSON.stringify(data.needs || []),
    location_name: locationName,
    region_label: regionLabel,
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
  return { ok: true, report: mapReport(row) };
}

async function listMine(userId) {
  const rows = await db('fire_reports')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc');
  return rows.map(mapReport);
}

// Admin (panel) — status geçişi + reporter'a push (mobil app çağırmaz).
async function adminSetStatus(id, { status, note }, actor = {}) {
  const row = await db('fire_reports').where({ id }).first();
  if (!row) throw errors.notFound('Bildirim bulunamadı', 'not_found');

  await db('fire_reports').where({ id }).update({ status, updated_at: new Date() });

  await writeAudit({
    userId: actor.userId || null,
    action: 'fire_reports.status',
    entity: 'fire_report',
    entityId: id,
    payload: { status, note },
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
  return { ok: true, report: mapReport(updated) };
}

// Admin (panel) liste/detay görünümü — mapReport + medya, ihbarcı ve açıklama.
// İhbarcı bilgisi yalnızca anonim DEĞİLSE döner; ip sadece detayda (includeIp).
function mapAdminReport(row, { includeIp = false } = {}) {
  const report = {
    ...mapReport(row),
    description: row.description || '',
    anonymous: !!row.anonymous,
    photoUrls: safeJson(row.photo_paths, []).map(assetUrl),
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

/** Admin (panel) — ihbar listesi. @param {{status?:string, page?:number, pageSize?:number}} params */
async function adminList({ status, page = 1, pageSize = 20 } = {}) {
  const base = db('fire_reports as fr');
  if (status) base.where('fr.status', status);

  const [{ total }] = await base.clone().count({ total: 'fr.id' });
  const rows = await base
    .clone()
    .leftJoin('users as u', 'u.id', 'fr.user_id')
    .select('fr.*', ...REPORTER_COLUMNS)
    .orderBy([
      { column: 'fr.created_at', order: 'desc' },
      { column: 'fr.id', order: 'desc' }, // unique tie-breaker
    ])
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items: rows.map((r) => mapAdminReport(r)), total: Number(total), page, pageSize };
}

/** Admin (panel) — ihbar detayı (+ip). */
async function adminGetById(id) {
  const row = await db('fire_reports as fr')
    .leftJoin('users as u', 'u.id', 'fr.user_id')
    .select('fr.*', ...REPORTER_COLUMNS)
    .where('fr.id', id)
    .first();
  if (!row) throw errors.notFound('Bildirim bulunamadı', 'not_found');
  return mapAdminReport(row, { includeIp: true });
}

module.exports = { create, listMine, adminSetStatus, adminList, adminGetById, mapReport, mapAdminReport };
