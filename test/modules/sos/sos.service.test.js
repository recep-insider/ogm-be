'use strict';

// POST /sos — kişisel acil yardım çağrısı: konumsuz çağrı kabul edilir, kullanıcı
// iletişim bilgileri çağrı anında satıra snapshot'lanır, rate limit ayrı anahtardadır.

const mockInserted = [];
const mockState = { user: null, redisCount: 0 };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      first: jest.fn(async () => (table === 'users' ? mockState.user : undefined)),
      insert: jest.fn(async (row) => {
        mockInserted.push(row);
        return [1];
      }),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  return { db };
});
jest.mock('../../../src/config/redis', () => ({
  redis: {
    incr: jest.fn(async () => {
      mockState.redisCount += 1;
      return mockState.redisCount;
    }),
    expire: jest.fn(async () => 1),
  },
}));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));

const { redis } = require('../../../src/config/redis');
const { writeAudit } = require('../../../src/shared/audit');
const service = require('../../../src/modules/sos/sos.service');

const USER_ROW = {
  id: 'u1',
  ad: 'Ali',
  soyad: 'Yılmaz',
  tc_kimlik: '10000000146',
  phone: '+905321234567',
  adres: 'Örnek Mah. Test Sok. No:1 Marmaris/Muğla',
  acil_ad: 'Ayşe',
  acil_soyad: 'Yılmaz',
  acil_telefon: '+905329876543',
  acil_yakinlik: 'Eş',
};

describe('sos.service.create', () => {
  beforeEach(() => {
    mockInserted.length = 0;
    mockState.user = { ...USER_ROW };
    mockState.redisCount = 0;
    jest.clearAllMocks();
  });

  test('konumsuz (boş body) çağrı kabul edilir ve kontrat alanlarıyla döner', async () => {
    const result = await service.create({ userId: 'u1', body: {}, ip: '1.2.3.4', userAgent: 'jest' });

    expect(result.ok).toBe(true);
    expect(typeof result.sosId).toBe('string');
    expect(typeof result.createdAt).toBe('string');
    expect(result.dispatchedTo).toBe('OGM Yangın Harekat Merkezi');
    // Kontrat /emergency'den farklı: reportId/submittedAt DEĞİL.
    expect(result.reportId).toBeUndefined();
    expect(result.submittedAt).toBeUndefined();

    expect(mockInserted).toHaveLength(1);
    expect(mockInserted[0].lat).toBeNull();
    expect(mockInserted[0].lng).toBeNull();
  });

  test('kullanıcı bilgileri satıra snapshot\'lanır (geri arama telefonu dahil)', async () => {
    await service.create({
      userId: 'u1',
      body: { coordinates: { lat: 36.8529, lng: 28.2661 }, message: 'Yardım' },
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    const row = mockInserted[0];
    expect(row.user_id).toBe('u1');
    expect(row.lat).toBe(36.8529);
    expect(row.lng).toBe(28.2661);
    expect(row.message).toBe('Yardım');
    expect(row.ad).toBe('Ali');
    expect(row.soyad).toBe('Yılmaz');
    expect(row.tc_kimlik).toBe('10000000146');
    expect(row.phone).toBe('+905321234567');
    expect(row.adres).toContain('Marmaris');
    expect(row.acil_ad).toBe('Ayşe');
    expect(row.acil_telefon).toBe('+905329876543');
    expect(row.acil_yakinlik).toBe('Eş');
    expect(row.dispatched_to).toBe('OGM Yangın Harekat Merkezi');

    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'sos.create', entity: 'sos_report' }));
  });

  test('rate limit ayrı anahtar kullanır ve 6. çağrıda 429 fırlatır', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.create({ userId: 'u1', body: {}, ip: '1.2.3.4', userAgent: 'jest' });
    }
    await expect(
      service.create({ userId: 'u1', body: {}, ip: '1.2.3.4', userAgent: 'jest' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(redis.incr).toHaveBeenCalledWith('rl:sos:u1');
  });

  test('kullanıcı bulunamazsa 404 fırlatır ve kayıt yazmaz', async () => {
    mockState.user = undefined;
    await expect(
      service.create({ userId: 'ghost', body: {}, ip: '1.2.3.4', userAgent: 'jest' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockInserted).toHaveLength(0);
  });
});
