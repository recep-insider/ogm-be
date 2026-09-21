'use strict';

// backend-gereksinimleri.md §4 — operatörün ELLE gönderdiği bildirim.
//
// Kanal KATEGORİDEN TÜRER, operatör seçmez: SMS yalnızca `acil` sınıfına gider, diğer
// her şey push. `acil` kapatılamaz ve gönüllünün bildirim tercihini bypass eder.
// Yarıçap admin'de GİRİLMEZ — elle gönderimde hedef kitle segmentle belirlenir
// (mesafe tercihi otomatik çağrının kuralıdır, §4 "Hedef kitle (otomatik tetikleyici)").

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');
const { sendPushToUser } = require('../../shared/push-provider');
const { sendSms } = require('../../shared/sms-provider');
const { toIso } = require('../../shared/dates');
const logger = require('../../config/logger');
const readinessService = require('../users/readiness.service');

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

/** Olay bazlı hedef kitle: seçilen durumlardaki katılımcılar + `hazir` gönüllüler. */
async function resolveEventTargets(missionId, segments) {
  const mission = await db('missions').where({ id: missionId }).first('id', 'title');
  if (!mission) throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  const statuses = segments.filter((s) => EVENT_SEGMENTS.includes(s));
  const ids = new Set();

  if (statuses.length) {
    const rows = await db('mission_participants')
      .where({ mission_id: missionId })
      .whereIn('status', statuses)
      .pluck('user_id');
    for (const id of rows) ids.add(id);
  }

  // "Hazır" segmenti olay katılımından bağımsızdır: henüz çağrılmamış hazır gönüllü de
  // toplanma noktası değişikliği gibi duyuruları almalı.
  if (segments.includes('hazir')) {
    for (const id of await readyVolunteerIds()) ids.add(id);
  }

  return [...ids];
}

async function readyVolunteerIds() {
  const candidates = await db('users')
    .where({ is_guest: false, is_active: true })
    .whereNull('deleted_at')
    .pluck('id');
  const out = [];
  for (const id of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const { kisiDurumu } = await readinessService.getReadiness(id);
    if (kisiDurumu === 'hazir') out.push(id);
  }
  return out;
}

/** Genel hedef kitle: Hazır · Eğitim Bekleyenler · Tüm Gönüllüler. */
async function resolveGeneralTargets(audience) {
  const all = await db('users')
    .where({ is_guest: false, is_active: true })
    .whereNull('deleted_at')
    .pluck('id');
  if (audience === 'tumu') return all;

  const out = [];
  for (const id of all) {
    // eslint-disable-next-line no-await-in-loop
    const { kisiDurumu, zincir } = await readinessService.getReadiness(id);
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

  let targets;
  let targetDoc;
  if (input.missionId) {
    const segments = input.segments?.length ? input.segments : ['hazir'];
    targets = await resolveEventTargets(input.missionId, segments);
    targetDoc = { kind: 'event', missionId: input.missionId, segments };
  } else {
    const audience = input.audience || 'hazir';
    if (!GENERAL_AUDIENCES.includes(audience)) {
      throw errors.validation('Geçersiz hedef kitle', { audience, allowed: GENERAL_AUDIENCES });
    }
    targets = await resolveGeneralTargets(audience);
    targetDoc = { kind: 'general', audience };
  }

  let pushCount = 0;
  let smsCount = 0;
  for (const userId of targets) {
    // eslint-disable-next-line no-await-in-loop
    await sendPushToUser(userId, {
      topic: channel.topic,
      title: input.title,
      body: input.body,
      data: { type: 'operator_notification', category: input.category, missionId: input.missionId },
    });
    pushCount += 1;

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

  const id = uuidv4();
  const sentAt = new Date();
  await db('notification_log').insert({
    id,
    category: input.category,
    title: input.title,
    body: input.body,
    mission_id: input.missionId || null,
    target: JSON.stringify(targetDoc),
    push_count: pushCount,
    sms_count: smsCount,
    sent_by: actor.name || 'Operatör',
    sent_at: sentAt,
    created_at: sentAt,
    updated_at: sentAt,
  });

  await writeAudit({
    userId: actor.userId || null,
    action: 'notifications.send',
    entity: 'notification',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { category: input.category, target: targetDoc, pushCount, smsCount },
  });

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
      sentBy: r.sent_by,
      sentAt: toIso(r.sent_at),
    })),
    total: Number(total),
    page,
    pageSize,
  };
}

module.exports = { send, history, CATEGORY_CHANNEL, EVENT_SEGMENTS, GENERAL_AUDIENCES };
