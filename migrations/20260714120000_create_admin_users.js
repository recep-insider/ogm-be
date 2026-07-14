'use strict';

/**
 * Admin user store for panel/officer authentication. Fully isolated from the
 * volunteer `users` table (different identity fields, password hash, role).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('admin_users', (t) => {
    t.string('id', 36).primary();
    t.string('eposta', 254).notNullable().unique();
    t.string('ad', 100);
    t.string('soyad', 100);
    t.string('password_hash', 255).notNullable();
    t.string('role', 16).notNullable().defaultTo('admin'); // 'admin' | 'officer'
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('last_login_at').nullable();
    t.timestamp('deleted_at').nullable();
    t.timestamps(true, true);
    t.index(['eposta']);
    t.index(['role']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('admin_users');
};
