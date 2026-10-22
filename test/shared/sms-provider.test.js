'use strict';

jest.mock('axios');
jest.mock('../../src/config/redis', () => {
  const redis = require('../modules/admin/panel-fakes').createFakeRedis();
  // REFUND_OTP Lua betiğinin taklidi: sayaç varsa ve 0'dan büyükse bir azaltır, yoksa yaratmaz.
  redis.eval = jest.fn(async (_script, _n, key) => {
    if (!(Number(await redis.get(key)) > 0)) return 0;
    redis.store.get(key).value -= 1;
    return redis.store.get(key).value;
  });
  return { redis };
});
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

  test('dummy phone logu telefonu maskeler', async () => {
    const logger = require('../../src/config/logger');
    env.sms.dummyPhones = ['+905555555555'];

    await sendOtp('+905555555555', '123456');

    expect(logger.info).toHaveBeenCalledWith('SMS atlandı (dummy phone)', { phone: '***5555' });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('+905555555555');
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

  test('üretim dışı mock da OTP kodunu loglamaz; telefon maskeli', async () => {
    await sms.sendOtp('+905321112233', '987654');

    expect(logger.info).toHaveBeenCalledWith('SMS [MOCK] gönderildi', { phone: '***2233' });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('987654');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('+905321112233');
  });

  test('gerçek sağlayıcıda OTP kodu loglanmaz', async () => {
    const axios = require('axios');
    axios.get.mockResolvedValueOnce({ data: '00 12345' });
    Object.assign(env.sms, { provider: 'netgsm', apiKey: 'k', apiSecret: 's' });

    await expect(sms.sendOtp('+905321112233', '987654')).resolves.toEqual({ providerMessageId: '12345' });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('987654');
  });

  test('sağlayıcı hatası günlük hakkı iade eder; sayaç TTL\'li kalır, limit dolmaz', async () => {
    const PHONE = '+905321112233';
    const KEY = `rl:sms:otp:daily:${PHONE}`;
    env.sms.dailyLimitPerUser = 1;
    Object.assign(env.sms, { provider: 'netgsm', apiKey: '' });

    await expect(sms.sendOtp(PHONE, '111111')).rejects.toThrow(/NetGSM/);
    await expect(sms.sendOtp(PHONE, '222222')).rejects.toThrow(/NetGSM/);

    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('decr'), 1, KEY);
    expect(await redis.get(KEY)).toBe('0');
    expect(await redis.ttl(KEY)).toBeGreaterThan(86000);
    env.sms.provider = 'mock';
    await expect(sms.sendOtp(PHONE, '333333')).resolves.toMatchObject({ providerMessageId: expect.any(String) });
  });

  test('limit aşımı (429) iade edilmez; iade hatası asıl hatayı gizlemez', async () => {
    env.sms.dailyLimitPerUser = 0;
    await expect(sms.sendOtp('+905321112233', '111111')).rejects.toMatchObject({ status: 429 });
    expect(redis.eval).not.toHaveBeenCalled();

    env.sms.dailyLimitPerUser = 5;
    Object.assign(env.sms, { provider: 'netgsm', apiKey: '' });
    redis.eval.mockRejectedValueOnce(new Error('redis kapalı'));
    await expect(sms.sendOtp('+905321112233', '222222')).rejects.toThrow(/NetGSM/);
    expect(logger.warn).toHaveBeenCalledWith('Günlük OTP sayacı iade edilemedi', { phone: '***2233', error: 'redis kapalı' });
  });

  test('işlemsel SMS hatası telefonu maskeli loglar', async () => {
    env.sms.provider = 'netgsm';
    env.sms.apiKey = '';

    const res = await sms.sendTransactional('+905321112233', 'applicationReceived');

    expect(res).toMatchObject({ sent: false, reason: 'provider_error' });
    expect(logger.error).toHaveBeenCalledWith('İşlemsel SMS gönderilemedi', expect.objectContaining({ phone: '***2233' }));
  });
});

describe('sendOtp — üretimde mock sağlayıcı', () => {
  let axios;
  let env;
  let logger;
  let redis;
  let sms;

  beforeEach(() => {
    jest.resetModules();
    axios = require('axios');
    env = require('../../src/config/env');
    logger = require('../../src/config/logger');
    ({ redis } = require('../../src/config/redis'));
    sms = require('../../src/shared/sms-provider');
    env.nodeEnv = 'production';
    env.sms.provider = 'mock';
    env.sms.dummyPhones = ['+905555555555'];
  });

  test('test numarası dışındaki numaraya 503 sms_unavailable, kota harcanmaz', async () => {
    await expect(sms.sendOtp('+905321112233', '987654')).rejects.toMatchObject({
      status: 503,
      code: 'sms_unavailable',
      message: 'SMS servisi henüz bağlı değil; şu an yalnız test numaralarıyla giriş yapılabilir.',
    });
    expect(redis.store.size).toBe(0);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('987654');
  });

  test('bilinmeyen sağlayıcı da mock sayılır', async () => {
    env.sms.provider = 'yok';
    expect(() => sms.assertOtpDeliverable('+905321112233')).toThrow(expect.objectContaining({ code: 'sms_unavailable' }));
  });

  test('test numarası giriş yapabilir, kod loglanmaz', async () => {
    await expect(sms.sendOtp('+905555555555', '123456')).resolves.toMatchObject({ dummy: true });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('123456');
  });

  test('gerçek sağlayıcı bağlıysa engel yoktur', async () => {
    axios.get.mockResolvedValueOnce({ data: '00 777' });
    Object.assign(env.sms, { provider: 'netgsm', apiKey: 'k', apiSecret: 's' });

    await expect(sms.sendOtp('+905321112233', '987654')).resolves.toEqual({ providerMessageId: '777' });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('987654');
  });

  test('işlemsel SMS mock\'ta sessizce no-op kalır', async () => {
    await expect(sms.sendTransactional('+905321112233', 'applicationReceived')).resolves.toMatchObject({
      sent: true,
      providerMessageId: expect.stringMatching(/^mock-/),
    });
  });
});
