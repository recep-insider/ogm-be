'use strict';

// Katalog seed'leri idempotent olmalı: ASLA .del() çağırmamalı (FK CASCADE ile prod kullanıcı
// verisini silerdi) ve insert(...).onConflict('id').ignore() zincirini kullanmalı.
// Bu test, destructive del()+insert desenine geri dönüşü engeller.

function makeMockKnex() {
  const calls = { tables: [], del: 0, insert: 0, onConflictCols: [], ignore: 0, merge: 0, update: 0 };

  function chain() {
    const c = {
      insert() { calls.insert += 1; return c; },
      onConflict(col) { calls.onConflictCols.push(col); return c; },
      ignore() { calls.ignore += 1; return Promise.resolve(0); },
      merge() { calls.merge += 1; return Promise.resolve(0); },
      del() { calls.del += 1; return Promise.resolve(0); },
      // Idempotent backfill desteği (ör. 03_online_trainings video_path):
      // where(...).whereNull(...).update(...) — non-destructive, .del() değil.
      where() { return c; },
      whereNull() { return c; },
      update() { calls.update += 1; return Promise.resolve(0); },
      // Zincir doğrudan await edilirse (örn. .insert(...) sonu) çözülebilsin.
      then(resolve) { return resolve(0); },
    };
    return c;
  }

  const knex = (table) => { calls.tables.push(table); return chain(); };
  return { knex, calls };
}

const SEEDS = [
  '../../seeds/02_blog_posts',
  '../../seeds/03_online_trainings',
  '../../seeds/04_saha_trainings',
  '../../seeds/05_missions',
];

describe.each(SEEDS)('seed idempotency: %s', (modPath) => {
  const { seed } = require(modPath);
  let calls;

  beforeAll(async () => {
    const mock = makeMockKnex();
    calls = mock.calls;
    await seed(mock.knex);
  });

  it('hiç .del() çağırmaz (cascade veri kaybı yok)', () => {
    expect(calls.del).toBe(0);
  });

  it('insert + onConflict("id").ignore() kullanır', () => {
    expect(calls.insert).toBeGreaterThan(0);
    expect(calls.ignore).toBeGreaterThan(0);
    expect(calls.onConflictCols.every((c) => c === 'id')).toBe(true);
    expect(calls.onConflictCols.length).toBe(calls.ignore);
  });
});
