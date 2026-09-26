'use strict';

const migration = require('../../migrations/20260925120000_backfill_blog_category');

const { categoryFromThemes } = migration;

describe('blog category backfill — categoryFromThemes', () => {
  it.each([
    [['Yangın Haberleri', 'Teknik Bilgiler'], 'haber'],
    [['Eğitim', 'Teknik Bilgiler'], 'egitim'],
    [['EGITIM'], 'egitim'],
    [['Teknik Bilgiler'], 'teknik'],
    ['["teknik"]', 'teknik'],
    [[], null],
    [null, null],
    ['{bozuk', null],
    [['Doğa'], null],
    // Non-string entries are skipped, so a later string theme still decides.
    [[42, { name: 'Eğitim' }, 'Kurs Duyurusu'], 'egitim'],
    // Valid JSON that is not an array carries no themes.
    ['{"themes":["Eğitim"]}', null],
    ['"Eğitim"', null],
  ])('%p -> %p', (themes, expected) => {
    expect(categoryFromThemes(themes)).toBe(expected);
  });
});

describe('blog category backfill — up/down', () => {
  // Minimal in-memory knex: blog_posts rows plus the backfill log table.
  const makeKnex = (posts) => {
    const tables = { blog_posts: posts };
    const updates = [];
    const matches = (row, filter) => Object.entries(filter).every(([k, v]) => row[k] === v);
    const knex = jest.fn((name) => {
      let filter = {};
      const c = {
        where: jest.fn((f) => {
          filter = f;
          return c;
        }),
        select: jest.fn(async () => tables[name].filter((r) => matches(r, filter))),
        insert: jest.fn((row) => {
          const write = (ignoreConflict) => {
            const clash = tables[name].some((r) => r.post_id === row.post_id);
            if (clash && !ignoreConflict) throw new Error(`duplicate ${row.post_id}`);
            if (!clash) tables[name].push(row);
          };
          return {
            onConflict: () => ({ ignore: async () => write(true) }),
            then: (resolve, reject) => Promise.resolve().then(() => write(false)).then(resolve, reject),
          };
        }),
        update: jest.fn(async (patch) => {
          const hit = tables[name].filter((r) => matches(r, filter));
          hit.forEach((r) => {
            updates.push({ id: r.id, ...patch });
            Object.assign(r, patch);
          });
          return hit.length;
        }),
      };
      return c;
    });
    knex.schema = {
      hasTable: jest.fn(async (name) => name in tables),
      createTable: jest.fn(async (name) => {
        tables[name] = [];
      }),
      dropTableIfExists: jest.fn(async (name) => {
        delete tables[name];
      }),
    };
    return { knex, updates, tables };
  };

  it('fills category from themes only for rows still on the default, and reverses', async () => {
    const rows = [
      { id: 'a', category: 'haber', themes: '["Eğitim"]' },
      { id: 'b', category: 'haber', themes: '["Yangın Haberleri"]' },
      { id: 'c', category: 'teknik', themes: '["Eğitim"]' }, // panel choice, left alone
      { id: 'd', category: 'haber', themes: null },
    ];
    const { knex, updates, tables } = makeKnex(rows);

    await migration.up(knex);
    expect(updates).toEqual([{ id: 'a', category: 'egitim' }]);
    expect(rows.map((r) => r.category)).toEqual(['egitim', 'haber', 'teknik', 'haber']);
    expect(tables.blog_category_backfill_log).toEqual([{ post_id: 'a', category: 'egitim' }]);

    await migration.down(knex);
    expect(rows.map((r) => r.category)).toEqual(['haber', 'haber', 'teknik', 'haber']);
    expect(tables.blog_category_backfill_log).toBeUndefined();
  });

  it('rollback leaves rows an admin re-categorised after the backfill untouched', async () => {
    const rows = [
      { id: 'a', category: 'haber', themes: '["Eğitim"]' },
      { id: 'e', category: 'haber', themes: '["Teknik Bilgiler"]' },
      { id: 'f', category: 'haber', themes: '["Eğitim"]' },
    ];
    const { knex } = makeKnex(rows);

    await migration.up(knex);
    // After the backfill the panel moves 'a' to teknik and a new egitim post appears.
    rows[0].category = 'teknik';
    rows.push({ id: 'g', category: 'egitim', themes: '["Eğitim"]' });

    await migration.down(knex);
    expect(rows.map((r) => [r.id, r.category])).toEqual([
      ['a', 'teknik'], // hand-edited: kept
      ['e', 'haber'], // backfilled and unchanged: reverted
      ['f', 'haber'], // backfilled, same value: reverted (indistinguishable)
      ['g', 'egitim'], // never touched by the backfill: kept
    ]);
  });

  it('can be re-run after a run that stopped partway', async () => {
    const rows = [
      { id: 'a', category: 'egitim', themes: '["Eğitim"]' }, // updated before the failure
      { id: 'b', category: 'haber', themes: '["Teknik Bilgiler"]' }, // logged, update lost
      { id: 'c', category: 'haber', themes: '["Eğitim"]' }, // never reached
    ];
    const { knex, tables } = makeKnex(rows);
    tables.blog_category_backfill_log = [
      { post_id: 'a', category: 'egitim' },
      { post_id: 'b', category: 'teknik' },
    ];

    await migration.up(knex);

    expect(knex.schema.createTable).not.toHaveBeenCalled();
    expect(rows.map((r) => r.category)).toEqual(['egitim', 'teknik', 'egitim']);
    expect(tables.blog_category_backfill_log).toEqual([
      { post_id: 'a', category: 'egitim' },
      { post_id: 'b', category: 'teknik' },
      { post_id: 'c', category: 'egitim' },
    ]);

    await migration.down(knex);
    expect(rows.map((r) => r.category)).toEqual(['haber', 'haber', 'haber']);
  });

  it('creates the log table keyed by post_id so onConflict(post_id).ignore() dedupes re-runs', async () => {
    const { knex } = makeKnex([]);

    await migration.up(knex);

    expect(knex.schema.createTable).toHaveBeenCalledTimes(1);
    const [tableName, build] = knex.schema.createTable.mock.calls[0];
    expect(tableName).toBe('blog_category_backfill_log');

    // Run the schema callback against a recording table builder.
    const columns = {};
    const t = {
      string: jest.fn((name, length) => {
        const col = { type: 'string', length, modifiers: [] };
        columns[name] = col;
        const chain = {
          primary: jest.fn(() => {
            col.modifiers.push('primary');
            return chain;
          }),
          notNullable: jest.fn(() => {
            col.modifiers.push('notNullable');
            return chain;
          }),
        };
        return chain;
      }),
    };
    build(t);

    expect(columns).toEqual({
      post_id: { type: 'string', length: 36, modifiers: ['primary'] },
      category: { type: 'string', length: 16, modifiers: ['notNullable'] },
    });
  });

  it('rollback is a no-op when the backfill log table is missing', async () => {
    const rows = [{ id: 'x', category: 'egitim', themes: '["Eğitim"]' }];
    const { knex, updates } = makeKnex(rows);

    await migration.down(knex);
    expect(updates).toEqual([]);
    expect(rows[0].category).toBe('egitim');
  });
});
