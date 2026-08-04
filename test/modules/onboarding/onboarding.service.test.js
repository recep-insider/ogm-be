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
  jwt: { accessSecret: 's', refreshSecret: 's', accessTtl: '15m', refreshTtl: '7d' },
}));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

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
