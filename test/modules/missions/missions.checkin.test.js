'use strict';

// backend §5/§13 — eksiği olan gönüllü hiçbir göreve katılamaz (istisna yok) ve
// check-in ANINDA uygunluk yeniden değerlendirilir: engel varsa KAYIT OLUŞMAZ.

const mockState = {
  mission: null,
  user: null,
  participant: null,
  checkIn: null,
  engeller: [],
  inserts: {},
  updates: {},
  historyRows: [],
  whereInCalls: [],
  orderCalls: [],
};

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      whereNull: jest.fn(() => c),
      whereIn: jest.fn((col, values) => {
        mockState.whereInCalls.push([table, col, values]);
        return c;
      }),
      orderBy: jest.fn((...args) => {
        mockState.orderCalls.push([table, 'orderBy', ...args]);
        return c;
      }),
      orderByRaw: jest.fn((...args) => {
        mockState.orderCalls.push([table, 'orderByRaw', ...args]);
        return c;
      }),
      count: jest.fn(() => c),
      join: jest.fn(() => c),
      select: jest.fn(() => c),
      pluck: jest.fn(async () => []),
      first: jest.fn(async () => {
        if (table === 'missions') return mockState.mission;
        if (table === 'users') return mockState.user;
        if (table === 'mission_participants') return mockState.participant;
        // check_ins.first(): hem mevcut kayıt sorgusu hem sayaç bu yoldan geçer;
        // null sayaçta 0 olarak okunur (Number(row?.c || 0)).
        if (table === 'check_ins') return mockState.checkIn;
        return undefined;
      }),
      insert: jest.fn(async (row) => {
        mockState.inserts[table] = [...(mockState.inserts[table] || []), row];
        return [1];
      }),
      update: jest.fn(async (row) => {
        mockState.updates[table] = [...(mockState.updates[table] || []), row];
        return 1;
      }),
      then: (resolve, reject) =>
        Promise.resolve(table === 'missions' ? mockState.historyRows : []).then(resolve, reject),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  // Transaction callback'i aynı zincir üzerinden çalışır — arşivleme gibi çok tablolu
  // yazımlar whereInCalls/updates'e düşer.
  db.transaction = jest.fn(async (fn) => fn(db));
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/modules/missions/assemblyPoints.service', () => ({ close: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadiness: jest.fn(async () => ({
    zincir: { kkdDurumu: 'tam', eksikAdimlar: [], steps: [], tamam: true },
    kisiDurumu: 'hazir',
    mudahaleYetkisi: true,
    engeller: mockState.engeller,
  })),
}));

const env = require('../../../src/config/env');
const service = require('../../../src/modules/missions/missions.service');

const reset = () => {
  mockState.mission = { id: 'm1', title: 'Marmaris Yangını', status: 'active', is_active: 1 };
  mockState.user = { id: 'u1', ad: 'Ali', soyad: 'Yılmaz', tc_kimlik: '10000000146' };
  mockState.participant = null;
  mockState.checkIn = null;
  mockState.engeller = [];
  mockState.inserts = {};
  mockState.updates = {};
  mockState.historyRows = [];
  mockState.whereInCalls = [];
  mockState.orderCalls = [];
  env.admin.scanHmacSecret = '';
  jest.clearAllMocks();
};

describe('respond — katılım kararı', () => {
  beforeEach(reset);

  it('hazırlık zinciri tamamsa "yolda" kaydedilir', async () => {
    const result = await service.respond('u1', 'm1', 'yolda', {});

    expect(result).toEqual({ ok: true, userStatus: 'yolda' });
    expect(mockState.inserts.mission_participants[0].status).toBe('yolda');
  });

  it('eksik adım varsa katılım engellenir ve eksikler dönülür', async () => {
    mockState.engeller = [{ key: 'kkd', label: 'KKD teslimi' }];

    await expect(service.respond('u1', 'm1', 'yolda', {})).rejects.toMatchObject({
      status: 403,
      code: 'readiness_incomplete',
      details: { engeller: [{ key: 'kkd', label: 'KKD teslimi' }] },
    });
    expect(mockState.inserts.mission_participants).toBeUndefined();
  });

  it('"katilamiyor" kararı hazırlık zincirinden bağımsızdır', async () => {
    mockState.engeller = [{ key: 'kkd', label: 'KKD teslimi' }];

    const result = await service.respond('u1', 'm1', 'katilamiyor', {});
    expect(result.userStatus).toBe('katilamiyor');
  });

  it('sahada/tamamladı durumu mobilden geri alınamaz', async () => {
    mockState.participant = { id: 'p1', status: 'sahada' };

    await expect(service.respond('u1', 'm1', 'katilamiyor', {})).rejects.toMatchObject({
      code: 'status_locked',
    });
  });

  it('arşivlenmiş olaya katılım kararı verilemez', async () => {
    mockState.mission.status = 'archived';
    await expect(service.respond('u1', 'm1', 'yolda', {})).rejects.toMatchObject({ status: 404 });
  });
});

describe('scan — yangın sahası giriş kaydı', () => {
  beforeEach(reset);

  it('QR ile check-in kaydı oluşur ve durum sahada olur', async () => {
    const result = await service.scan('m1', { qr: 'OGM:VOL:u1' }, { role: 'officer' });

    expect(result.userStatus).toBe('sahada');
    expect(result.method).toBe('qr');
    expect(mockState.inserts.check_ins).toHaveLength(1);
    expect(result.volunteer.tcKimlikMasked).toBe('100******46');
  });

  it('QR okutulamazsa TC kimlik numarası yedek yöntemdir', async () => {
    const result = await service.scan('m1', { tcKimlik: '10000000146' }, {});

    expect(result.method).toBe('tc_manual');
    expect(mockState.inserts.check_ins).toHaveLength(1);
  });

  it('katılım engeli varsa KAYIT OLUŞMAZ — yalnızca uyarı değil', async () => {
    mockState.engeller = [{ key: 'komisyon', label: 'Komisyon onayı' }];

    await expect(service.scan('m1', { qr: 'OGM:VOL:u1' }, {})).rejects.toMatchObject({
      status: 403,
      code: 'readiness_incomplete',
    });
    expect(mockState.inserts.check_ins).toBeUndefined();
    expect(mockState.inserts.mission_participants).toBeUndefined();
  });

  it('arşivlenmiş olaya giriş kaydı alınamaz', async () => {
    mockState.mission.status = 'archived';

    await expect(service.scan('m1', { qr: 'OGM:VOL:u1' }, {})).rejects.toMatchObject({
      code: 'mission_archived',
    });
  });

  it('çağrılmamış gönüllü de check-in yapabilir (başka bölgeden destek)', async () => {
    mockState.participant = null;
    await service.scan('m1', { qr: 'OGM:VOL:u1' }, {});
    expect(mockState.inserts.mission_participants[0].status).toBe('sahada');
  });
});

describe('scan — HMAC signature (SCAN_HMAC_SECRET set)', () => {
  beforeEach(() => {
    reset();
    env.admin.scanHmacSecret = 'test-secret';
  });
  afterAll(() => {
    env.admin.scanHmacSecret = '';
  });

  const sign = (userId, missionId) =>
    require('crypto').createHmac('sha256', 'test-secret').update(`${userId}:${missionId}`).digest('hex');

  it('accepts an unsigned OGM:VOL QR — the officer device is the trust anchor', async () => {
    const result = await service.scan('m1', { qr: 'OGM:VOL:u1' }, { role: 'officer' });
    expect(result.userStatus).toBe('sahada');
    expect(mockState.inserts.check_ins).toHaveLength(1);
  });

  it('accepts the TC kimlik fallback without a token', async () => {
    const result = await service.scan('m1', { tcKimlik: '10000000146' }, {});
    expect(result.method).toBe('tc_manual');
    expect(mockState.inserts.check_ins).toHaveLength(1);
  });

  it('still requires a valid signature for the bare userId format', async () => {
    await expect(service.scan('m1', { userId: 'u1' }, {})).rejects.toMatchObject({
      status: 400,
      code: 'invalid_qr',
    });
    const ok = await service.scan('m1', { userId: 'u1', token: sign('u1', 'm1') }, {});
    expect(ok.userStatus).toBe('sahada');
  });

  it('answers 400 invalid_qr (never 500) for a wrong-length token', async () => {
    await expect(service.scan('m1', { userId: 'u1', token: 'short' }, {})).rejects.toMatchObject({
      status: 400,
      code: 'invalid_qr',
    });
    expect(mockState.inserts.check_ins).toBeUndefined();
  });

  it('rejects a same-length but wrong signature', async () => {
    await expect(
      service.scan('m1', { userId: 'u1', token: sign('u2', 'm1') }, {}),
    ).rejects.toMatchObject({ code: 'invalid_qr' });
  });
});

describe('history — missions the volunteer actually took part in', () => {
  beforeEach(reset);

  it('filters participants to yolda/sahada/tamamladi and exposes userStatus', async () => {
    mockState.historyRows = [
      { id: 'm1', title: 'Marmaris', status: 'archived', start_date: null, started_at: '2026-08-01T10:00:00Z', user_status: 'tamamladi' },
    ];

    const list = await service.listHistory('u1');

    expect(mockState.whereInCalls).toContainEqual([
      'missions',
      'mission_participants.status',
      ['yolda', 'sahada', 'tamamladi'],
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].userStatus).toBe('tamamladi');
    expect(list[0].startDate).toBe('2026-08-01');
  });

  it('orders newest first, falling back to started_at when start_date is missing', async () => {
    await service.listHistory('u1');

    // A plain orderBy('missions.start_date') would sink missions without a start_date.
    expect(mockState.orderCalls).toEqual([
      ['missions', 'orderByRaw', 'COALESCE(missions.start_date, missions.started_at) DESC'],
    ]);
  });

  it('detail rejects a volunteer who was only called (cagrildi)', async () => {
    mockState.participant = { id: 'p1', status: 'cagrildi' };
    await expect(service.getHistory('u1', 'm1')).rejects.toMatchObject({
      status: 403,
      code: 'not_participated',
    });
  });

  it('detail rejects a volunteer who declined (katilamiyor)', async () => {
    mockState.participant = { id: 'p1', status: 'katilamiyor' };
    await expect(service.getHistory('u1', 'm1')).rejects.toMatchObject({ code: 'not_participated' });
  });

  it('detail carries userStatus for an attended mission', async () => {
    mockState.participant = { id: 'p1', status: 'sahada' };
    const detail = await service.getHistory('u1', 'm1');
    expect(detail.userStatus).toBe('sahada');
  });
});

describe('adminArchive — arşiv terminaldir', () => {
  beforeEach(reset);

  it('zaten arşivlenmiş olay tekrar arşivlenemez ve Aktif\'e dönemez', async () => {
    mockState.mission.status = 'archived';
    await expect(service.adminArchive('m1', {})).rejects.toMatchObject({ code: 'already_archived' });
  });

  it('arşivleme yalnızca yolda/sahada katılımcıları tamamladi yapar, cagrildi geçmişe sızmaz', async () => {
    mockState.mission.status = 'active';
    await service.adminArchive('m1', {});

    const archiveCall = mockState.whereInCalls.find(
      ([table, col]) => table === 'mission_participants' && col === 'status',
    );
    expect(archiveCall).toBeDefined();
    expect(archiveCall[2]).toEqual(['yolda', 'sahada']);
    expect(archiveCall[2]).not.toContain('cagrildi');
    expect(mockState.updates.mission_participants).toEqual([
      expect.objectContaining({ status: 'tamamladi' }),
    ]);
  });
});
