'use strict';

// onboarding.service.complete — egitim bloğu: forest_units kanonik doğrulaması,
// giysi_bedeni/ayakkabi_numarasi'nın users satırına, dört birim adının snapshot'a yazılması.

const mockInserted = { users: [], applications: [], audit_log: [] };
const mockUpdated = { users: [] };
const mockState = {
  forestUnit: undefined,
  hobilerAllowed: ['Doğa Yürüyüşü'],
  userRecord: null,
  applicationRecord: null,
};

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      whereNull: jest.fn(() => c),
      orderBy: jest.fn(() => c),
      pluck: jest.fn(async () => mockState.hobilerAllowed),
      first: jest.fn(async () => {
        if (table === 'forest_units') return mockState.forestUnit;
        if (table === 'users') return mockState.userRecord;
        if (table === 'applications') return mockState.applicationRecord;
        return undefined;
      }),
      insert: jest.fn(async (row) => {
        (mockInserted[table] = mockInserted[table] || []).push(row);
        return [1];
      }),
      update: jest.fn(async (row) => {
        (mockUpdated[table] = mockUpdated[table] || []).push(row);
        return 1;
      }),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), {
    transaction: jest.fn(async (cb) => cb(jest.fn((table) => makeChain(table)))),
    raw: jest.fn(),
  });
  return { db };
});
jest.mock('../../../src/config/env', () => ({
  upload: { dir: '/tmp/uploads' },
  jwt: { accessSecret: 's', refreshSecret: 's', accessTtl: '15m', refreshTtl: '7d', accessExpiresIn: '15m', refreshExpiresIn: '7d' },
}));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
// Kayıt token'ının tek kullanım kaydı (SET NX) ve geri alınması (DEL) için.
const mockRedis = { set: jest.fn(async () => 'OK'), del: jest.fn(async () => 1) };
jest.mock('../../../src/config/redis', () => ({ redis: mockRedis }));

const service = require('../../../src/modules/onboarding/onboarding.service');

const FILES = {
  saglikRaporu: [{ path: '/tmp/uploads/onboarding/saglik.pdf' }],
  sabikaKaydi: [{ path: '/tmp/uploads/onboarding/sabika.pdf' }],
};

function baseData() {
  return {
    kimlik: { tcKimlik: '10000000146', ad: 'Ali', soyad: 'Yılmaz', dogumTarihi: '1990-05-15' },
    iletisim: { eposta: 'ali@example.com', adres: 'Örnek Mah. Test Sok. No:1 Marmaris' },
    kisisel: { kanGrubu: 'A+', ogrenim: 'Lisans', meslek: 'Memur', hobiler: [] },
    acil: { ad: 'Ayşe', soyad: 'Yılmaz', telefon: '+905329876543', yakinlik: 'Eş' },
  };
}

function egitimData() {
  return {
    il: 'Antalya',
    ilce: 'Alanya',
    bolgeMudurlugu: 'Antalya Orman Bölge Müdürlüğü',
    isletmeMudurlugu: 'Alanya Orman İşletme Müdürlüğü',
    giysiBedeni: 'M',
    ayakkabiNumarasi: 38,
  };
}

describe('onboarding.service.complete — egitim bloğu', () => {
  beforeEach(() => {
    mockInserted.users.length = 0;
    mockInserted.applications.length = 0;
    mockInserted.audit_log.length = 0;
    mockUpdated.users.length = 0;
    mockState.forestUnit = { id: 'antalya-alanya-alanya' };
    mockState.userRecord = {
      id: 'u1', tc_kimlik: '10000000146', ad: 'Ali', soyad: 'Yılmaz',
      dogum_tarihi: '1990-05-15', phone: '+905321234567', eposta: 'ali@example.com',
      profile_complete: 1,
    };
    mockState.applicationRecord = { id: 'app1', status: 'pending', submitted_at: new Date('2026-08-04T10:00:00Z') };
    jest.clearAllMocks();
  });

  test('forest_units eşleşmesi yoksa "Geçersiz eğitim birimi seçimi" ile reddeder', async () => {
    mockState.forestUnit = undefined;
    await expect(
      service.complete({
        user: { id: 'u1' },
        data: { ...baseData(), egitim: egitimData() },
        files: FILES,
        ip: '1.2.3.4',
        userAgent: 'jest',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockUpdated.users).toHaveLength(0);
    expect(mockInserted.applications).toHaveLength(0);
  });

  test('geçerli egitim: users satırına beden/numara, applications.snapshot içine dört birim adı yazılır', async () => {
    const result = await service.complete({
      user: { id: 'u1' },
      data: { ...baseData(), egitim: egitimData() },
      files: FILES,
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(result.applicationId).toBe('app1');
    expect(mockUpdated.users).toHaveLength(1);
    expect(mockUpdated.users[0].giysi_bedeni).toBe('M');
    expect(mockUpdated.users[0].ayakkabi_numarasi).toBe(38);

    expect(mockInserted.applications).toHaveLength(1);
    const snapshot = JSON.parse(mockInserted.applications[0].snapshot);
    expect(snapshot.egitim).toMatchObject({
      il: 'Antalya',
      ilce: 'Alanya',
      bolgeMudurlugu: 'Antalya Orman Bölge Müdürlüğü',
      isletmeMudurlugu: 'Alanya Orman İşletme Müdürlüğü',
    });
  });

  test('egitim gönderilmezse forest_units sorgulanmaz ve mevcut beden alanları ezilmez', async () => {
    const { db } = require('../../../src/config/db');
    await service.complete({
      user: { id: 'u1' },
      data: baseData(),
      files: FILES,
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(db).not.toHaveBeenCalledWith('forest_units');
    expect(mockUpdated.users).toHaveLength(1);
    expect('giysi_bedeni' in mockUpdated.users[0]).toBe(false);
    expect('ayakkabi_numarasi' in mockUpdated.users[0]).toBe(false);
  });
});

describe('onboarding.service.complete — telefon ve kayıt token\'ı', () => {
  const { db } = require('../../../src/config/db');

  beforeEach(() => {
    mockInserted.users.length = 0;
    mockInserted.applications.length = 0;
    mockUpdated.users.length = 0;
    mockState.forestUnit = { id: 'x' };
    mockState.userRecord = undefined;
    jest.clearAllMocks();
    mockRedis.set.mockResolvedValue('OK');
  });

  const registrationCall = (telefon) => service.complete({
    user: null,
    registration: { sub: null, phone: '+905551112233' },
    registrationToken: 'kayit-token',
    data: { ...baseData(), iletisim: { ...baseData().iletisim, telefon } },
    files: FILES,
  });

  test('SMS akışında gövdedeki farklı telefon 400 phone_mismatch; kayıt açılmaz', async () => {
    await expect(registrationCall('+905559998877')).rejects.toMatchObject({ status: 400, code: 'phone_mismatch' });
    expect(mockInserted.users).toHaveLength(0);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  test('kullanılmış kayıt token\'ı 401 registration_used; kayıt açılmaz', async () => {
    mockRedis.set.mockResolvedValue(null);
    await expect(registrationCall('+905551112233')).rejects.toMatchObject({ status: 401, code: 'registration_used' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  test('token tek kullanımlık işaretlenir; kayıt yazılamazsa işaret geri alınır', async () => {
    db.transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(registrationCall(undefined)).rejects.toThrow('db down');

    const [key, value, ex, ttl, nx] = mockRedis.set.mock.calls[0];
    expect(key).toMatch(/^used:reg:[0-9a-f]{64}$/);
    expect([value, ex, nx]).toEqual(['1', 'EX', 'NX']);
    expect(ttl).toBeGreaterThan(0);
    expect(mockRedis.del).toHaveBeenCalledWith(key);
  });

  test('Redis yazılamazsa kayıt engellenmez ve uyarı loglanır', async () => {
    const logger = require('../../../src/config/logger');
    const runTransaction = db.transaction.getMockImplementation();
    db.transaction.mockImplementationOnce(async (cb) => {
      await runTransaction(cb);
      mockState.userRecord = { id: 'new', tc_kimlik: '10000000146', phone: '+905551112233', profile_complete: 1 };
    });
    mockState.applicationRecord = { id: 'app2', status: 'pending', submitted_at: new Date('2026-08-04T10:00:00Z') };
    mockRedis.set.mockRejectedValueOnce(new Error('redis down'));

    const result = await registrationCall(undefined);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(mockInserted.users).toHaveLength(1);
    expect(result.applicationId).toBe('app2');
    expect(logger.warn).toHaveBeenCalledWith('Kayıt token kullanım kaydı yazılamadı', { error: 'redis down' });
  });

  test('Redis yazılamadıysa kayıt başarısız olduğunda işaret silinmeye çalışılmaz', async () => {
    mockRedis.set.mockRejectedValueOnce(new Error('redis down'));
    db.transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(registrationCall(undefined)).rejects.toThrow('db down');

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  test('silinme sürecindeki hesabın TC ya da telefonuyla yeni kayıt 500 yerine 409 account_pending_deletion', async () => {
    mockState.userRecord = {
      id: 'silinen', tc_kimlik: '10000000146', phone: '+905551112233', is_active: 0, deleted_at: new Date(),
    };
    await expect(registrationCall(undefined)).rejects.toMatchObject({ status: 409, code: 'account_pending_deletion' });
    expect(mockInserted.users).toHaveLength(0);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  test('30 günü dolmuş (anonimleştirme bekleyen) hesabın TC\'siyle kayıt 409 account_deletion_finalizing; giriş önerilmez', async () => {
    mockState.userRecord = {
      id: 'silinen', tc_kimlik: '10000000146', phone: '+905551112233', is_active: 0,
      deleted_at: new Date(Date.now() - 31 * 86400 * 1000), anonymized_at: null,
    };
    await expect(registrationCall(undefined)).rejects.toMatchObject({ status: 409, code: 'account_deletion_finalizing' });
    expect(mockInserted.users).toHaveLength(0);
  });

  test('30 günü dolmuş hesabın telefonuyla kayıt da 409 account_deletion_finalizing', async () => {
    const baseImpl = db.getMockImplementation();
    db.mockImplementationOnce((table) => {
      const chain = baseImpl(table);
      chain.first = jest.fn(async () => undefined);
      return chain;
    });
    mockState.userRecord = { id: 'silinen', phone: '+905551112233', deleted_at: new Date(Date.now() - 31 * 86400 * 1000) };

    await expect(registrationCall(undefined)).rejects.toMatchObject({ status: 409, code: 'account_deletion_finalizing' });
    expect(mockInserted.users).toHaveLength(0);
  });

  test('TC kaydı yokken telefonu silinme sürecindeki hesapta olan yeni kayıt 409 account_pending_deletion; dosyalar silinir', async () => {
    const fs = require('fs/promises');
    const unlink = jest.spyOn(fs, 'unlink').mockResolvedValue();
    const baseImpl = db.getMockImplementation();
    db.mockImplementationOnce((table) => {
      const chain = baseImpl(table);
      chain.first = jest.fn(async () => undefined);
      return chain;
    });
    mockState.userRecord = { id: 'silinen', phone: '+905551112233', deleted_at: new Date() };

    await expect(registrationCall(undefined)).rejects.toMatchObject({ status: 409, code: 'account_pending_deletion' });

    expect(mockInserted.users).toHaveLength(0);
    expect(unlink.mock.calls.map(([p]) => p).sort()).toEqual([
      FILES.sabikaKaydi[0].path,
      FILES.saglikRaporu[0].path,
    ]);
    unlink.mockRestore();
  });

  test('oturumlu kullanıcı onboarding ile telefonunu değiştiremez', async () => {
    mockState.userRecord = { id: 'u1', tc_kimlik: '10000000146', phone: '+905321234567' };
    await expect(service.complete({
      user: { id: 'u1' },
      data: { ...baseData(), iletisim: { ...baseData().iletisim, telefon: '+905559998877' } },
      files: FILES,
    })).rejects.toMatchObject({ status: 400, code: 'phone_mismatch' });
    expect(mockUpdated.users).toHaveLength(0);
  });
});
