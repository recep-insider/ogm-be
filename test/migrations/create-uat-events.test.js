'use strict';

const migration = require('../../migrations/20261126120000_create_uat_events');

function makeKnex() {
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
  const knex = {
    fn: { now: () => 'NOW()' },
    schema: {
      createTable: jest.fn(async (name, cb) => {
        const cols = [];
        cb(columnRecorder(cols));
        ops.push(['createTable', name, cols]);
      }),
      dropTableIfExists: jest.fn(async (name) => ops.push(['dropTable', name])),
    },
  };
  return { knex, ops };
}

describe('20261126120000_create_uat_events', () => {
  it('up uat_events tablosunu panel kullanıcısına bağlı ve oturum+sıra tekil olarak kurar', async () => {
    const { knex, ops } = makeKnex();

    await migration.up(knex);

    const create = ops.find(([op, name]) => op === 'createTable' && name === 'uat_events');
    expect(create).toBeDefined();
    const cols = create[2];
    expect(cols).toContainEqual([
      'string',
      'panel_user_id',
      36,
      ['nullable'],
      ['references', 'id'],
      ['inTable', 'panel_users'],
      ['onDelete', 'SET NULL'],
    ]);
    expect(cols).toContainEqual(['unique', ['session_id', 'seq']]);
  });

  it('down tabloyu kaldırır', async () => {
    const { knex, ops } = makeKnex();

    await migration.down(knex);

    expect(ops).toEqual([['dropTable', 'uat_events']]);
  });
});
