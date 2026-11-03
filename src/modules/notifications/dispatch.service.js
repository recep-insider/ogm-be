'use strict';

// backend-gereksinimleri.md §4 — operatörün ELLE gönderdiği bildirim.
//
// Kanal KATEGORİDEN TÜRER, operatör seçmez: SMS yalnızca `acil` sınıfına gider, diğer
// her şey push. `acil` kapatılamaz ve gönüllünün konu (topic) tercihini bypass eder.
// Yarıçap admin'de GİRİLMEZ. Hedef kitle tek bir küme ifadesidir (K6, K8):
//   olaya bağlı:  (seçilen olay durumlarındaki katılımcılar; mesafeden ve bölgeden bağımsız)
//                 ∪ (Hazır ∧ mesafe tercihi olayı kapsıyor ∧ seçili bölgede)   — Acil dahil
//   olaysız:      seçilen kitle ∧ seçili bölgede
// Bölge verilmemişse ya da "Tüm Bölgeler" (`all`) ise bölge süzmesi yoktur.

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');
const { sendPushToUser } = require('../../shared/push-provider');
const { sendSms } = require('../../shared/sms-provider');
const { toIso } = require('../../shared/dates');
const logger = require('../../config/logger');
const readinessService = require('../users/readiness.service');
const { applyRegionFilter } = require('../../shared/regions');
const { coversTarget } = require('../../shared/geo-distance');

// Kategori → kanal + push topic. `acil` topic'inin tercih kolonu yoktur (kapatılamaz).
const CATEGORY_CHANNEL = {
  acil: { sms: true, topic: 'acil' },
  gorev: { sms: false, topic: 'taskCalls' },
  egitim: { sms: false, topic: 'trainings' },
  bilgi: { sms: false, topic: 'announcements' },
};

// Olay bazlı segmentler — gönüllünün o olaydaki durumu (§3).
const EVENT_SEGMENTS = ['cagrildi', 'yolda', 'sahada'];
// Genel segmentler — kişi durumundan türer, bölgeden bağımsızdır (§11).
const GENERAL_AUDIENCES = ['hazir', 'egitim_bekleyen', 'tumu'];

/** Olay bazlı hedef kitle: seçilen durumlardaki katılımcılar ∪ olayı kapsayan, bölgedeki `hazir` gönüllüler. */
async function resolveEventTargets(missionId, segments, region) {
  const mission = await db('missions').where({ id: missionId }).first('id', 'title', 'lat', 'lng');
  if (!mission) throw errors.notFound('Görev bulunamadı', 'mission_not_found');
  const target = mission.lat != null && mission.lng != null
    ? { lat: Number(mission.lat), lng: Number(mission.lng) }
    : null;

  const statuses = segments.filter((s) => EVENT_SEGMENTS.includes(s));
  const ids = new Set();

  if (statuses.length) {
    // Silinen (KVKK) hesap katılımcı satırında kalır; bildirim almamalı.
    const rows = await db('mission_participants as mp')
      .join('users as u', 'u.id', 'mp.user_id')
      .where('mp.mission_id', missionId)
      .whereIn('mp.status', statuses)
      .whereNull('u.deleted_at')
      .pluck('mp.user_id');
    for (const id of rows) ids.add(id);
  }

  // "Hazır" segmenti olay katılımından bağımsızdır: henüz çağrılmamış hazır gönüllü de
  // toplanma noktası değişikliği gibi duyuruları almalı.
  if (segments.includes('hazir')) {
    for (const id of await readyVolunteerIds(region, target)) ids.add(id);
  }

  return [...ids];
}

function activeVolunteers(region) {
  const query = db('users as u')
    .where({ 'u.is_guest': false, 'u.is_active': true })
    .whereNull('u.deleted_at');
  return applyRegionFilter(query, region, 'u.il');
}

/** Bölgedeki `hazir` gönüllüler; olay koordinatı verilirse yalnız mesafe tercihi onu kapsayanlar. */
async function readyVolunteerIds(region, target) {
  const candidates = await activeVolunteers(region)
    .leftJoin('notification_preferences as np', 'np.user_id', 'u.id')
    .select('u.id', 'np.distance_km', 'np.base_lat', 'np.base_lng');
  const readiness = await readinessService.getReadinessMany(candidates.map((c) => c.id));
  return candidates
    .filter((c) => {
      if (readiness.get(c.id).kisiDurumu !== 'hazir') return false;
      const base = c.base_lat != null && c.base_lng != null
        ? { lat: Number(c.base_lat), lng: Number(c.base_lng) }
        : null;
      return coversTarget(base, c.distance_km ?? null, target).covered;
    })
    .map((c) => c.id);
}

/** Genel hedef kitle: Hazır · Eğitim Bekleyenler · Tüm Gönüllüler — seçili bölgede. */
async function resolveGeneralTargets(audience, region) {
  const all = await activeVolunteers(region).pluck('u.id');
  if (audience === 'tumu') return all;

  const readiness = await readinessService.getReadinessMany(all);
  const out = [];
  for (const id of all) {
    const { kisiDurumu, zincir } = readiness.get(id);
    if (audience === 'hazir' && kisiDurumu === 'hazir') out.push(id);
    // Eğitim bekleyen: komisyonu onaylı ama teorik/uygulamalı adımı açık olan gönüllü.
    if (
      audience === 'egitim_bekleyen' &&
      zincir.komisyon === 'approved' &&
      zincir.eksikAdimlar.some((step) => step === 'teorik' || step === 'uygulamali')
    ) {
      out.push(id);
    }
  }
  return out;
}

/**
 * Bildirimi gönderir ve denetim izine yazar.
 *
 * @param {{category:string, title:string, body:string, missionId?:string,
 *          segments?:string[], audience?:string}} input
 */
async function send(input, actor = {}) {
  const channel = CATEGORY_CHANNEL[input.category];
  if (!channel) {
    throw errors.validation('Geçersiz bildirim kategorisi', {
      category: input.category,
      allowed: Object.keys(CATEGORY_CHANNEL),
    });
  }

  const region = input.region && input.region !== 'all' ? input.region : null;
  let targets;
  let targetDoc;
  if (input.missionId) {
    const segments = input.segments?.length ? input.segments : ['hazir'];
    targets = await resolveEventTargets(input.missionId, segments, region);
    targetDoc = { kind: 'event', missionId: input.missionId, segments };
  } else {
    const audience = input.audience || 'hazir';
    if (!GENERAL_AUDIENCES.includes(audience)) {
      throw errors.validation('Geçersiz hedef kitle', { audience, allowed: GENERAL_AUDIENCES });
    }
    targets = await resolveGeneralTargets(audience, region);
    targetDoc = { kind: 'general', audience };
  }
  if (region) targetDoc.region = region;

  // Kayıt gönderimden ÖNCE yazılır: push verisindeki notificationId'yi mobil açılışta geri
  // bildirir (K5) ve gönderim yarıda kalsa da denetim izi kalır. Sayılar sonra güncellenir.
  const id = uuidv4();
  const sentAt = new Date();
  await db('notification_log').insert({
    id,
    category: input.category,
    title: input.title,
    body: input.body,
    mission_id: input.missionId || null,
    target: JSON.stringify(targetDoc),
    push_count: 0,
    sms_count: 0,
    sent_by: actor.name || 'Operatör',
    sent_at: sentAt,
    created_at: sentAt,
    updated_at: sentAt,
  });

  let pushCount = 0;
  let smsCount = 0;
  let completed = false;
  try {
    for (const userId of targets) {
      // eslint-disable-next-line no-await-in-loop
      const push = await sendPushToUser(userId, {
        topic: channel.topic,
        title: input.title,
        body: input.body,
        data: { type: 'operator_notification', category: input.category, missionId: input.missionId, notificationId: id },
      });
      // Yalnız sağlayıcının kabul ettiği teslim sayılır: cihazsız, tercihle atlanan,
      // hatalı ve mock gönderim "gönderildi" değildir.
      if (push?.sent > 0 && !push.mock) pushCount += 1;

      if (channel.sms) {
        // eslint-disable-next-line no-await-in-loop
        const phone = await db('users').where({ id: userId }).first('phone');
        if (phone?.phone) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await sendSms(phone.phone, `${input.title}. ${input.body}`);
            smsCount += 1;
          } catch (err) {
            logger.error('Acil SMS gönderilemedi', { userId, error: err.message });
          }
        }
      }
    }
    completed = true;
  } finally {
    // Gönderim yarıda kesilse de giden sayılar ve denetim izi yazılır: aksi halde kayıt 0 gösterir,
    // görevli bildirimi tekrar gönderir. Bu kayıt düşerse asıl hatayı gizlemez, loglanır.
    try {
      await db('notification_log')
        .where({ id })
        .update({ push_count: pushCount, sms_count: smsCount, updated_at: new Date() });

      await writeAudit({
        userId: actor.userId || null,
        action: 'notifications.send',
        entity: 'notification',
        entityId: id,
        ip: actor.ip,
        userAgent: actor.userAgent,
        payload: {
          category: input.category,
          target: targetDoc,
          recipients: targets.length,
          pushCount,
          smsCount,
          ...(completed ? {} : { incomplete: true }),
        },
      });
    } catch (err) {
      logger.error('Bildirim sayıları kaydedilemedi', { notificationId: id, pushCount, smsCount, error: err.message });
    }
  }

  return {
    ok: true,
    notificationId: id,
    category: input.category,
    channel: channel.sms ? 'sms+push' : 'push',
    recipients: targets.length,
    pushCount,
    smsCount,
    sentAt: toIso(sentAt),
  };
}

/** Panel — gönderim geçmişi (denetim izi). */
async function history({ page = 1, pageSize = 20 } = {}) {
  const base = db('notification_log');
  const [{ total }] = await base.clone().count({ total: 'id' });
  const rows = await base
    .clone()
    .select(
      'notification_log.*',
      db.raw('(select count(*) from notification_opens o where o.notification_id = notification_log.id) as open_count'),
    )
    .orderBy([
      { column: 'sent_at', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map((r) => ({
      id: r.id,
      category: r.category,
      channel: CATEGORY_CHANNEL[r.category]?.sms ? 'sms+push' : 'push',
      title: r.title,
      body: r.body,
      missionId: r.mission_id || null,
      target: typeof r.target === 'string' ? JSON.parse(r.target) : r.target,
      pushCount: r.push_count,
      smsCount: r.sms_count,
      // K5: bildirime dokunup uygulamayı açan tekil gönüllü sayısı.
      openCount: Number(r.open_count || 0),
      sentBy: r.sent_by,
      sentAt: toIso(r.sent_at),
    })),
    total: Number(total),
    page,
    pageSize,
  };
}

module.exports = { send, history, CATEGORY_CHANNEL, EVENT_SEGMENTS, GENERAL_AUDIENCES };
