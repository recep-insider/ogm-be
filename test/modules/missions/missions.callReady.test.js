'use strict';

const mockState = { candidates: [], inserts: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      leftJoin: jest.fn(() => c),
      where: jest.fn(() => c),
      whereNull: jest.fn(() => c),
      select: jest.fn(async () => mockState.candidates),
      first: jest.fn(async () => (table === 'missions' ? { id: 'm1', title: 'Marmaris Yangını', lat: null, lng: null } : undefined)),
      insert: jest.fn(async (row) => {
        if (table === 'mission_participants') mockState.inserts.push(row);
        return [1];
      }),
    };
    return c;
  };
  return { db: jest.fn((table) => makeChain(table)) };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/modules/missions/assemblyPoints.service', () => ({ close: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadiness: jest.fn(),
  getReadinessMany: jest.fn(),
}));

const readinessService = require('../../../src/modules/users/readiness.service');
const service = require('../../../src/modules/missions/missions.service');

describe('callReadyVolunteers — toplu hazırlık sorgusu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.inserts = [];
    mockState.candidates = [
      { id: 'u1', distance_km: null, base_lat: null, base_lng: null },
      { id: 'u2', distance_km: null, base_lat: null, base_lng: null },
      { id: 'u3', distance_km: null, base_lat: null, base_lng: null },
    ];
    readinessService.getReadinessMany.mockResolvedValue(
      new Map([
        ['u1', { kisiDurumu: 'basvuru' }],
        ['u2', { kisiDurumu: 'hazir' }],
        ['u3', { kisiDurumu: 'egitimde' }],
      ]),
    );
  });

  it('getReadinessMany tüm aday kimlikleriyle bir kez çağrılır, getReadiness hiç çağrılmaz', async () => {
    await service.callReadyVolunteers('m1');

    expect(readinessService.getReadinessMany).toHaveBeenCalledTimes(1);
    expect(readinessService.getReadinessMany).toHaveBeenCalledWith(['u1', 'u2', 'u3']);
    expect(readinessService.getReadiness).not.toHaveBeenCalled();
  });

  it('yalnızca hazır aday mission_participants satırı alır', async () => {
    await service.callReadyVolunteers('m1');

    expect(mockState.inserts).toHaveLength(1);
    expect(mockState.inserts[0]).toMatchObject({ user_id: 'u2', mission_id: 'm1', status: 'cagrildi' });
  });

  it('hazır olmayan iki aday notReady olarak sayılır', async () => {
    const result = await service.callReadyVolunteers('m1');

    expect(result).toMatchObject({ called: 1, notReady: 2 });
  });
});
