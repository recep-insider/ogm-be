'use strict';

// backend §4 — kanal kategoriden türer, operatör seçmez; acil sınıfı SMS + push ve
// tercih bypass'lı, diğer her şey push.

const mockState = { users: [], prefs: null, participants: [], inserts: {}, readiness: {} };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      whereNull: jest.fn(() => c),
      whereIn: jest.fn(() => c),
      orderBy: jest.fn(() => c),
      limit: jest.fn(() => c),
      offset: jest.fn(() => c),
      clone: jest.fn(() => c),
      count: jest.fn(() => c),
      pluck: jest.fn(async () => {
        if (table === 'users') return mockState.users.map((u) => u.id);
        if (table === 'mission_participants') return mockState.participants;
        return [];
      }),
      first: jest.fn(async () => {
        if (table === 'missions') return { id: 'm1', title: 'Marmaris Yangını' };
        if (table === 'users') return mockState.users[0];
        return undefined;
      }),
      insert: jest.fn(async (row) => {
        mockState.inserts[table] = [...(mockState.inserts[table] || []), row];
        return [1];
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
jest.mock('../../../src/shared/sms-provider', () => ({ sendSms: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadiness: jest.fn(async (id) => mockState.readiness[id]),
}));

const { sendPushToUser } = require('../../../src/shared/push-provider');
const { sendSms } = require('../../../src/shared/sms-provider');
const service = require('../../../src/modules/notifications/dispatch.service');

beforeEach(() => {
  mockState.users = [{ id: 'u1', phone: '+905321112233' }];
  mockState.participants = ['u2'];
  mockState.inserts = {};
  mockState.readiness = {
    u1: { kisiDurumu: 'hazir', zincir: { komisyon: 'approved', eksikAdimlar: [] } },
  };
  jest.clearAllMocks();
});

describe('kanal kategoriden türer', () => {
  it('acil → push + SMS', async () => {
    const result = await service.send(
      { category: 'acil', title: 'Tahliye', body: 'Bölgeyi terk edin', audience: 'tumu' },
      {},
    );

    expect(result.channel).toBe('sms+push');
    expect(sendPushToUser).toHaveBeenCalledWith('u1', expect.objectContaining({ topic: 'acil' }));
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it('eğitim duyurusu SMS DEĞİL push kanalından gider', async () => {
    const result = await service.send(
      { category: 'egitim', title: 'Saha eğitimi', body: 'Yarın 09:00', audience: 'tumu' },
      {},
    );

    expect(result.channel).toBe('push');
    expect(sendPushToUser).toHaveBeenCalledWith('u1', expect.objectContaining({ topic: 'trainings' }));
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('tanımsız kategori reddedilir', async () => {
    await expect(service.send({ category: 'reklam', title: 'x', body: 'y' }, {})).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('hedef kitle', () => {
  it('olay bazlı gönderim segmentteki katılımcılara gider (Sahada/Yolda dahil)', async () => {
    const result = await service.send(
      {
        category: 'acil',
        title: 'Toplanma noktası değişti',
        body: 'Yeni nokta: stadyum',
        missionId: 'm1',
        segments: ['yolda', 'sahada'],
      },
      {},
    );

    expect(result.recipients).toBe(1);
    expect(sendPushToUser).toHaveBeenCalledWith('u2', expect.anything());
  });

  it('genel gönderimde "hazir" yalnızca hazır gönüllüleri kapsar', async () => {
    mockState.users = [{ id: 'u1' }, { id: 'u9' }];
    mockState.readiness.u9 = { kisiDurumu: 'basvuru', zincir: { komisyon: 'pending', eksikAdimlar: ['komisyon'] } };

    const result = await service.send({ category: 'gorev', title: 'Çağrı', body: 'x', audience: 'hazir' }, {});

    expect(result.recipients).toBe(1);
  });

  it('"egitim_bekleyen" komisyonu onaylı ama eğitimi eksik olanı kapsar', async () => {
    mockState.users = [{ id: 'u1' }, { id: 'u7' }];
    mockState.readiness.u7 = {
      kisiDurumu: 'basvuru',
      zincir: { komisyon: 'approved', eksikAdimlar: ['teorik'] },
    };

    const result = await service.send(
      { category: 'egitim', title: 'Eğitim', body: 'x', audience: 'egitim_bekleyen' },
      {},
    );

    expect(result.recipients).toBe(1);
  });

  it('gönderim denetim izine yazılır', async () => {
    await service.send({ category: 'bilgi', title: 'Duyuru', body: 'x', audience: 'tumu' }, {});
    expect(mockState.inserts.notification_log).toHaveLength(1);
    expect(mockState.inserts.notification_log[0]).toMatchObject({ category: 'bilgi', push_count: 1 });
  });
});
