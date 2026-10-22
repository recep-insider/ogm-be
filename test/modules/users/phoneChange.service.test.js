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

  it('üretimde mock sağlayıcı: 503 sms_unavailable, oturum ve sayaç oluşmaz', async () => {
    env.nodeEnv = 'production';

    await expect(init()).rejects.toMatchObject({ status: 503, code: 'sms_unavailable' });
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.store.size).toBe(0);
  });
});
