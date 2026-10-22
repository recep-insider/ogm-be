'use strict';

// bcrypt native binding'i bu test makinesinde yüklenemiyor; getOtpForPhone onu
// kullanmıyor (yalnızca require zincirinde geliyor), bu yüzden factory ile
// mock'layıp gerçek modülün hiç yüklenmemesini sağlıyoruz.
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));
jest.mock('../../../src/config/redis', () => {
  const redis = require('../admin/panel-fakes').createFakeRedis();
  redis.set = jest.fn(async () => 'OK');
  return { redis };
});
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

describe('phone.service — getOtpForPhone / isDummyPhone', () => {
  let env;
  let svc;

  beforeEach(() => {
    jest.resetModules();
    env = require('../../../src/config/env');
    svc = require('../../../src/modules/auth/phone.service');
  });

  test('isDummyPhone yalnızca yapılandırılmış numaraları tanır', () => {
    env.sms.dummyPhones = ['+905555555555'];
    expect(svc.isDummyPhone('+905555555555')).toBe(true);
    expect(svc.isDummyPhone('+905321112233')).toBe(false);
  });

  test('getOtpForPhone dummy numara için sabit kodu döner', () => {
    env.sms.dummyPhones = ['+905555555555'];
    env.sms.dummyCode = '123456';
    expect(svc.getOtpForPhone('+905555555555')).toBe('123456');
  });

  test('getOtpForPhone normal numara için otpLength uzunluğunda rakamsal kod üretir', () => {
    env.sms.dummyPhones = [];
    env.sms.otpLength = 6;

    const code = svc.getOtpForPhone('+905321112233');

    expect(code).toMatch(/^\d{6}$/);
  });
});

describe('phone.service — sendOtpFlow limitleri', () => {
  let env;
  let logger;
  let redis;
  let svc;
  const PHONE = '+905321112233';

  beforeEach(() => {
    jest.resetModules();
    env = require('../../../src/config/env');
    logger = require('../../../src/config/logger');
    ({ redis } = require('../../../src/config/redis'));
    svc = require('../../../src/modules/auth/phone.service');
    env.sms.dummyPhones = [];
    env.sms.provider = 'mock';
    env.sms.dailyLimitPerUser = 10;
  });

  test('telefon başına saatlik sayaç TTL ile atomik artar; 6. istek 429 rate_limited', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await svc.sendOtpFlow({ phone: PHONE, ip: '1.2.3.4' });
    }
    await expect(svc.sendOtpFlow({ phone: PHONE, ip: '1.2.3.4' })).rejects.toMatchObject({
      status: 429, code: 'rate_limited',
    });
    expect(await redis.ttl(`rl:otp:phone:${PHONE}`)).toBe(3600);
    expect(await redis.ttl('rl:otp:ip:1.2.3.4')).toBe(3600);
  });

  test('günlük SMS limiti 500e dönüşmeden 429 sms_daily_limit olarak döner', async () => {
    env.sms.dailyLimitPerUser = 0;

    await expect(svc.sendOtpFlow({ phone: PHONE })).rejects.toMatchObject({
      status: 429, code: 'sms_daily_limit',
    });
  });

  test('sağlayıcı hatası 500 döner, log telefonu maskeler', async () => {
    env.sms.provider = 'netgsm';
    env.sms.apiKey = '';

    await expect(svc.sendOtpFlow({ phone: PHONE })).rejects.toMatchObject({ status: 500 });
    expect(logger.error).toHaveBeenCalledWith('SMS gönderim hatası', expect.objectContaining({ phone: '***2233' }));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(PHONE);
  });
});
