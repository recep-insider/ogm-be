'use strict';

// Telefon değiştirme: oturum yalnız kod yeni numaraya gönderildikten sonra yazılır.

jest.mock('bcrypt', () => require('../admin/panel-fakes').fakeBcrypt);
jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => {
  const redis = require('../admin/panel-fakes').createFakeRedis();
  redis.set = jest.fn(async () => 'OK');
  return { redis };
});
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));

const env = require('../../../src/config/env');
const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const { writeAudit } = require('../../../src/shared/audit');
const service = require('../../../src/modules/users/phone-change.service');

const NEW_PHONE = '+905321112233';
const init = () => service.init({ userId: 'u1', newPhone: NEW_PHONE, ip: '1.1.1.1', userAgent: 'jest' });

beforeEach(() => {
  jest.clearAllMocks();
  redis.store.clear();
  db.reset({ users: [{ id: 'u1', phone: '+905320000000', is_active: true }] });
  env.nodeEnv = 'test';
  Object.assign(env.sms, { provider: 'mock', dummyPhones: [], dailyLimitPerUser: 10 });
});

describe('phone-change.init', () => {
  it('kod gönderilince oturum yazılır ve denetim izine geçer', async () => {
    const res = await init();

    expect(redis.set).toHaveBeenCalledWith(
      `otp:phone-change:${res.sessionId}`,
      expect.stringContaining(`"newPhone":"${NEW_PHONE}"`),
      'EX',
      env.sms.otpExpiresIn,
    );
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'users.phone-change.init' }));
  });

  it('günlük SMS limiti dolunca 429 döner, oturum yazılmaz', async () => {
    env.sms.dailyLimitPerUser = 0;

    await expect(init()).rejects.toMatchObject({ status: 429, code: 'sms_daily_limit' });
    expect(redis.set).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('günlük sınır numara + IP başınadır: bir IP dolunca başka IP kod alabilir', async () => {
    env.sms.dailyLimitPerUser = 1;
    const initFrom = (ip) => service.init({ userId: 'u1', newPhone: NEW_PHONE, ip, userAgent: 'jest' });

    await initFrom('1.1.1.1');
    await expect(initFrom('1.1.1.1')).rejects.toMatchObject({ status: 429, code: 'sms_daily_limit' });
    await expect(initFrom('2.2.2.2')).resolves.toMatchObject({ sessionId: expect.any(String) });
  });

  it('üretimde mock sağlayıcı: 503 sms_unavailable, oturum ve sayaç oluşmaz', async () => {
    env.nodeEnv = 'production';

    await expect(init()).rejects.toMatchObject({ status: 503, code: 'sms_unavailable' });
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.store.size).toBe(0);
  });
});

describe('phone-change.commit — hata kodları (BUG-038)', () => {
  const commit = (code) => service.commit({ userId: 'u1', sessionId: 's1', code, ip: '1.1.1.1', userAgent: 'jest' });
  const putSession = () => redis.store.set('otp:phone-change:s1', {
    value: JSON.stringify({ userId: 'u1', newPhone: NEW_PHONE, codeHash: 'hash:123456', attempts: 0 }),
    expiresAt: null,
  });

  it('yanlış kod 401 değil 400 invalid_otp (mobil oturum yenileyip ikinci hak harcamasın)', async () => {
    putSession();
    await expect(commit('000000')).rejects.toMatchObject({ status: 400, code: 'invalid_otp' });
  });

  it('süresi dolmuş ya da bilinmeyen oturum 410 otp_expired', async () => {
    await expect(commit('123456')).rejects.toMatchObject({ status: 410, code: 'otp_expired' });
  });

  it('doğru kod telefonu değiştirir', async () => {
    putSession();
    await expect(commit('123456')).resolves.toBeTruthy();
    expect(db.rows('users')[0].phone).toBe(NEW_PHONE);
  });

  it('deneme hakkı tükenince 429 retryAfterSec döner, oturum silinir, telefon değişmez', async () => {
    redis.store.set('otp:phone-change:s1', {
      value: JSON.stringify({ userId: 'u1', newPhone: NEW_PHONE, codeHash: 'hash:123456', attempts: env.sms.otpMaxAttempts }),
      expiresAt: null,
    });

    await expect(commit('123456')).rejects.toMatchObject({
      status: 429,
      details: { retryAfterSec: env.sms.resendCooldown },
    });
    expect(redis.store.has('otp:phone-change:s1')).toBe(false);
    expect(db.rows('users')[0].phone).toBe('+905320000000');
  });

  it('oturum silmenin yanıtı gecikse de (komut Redis\'e gitti) telefon değişir, 503 dönmez', async () => {
    putSession();
    jest.useFakeTimers();
    try {
      jest.spyOn(redis, 'del').mockImplementationOnce(() => new Promise(() => {}));
      const pending = commit('123456');
      await jest.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toBeTruthy();
      expect(db.rows('users')[0].phone).toBe(NEW_PHONE);
    } finally {
      jest.useRealTimers();
    }
  });

  it('oturum silme hemen hata verirse (uygulanmadı) 503, telefon değişmez', async () => {
    putSession();
    jest.spyOn(redis, 'del').mockRejectedValueOnce(new Error('Connection is closed.'));
    await expect(commit('123456')).rejects.toMatchObject({ status: 503, code: 'service_unavailable' });
    expect(db.rows('users')[0].phone).toBe('+905320000000');
  });
});
