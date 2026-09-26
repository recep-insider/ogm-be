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

// FCM'in "bu token artık bu uygulamaya ait değil" dediği hatalar (uygulama silindi,
// token döndü). Bu token'lara bir daha gönderilmez; kayıt silinir.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** Gönderim sonucundan ölü token'ları ayıklar. */
function deadTokens(tokens, responses) {
  return tokens.filter((_, i) => {
    const r = responses[i];
    return r && !r.success && DEAD_TOKEN_CODES.has(r.error?.code);
  });
}

async function deliver(tokens, payload) {
  const provider = env.push.provider.toLowerCase();
  if (provider === 'firebase') {
    const messaging = getFirebaseMessaging();
    const res = await messaging.sendEachForMulticast(buildMulticast(tokens, payload));
    const dead = deadTokens(tokens, res.responses || []);
    if (dead.length) {
      await db('devices').whereIn('fcm_token', dead).del();
      logger.info('Push: geçersiz token kayıtları silindi', { count: dead.length });
    }
    return { sent: res.successCount, failed: res.failureCount };
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
  // Acil çağrılar Android'de Doze'u delip hemen düşmeli.
  if (payload.topic === 'acil') message.android = { ...message.android, priority: 'high' };
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

module.exports = { sendPushToUser, stringifyData, buildMulticast, deadTokens };
