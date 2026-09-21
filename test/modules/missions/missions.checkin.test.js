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
};

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      whereNull: jest.fn(() => c),
      whereIn: jest.fn(() => c),
      orderBy: jest.fn(() => c),
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
      then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadiness: jest.fn(async () => ({
    zincir: { kkdDurumu: 'tam', eksikAdimlar: [], steps: [], tamam: true },
    kisiDurumu: 'hazir',
    mudahaleYetkisi: true,
    engeller: mockState.engeller,
  })),
}));

const service = require('../../../src/modules/missions/missions.service');

const reset = () => {
  mockState.mission = { id: 'm1', title: 'Marmaris Yangını', status: 'active', is_active: 1 };
  mockState.user = { id: 'u1', ad: 'Ali', soyad: 'Yılmaz', tc_kimlik: '10000000146' };
  mockState.participant = null;
  mockState.checkIn = null;
  mockState.engeller = [];
  mockState.inserts = {};
  mockState.updates = {};
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

describe('adminArchive — arşiv terminaldir', () => {
  beforeEach(reset);

  it('zaten arşivlenmiş olay tekrar arşivlenemez ve Aktif\'e dönemez', async () => {
    mockState.mission.status = 'archived';
    await expect(service.adminArchive('m1', {})).rejects.toMatchObject({ code: 'already_archived' });
  });
});
