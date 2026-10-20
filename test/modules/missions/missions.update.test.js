'use strict';

// PATCH /admin/missions/:id — kısmi güncelleme: gövdede olmayan alan değişmez, arşiv
// düzenlenemez. adminCreate toplanma noktası görevlisini de yazar.

const mockState = { mission: null, inserts: {}, updates: {}, updateAffects: 1 };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      whereIn: jest.fn(() => c),
      whereNot: jest.fn(() => c),
      first: jest.fn(async () => (table === 'missions' ? mockState.mission : undefined)),
      insert: jest.fn(async (row) => {
        mockState.inserts[table] = [...(mockState.inserts[table] || []), row];
        return [1];
      }),
      update: jest.fn(async (row) => {
        mockState.updates[table] = [...(mockState.updates[table] || []), row];
        return mockState.updateAffects;
      }),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  db.transaction = jest.fn(async (fn) => fn(db));
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
