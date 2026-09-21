'use strict';

// mobil §16 / backend §4 — acil sınıfı kapatılamaz, kanal kategoriden türer,
// yarıçap bir baz konumdan ölçülür.

const mockState = { row: null, writes: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = () => {
    const c = {
      where: jest.fn(() => c),
      first: jest.fn(async () => mockState.row),
      update: jest.fn(async (row) => {
        mockState.writes.push(row);
        return 1;
      }),
      insert: jest.fn(async (row) => {
        mockState.writes.push(row);
        return [1];
      }),
    };
    return c;
  };
  const db = Object.assign(jest.fn(() => makeChain()), { raw: jest.fn() });
  return { db };
});

const service = require('../../../src/modules/notifications/preferences.service');

const ROW = {
  user_id: 'u1',
  task_calls: 1,
  trainings: 0,
  announcements: 1,
  distance_km: 50,
  distance_min: 5,
  distance_max: 200,
  base_lat: null,
  base_lng: null,
  base_il: null,
  base_ilce: null,
};

describe('preferences.get', () => {
  beforeEach(() => {
    mockState.row = { ...ROW };
    mockState.writes = [];
  });

  it('dört kategori döner ve acil en üstte, kapatılamaz, her zaman açıktır', async () => {
    const prefs = await service.get('u1');

    expect(prefs.categories.map((c) => c.key)).toEqual(['acil', 'gorev', 'egitim', 'bilgi']);
    expect(prefs.categories[0]).toMatchObject({ closable: false, enabled: true, channel: 'sms+push' });
  });

  it('SMS yalnızca acil sınıfına gider — diğer kategoriler push', async () => {
    const prefs = await service.get('u1');
    const pushOnly = prefs.categories.filter((c) => c.key !== 'acil');
    expect(pushOnly.every((c) => c.channel === 'push')).toBe(true);
  });

  it('kapatılmış kategori enabled:false döner ama acil etkilenmez', async () => {
    const prefs = await service.get('u1');
    expect(prefs.categories.find((c) => c.key === 'egitim').enabled).toBe(false);
    expect(prefs.categories.find((c) => c.key === 'acil').enabled).toBe(true);
  });

  it('acil sınıfı mesafe tercihini bypass eder', async () => {
    expect((await service.get('u1')).emergencyBypassesDistance).toBe(true);
  });

  it('baz konum seçilmemişse null döner', async () => {
    expect((await service.get('u1')).baseLocation).toBeNull();
  });
});

describe('preferences.update', () => {
  beforeEach(() => {
    mockState.row = { ...ROW };
    mockState.writes = [];
  });

  it('baz konum kaydedilir ve cevapta döner', async () => {
    const prefs = await service.update('u1', {
      baseLocation: { lat: 36.85, lng: 28.27, il: 'Muğla', ilce: 'Marmaris' },
    });

    expect(mockState.writes[0]).toMatchObject({ base_lat: 36.85, base_lng: 28.27, base_il: 'Muğla' });
    expect(prefs.baseLocation).toEqual({ lat: 36.85, lng: 28.27, il: 'Muğla', ilce: 'Marmaris' });
  });

  it('baseLocation null gönderilirse temizlenir', async () => {
    mockState.row = { ...ROW, base_lat: 36.85, base_lng: 28.27 };
    const prefs = await service.update('u1', { baseLocation: null });

    expect(mockState.writes[0].base_lat).toBeNull();
    expect(prefs.baseLocation).toBeNull();
  });

  it('gönderilmeyen baseLocation mevcut değeri korur', async () => {
    mockState.row = { ...ROW, base_lat: 36.85, base_lng: 28.27, base_il: 'Muğla' };
    await service.update('u1', { distanceKm: 80 });

    expect(mockState.writes[0]).toMatchObject({ base_lat: 36.85, distance_km: 80 });
  });

  it('sınır dışı mesafe reddedilir', async () => {
    await expect(service.update('u1', { distanceKm: 500 })).rejects.toMatchObject({ status: 400 });
  });
});
