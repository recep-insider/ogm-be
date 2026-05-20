'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('missions', (t) => {
    t.string('id', 36).primary();
    t.string('category', 64).notNullable();
    t.string('title', 200).notNullable();
    t.string('full_title', 200).nullable();
    t.string('short_location', 120).notNullable();
    t.string('region_label', 120).nullable();
    t.text('description').nullable();
    t.string('icon_name', 32).notNullable().defaultTo('helmet'); // water | helmet | tool | first-aid
    t.enu('status', ['active', 'staffed', 'completed'], {
      useNative: false,
      enumName: null,
    }).notNullable().defaultTo('active');
    t.string('location_label', 200).nullable();
    t.timestamp('started_at').nullable();
    t.timestamp('ended_at').nullable();
    t.date('start_date').nullable();
    t.date('end_date').nullable();
    t.decimal('lat', 10, 7).nullable();
    t.decimal('lng', 10, 7).nullable();
    t.float('coverage_radius_km').nullable();
    t.json('gallery').nullable();
    t.json('needs').nullable();
    t.integer('stat_volunteers').notNullable().defaultTo(0);
    t.float('stat_hectares').notNullable().defaultTo(0);
    t.string('meeting_point', 200).nullable();
    t.string('required_equipment', 200).nullable();
    t.string('subtitle', 200).nullable();
    t.text('summary').nullable();
    t.string('cover_path', 512).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['is_active']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('missions');
};
