'use strict';

const migration = require('../../migrations/20261023110000_add_location_to_sos_reports');

function fakeKnex() {
  const ops = [];
  const column = (name) => ({ nullable: () => ops.push(['nullable', name]) });
  const t = {
    string: jest.fn((name, length) => {
      ops.push(['string', name, length]);
      return column(name);
    }),
    index: jest.fn((cols) => ops.push(['index', cols])),
    dropIndex: jest.fn((cols) => ops.push(['dropIndex', cols])),
    dropColumn: jest.fn((name) => ops.push(['dropColumn', name])),
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

describe('migration — sos_reports il/ilce', () => {
  it('adds nullable il/ilce (60) and an index on il', async () => {
    const { knex, ops } = fakeKnex();

    await migration.up(knex);

    expect(ops).toEqual([
      ['alterTable', 'sos_reports'],
      ['string', 'il', 60],
      ['nullable', 'il'],
      ['string', 'ilce', 60],
      ['nullable', 'ilce'],
      ['index', ['il']],
    ]);
  });

  it('down drops the index and both columns', async () => {
    const { knex, ops } = fakeKnex();

    await migration.down(knex);

    expect(ops).toEqual([
      ['alterTable', 'sos_reports'],
      ['dropIndex', ['il']],
      ['dropColumn', 'il'],
      ['dropColumn', 'ilce'],
    ]);
  });
});
