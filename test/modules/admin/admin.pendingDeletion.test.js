'use strict';

// K3: panel "Silinme sürecinde" listesi — silinmiş ama henüz anonimleşmemiş hesaplar.

const mockCalls = [];
let mockRows = [];

jest.mock('../../../src/config/db', () => {
  const makeChain = (state = { counting: false }) => {
    const c = {};
    for (const m of ['where', 'select', 'orderBy', 'limit', 'offset', 'on', 'andOn', 'whereRaw']) c[m] = jest.fn(() => c);
    for (const m of ['whereNull', 'whereNotNull']) {
      c[m] = jest.fn((col) => {
        mockCalls.push(`${m}:${col}`);
        return c;
      });
    }
    c.leftJoin = jest.fn((_t, fn) => {
      if (typeof fn === 'function') fn.call(c);
      return c;
    });
    c.clone = jest.fn(() => makeChain({ counting: false }));
    c.count = jest.fn(() => {
      state.counting = true;
      return c;
    });
    c.then = (resolve, reject) =>
      Promise.resolve(state.counting ? [{ total: mockRows.length }] : mockRows).then(resolve, reject);
    return c;
  };
  const db = Object.assign(jest.fn(() => makeChain()), { raw: jest.fn(() => 'raw') });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadinessMany: jest.fn(async (ids) =>
    new Map(ids.map((id) => [id, {
      kisiDurumu: 'pasif',
      mudahaleYetkisi: false,
      komisyon: { decision: 'approved' },
      zincir: { kkdDurumu: 'yok', eksikAdimlar: [], siradakiAdim: null },
    }])),
  ),
}));

const { listVolunteers } = require('../../../src/modules/admin/admin.service');

beforeEach(() => {
  mockCalls.length = 0;
  mockRows = [];
});

describe('admin.service — listVolunteers pendingDeletion', () => {
  it('varsayılan liste silinmiş hesapları dışarıda bırakır', async () => {
    await listVolunteers({});
    expect(mockCalls).toContain('whereNull:u.deleted_at');
    expect(mockCalls).not.toContain('whereNotNull:u.deleted_at');
  });

  it('pendingDeletion yalnız silinmiş ve anonimleşmemiş hesapları ister', async () => {
    await listVolunteers({ pendingDeletion: true });
    expect(mockCalls).toEqual(expect.arrayContaining(['whereNotNull:u.deleted_at', 'whereNull:u.anonymized_at']));
    expect(mockCalls).not.toContain('whereNull:u.deleted_at');
  });

  it('satırda silme tarihi, anonimleştirme tarihi ve kalan gün döner', async () => {
    const deletedAt = new Date(Date.now() - 10 * 86400 * 1000);
    mockRows = [{ id: 'u1', ad: 'Ayşe', deleted_at: deletedAt, is_active: 0 }];

    const { items, total } = await listVolunteers({ pendingDeletion: true });

    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      userId: 'u1',
      pendingDeletion: true,
      deletedAt: deletedAt.toISOString(),
      deletionDueAt: new Date(deletedAt.getTime() + 30 * 86400 * 1000).toISOString(),
      deletionDaysLeft: 20,
    });
  });

  it('silinmemiş satıra silme alanı eklenmez', async () => {
    mockRows = [{ id: 'u2', ad: 'Ali', deleted_at: null, is_active: 1 }];
    const { items } = await listVolunteers({});
    expect(items[0]).not.toHaveProperty('pendingDeletion');
    expect(items[0]).not.toHaveProperty('deletedAt');
  });
});
