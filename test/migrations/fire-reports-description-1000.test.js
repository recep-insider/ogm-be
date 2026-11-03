'use strict';

const migration = require('../../migrations/20261103130000_fire_reports_description_1000');

function fakeKnex() {
  const ops = [];
  const t = {
    string: jest.fn((name, length) => {
      ops.push(['string', name, length]);
      const col = { nullable: () => (ops.push(['nullable', name]), col), alter: () => ops.push(['alter', name]) };
      return col;
    }),
  };
  const knex = { schema: { alterTable: jest.fn(async (table, fn) => { ops.push(['alterTable', table]); fn(t); }) } };
  return { knex, ops };
}

describe('migration — fire_reports.description 1000', () => {
  it('up sütunu doğrulamayla aynı 1000 karaktere genişletir, down 500e döner', async () => {
    const up = fakeKnex();
    await migration.up(up.knex);
    expect(up.ops).toEqual([['alterTable', 'fire_reports'], ['string', 'description', 1000], ['nullable', 'description'], ['alter', 'description']]);

    const down = fakeKnex();
    await migration.down(down.knex);
    expect(down.ops).toContainEqual(['string', 'description', 500]);
  });
});
