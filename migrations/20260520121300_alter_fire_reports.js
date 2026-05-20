'use strict';

// Kontrat 9.x: fire_reports'a reverse-geocode alanları + needs[] eklenir,
// status kontrat değerlerine (reviewing/confirmed/rejected) geçirilir.
exports.up = async function up(knex) {
  await knex.schema.alterTable('fire_reports', (t) => {
    t.string('location_name', 200).nullable();
    t.string('region_label', 120).nullable();
    t.json('needs').nullable();
  });

  // Eski enum kolonunu (received/dispatched/closed) kontrat statüsüyle değiştir.
  await knex.schema.alterTable('fire_reports', (t) => {
    t.dropColumn('status');
  });
  await knex.schema.alterTable('fire_reports', (t) => {
    t.enu('status', ['reviewing', 'confirmed', 'rejected'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('reviewing');
    t.index(['status'], 'fire_reports_status_v2_index');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('fire_reports', (t) => {
    t.dropColumn('location_name');
    t.dropColumn('region_label');
    t.dropColumn('needs');
    t.dropIndex(['status'], 'fire_reports_status_v2_index');
    t.dropColumn('status');
  });
  await knex.schema.alterTable('fire_reports', (t) => {
    t.enu('status', ['received', 'dispatched', 'closed'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('received');
  });
};
