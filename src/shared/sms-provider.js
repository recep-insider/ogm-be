'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('../config/logger');

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

async function sendMock(phone, message) {
  logger.info('SMS [MOCK] gönderildi', { phone, message });
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

/** Sağlayıcı seçimi — dummy telefonlar ve bilinmeyen sağlayıcı mock'a düşer. */
async function sendSms(phone, message) {
  if (!phone) throw new Error('SMS için telefon numarası gerekli');
  if (env.sms.dummyPhones.includes(phone)) {
    logger.info('SMS atlandı (dummy phone)', { phone });
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

async function sendOtp(phone, code) {
  return sendSms(phone, OTP_TEMPLATE(code));
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
    logger.error('İşlemsel SMS gönderilemedi', { templateKey, phone, error: err.message });
    return { sent: false, reason: 'provider_error' };
  }
}

module.exports = { sendOtp, sendSms, sendTransactional, OTP_TEMPLATE, SMS_TEMPLATES };
