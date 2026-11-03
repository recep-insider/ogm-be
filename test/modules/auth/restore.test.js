'use strict';

// K28: silinme sürecindeki hesabın sahibi SMS koduyla girerken önce sorulur; "Devam" derse
// /auth/restore silme talebini iptal eder ve normal girişteki gibi oturum açar.

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));
jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('../admin/panel-fakes').createFakeRedis() }));
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/otp', () => ({
  generateOtp: () => '123456',
  hashOtp: async (code) => `h:${code}`,
  verifyOtp: async (code, hash) => hash === `h:${code}`,
}));

const jwt = require('jsonwebtoken');
const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const { verifyOtpFlow, restoreFlow } = require('../../../src/modules/auth/phone.service');
const { signRestoreToken, verifyAccessToken, userBlockKey } = require('../../../src/shared/jwt');

const PHONE = '+905551112233';
const DELETED_AT = new Date(Date.now() - 5 * 86400 * 1000);

function pendingUser(extra = {}) {
  return {
    id: 'u1', phone: PHONE, ad: 'Ayşe', soyad: 'Yılmaz', tc_kimlik: '10000000146',
    is_active: false, deleted_at: DELETED_AT, anonymized_at: null, profile_complete: 1, ...extra,
  };
}

async function verify() {
  await redis.set('otp:phone:s1', JSON.stringify({ phone: PHONE, codeHash: 'h:123456', attempts: 0 }));
  return verifyOtpFlow({ sessionId: 's1', code: '123456', ip: '1.2.3.4', userAgent: 'jest' });
}

beforeEach(() => {
  db.reset({ users: [pendingUser()], refresh_tokens: [], applications: [] });
  redis.store.clear();
});

describe('verify-otp — silinme sürecindeki hesap', () => {
  it('kayıt token\'ı yerine pendingDeletion ve restoreToken döner, oturum açmaz', async () => {
    const result = await verify();

    expect(result).toMatchObject({ ok: true, isExisting: true, pendingDeletion: true, expiresIn: 600 });
    expect(result.registrationToken).toBeUndefined();
    expect(result.accessToken).toBeUndefined();
    expect(jwt.decode(result.restoreToken)).toMatchObject({ sub: 'u1', typ: 'restore' });
    expect(db.rows('refresh_tokens')).toHaveLength(0);
  });

  it('anonimleşmiş hesap silinme sürecinde sayılmaz, yeni kayıt akışı başlar', async () => {
    db.reset({ users: [pendingUser({ anonymized_at: new Date(), phone: PHONE })], refresh_tokens: [] });
    const result = await verify();
    expect(result.pendingDeletion).toBeUndefined();
    expect(result.registrationToken).toEqual(expect.any(String));
  });

  it('silmeden 30 gün geçmiş (anonimleştirme sırasındaki) hesap geri alma teklifi almaz', async () => {
    db.reset({ users: [pendingUser({ deleted_at: new Date(Date.now() - 31 * 86400 * 1000) })], refresh_tokens: [] });
    const result = await verify();
    expect(result.pendingDeletion).toBeUndefined();
    expect(result.restoreToken).toBeUndefined();
  });
});

describe('POST /auth/restore — 30 günlük sınır', () => {
  it('silmeden 30 gün geçmiş hesabı açmaz; erişim engeli kalır', async () => {
    const restoreToken = signRestoreToken({ sub: 'u1' });
    db.reset({ users: [pendingUser({ deleted_at: new Date(Date.now() - 31 * 86400 * 1000) })], refresh_tokens: [] });
    await redis.set(userBlockKey('u1'), '1', 'EX', 900);

    await expect(restoreFlow({ restoreToken })).rejects.toMatchObject({ status: 401, code: 'restore_invalid' });
    expect(db.rows('users')[0].is_active).toBe(false);
    expect(await redis.get(userBlockKey('u1'))).toBe('1');
  });
});

describe('POST /auth/restore — restoreFlow', () => {
  it('hesabı yeniden açar, erişim engelini kaldırır ve oturum verir', async () => {
    await redis.set(userBlockKey('u1'), '1', 'EX', 900);
    const { restoreToken } = await verify();

    const result = await restoreFlow({ restoreToken, ip: '1.2.3.4', userAgent: 'jest' });

    expect(result).toMatchObject({ ok: true, isExisting: true, user: { id: 'u1' } });
    expect(verifyAccessToken(result.accessToken).sub).toBe('u1');
    expect(db.rows('users')[0]).toMatchObject({ is_active: true, deleted_at: null });
    expect(await redis.get(userBlockKey('u1'))).toBeNull();
    expect(db.rows('refresh_tokens')).toHaveLength(1);
  });

  it('token ikinci kez kullanılamaz', async () => {
    const { restoreToken } = await verify();
    await restoreFlow({ restoreToken });
    await expect(restoreFlow({ restoreToken })).rejects.toMatchObject({ status: 401, code: 'restore_invalid' });
  });

  it('token verildikten sonra yeniden silinen hesabı açmaz', async () => {
    const restoreToken = signRestoreToken({ sub: 'u1' });
    db.reset({ users: [pendingUser({ deleted_at: new Date(Date.now() + 60 * 1000) })], refresh_tokens: [] });
    await redis.set(userBlockKey('u1'), '1', 'EX', 900);

    await expect(restoreFlow({ restoreToken })).rejects.toMatchObject({ status: 401, code: 'restore_invalid' });
    expect(db.rows('users')[0].is_active).toBe(false);
    expect(await redis.get(userBlockKey('u1'))).toBe('1');
  });

  it('access ya da kayıt token\'ı restore token yerine geçmez', async () => {
    const { signAccessToken, signRegistrationToken } = require('../../../src/shared/jwt');
    await expect(restoreFlow({ restoreToken: signAccessToken({ sub: 'u1' }) }))
      .rejects.toMatchObject({ status: 401, code: 'restore_invalid' });
    await expect(restoreFlow({ restoreToken: signRegistrationToken({ sub: 'u1', phone: PHONE }) }))
      .rejects.toMatchObject({ status: 401, code: 'restore_invalid' });
  });

  it('erişim engeli kaldırılamazsa hesap açılmaz, 503 restore_unavailable', async () => {
    const { restoreToken } = await verify();
    const del = jest.spyOn(redis, 'del').mockRejectedValueOnce(new Error('redis down'));

    await expect(restoreFlow({ restoreToken })).rejects.toMatchObject({ status: 503, code: 'restore_unavailable' });
    expect(db.rows('users')[0]).toMatchObject({ is_active: false, deleted_at: DELETED_AT });
    del.mockRestore();
  });

  it('kontrolden sonra anonimleşen hesap açılmaz, oturum verilmez', async () => {
    const { restoreToken } = await verify();
    const del = jest.spyOn(redis, 'del').mockImplementationOnce(async () => {
      db.rows('users')[0].anonymized_at = new Date();
      return 1;
    });

    await expect(restoreFlow({ restoreToken })).rejects.toMatchObject({ status: 401, code: 'restore_invalid' });
    expect(db.rows('users')[0]).toMatchObject({ is_active: false, deleted_at: DELETED_AT });
    expect(db.rows('refresh_tokens')).toHaveLength(0);
    expect(await redis.get(userBlockKey('u1'))).toBe('1');
    del.mockRestore();
  });

  it('aynı anda iki geri alma isteği: biri açar, öteki 401 alır ve açılan hesabı engellemez', async () => {
    const { restoreToken } = await verify();
    await redis.set(userBlockKey('u1'), '1', 'EX', 900);

    const results = await Promise.allSettled([restoreFlow({ restoreToken }), restoreFlow({ restoreToken })]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ status: 401, code: 'restore_invalid' });
    expect(db.rows('users')[0]).toMatchObject({ is_active: true, deleted_at: null });
    expect(await redis.get(userBlockKey('u1'))).toBeNull();
  });

  it('hesap güncellemesi hata verirse kaldırılan erişim engeli geri yazılır', async () => {
    const { restoreToken } = await verify();
    await redis.set(userBlockKey('u1'), '1', 'EX', 900);
    const realDel = redis.del.bind(redis);
    const del = jest.spyOn(redis, 'del').mockImplementationOnce(async (key) => {
      const out = await realDel(key);
      // Engel kalktıktan sonra DB yazımı düşer.
      Object.defineProperty(db.rows('users')[0], 'deleted_at', { get() { throw new Error('db down'); } });
      return out;
    });

    await expect(restoreFlow({ restoreToken })).rejects.toThrow('db down');
    expect(await redis.get(userBlockKey('u1'))).toBe('1');
    del.mockRestore();
  });

  it('restore token access token yerine kullanılamaz', async () => {
    const restoreToken = signRestoreToken({ sub: 'u1' });
    expect(() => verifyAccessToken(restoreToken)).toThrow();
  });
});
