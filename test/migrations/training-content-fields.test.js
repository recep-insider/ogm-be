'use strict';

const migration = require('../../migrations/20261023130000_training_content_fields');

function fakeKnex() {
  const ops = [];
  const builder = (table) => {
    const col = (kind) => (name, ...args) => {
      ops.push([table, kind, name, ...args]);
      return { nullable: () => undefined };
    };
    return { string: col('string'), text: col('text'), json: col('json'), dropColumn: col('drop') };
  };
  return {
    ops,
    schema: { alterTable: jest.fn(async (table, fn) => fn(builder(table))) },
  };
}

describe('migration — training content fields', () => {
  it('adds cover_path + content to theory trainings and description + content to field trainings', async () => {
    const knex = fakeKnex();
    await migration.up(knex);

    expect(knex.ops).toEqual([
      ['online_trainings', 'string', 'cover_path', 512],
      ['online_trainings', 'json', 'content'],
      ['saha_trainings', 'text', 'description'],
      ['saha_trainings', 'json', 'content'],
    ]);
  });

  it('down drops exactly the columns up added', async () => {
    const up = fakeKnex();
    const down = fakeKnex();
    await migration.up(up);
    await migration.down(down);

    const added = up.ops.map(([table, , name]) => `${table}.${name}`).sort();
    const dropped = down.ops.map(([table, kind, name]) => {
      expect(kind).toBe('drop');
      return `${table}.${name}`;
    }).sort();
    expect(dropped).toEqual(added);
  });
});
