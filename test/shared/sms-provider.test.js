'use strict';

jest.mock('axios');
jest.mock('../../src/config/redis', () => ({ redis: require('../modules/admin/panel-fakes').createFakeRedis() }));
jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

describe('sendOtp — dummy phone bypass', () => {
  let axios;
  let env;
  let sendOtp;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    axios = require('axios');
    env = require('../../src/config/env');
    ({ sendOtp } = require('../../src/shared/sms-provider'));
  });

  test('dummy phone için provider çağrılmaz, dummy sonuç döner', async () => {
    env.sms.dummyPhones = ['+905555555555'];

    const res = await sendOtp('+905555555555', '123456');

    expect(res.dummy).toBe(true);
    expect(res.providerMessageId).toMatch(/^dummy-/);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('dummy listede olmayan numara mock provider yolundan geçer', async () => {
    env.sms.dummyPhones = [];
    env.sms.provider = 'mock';

    const res = await sendOtp('+905321112233', '123456');

    expect(res.dummy).toBeUndefined();
    expect(res.providerMessageId).toMatch(/^mock-/);
  });
});

describe('sendOtp — günlük SMS limiti ve log maskeleme', () => {
  let env;
  let logger;
  let redis;
  let sms;

  beforeEach(() => {
    jest.resetModules();
    env = require('../../src/config/env');
    logger = require('../../src/config/logger');
    ({ redis } = require('../../src/config/redis'));
    sms = require('../../src/shared/sms-provider');
    env.sms.provider = 'mock';
    env.sms.dummyPhones = [];
    env.sms.dailyLimitPerUser = 2;
  });

  test('limit aşılınca 429 sms_daily_limit döner, sayaç 24 saatlik TTL taşır', async () => {
    await sms.sendOtp('+905321112233', '111111');
    await sms.sendOtp('+905321112233', '222222');

    await expect(sms.sendOtp('+905321112233', '333333')).rejects.toMatchObject({
      status: 429,
      code: 'sms_daily_limit',
      details: { retryAfterSec: expect.any(Number) },
    });
    expect(await redis.ttl('rl:sms:otp:daily:+905321112233')).toBeGreaterThan(86000);
    // Başka numaranın sayacı ayrıdır.
    await expect(sms.sendOtp('+905329998877', '444444')).resolves.toMatchObject({ providerMessageId: expect.any(String) });
  });

  test('dummy numaralar sayaca girmez', async () => {
    env.sms.dummyPhones = ['+905555555555'];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sms.sendOtp('+905555555555', '123456');
    }
    expect(redis.store.size).toBe(0);
  });

  test('mock log telefonu maskeler, SMS metnini (OTP kodu) yazmaz', async () => {
    await sms.sendOtp('+905321112233', '987654');

    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('987654');
    expect(logged).not.toContain('+905321112233');
    expect(logger.info).toHaveBeenCalledWith('SMS [MOCK] gönderildi', { phone: '***2233' });
  });

  test('işlemsel SMS hatası telefonu maskeli loglar', async () => {
    env.sms.provider = 'netgsm';
    env.sms.apiKey = '';

    const res = await sms.sendTransactional('+905321112233', 'applicationReceived');

    expect(res).toMatchObject({ sent: false, reason: 'provider_error' });
    expect(logger.error).toHaveBeenCalledWith('İşlemsel SMS gönderilemedi', expect.objectContaining({ phone: '***2233' }));
  });
});
