'use strict';

const migration = require('../../migrations/20261104100000_blog_posts_version');

function fakeKnex() {
  const ops = [];
  const col = {
    unsigned: () => (ops.push(['unsigned']), col),
    notNullable: () => (ops.push(['notNullable']), col),
    defaultTo: (v) => (ops.push(['defaultTo', v]), col),
  };
  const t = {
    integer: jest.fn((name) => (ops.push(['integer', name]), col)),
    dropColumn: jest.fn((name) => ops.push(['dropColumn', name])),
  };
  const knex = { schema: { alterTable: jest.fn(async (table, fn) => { ops.push(['alterTable', table]); fn(t); }) } };
  return { knex, ops };
}

describe('migration — blog_posts.version', () => {
  it('up mevcut yazılar 1. sürümde başlayacak biçimde sütun ekler, down siler', async () => {
    const up = fakeKnex();
    await migration.up(up.knex);
    expect(up.ops).toEqual([['alterTable', 'blog_posts'], ['integer', 'version'], ['unsigned'], ['notNullable'], ['defaultTo', 1]]);

    const down = fakeKnex();
    await migration.down(down.knex);
    expect(down.ops).toEqual([['alterTable', 'blog_posts'], ['dropColumn', 'version']]);
  });
});
