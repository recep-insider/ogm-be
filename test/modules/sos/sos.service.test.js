'use strict';

// POST /sos — kişisel acil yardım çağrısı: konumsuz çağrı kabul edilir, kullanıcı
// iletişim bilgileri çağrı anında satıra snapshot'lanır, rate limit ayrı anahtardadır.
// Çağrı `active` açılır ve geçmişine mobil kaynaklı ilk satır düşer (backend §10).

const mockInserted = [];
const mockHistory = [];
const mockUpdates = [];
const mockState = {
  user: null,
  participation: undefined,
  whereCalls: [],
  whereInCalls: [],
  orderByCalls: [],
  leftJoinCalls: [],
  selectCalls: [],
  adminRows: [],
};

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn((...args) => {
        mockState.whereCalls.push([table, ...args]);
        return c;
      }),
      join: jest.fn(() => c),
      leftJoin: jest.fn((...args) => {
        mockState.leftJoinCalls.push(args);
        return c;
      }),
      select: jest.fn((...args) => {
        mockState.selectCalls.push(args);
        return c;
      }),
      clone: jest.fn(() => c),
      limit: jest.fn(() => c),
      count: jest.fn(async () => [{ total: mockState.adminRows.length }]),
      offset: jest.fn(async () => mockState.adminRows),
      whereIn: jest.fn((...args) => {
        mockState.whereInCalls.push([table, ...args]);
        return c;
      }),
      orderBy: jest.fn((...args) => {
        mockState.orderByCalls.push([table, ...args]);
        return c;
      }),
      first: jest.fn(async () => {
        if (table === 'users') return mockState.user;
        if (table === 'mission_participants as mp') return mockState.participation;
        return undefined;
      }),
      insert: jest.fn(async (row) => {
        if (table === 'sos_history') mockHistory.push(row);
        else mockInserted.push(row);
        return [1];
      }),
      update: jest.fn(async (values) => {
        if (mockState.updateError) throw mockState.updateError;
        mockUpdates.push({ table, where: mockState.whereCalls.at(-1), values });
        return 1;
      }),
    };
    if (table === 'sos_history') c.then = (resolve) => resolve([]);
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  return { db };
});
jest.mock('../../../src/config/redis', () => {
  const redis = require('../admin/panel-fakes').createFakeRedis();
  jest.spyOn(redis, 'incr');
  return { redis };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/reverse-geocode', () => ({ reverseGeocode: jest.fn() }));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const { redis } = require('../../../src/config/redis');
const { reverseGeocode } = require('../../../src/shared/reverse-geocode');
const logger = require('../../../src/config/logger');
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
    mockHistory.length = 0;
    mockUpdates.length = 0;
    mockState.updateError = null;
    mockState.user = { ...USER_ROW };
    redis.store.clear();
    mockState.participation = undefined;
    mockState.whereCalls = [];
    mockState.whereInCalls = [];
    mockState.orderByCalls = [];
    jest.clearAllMocks();
    reverseGeocode.mockResolvedValue({ il: null, ilce: null });
  });

  test('konumsuz (boş body) çağrı kabul edilir ve kontrat alanlarıyla döner', async () => {
    const result = await service.create({ userId: 'u1', body: {}, ip: '1.2.3.4', userAgent: 'jest' });

    expect(result.ok).toBe(true);
    expect(typeof result.sosId).toBe('string');
    expect(typeof result.createdAt).toBe('string');
    expect(result.dispatchedTo).toBe('OGM Yangın Harekat Merkezi');
    expect(result.status).toBe('active');
    // Kontrat /emergency'den farklı: reportId/submittedAt DEĞİL.
    expect(result.reportId).toBeUndefined();
    expect(result.submittedAt).toBeUndefined();

    expect(mockInserted).toHaveLength(1);
    expect(mockInserted[0].lat).toBeNull();
    expect(mockInserted[0].lng).toBeNull();
    expect(mockInserted[0].status).toBe('active');

    // Geçmişteki ilk satır mobil kaynaklıdır — yanıt süresi operatör kaydından türer.
    expect(mockHistory).toHaveLength(1);
    expect(mockHistory[0]).toMatchObject({ event: 'SOS çağrısı gönderildi', by_kind: 'mobil' });
  });

  test('kullanıcı bilgileri satıra snapshot\'lanır (geri arama telefonu dahil)', async () => {
    await service.create({
      userId: 'u1',
      body: { coordinates: { lat: 36.8529, lng: 28.2661 } },
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    const row = mockInserted[0];
    expect(row.user_id).toBe('u1');
    expect(row.lat).toBe(36.8529);
    expect(row.lng).toBe(28.2661);
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
    ).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    expect(redis.incr).toHaveBeenCalledWith('rl:sos:u1');
    expect(await redis.ttl('rl:sos:u1')).toBe(60);
  });

  test('kullanıcı bulunamazsa 404 fırlatır ve kayıt yazmaz', async () => {
    mockState.user = undefined;
    await expect(
      service.create({ userId: 'ghost', body: {}, ip: '1.2.3.4', userAgent: 'jest' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockInserted).toHaveLength(0);
  });

  test('gönüllü aktif bir olayda yolda/sahada ise SOS o olaya bağlanır', async () => {
    mockState.participation = { mission_id: 'm1' };

    await service.create({ userId: 'u1', body: {}, ip: '1.2.3.4', userAgent: 'jest' });

    expect(mockInserted[0].mission_id).toBe('m1');
    expect(mockState.whereCalls).toEqual(
      expect.arrayContaining([
        ['mission_participants as mp', 'mp.user_id', 'u1'],
        ['mission_participants as mp', 'm.status', 'active'],
      ]),
    );
    expect(mockState.whereInCalls).toContainEqual([
      'mission_participants as mp',
      'mp.status',
      ['yolda', 'sahada'],
    ]);
  });

  test('birden çok katılım varsa en son güncellenen katılımın olayı seçilir', async () => {
    mockState.participation = { mission_id: 'm1' };

    await service.create({ userId: 'u1', body: {}, ip: '1.2.3.4', userAgent: 'jest' });

    expect(mockState.orderByCalls).toContainEqual(['mission_participants as mp', 'mp.updated_at', 'desc']);
  });

  test('aktif olayda yolda/sahada katılımı yoksa SOS yine kabul edilir, mission_id null', async () => {
    mockState.participation = undefined;

    const result = await service.create({ userId: 'u1', body: {}, ip: '1.2.3.4', userAgent: 'jest' });

    expect(result.ok).toBe(true);
    expect(mockInserted[0].mission_id).toBeNull();
  });
});

describe('sos.service.create — basıldığı yerin il/ilçesi', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const body = { coordinates: { lat: 36.8529, lng: 28.2661 } };

  beforeEach(() => {
    mockInserted.length = 0;
    mockUpdates.length = 0;
    mockState.updateError = null;
    mockState.user = { ...USER_ROW };
    redis.store.clear();
    mockState.whereCalls = [];
    jest.clearAllMocks();
  });

  test('geocode hiç dönmese de SOS yanıtı bekletilmez', async () => {
    reverseGeocode.mockReturnValue(new Promise(() => {}));

    const result = await service.create({ userId: 'u1', body, ip: '1.2.3.4', userAgent: 'jest' });

    expect(result.ok).toBe(true);
    expect(mockInserted).toHaveLength(1);
    expect(mockUpdates).toEqual([]);
  });

  test('kayıttan sonra koordinattan çözülen il/ilçe aynı satıra yazılır (süre sınırıyla)', async () => {
    reverseGeocode.mockResolvedValue({ il: 'Muğla', ilce: 'Marmaris' });

    const result = await service.create({ userId: 'u1', body, ip: '1.2.3.4', userAgent: 'jest' });
    await flush();

    expect(reverseGeocode).toHaveBeenCalledWith(36.8529, 28.2661, expect.objectContaining({
      maxWaitMs: expect.any(Number),
      timeoutMs: expect.any(Number),
    }));
    expect(Number.isFinite(reverseGeocode.mock.calls[0][2].maxWaitMs)).toBe(true);
    expect(mockUpdates).toEqual([
      expect.objectContaining({
        table: 'sos_reports',
        where: ['sos_reports', { id: result.sosId }],
        values: expect.objectContaining({ il: 'Muğla', ilce: 'Marmaris' }),
      }),
    ]);
  });

  test('il çözülemezse satır güncellenmez (backfill toparlar)', async () => {
    reverseGeocode.mockResolvedValue({ il: null, ilce: null });

    await service.create({ userId: 'u1', body, ip: '1.2.3.4', userAgent: 'jest' });
    await flush();

    expect(mockUpdates).toEqual([]);
  });

  test('arka plan yazımı patlarsa SOS etkilenmez, uyarı loglanır', async () => {
    reverseGeocode.mockResolvedValue({ il: 'Muğla', ilce: 'Marmaris' });
    mockState.updateError = new Error('ER_LOCK_WAIT_TIMEOUT');

    const result = await service.create({ userId: 'u1', body, ip: '1.2.3.4', userAgent: 'jest' });
    await flush();

    expect(result.ok).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('SOS konumu çözülemedi', expect.objectContaining({ sosId: result.sosId }));
  });

  test('konumsuz çağrıda geocode isteği atılmaz', async () => {
    await service.create({ userId: 'u1', body: {}, ip: '1.2.3.4', userAgent: 'jest' });
    await flush();

    expect(reverseGeocode).not.toHaveBeenCalled();
  });
});

describe('sos.service.mapAdminSos — bölge', () => {
  const row = { id: 's1', status: 'active', created_at: new Date('2026-10-20T10:00:00Z') };

  test('il/ilçe ve il\'den türeyen region/regionName döner', () => {
    const item = service.mapAdminSos({ ...row, il: 'Muğla', ilce: 'Marmaris' }, []);

    expect(item).toMatchObject({ il: 'Muğla', ilce: 'Marmaris', region: 'ege', regionName: 'Ege' });
  });

  test('il\'i çözülmemiş SOS için hepsi null', () => {
    const item = service.mapAdminSos({ ...row, il: null }, []);

    expect(item).toMatchObject({ il: null, ilce: null, region: null, regionName: null });
  });
});

describe('sos.service.mapAdminSos — bağlı olay', () => {
  const row = { id: 's1', status: 'active', created_at: new Date('2026-10-20T10:00:00Z') };

  test('missionId ve missionTitle döner', () => {
    const item = service.mapAdminSos({ ...row, mission_id: 'm1', mission_title: 'Marmaris Yangını' }, []);

    expect(item).toMatchObject({ missionId: 'm1', missionTitle: 'Marmaris Yangını' });
  });

  test('olaysız SOS için ikisi de null', () => {
    const item = service.mapAdminSos({ ...row, mission_id: null }, []);

    expect(item).toMatchObject({ missionId: null, missionTitle: null });
  });
});

describe('sos.service.adminList — bağlı olay başlığı', () => {
  beforeEach(() => {
    mockState.leftJoinCalls = [];
    mockState.selectCalls = [];
    mockState.adminRows = [
      { id: 's1', status: 'active', created_at: new Date('2026-10-20T10:00:00Z'), mission_id: 'm1', mission_title: 'Marmaris Yangını' },
    ];
    jest.clearAllMocks();
  });

  test('missions tablosunu join edip olay başlığını missionTitle olarak döner', async () => {
    const result = await service.adminList({}, { userId: 'a1' });

    expect(mockState.leftJoinCalls).toContainEqual(['missions as m', 'm.id', 'sr.mission_id']);
    expect(mockState.selectCalls[0]).toContain('m.title as mission_title');
    expect(result.items[0]).toMatchObject({ missionId: 'm1', missionTitle: 'Marmaris Yangını' });
  });
});
