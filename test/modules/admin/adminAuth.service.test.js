'use strict';

// db / redis / bcrypt / jwt / audit are all mocked — bcrypt's native binding
// won't load on this machine and there is no real DB (repo test pattern: unit level).

const mockFirst = jest.fn();
const mockInsert = jest.fn().mockResolvedValue([1]);
const mockUpdate = jest.fn().mockResolvedValue(1);

function chain() {
  const c = {
    whereRaw: () => c,
    whereNull: () => c,
    where: () => c,
    orderBy: () => c,
    select: () => c,
    first: (...a) => mockFirst(...a),
    insert: (...a) => mockInsert(...a),
    update: (...a) => mockUpdate(...a),
  };
  return c;
}

const mockDb = jest.fn(() => chain());
mockDb.fn = { now: () => 'NOW' };
mockDb.transaction = async (cb) => cb(mockDb);

const mockRedisGet = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisSet = jest.fn();

const mockCompare = jest.fn();
const mockHash = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../src/config/db', () => ({ db: mockDb }));
jest.mock('../../../src/config/redis', () => ({
  redis: {
    get: (...a) => mockRedisGet(...a),
    incr: (...a) => mockRedisIncr(...a),
    expire: (...a) => mockRedisExpire(...a),
    del: (...a) => mockRedisDel(...a),
    set: (...a) => mockRedisSet(...a),
  },
}));
jest.mock('bcrypt', () => ({ compare: (...a) => mockCompare(...a), hash: (...a) => mockHash(...a) }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: (...a) => mockWriteAudit(...a) }));
jest.mock('../../../src/shared/jwt', () => ({
  signAccessToken: jest.fn(() => 'access.jwt'),
  signRefreshToken: jest.fn(() => 'refresh.jwt'),
  verifyRefreshToken: jest.fn(),
  accessTokenSeconds: jest.fn(() => 900),
}));

const svc = require('../../../src/modules/admin/auth/adminAuth.service');
const { verifyRefreshToken } = require('../../../src/shared/jwt');

const ACTIVE_ADMIN = {
  id: 'adm-1',
  eposta: 'admin@ogm.gov.tr',
  ad: 'Sistem',
  soyad: 'Yöneticisi',
  password_hash: 'hashed',
  role: 'admin',
  is_active: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInsert.mockResolvedValue([1]);
  mockUpdate.mockResolvedValue(1);
  mockRedisGet.mockResolvedValue(null);
  mockRedisIncr.mockResolvedValue(1);
});

describe('adminAuth.service — login', () => {
  test('kilitliyse (fails >= max) rateLimit fırlatır, DB sorgusu yapmaz', async () => {
    mockRedisGet.mockResolvedValueOnce('10');
    await expect(
      svc.login({ eposta: 'admin@ogm.gov.tr', sifre: 'password1', ip: '9.9.9.9' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(mockDb).not.toHaveBeenCalled();
  });

  test('kilit sayacı IP bazlıdır (e-posta değil) — anahtar IP içerir', async () => {
    mockFirst.mockResolvedValueOnce(undefined);
    await expect(
      svc.login({ eposta: 'admin@ogm.gov.tr', sifre: 'wrongpass', ip: '9.9.9.9' }),
    ).rejects.toMatchObject({ status: 401 });
    // get + incr must be called with the same IP-based key, never containing the email.
    expect(mockRedisGet).toHaveBeenCalledWith('rl:admin:login:ip:9.9.9.9');
    expect(mockRedisIncr).toHaveBeenCalledWith('rl:admin:login:ip:9.9.9.9');
    expect(mockRedisGet.mock.calls[0][0]).not.toContain('admin@ogm.gov.tr');
  });

  test('IP yoksa sayaç uygulanmaz (kilit atlanır) ama yine 401', async () => {
    mockFirst.mockResolvedValueOnce(undefined);
    await expect(
      svc.login({ eposta: 'yok@ogm.gov.tr', sifre: 'password1' }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(mockRedisGet).not.toHaveBeenCalled();
    expect(mockRedisIncr).not.toHaveBeenCalled();
  });

  test('hesap yoksa generic 401 döner ve fail sayacı artar', async () => {
    mockFirst.mockResolvedValueOnce(undefined);
    await expect(
      svc.login({ eposta: 'yok@ogm.gov.tr', sifre: 'password1', ip: '1.2.3.4' }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(mockCompare).not.toHaveBeenCalled();
    expect(mockRedisIncr).toHaveBeenCalledTimes(1);
  });

  test('yanlış şifrede generic 401 döner (enumeration yok)', async () => {
    mockFirst.mockResolvedValueOnce({ ...ACTIVE_ADMIN });
    mockCompare.mockResolvedValueOnce(false);
    await expect(
      svc.login({ eposta: 'admin@ogm.gov.tr', sifre: 'wrongpass', ip: '1.2.3.4' }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(mockRedisIncr).toHaveBeenCalledTimes(1);
  });

  test('pasif hesapta doğru şifreyle bile 401 döner', async () => {
    mockFirst.mockResolvedValueOnce({ ...ACTIVE_ADMIN, is_active: 0 });
    mockCompare.mockResolvedValueOnce(true);
    await expect(
      svc.login({ eposta: 'admin@ogm.gov.tr', sifre: 'password1', ip: '1.2.3.4' }),
    ).rejects.toMatchObject({ status: 401 });
  });

  test('doğru kimlikte token çifti + admin döner, sayaç sıfırlanır, audit yazılır', async () => {
    mockFirst.mockResolvedValueOnce({ ...ACTIVE_ADMIN });
    mockCompare.mockResolvedValueOnce(true);

    const result = await svc.login({
      eposta: 'admin@ogm.gov.tr',
      sifre: 'password1',
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(result).toMatchObject({
      accessToken: 'access.jwt',
      refreshToken: 'refresh.jwt',
      expiresIn: 900,
      admin: { id: 'adm-1', eposta: 'admin@ogm.gov.tr', role: 'admin' },
    });
    expect(result.admin.password_hash).toBeUndefined();
    expect(mockInsert).toHaveBeenCalledTimes(1); // refresh token written
    expect(mockRedisDel).toHaveBeenCalledTimes(1); // fail counter cleared
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.auth.login', userId: 'adm-1' }),
    );
  });
});

describe('adminAuth.service — refresh', () => {
  test('geçersiz token 401', async () => {
    verifyRefreshToken.mockImplementationOnce(() => {
      throw new Error('bad');
    });
    await expect(svc.refresh({ refreshToken: 'x' })).rejects.toMatchObject({ status: 401 });
  });

  test('blacklist edilmiş token 401', async () => {
    verifyRefreshToken.mockReturnValueOnce({ sub: 'adm-1', jti: 'jti-1' });
    mockRedisGet.mockResolvedValueOnce('1');
    await expect(svc.refresh({ refreshToken: 'x' })).rejects.toMatchObject({ status: 401 });
  });

  test('rotation: eskiyi revoke eder, yeni çift döner', async () => {
    verifyRefreshToken.mockReturnValueOnce({ sub: 'adm-1', jti: 'jti-1' });
    mockRedisGet.mockResolvedValueOnce(null); // not blacklisted
    // 1) stored refresh, 2) admin
    mockFirst
      .mockResolvedValueOnce({
        id: 'jti-1',
        token_hash: svc.hashToken('x'),
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
      })
      .mockResolvedValueOnce({ ...ACTIVE_ADMIN });

    const result = await svc.refresh({ refreshToken: 'x', ip: '1.2.3.4' });

    expect(result).toMatchObject({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' });
    expect(mockUpdate).toHaveBeenCalled(); // old one revoked
    expect(mockInsert).toHaveBeenCalled(); // new one written
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.auth.refresh' }),
    );
  });

  test('DB kaydı token_hash uyuşmazsa 401', async () => {
    verifyRefreshToken.mockReturnValueOnce({ sub: 'adm-1', jti: 'jti-1' });
    mockRedisGet.mockResolvedValueOnce(null);
    mockFirst.mockResolvedValueOnce({
      id: 'jti-1',
      token_hash: 'baska-hash',
      expires_at: new Date(Date.now() + 86400000),
      revoked_at: null,
    });
    await expect(svc.refresh({ refreshToken: 'x' })).rejects.toMatchObject({ status: 401 });
  });
});

describe('adminAuth.service — logout', () => {
  test('geçersiz token sessizce başarılı (throw yok)', async () => {
    verifyRefreshToken.mockImplementationOnce(() => {
      throw new Error('bad');
    });
    await expect(svc.logout({ refreshToken: 'x' })).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('geçerli token revoke + blacklist + audit', async () => {
    verifyRefreshToken.mockReturnValueOnce({ sub: 'adm-1', jti: 'jti-1' });
    await svc.logout({ refreshToken: 'x', ip: '1.2.3.4' });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockRedisSet).toHaveBeenCalledWith('bl:admin_refresh:jti-1', '1', 'EX', 7 * 86400);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.auth.logout' }),
    );
  });
});

describe('adminAuth.service — me', () => {
  test('aktif admin profili döner (şifre hariç)', async () => {
    mockFirst.mockResolvedValueOnce({ ...ACTIVE_ADMIN });
    const admin = await svc.me('adm-1');
    expect(admin).toEqual({
      id: 'adm-1',
      eposta: 'admin@ogm.gov.tr',
      ad: 'Sistem',
      soyad: 'Yöneticisi',
      role: 'admin',
    });
  });

  test('bulunamazsa/pasifse 401', async () => {
    mockFirst.mockResolvedValueOnce(undefined);
    await expect(svc.me('yok')).rejects.toMatchObject({ status: 401 });
  });
});
