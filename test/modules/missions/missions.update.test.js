'use strict';

// PATCH /admin/missions/:id — kısmi güncelleme: gövdede olmayan alan değişmez, arşiv
// düzenlenemez. adminCreate toplanma noktası görevlisini de yazar.

const mockState = { mission: null, inserts: {}, updates: {}, updateAffects: 1, lastNo: 1, ops: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = (conn, table) => {
    const c = {
      where: jest.fn(() => c),
      whereIn: jest.fn(() => c),
      whereNot: jest.fn(() => c),
      forUpdate: jest.fn(() => {
        mockState.ops.push([conn, table, 'forUpdate']);
        return c;
      }),
      first: jest.fn(async () => {
        if (table === 'mission_ref_counters') return { last_no: mockState.lastNo };
        return table === 'missions' ? mockState.mission : undefined;
      }),
      insert: jest.fn((row) => {
        mockState.ops.push([conn, table, 'insert']);
        mockState.inserts[table] = [...(mockState.inserts[table] || []), row];
        return Object.assign(Promise.resolve([1]), {
          onConflict: jest.fn((col) => ({
            merge: jest.fn(async (patch) => {
              mockState.ops.push([conn, table, 'upsert', col, patch]);
              return [1];
            }),
          })),
        });
      }),
      update: jest.fn(async (row) => {
        mockState.updates[table] = [...(mockState.updates[table] || []), row];
        return mockState.updateAffects;
      }),
    };
    return c;
  };
  const trx = Object.assign(jest.fn((table) => makeChain('trx', table)), { raw: jest.fn((sql) => ({ sql })) });
  const db = Object.assign(jest.fn((table) => makeChain('db', table)), { raw: jest.fn(), trx });
  db.transaction = jest.fn(async (fn) => fn(trx));
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/modules/missions/assemblyPoints.service', () => ({ close: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({ getReadiness: jest.fn() }));

const { writeAudit } = require('../../../src/shared/audit');
const service = require('../../../src/modules/missions/missions.service');

const reset = () => {
  mockState.mission = { id: 'm1', title: 'Marmaris Yangını', status: 'active', description: 'Eski' };
  mockState.inserts = {};
  mockState.updates = {};
  mockState.updateAffects = 1;
  mockState.lastNo = 1;
  mockState.ops = [];
  jest.clearAllMocks();
};

describe('adminUpdate — kısmi güncelleme', () => {
  beforeEach(reset);

  it('yalnızca gönderilen alanlar update satırına girer', async () => {
    const result = await service.adminUpdate('m1', { title: 'Yeni Başlık', il: 'Muğla' }, { userId: 'a1' });

    expect(result).toEqual({ ok: true, missionId: 'm1' });
    const [row] = mockState.updates.missions;
    expect(Object.keys(row).sort()).toEqual(['il', 'title', 'updated_at']);
    expect(row).toMatchObject({ title: 'Yeni Başlık', il: 'Muğla' });
    expect(row.updated_at).toBeInstanceOf(Date);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'missions.update', entityId: 'm1', payload: { fields: ['title', 'il'] } }),
    );
  });

  it('camelCase alanlar kolonlarına eşlenir', async () => {
    await service.adminUpdate('m1', {
      fullTitle: 'Tam', shortLocation: 'Kısa', ilce: 'Datça', regionLabel: 'Ege', locationLabel: 'Konum',
    });

    expect(mockState.updates.missions[0]).toMatchObject({
      full_title: 'Tam', short_location: 'Kısa', ilce: 'Datça', region_label: 'Ege', location_label: 'Konum',
    });
  });

  it.each([[''], [null]])('description %p gönderilirse temizlenir', async (value) => {
    await service.adminUpdate('m1', { description: value });

    expect(mockState.updates.missions[0]).toHaveProperty('description', null);
  });

  it('coordinates lat/lng kolonlarına yazılır', async () => {
    await service.adminUpdate('m1', { coordinates: { lat: 36.85, lng: 28.27 } });

    const [row] = mockState.updates.missions;
    expect(row).toMatchObject({ lat: 36.85, lng: 28.27 });
    expect(row).not.toHaveProperty('coordinates');
    expect(row).not.toHaveProperty('description');
  });

  it('arşivlenmiş olay düzenlenemez — 409 mission_archived, update yok', async () => {
    mockState.mission.status = 'archived';

    await expect(service.adminUpdate('m1', { title: 'X' })).rejects.toMatchObject({
      status: 409,
      code: 'mission_archived',
    });
    expect(mockState.updates.missions).toBeUndefined();
  });

  it('okuma ile güncelleme arasında arşivlenen olay da 409 mission_archived', async () => {
    mockState.updateAffects = 0;

    await expect(service.adminUpdate('m1', { title: 'Yeni' })).rejects.toMatchObject({ status: 409, code: 'mission_archived' });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it.each([['fullTitle', 'full_title'], ['il', 'il'], ['ilce', 'ilce'], ['regionLabel', 'region_label'], ['locationLabel', 'location_label']])(
    '%s boş gönderilirse temizlenir',
    async (key, column) => {
      await service.adminUpdate('m1', { [key]: '' });

      expect(mockState.updates.missions[0][column]).toBeNull();
    },
  );

  it('olay yoksa 404 mission_not_found', async () => {
    mockState.mission = undefined;

    await expect(service.adminUpdate('yok', { title: 'X' })).rejects.toMatchObject({
      status: 404,
      code: 'mission_not_found',
    });
    expect(mockState.updates.missions).toBeUndefined();
  });
});

describe('adminCreate — toplanma noktası görevlisi', () => {
  beforeEach(reset);

  const body = (assemblyPoint) => ({
    title: 'Olay',
    shortLocation: 'Marmaris',
    coordinates: { lat: 36.85, lng: 28.27 },
    assemblyPoint: { name: 'Okul bahçesi', coordinates: { lat: 36.86, lng: 28.28 }, ...assemblyPoint },
  });

  it('görevli adı ve telefonu noktaya yazılır', async () => {
    await service.adminCreate(body({ officerName: 'Mehmet Kaya', officerPhone: '+90 532 111 22 33' }));

    expect(mockState.inserts.assembly_points[0]).toMatchObject({
      officer_name: 'Mehmet Kaya',
      officer_phone: '+90 532 111 22 33',
    });
  });

  it('boş veya verilmemiş görevli alanları null yazılır', async () => {
    await service.adminCreate(body({ officerName: '' }));

    expect(mockState.inserts.assembly_points[0]).toMatchObject({ officer_name: null, officer_phone: null });
  });
});

describe('adminCreate — olay numarası', () => {
  beforeEach(reset);
  afterEach(() => jest.useRealTimers());

  const body = {
    title: 'Olay',
    shortLocation: 'Marmaris',
    coordinates: { lat: 36.85, lng: 28.27 },
    assemblyPoint: { name: 'Okul bahçesi', coordinates: { lat: 36.86, lng: 28.28 } },
  };

  it('sayaç aynı işlemde artırılıp kilitlenir, numara olay satırına yazılır ve döner', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-22T09:00:00Z') });
    mockState.lastNo = 123;

    const result = await service.adminCreate(body, { userId: 'p1' });

    expect(result.refNo).toBe('OGM-2026-000123');
    expect(mockState.inserts.missions[0].ref_no).toBe('OGM-2026-000123');
    expect(mockState.inserts.mission_ref_counters).toEqual([{ year: 2026, last_no: 1 }]);
    const ops = mockState.ops.map(([conn, table, op]) => `${conn}:${table}:${op}`);
    expect(ops.slice(0, 4)).toEqual([
      'trx:mission_ref_counters:insert',
      'trx:mission_ref_counters:upsert',
      'trx:mission_ref_counters:forUpdate',
      'trx:missions:insert',
    ]);
    const [, , , col, patch] = mockState.ops[1];
    expect(col).toBe('year');
    expect(patch).toEqual({ last_no: { sql: 'last_no + 1' } });
  });

  it('yıl Türkiye saatine göre alınır — 31 Aralık 22:30 UTC yeni yılın ilk numarasıdır', async () => {
    jest.useFakeTimers({ now: new Date('2026-12-31T22:30:00Z') });

    const result = await service.adminCreate(body, {});

    expect(result.refNo).toBe('OGM-2027-000001');
    expect(mockState.inserts.mission_ref_counters).toEqual([{ year: 2027, last_no: 1 }]);
  });

  it('oluştururken bağlanan ihbarlar için bağ denetim kaydı işlem içinde yazılır', async () => {
    const { db } = require('../../../src/config/db');

    await service.adminCreate({ ...body, linkedReportIds: ['r1', 'r2'] }, { userId: 'p1' });

    const linkCall = writeAudit.mock.calls.find(([a]) => a.action === 'fire_reports.link');
    expect(linkCall[0]).toMatchObject({ userId: 'p1', entity: 'mission', payload: { reportIds: ['r1', 'r2'] } });
    expect(linkCall[0].entityId).toBe(mockState.inserts.missions[0].id);
    expect(linkCall[1]).toBe(db.trx);
  });

  it('ihbar bağlanmadan oluşturulan olayda bağ kaydı yazılmaz', async () => {
    await service.adminCreate(body, {});

    expect(writeAudit.mock.calls.some(([a]) => a.action === 'fire_reports.link')).toBe(false);
  });
});
