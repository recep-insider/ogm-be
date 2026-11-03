'use strict';

// backend §4 — kanal kategoriden türer, operatör seçmez; acil sınıfı SMS + push ve
// tercih bypass'lı, diğer her şey push.

const mockState = { users: [], prefs: null, participants: [], inserts: {}, updates: {}, readiness: {}, mission: null, order: [], failLogUpdate: false };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const nullCols = [];
    let cities = null;
    const isUsers = table === 'users' || table === 'users as u';
    // Bölge süzmesi `u.il` üzerinden whereIn ile gelir.
    const scopedUsers = () => mockState.users.filter((u) => !cities || cities.includes(u.il));
    const c = {
      where: jest.fn(() => c),
      join: jest.fn(() => c),
      leftJoin: jest.fn(() => c),
      select: jest.fn(() => c),
      whereNull: jest.fn((col) => {
        nullCols.push(col);
        return c;
      }),
      whereIn: jest.fn((col, values) => {
        if (col === 'u.il') cities = values;
        return c;
      }),
      orderBy: jest.fn(() => c),
      limit: jest.fn(() => c),
      offset: jest.fn(() => c),
      clone: jest.fn(() => c),
      count: jest.fn(() => c),
      pluck: jest.fn(async () => {
        if (isUsers) return scopedUsers().map((u) => u.id);
        if (table === 'mission_participants as mp') {
          // Katılımcı satırı silinen hesapta da kalır; süzme users join'i üzerinden yapılmalı.
          return mockState.participants
            .filter((p) => !(nullCols.includes('u.deleted_at') && p.deleted_at))
            .map((p) => p.id);
        }
        return [];
      }),
      first: jest.fn(async () => {
        if (table === 'missions') return mockState.mission;
        if (table === 'users') return mockState.users[0];
        return undefined;
      }),
      insert: jest.fn(async (row) => {
        mockState.order.push(`insert:${table}`);
        mockState.inserts[table] = [...(mockState.inserts[table] || []), row];
        return [1];
      }),
      update: jest.fn(async (row) => {
        if (table === 'notification_log' && mockState.failLogUpdate) throw new Error('log down');
        mockState.order.push(`update:${table}`);
        mockState.updates[table] = [...(mockState.updates[table] || []), row];
        return 1;
      }),
      then: (resolve, reject) => Promise.resolve(isUsers ? scopedUsers() : []).then(resolve, reject),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn(async () => ({ sent: 1, failed: 0 })) }));
jest.mock('../../../src/shared/sms-provider', () => ({ sendSms: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadiness: jest.fn(async (id) => mockState.readiness[id]),
  getReadinessMany: jest.fn(async (ids) => new Map(ids.map((id) => [id, mockState.readiness[id]]))),
}));

const { writeAudit } = require('../../../src/shared/audit');
const { sendPushToUser } = require('../../../src/shared/push-provider');
const { sendSms } = require('../../../src/shared/sms-provider');
const service = require('../../../src/modules/notifications/dispatch.service');

beforeEach(() => {
  mockState.users = [{ id: 'u1', phone: '+905321112233' }];
  mockState.participants = [{ id: 'u2', deleted_at: null }];
  mockState.inserts = {};
  mockState.updates = {};
  mockState.order = [];
  mockState.failLogUpdate = false;
  mockState.mission = { id: 'm1', title: 'Marmaris Yangını', lat: null, lng: null };
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

  it('olay bazlı "hazir" segmenti yalnızca hazır gönüllüye push gönderir, hazırlık tek sorguda okunur', async () => {
    const { getReadinessMany } = require('../../../src/modules/users/readiness.service');
    mockState.users = [{ id: 'u1' }, { id: 'u9' }];
    mockState.readiness.u9 = { kisiDurumu: 'basvuru', zincir: { komisyon: 'pending', eksikAdimlar: ['komisyon'] } };

    await service.send(
      { category: 'gorev', title: 'Çağrı', body: 'x', missionId: 'm1', segments: ['hazir'] },
      {},
    );

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith('u1', expect.anything());
    expect(getReadinessMany).toHaveBeenCalledTimes(1);
    expect(getReadinessMany).toHaveBeenCalledWith(['u1', 'u9']);
  });

  it('olay bazlı gönderim silinmiş (KVKK) katılımcıyı hedeflemez', async () => {
    mockState.participants = [{ id: 'u2', deleted_at: null }, { id: 'u3', deleted_at: new Date('2026-10-01') }];

    const result = await service.send(
      { category: 'acil', title: 'Tahliye', body: 'x', missionId: 'm1', segments: ['yolda', 'sahada'] },
      {},
    );

    expect(result.recipients).toBe(1);
    expect(sendPushToUser).not.toHaveBeenCalledWith('u3', expect.anything());
  });

  it('gönderim denetim izine yazılır', async () => {
    await service.send({ category: 'bilgi', title: 'Duyuru', body: 'x', audience: 'tumu' }, {});
    expect(mockState.inserts.notification_log).toHaveLength(1);
    expect(mockState.inserts.notification_log[0]).toMatchObject({ category: 'bilgi', push_count: 0 });
    expect(mockState.updates.notification_log[0]).toMatchObject({ push_count: 1 });
  });

  it('gönderim yarıda kesilirse gidenlerin sayısı ve eksik gönderim denetim izine yine yazılır', async () => {
    mockState.users = [{ id: 'u1' }, { id: 'u2' }];
    sendPushToUser.mockResolvedValueOnce({ sent: 1, failed: 0 }).mockRejectedValueOnce(new Error('db down'));

    await expect(service.send({ category: 'bilgi', title: 'Duyuru', body: 'x', audience: 'tumu' }, {}))
      .rejects.toThrow('db down');

    expect(mockState.updates.notification_log[0]).toMatchObject({ push_count: 1 });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'notifications.send',
      payload: expect.objectContaining({ recipients: 2, pushCount: 1, incomplete: true }),
    }));
  });

  it('sayı kaydı da düşerse asıl gönderim hatası gizlenmez; hata loglanır, denetim izi yine yazılır', async () => {
    const logger = require('../../../src/config/logger');
    const error = jest.spyOn(logger, 'error').mockImplementation(() => {});
    mockState.users = [{ id: 'u1' }, { id: 'u2' }];
    mockState.failLogUpdate = true;
    sendPushToUser.mockResolvedValueOnce({ sent: 1, failed: 0 }).mockRejectedValueOnce(new Error('fcm down'));

    await expect(service.send({ category: 'bilgi', title: 'Duyuru', body: 'x', audience: 'tumu' }, {}))
      .rejects.toThrow('fcm down');
    expect(error).toHaveBeenCalledWith('Bildirim sayıları kaydedilemedi', expect.objectContaining({ pushCount: 1, error: 'log down' }));
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'notifications.send',
      payload: expect.objectContaining({ pushCount: 1, incomplete: true }),
    }));
    error.mockRestore();
  });

  it('kayıt gönderimden önce yazılır; push verisi notificationId taşır (K5)', async () => {
    await service.send({ category: 'bilgi', title: 'Duyuru', body: 'x', audience: 'tumu' }, {});

    const { id } = mockState.inserts.notification_log[0];
    expect(sendPushToUser).toHaveBeenCalledWith('u1', expect.objectContaining({
      data: expect.objectContaining({ notificationId: id }),
    }));
    expect(mockState.order).toEqual(['insert:notification_log', 'update:notification_log']);
  });
});

describe('olaya bağlı gönderimde mesafe tercihi (K6)', () => {
  const READY = { kisiDurumu: 'hazir', zincir: { komisyon: 'approved', eksikAdimlar: [] } };
  // Marmaris yangını; yakın gönüllü Marmaris'te, uzak gönüllü İstanbul'da.
  const MARMARIS = { lat: 36.85, lng: 28.27 };

  beforeEach(() => {
    mockState.mission = { id: 'm1', title: 'Marmaris Yangını', ...MARMARIS };
    mockState.users = [
      { id: 'yakin', distance_km: 25, base_lat: 36.86, base_lng: 28.25 },
      { id: 'uzak', distance_km: 25, base_lat: 41.01, base_lng: 28.97 },
      { id: 'konumsuz', distance_km: null, base_lat: null, base_lng: null },
    ];
    mockState.readiness = { yakin: READY, uzak: READY, konumsuz: READY };
    mockState.participants = [{ id: 'sahadaki', deleted_at: null }];
  });

  it.each([['gorev'], ['acil']])('%s: hazır gönüllülerden yalnız mesafe tercihi olayı kapsayanlar alır', async (category) => {
    const result = await service.send({ category, title: 'x', body: 'y', missionId: 'm1', segments: ['hazir'] }, {});

    const ids = sendPushToUser.mock.calls.map(([id]) => id);
    expect(ids).toEqual(expect.arrayContaining(['yakin', 'konumsuz']));
    expect(ids).not.toContain('uzak');
    expect(result.recipients).toBe(2);
  });

  it('olaya katılmış olanlar mesafeden bağımsız alır (hazır ∪ katılımcı)', async () => {
    await service.send({ category: 'acil', title: 'x', body: 'y', missionId: 'm1', segments: ['hazir', 'sahada'] }, {});

    const ids = sendPushToUser.mock.calls.map(([id]) => id);
    expect(ids).toEqual(expect.arrayContaining(['yakin', 'konumsuz', 'sahadaki']));
    expect(ids).not.toContain('uzak');
  });

  it('olaysız acil duyuruda mesafe uygulanmaz, seçilen kitle alır', async () => {
    const result = await service.send({ category: 'acil', title: 'x', body: 'y', audience: 'tumu' }, {});
    expect(result.recipients).toBe(3);
  });
});

describe('bölge seçimi (K8)', () => {
  beforeEach(() => {
    mockState.users = [
      { id: 'mugla', il: 'Muğla' },
      { id: 'antalya', il: 'Antalya' },
      { id: 'ilsiz', il: null },
    ];
  });

  it('bölge verilince genel bildirim yalnız o bölgedeki gönüllülere gider; hedef denetim izinde', async () => {
    const result = await service.send({ category: 'bilgi', title: 'x', body: 'y', audience: 'tumu', region: 'ege' }, {});

    expect(sendPushToUser.mock.calls.map(([id]) => id)).toEqual(['mugla']);
    expect(result.recipients).toBe(1);
    expect(JSON.parse(mockState.inserts.notification_log[0].target)).toEqual({ kind: 'general', audience: 'tumu', region: 'ege' });
  });

  it('Tüm Bölgeler (all) ya da bölge yoksa süzme yapılmaz', async () => {
    expect((await service.send({ category: 'bilgi', title: 'x', body: 'y', audience: 'tumu', region: 'all' }, {})).recipients).toBe(3);
    expect((await service.send({ category: 'bilgi', title: 'x', body: 'y', audience: 'tumu' }, {})).recipients).toBe(3);
  });

  it('olaya bağlı gönderimde bölge hazır gönüllüleri süzer, katılımcıları süzmez', async () => {
    mockState.readiness = {
      mugla: { kisiDurumu: 'hazir', zincir: {} },
      antalya: { kisiDurumu: 'hazir', zincir: {} },
      ilsiz: { kisiDurumu: 'hazir', zincir: {} },
    };
    mockState.participants = [{ id: 'yolda', deleted_at: null }];

    await service.send({ category: 'gorev', title: 'x', body: 'y', missionId: 'm1', segments: ['hazir', 'yolda'], region: 'ege' }, {});

    expect(sendPushToUser.mock.calls.map(([id]) => id).sort()).toEqual(['mugla', 'yolda']);
  });
});

describe('pushCount yalnız sağlayıcının kabul ettiği teslimi sayar', () => {
  it.each([
    ['cihazı yok', { sent: 0, noDevices: true }],
    ['tercihini kapatmış', { sent: 0, skipped: true }],
    ['sağlayıcı hatası', { sent: 0, error: 'timeout' }],
    ['tüm token reddedildi', { sent: 0, failed: 2 }],
    ['mock sağlayıcı', { sent: 1, failed: 0, mock: true }],
  ])('%s → sayılmaz', async (_label, outcome) => {
    mockState.users = [{ id: 'u1' }, { id: 'u2' }];
    sendPushToUser.mockResolvedValueOnce({ sent: 2, failed: 0 }).mockResolvedValueOnce(outcome);

    const result = await service.send({ category: 'bilgi', title: 'Duyuru', body: 'x', audience: 'tumu' }, {});

    expect(result.recipients).toBe(2);
    expect(result.pushCount).toBe(1);
    expect(mockState.updates.notification_log[0]).toMatchObject({ push_count: 1 });
    // Zaman çizelgesi hedef kitleyi denetim izinden okur.
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'notifications.send',
      payload: expect.objectContaining({ recipients: 2, pushCount: 1 }),
    }));
  });
});
