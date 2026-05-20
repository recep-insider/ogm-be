'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('../config/logger');

const OTP_TEMPLATE = (code) =>
  `OGM Gönüllü doğrulama kodunuz: ${code}. Bu kodu kimseyle paylaşmayın.`;

async function sendOtpMock(phone, code) {
  logger.info('SMS [MOCK] gönderildi', { phone, code });
  return { providerMessageId: `mock-${Date.now()}` };
}

async function sendOtpNetgsm(phone, code) {
  if (!env.sms.apiKey || !env.sms.apiSecret) {
    throw new Error('NetGSM SMS_API_KEY / SMS_API_SECRET tanımlı değil');
  }
  const url = `${env.sms.apiUrl}/sms/send/get`;
  const params = {
    usercode: env.sms.apiKey,
    password: env.sms.apiSecret,
    gsmno: phone.replace(/^\+/, ''),
    message: OTP_TEMPLATE(code),
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

async function sendOtp(phone, code) {
  if (env.sms.dummyPhones.includes(phone)) {
    logger.info('SMS atlandı (dummy phone)', { phone });
    return { providerMessageId: `dummy-${Date.now()}`, dummy: true };
  }

  const provider = env.sms.provider.toLowerCase();
  switch (provider) {
    case 'mock':
      return sendOtpMock(phone, code);
    case 'netgsm':
      return sendOtpNetgsm(phone, code);
    default:
      logger.warn('Bilinmeyen SMS sağlayıcı, mock kullanılıyor', { provider });
      return sendOtpMock(phone, code);
  }
}

module.exports = { sendOtp, OTP_TEMPLATE };
