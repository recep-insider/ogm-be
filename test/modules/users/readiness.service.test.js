'use strict';

// Bellek içi knex taklidi: collect'in kullandığı where/whereIn/join/orderBy/select/first/pluck
// alt kümesini gerçekten süzer, böylece toplu ve tekil yol aynı tablolardan okunur.
const mockTables = {};
const mockCalls = [];

jest.mock('../../../src/config/db', () => {
  const split = (ref) => {
    const [name, alias] = ref.split(/\s+as\s+/i);
    return { name, alias: alias || name };
  };
  const qualify = (alias, row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [`${alias}.${k}`, v]));

  const makeQuery = (ref) => {
    const base = split(ref);
    let rows = (mockTables[base.name] || []).map((r) => qualify(base.alias, r));
    let selected = null;
    const col = (c) => (c.includes('.') ? c : `${base.alias}.${c}`);
    const project = (r) => {
      if (!selected) {
        const prefix = `${base.alias}.`;
        return Object.fromEntries(
          Object.entries(r).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]),
        );
      }
      return Object.fromEntries(selected.map((c) => [c.split('.').pop(), r[col(c)]]));
    };
    const q = {
      where(obj, val) {
        const conds = typeof obj === 'string' ? { [obj]: val } : obj;
        rows = rows.filter((r) => Object.entries(conds).every(([k, v]) => r[col(k)] === v));
        return q;
      },
      whereIn(c, vals) {
        rows = rows.filter((r) => vals.includes(r[col(c)]));
        return q;
      },
      join(ref2, left, right) {
        const other = split(ref2);
        const others = (mockTables[other.name] || []).map((r) => qualify(other.alias, r));
        rows = rows.flatMap((r) => others.filter((o) => o[left] === r[right])
          .map((o) => ({ ...r, ...o })));
        return q;
      },
      orderBy(c, dir = 'asc') {
        const sign = dir === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => (a[col(c)] > b[col(c)] ? sign : a[col(c)] < b[col(c)] ? -sign : 0));
        return q;
      },
      select(...cols) {
        selected = cols;
        return q;
      },
      first: () => Promise.resolve(rows.map(project)[0]),
      pluck: (c) => Promise.resolve(rows.map((r) => r[col(c)])),
      then: (resolve, reject) => Promise.resolve(rows.map(project)).then(resolve, reject),
    };
    return q;
  };

  const db = jest.fn((ref) => {
    mockCalls.push(ref);
    return makeQuery(ref);
  });
  return { db };
});

const readiness = require('../../../src/modules/users/readiness.service');

const d = (iso) => new Date(iso);
const future = d('2099-01-01T00:00:00Z');
const kkdRows = (userId) => require('../../../src/shared/kkd').KKD_ITEMS.map((i) => i.key).map((itemKey, i) => ({
  id: `${userId}-e${i}`, user_id: userId, item_key: itemKey, type: 'Koruyucu Ekipman',
  assigned_at: d('2026-01-01T00:00:00Z'), expires_at: future, returned_at: null,
}));

beforeEach(() => {
  mockCalls.length = 0;
  Object.assign(mockTables, {
    online_trainings: [
      { id: 't1', is_active: true, required: true },
      { id: 't2', is_active: true, required: true },
      { id: 't3', is_active: true, required: false },
    ],
    commission_decisions: [
      { id: 'c1', user_id: 'u1', decision: 'rejected', decided_at: d('2026-05-01T00:00:00Z') },
      { id: 'c2', user_id: 'u1', decision: 'approved', decided_at: d('2026-06-01T00:00:00Z'), decided_by: 'Kurul', decision_no: '7' },
      { id: 'c3', user_id: 'u2', decision: 'approved', decided_at: d('2026-06-02T00:00:00Z') },
      { id: 'c4', user_id: 'u3', decision: 'approved', decided_at: d('2026-06-03T00:00:00Z') },
    ],
    online_training_progress: [
      { user_id: 'u1', training_id: 't1', status: 'completed' },
      { user_id: 'u1', training_id: 't2', status: 'completed' },
      { user_id: 'u2', training_id: 't1', status: 'completed' },
      { user_id: 'u2', training_id: 't2', status: 'in_progress' },
      { user_id: 'u3', training_id: 't1', status: 'completed' },
      { user_id: 'u3', training_id: 't2', status: 'completed' },
    ],
    saha_trainings: [
      { id: 's1', grants_competency: 1 },
      { id: 's2', grants_competency: 0 },
    ],
    saha_training_applications: [
      { user_id: 'u1', training_id: 's1', attendance: 'katildi' },
      { user_id: 'u2', training_id: 's2', attendance: 'katildi' },
      { user_id: 'u3', training_id: 's1', attendance: 'katildi' },
    ],
    equipment: [...kkdRows('u1'), ...kkdRows('u3')],
    users: [
      { id: 'u1', is_active: 1 },
      { id: 'u2', is_active: 1 },
      { id: 'u3', is_active: 0 },
      { id: 'u4', is_active: 1 },
    ],
  });
});

describe('readiness.service — collectMany', () => {
  const ids = ['u1', 'u2', 'u3', 'u4'];

  test('her kullanıcı için tekil collect ile aynı girdiyi döner', async () => {
    const many = await readiness.collectMany(ids);
    for (const id of ids) {
      const single = await readiness.collect(id);
      expect(many.get(id)).toEqual(single);
    }

    const u1 = many.get('u1');
    expect(u1.decision.id).toBe('c2'); // en güncel karar
    expect(u1.completedIds.sort()).toEqual(['t1', 't2']);
    expect(u1.requiredIds.sort()).toEqual(['t1', 't2']);
    expect(u1.equipmentRows).toHaveLength(mockTables.equipment.length / 2);
    expect(many.get('u2').completedIds).toEqual(['t1']);
    expect(many.get('u4')).toMatchObject({ decision: undefined, completedIds: [], attendanceRows: [], equipmentRows: [] });
  });

  test('getReadinessMany tekil getReadiness ile birebir aynı türetimi verir', async () => {
    const many = await readiness.getReadinessMany(ids);
    for (const id of ids) expect(many.get(id)).toEqual(await readiness.getReadiness(id));

    expect(many.get('u1')).toMatchObject({
      kisiDurumu: 'hazir', mudahaleYetkisi: true,
      zincir: { eksikAdimlar: [], siradakiAdim: null, kkdDurumu: 'tam' },
      komisyon: { decision: 'approved', decidedBy: 'Kurul', decisionNo: '7' },
    });
    expect(many.get('u2')).toMatchObject({
      kisiDurumu: 'basvuru',
      zincir: { eksikAdimlar: ['teorik', 'uygulamali', 'kkd'], siradakiAdim: 'teorik' },
    });
    expect(many.get('u3').kisiDurumu).toBe('pasif');
    expect(many.get('u4')).toMatchObject({
      komisyon: { decision: 'pending' },
      zincir: { siradakiAdim: 'komisyon' },
    });
  });

  test('sorgu sayısı kullanıcı sayısından bağımsızdır', async () => {
    await readiness.collectMany(['u1']);
    const forOne = mockCalls.length;
    mockCalls.length = 0;

    await readiness.collectMany(ids);
    expect(mockCalls.length).toBe(forOne);
  });

  test('boş liste sorgu atmaz', async () => {
    expect((await readiness.getReadinessMany([])).size).toBe(0);
    expect(mockCalls).toHaveLength(0);
  });
});
