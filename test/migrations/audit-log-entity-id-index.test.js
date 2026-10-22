'use strict';

const migration = require('../../migrations/20261023140000_audit_log_entity_id_index');

function fakeKnex() {
  const ops = [];
  const t = {
    index: jest.fn((cols) => ops.push(['index', cols])),
    dropIndex: jest.fn((cols) => ops.push(['dropIndex', cols])),
  };
  const knex = {
    schema: {
      alterTable: jest.fn(async (table, fn) => {
        ops.push(['alterTable', table]);
        fn(t);
      }),
    },
  };
  return { knex, ops };
}

describe('migration — audit_log entity_id indeksi', () => {
  it('up indeksi ekler, down kaldırır', async () => {
    const up = fakeKnex();
    await migration.up(up.knex);
    expect(up.ops).toEqual([['alterTable', 'audit_log'], ['index', ['entity_id']]]);

    const down = fakeKnex();
    await migration.down(down.knex);
    expect(down.ops).toEqual([['alterTable', 'audit_log'], ['dropIndex', ['entity_id']]]);
  });
});
