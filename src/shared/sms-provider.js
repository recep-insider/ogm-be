'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('../config/logger');
const { redis } = require('../config/redis');
const { hitFixedWindow } = require('./fixed-window');
const { errors } = require('./errors');

const DAILY_OTP_PREFIX = 'rl:sms:otp:daily:';
// Sağlayıcı hatasında harcanan hak iade edilir; süresi dolmuş/olmayan sayaç yaratılmaz, 0'ın altına inmez.
const REFUND_OTP = "local n = tonumber(redis.call('get', KEYS[1])) if n and n > 0 then return redis.call('decr', KEYS[1]) end return 0";

const OTP_TEMPLATE = (code) =>
  `OGM Gönüllü doğrulama kodunuz: ${code}. Bu kodu kimseyle paylaşmayın.`;

// backend-gereksinimleri.md §7.1/§7.2 — işlemsel SMS şablonları. İçerik sabittir,
// operatör serbest metin yazmaz; ret gerekçesi metne girmez.
const SMS_TEMPLATES = {
  applicationReceived:
    'OGM Orman Yangını Gönüllüsü başvurunuz alınmıştır. Süreci mobil uygulamadan takip edebilirsiniz.',
  commissionApproved:
    'OGM Orman Yangını Gönüllüsü başvurunuz Bölge Müdürlüğü Komisyonunca onaylanmıştır. Sıradaki adımınız teorik eğitim — detaylar için mobil uygulamayı kontrol edin.',
  commissionRejected:
    'OGM Orman Yangını Gönüllüsü başvurunuz Bölge Müdürlüğü Komisyonunca değerlendirilmiştir; bu aşamada onaylanmamıştır. Detaylar için mobil uygulamayı kontrol edin.',
};

// Loglarda telefonun yalnız son 4 hanesi kalır; SMS metni loglanmaz (OTP kodu yalnız üretim dışı mock'ta, sendOtp).
function maskPhone(phone) {
  return phone ? `***${String(phone).slice(-4)}` : phone;
}

async function sendMock(phone) {
  logger.info('SMS [MOCK] gönderildi', { phone: maskPhone(phone) });
  return { providerMessageId: `mock-${Date.now()}` };
}

async function sendNetgsm(phone, message) {
  if (!env.sms.apiKey || !env.sms.apiSecret) {
    throw new Error('NetGSM SMS_API_KEY / SMS_API_SECRET tanımlı değil');
  }
  const url = `${env.sms.apiUrl}/sms/send/get`;
  const params = {
    usercode: env.sms.apiKey,
    password: env.sms.apiSecret,
    gsmno: phone.replace(/^\+/, ''),
    message,
    msgheader: env.sms.senderId,
    dil: 'TR',
  };
  const { data } = await axios.get(url, { params, timeout: 10_000 });
  const ok = typeof data === 'string' ? data.startsWith('00') : false;
  if (!ok) {
    throw new Error(`NetGSM hata: ${data}`);
  }
  const id = String(data).split(' ')[1] || `netgsm-${Date.now()}`;
  return { providerMessageId: id };
}

// Bilinmeyen sağlayıcı da mock'a düşer (sendSms).
function isMockProvider() {
  return env.sms.provider.toLowerCase() !== 'netgsm';
}

/** Sağlayıcı seçimi — dummy telefonlar ve bilinmeyen sağlayıcı mock'a düşer. */
async function sendSms(phone, message) {
  if (!phone) throw new Error('SMS için telefon numarası gerekli');
  if (env.sms.dummyPhones.includes(phone)) {
    logger.info('SMS atlandı (dummy phone)', { phone: maskPhone(phone) });
    return { providerMessageId: `dummy-${Date.now()}`, dummy: true };
  }

  const provider = env.sms.provider.toLowerCase();
  switch (provider) {
    case 'mock':
      return sendMock(phone, message);
    case 'netgsm':
      return sendNetgsm(phone, message);
    default:
      logger.warn('Bilinmeyen SMS sağlayıcı, mock kullanılıyor', { provider });
      return sendMock(phone, message);
  }
}

async function refundDailyOtp(key, phone) {
  try {
    await redis.eval(REFUND_OTP, 1, key);
  } catch (err) {
    logger.warn('Günlük OTP sayacı iade edilemedi', { phone: maskPhone(phone), error: err.message });
  }
}

// Üretimde mock sağlayıcı kodu ne gönderir ne loglar: test numarası dışındaki giriş sessizce düşmesin.
// Oturum yazılmadan ve kota harcanmadan önce çağrılır.
function assertOtpDeliverable(phone) {
  if (env.nodeEnv === 'production' && isMockProvider() && !env.sms.dummyPhones.includes(phone)) {
    throw errors.make(503, 'sms_unavailable', 'SMS servisi henüz bağlı değil; şu an yalnız test numaralarıyla giriş yapılabilir.');
  }
}

// Günlük OTP SMS limiti (SMS_DAILY_LIMIT_PER_USER) burada uygulanır: tüm OTP akışları buradan geçer.
// Kullanıcı kimliği olmayan giriş akışlarında da geçerli olsun diye hedef telefon başınadır.
async function sendOtp(phone, code) {
  assertOtpDeliverable(phone);
  const key = phone && !env.sms.dummyPhones.includes(phone) ? `${DAILY_OTP_PREFIX}${phone}` : null;
  if (key) {
    await hitFixedWindow(redis, key, {
      max: env.sms.dailyLimitPerUser,
      windowSec: 86400,
      message: 'Günlük SMS limitine ulaşıldı, lütfen daha sonra tekrar deneyin',
      code: 'sms_daily_limit',
    });
  }
  if (env.nodeEnv !== 'production' && isMockProvider()) {
    logger.info('OTP [MOCK] — yerel geliştirme', { phone: maskPhone(phone), code });
  }
  try {
    return await sendSms(phone, OTP_TEMPLATE(code));
  } catch (err) {
    if (key) await refundDailyOtp(key, phone);
    throw err;
  }
}

/**
 * İşlemsel SMS — gönderim hatası çağıran akışı DÜŞÜRMEZ (başvuru kaydı ve komisyon
 * kararı SMS'ten önce kalıcıdır); hata loglanır ve sonuç `sent:false` döner.
 * @param {string} phone
 * @param {keyof typeof SMS_TEMPLATES} templateKey
 */
async function sendTransactional(phone, templateKey) {
  const message = SMS_TEMPLATES[templateKey];
  if (!message) throw new Error(`Bilinmeyen SMS şablonu: ${templateKey}`);
  if (!phone) {
    logger.warn('İşlemsel SMS atlandı — telefon yok', { templateKey });
    return { sent: false, reason: 'no_phone' };
  }
  try {
    const result = await sendSms(phone, message);
    return { sent: true, sentAt: new Date(), ...result };
  } catch (err) {
    logger.error('İşlemsel SMS gönderilemedi', { templateKey, phone: maskPhone(phone), error: err.message });
    return { sent: false, reason: 'provider_error' };
  }
}

module.exports = { sendOtp, sendSms, sendTransactional, assertOtpDeliverable, maskPhone, OTP_TEMPLATE, SMS_TEMPLATES };
