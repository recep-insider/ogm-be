'use strict';

const env = require('../config/env');
const logger = require('../config/logger');
const { db } = require('../config/db');

// topic → notification_preferences kolonu (Ek B.5).
// backend §4 / mobil §16: `acil` sınıfının kolonu YOKTUR — kapatılamaz ve gönüllünün
// bildirim tercihini bypass eder (tahliye, acil çağrı, toplanma noktası değişikliği).
const TOPIC_COLUMN = {
  acil: null,
  taskCalls: 'task_calls',
  trainings: 'trainings',
  announcements: 'announcements',
};

const URGENT_TOPICS = new Set(['acil', 'taskCalls']);

let firebaseMessaging = null;
function getFirebaseMessaging() {
  if (firebaseMessaging) return firebaseMessaging;
  // firebase-admin yalnızca gerçek sağlayıcıda yüklenir (opsiyonel bağımlılık).
  // eslint-disable-next-line global-require
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: env.firebase.credentialsPath
        ? admin.credential.cert(require(env.firebase.credentialsPath))
        : admin.credential.applicationDefault(),
      projectId: env.firebase.projectId || undefined,
    });
  }
  firebaseMessaging = admin.messaging();
  return firebaseMessaging;
}

// FCM HTTP v1'in "bu token bu uygulamaya ait değil" cevabı (uygulama silindi, token döndü).
const DEAD_TOKEN_CODE = 'messaging/registration-token-not-registered';
// Bozuk/biçimsiz token da v1'de `invalid-argument` döner — ama aynı kod bozuk bir
// *payload* için de her token'a döner. Bu yüzden yalnızca aynı gönderimde en az bir
// token başarılıysa (payload sağlamsa) token'a ait sayılır.
const MALFORMED_TOKEN_CODE = 'messaging/invalid-argument';

/** Gönderim sonucundan ölü token'ları ayıklar. */
function deadTokens(tokens, responses) {
  const payloadAccepted = responses.some((r) => r && r.success);
  return tokens.filter((_, i) => {
    const code = responses[i] && !responses[i].success ? responses[i].error?.code : undefined;
    return code === DEAD_TOKEN_CODE || (payloadAccepted && code === MALFORMED_TOKEN_CODE);
  });
}

async function deliver(tokens, payload) {
  const provider = env.push.provider.toLowerCase();
  if (provider === 'firebase') {
    const messaging = getFirebaseMessaging();
    const res = await messaging.sendEachForMulticast(buildMulticast(tokens, payload));
    const result = { sent: res.successCount, failed: res.failureCount };
    // Temizlik en iyi çaba: devices tablosundaki bir hata, gerçekten teslim edilmiş
    // bir push'u "gönderilemedi" diye raporlatmamalı.
    const dead = deadTokens(tokens, res.responses || []);
    if (dead.length) {
      try {
        await db('devices').whereIn('fcm_token', dead).del();
        logger.info('Push: geçersiz token kayıtları silindi', { count: dead.length });
      } catch (err) {
        logger.warn('Push: geçersiz token temizliği başarısız', { count: dead.length, error: err.message });
      }
    }
    return result;
  }
  logger.info('PUSH [MOCK] gönderildi', { tokenCount: tokens.length, ...payload });
  return { sent: tokens.length, failed: 0, mock: true };
}

/**
 * FCM data değerleri string olmak zorunda. Boş (undefined/null) anahtarlar hiç yazılmaz —
 * aksi halde istemciye "undefined"/"null" metni gider.
 */
function stringifyData(data) {
  if (!data) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

/**
 * FCM multicast mesajı. Android kanalı varsayılan olarak topic adıyla birebir aynıdır
 * (acil | taskCalls | trainings | announcements) — mobil bu kanalları önceden açar.
 * `channelId` verilirse o kullanılır: tercih filtresi topic'e göre işlerken bildirim
 * mobilin ayrı açtığı bir kanala düşebilir (ör. `fire-report-confirmed`).
 */
function buildMulticast(tokens, payload) {
  const message = {
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: stringifyData(payload.data),
  };
  const channelId = payload.channelId || payload.topic;
  if (channelId) message.android = { notification: { channelId } };
  // Acil durumlar ve görev çağrıları Android'de Doze'u delip hemen düşmeli;
  // eğitim/duyuru bildirimleri normal öncelikte kalır.
  if (URGENT_TOPICS.has(payload.topic)) message.android = { ...message.android, priority: 'high' };
  // iOS'ta `sound` verilmezse bildirim sessiz gelir.
  message.apns = { payload: { aps: { sound: 'default' } } };
  return message;
}

/**
 * Tek kullanıcıya, topic opt-in'ine saygı göstererek push gönderir.
 * @param {string} userId
 * @param {{topic: 'acil'|'taskCalls'|'trainings'|'announcements', channelId?: string, title: string, body: string, data?: object}} payload
 */
async function sendPushToUser(userId, payload) {
  const column = TOPIC_COLUMN[payload.topic];
  if (column) {
    const prefs = await db('notification_preferences').where({ user_id: userId }).first();
    // Tercih kaydı yoksa varsayılan: gönder. Kayıt varsa ve kapalıysa atla.
    if (prefs && !prefs[column]) {
      logger.debug('Push atlandı (topic opt-out)', { userId, topic: payload.topic });
      return { sent: 0, skipped: true };
    }
  }

  const tokens = await db('devices').where({ user_id: userId }).pluck('fcm_token');
  if (!tokens.length) return { sent: 0, noDevices: true };

  try {
    return await deliver(tokens, payload);
  } catch (err) {
    logger.warn('Push gönderilemedi', { userId, topic: payload.topic, error: err.message });
    return { sent: 0, error: err.message };
  }
}

/**
 * Açılışta push sağlayıcısını doğrular. Gerçek sağlayıcıda anahtar dosyası
 * okunamıyorsa bu, ilk acil bildirimde değil burada, tek ve açık bir hatayla görünür.
 */
function verifyPushProvider() {
  const provider = env.push.provider.toLowerCase();
  if (provider !== 'firebase') {
    logger.info('Push sağlayıcısı: mock (gerçek bildirim gönderilmez)');
    return { provider, ok: true };
  }
  try {
    getFirebaseMessaging();
    logger.info('Push sağlayıcısı: firebase', { projectId: env.firebase.projectId || undefined });
    return { provider, ok: true };
  } catch (err) {
    logger.error('Push sağlayıcısı firebase ama başlatılamadı — bildirimler GİTMEYECEK', {
      credentialsPath: env.firebase.credentialsPath || undefined,
      error: err.message,
    });
    return { provider, ok: false };
  }
}

module.exports = { sendPushToUser, stringifyData, buildMulticast, deadTokens, verifyPushProvider };
