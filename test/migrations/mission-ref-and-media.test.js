'use strict';

const refMigration = require('../../migrations/20261023120100_mission_ref_no');
const mediaMigration = require('../../migrations/20261023120000_operator_mission_media');

// Şema çağrılarını ve satır yazımlarını sırasıyla kaydeden küçük knex taklidi.
function makeKnex(missions = []) {
  const ops = [];
  const columnRecorder = (log) =>
    new Proxy(
      {},
      {
        get: (_o, method) => (...args) => {
          const entry = [method, ...args];
          log.push(entry);
          const chain = new Proxy(
            {},
            {
              get: (_x, next) => (...rest) => {
                entry.push([next, ...rest]);
                return chain;
              },
            },
          );
          return chain;
        },
      },
    );
  const knex = jest.fn((table) => {
    let filter = null;
    const q = {
      orderBy: jest.fn(() => q),
      select: jest.fn(async () => missions.map((m) => ({ ...m }))),
      where: jest.fn((f) => {
        filter = f;
        return q;
      }),
      whereNull: jest.fn((col) => {
        filter = { [col]: null };
        return q;
      }),
      update: jest.fn(async (patch) => {
        ops.push(['update', table, filter, patch]);
        return 1;
      }),
      insert: jest.fn(async (rows) => {
        ops.push(['insert', table, rows]);
        return [1];
      }),
      del: jest.fn(async () => {
        ops.push(['del', table, filter]);
        return 1;
      }),
    };
    return q;
  });
  knex.schema = {
    createTable: jest.fn(async (name, cb) => {
      const cols = [];
      cb(columnRecorder(cols));
      ops.push(['createTable', name, cols]);
    }),
    alterTable: jest.fn(async (name, cb) => {
      const cols = [];
      cb(columnRecorder(cols));
      ops.push(['alterTable', name, cols]);
    }),
    dropTableIfExists: jest.fn(async (name) => ops.push(['dropTable', name])),
  };
  return { knex, ops };
}

describe('20261023120100_mission_ref_no', () => {
  it('mevcut olayları Türkiye yılına göre oluşturulma sırasıyla numaralar ve sayaçları yazar', async () => {
    const { knex, ops } = makeKnex([
      // 21:30 UTC 31 Aralık 2025 → İstanbul'da 2026'nın ilk yarım saati.
      { id: 'a', created_at: new Date('2025-12-31T21:30:00Z') },
      { id: 'b', created_at: new Date('2025-12-31T20:00:00Z') },
      { id: 'c', created_at: new Date('2026-03-01T10:00:00Z') },
      { id: 'd', created_at: new Date('2026-10-20T10:00:00Z') },
    ]);

    await refMigration.up(knex);

    const updates = ops.filter(([op]) => op === 'update').map(([, , where, patch]) => [where.id, patch.ref_no]);
    expect(updates).toEqual([
      ['a', 'OGM-2026-000001'],
      ['b', 'OGM-2025-000001'],
      ['c', 'OGM-2026-000002'],
      ['d', 'OGM-2026-000003'],
    ]);
    expect(ops.find(([op]) => op === 'insert')).toEqual([
      'insert',
      'mission_ref_counters',
      [
        { year: 2026, last_no: 3 },
        { year: 2025, last_no: 1 },
      ],
    ]);
    const [orderBy] = knex.mock.results[0].value.orderBy.mock.calls;
    expect(orderBy).toEqual([[{ column: 'created_at', order: 'asc' }, { column: 'id', order: 'asc' }]]);
    const alter = ops.find(([op, name]) => op === 'alterTable' && name === 'missions');
    expect(alter[2]).toEqual([['string', 'ref_no', 20, ['nullable'], ['unique']]]);
  });

  it('olay yoksa sayaç yazılmaz', async () => {
    const { knex, ops } = makeKnex([]);

    await refMigration.up(knex);

    expect(ops.some(([op]) => op === 'insert')).toBe(false);
  });

  it('down kolonu ve sayaç tablosunu kaldırır', async () => {
    const { knex, ops } = makeKnex();

    await refMigration.down(knex);

    expect(ops).toEqual([
      ['alterTable', 'missions', [['dropUnique', ['ref_no']], ['dropColumn', 'ref_no']]],
      ['dropTable', 'mission_ref_counters'],
    ]);
  });
});

describe('20261023120000_operator_mission_media', () => {
  it('up user_id boşaltılabilir yapar ve panel_user_id ekler', async () => {
    const { knex, ops } = makeKnex();

    await mediaMigration.up(knex);

    expect(ops).toEqual([
      [
        'alterTable',
        'mission_photos',
        [
          ['string', 'user_id', 36, ['nullable'], ['alter']],
          ['string', 'panel_user_id', 36, ['nullable'], ['references', 'id'], ['inTable', 'panel_users'], ['onDelete', 'SET NULL']],
        ],
      ],
    ]);
  });

  it('down user_id zorunlu olmadan önce gönüllüsüz satırları siler', async () => {
    const { knex, ops } = makeKnex();

    await mediaMigration.down(knex);

    expect(ops.map(([op]) => op)).toEqual(['del', 'alterTable', 'alterTable']);
    expect(ops[0]).toEqual(['del', 'mission_photos', { user_id: null }]);
    expect(ops[2][2]).toEqual([['string', 'user_id', 36, ['notNullable'], ['alter']]]);
  });
});
