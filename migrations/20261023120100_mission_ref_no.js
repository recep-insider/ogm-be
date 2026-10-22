'use strict';

const { refYear, formatRefNo } = require('../src/shared/mission-ref');

// Okunabilir olay numarası (OGM-2026-000123); sayaç her yıl sıfırdan başlar.
exports.up = async function up(knex) {
  await knex.schema.createTable('mission_ref_counters', (t) => {
    t.integer('year').unsigned().primary();
    t.integer('last_no').unsigned().notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('missions', (t) => {
    t.string('ref_no', 20).nullable().unique();
  });

  // Mevcut olaylar yıl içinde oluşturulma sırasıyla numaralanır.
  const rows = await knex('missions')
    .orderBy([
      { column: 'created_at', order: 'asc' },
      { column: 'id', order: 'asc' },
    ])
    .select('id', 'created_at');
  const counters = new Map();
  for (const m of rows) {
    const year = refYear(m.created_at);
    const no = (counters.get(year) || 0) + 1;
    counters.set(year, no);
    // eslint-disable-next-line no-await-in-loop
    await knex('missions').where({ id: m.id }).update({ ref_no: formatRefNo(year, no) });
  }
  if (counters.size) {
    await knex('mission_ref_counters').insert([...counters].map(([year, lastNo]) => ({ year, last_no: lastNo })));
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('missions', (t) => {
    t.dropUnique(['ref_no']);
    t.dropColumn('ref_no');
  });
  await knex.schema.dropTableIfExists('mission_ref_counters');
};
