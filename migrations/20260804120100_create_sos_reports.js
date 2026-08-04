'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('sos_reports', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
    t.decimal('lat', 10, 7).nullable();
    t.decimal('lng', 10, 7).nullable();
    t.string('message', 500).nullable();
    // Kullanıcı bilgileri çağrı anında snapshot'lanır: user_id SET NULL olduğundan ve profil
    // sonradan değişebileceğinden, geri arama telefonu ve acil kişi bilgisi satırda kalıcı olmalı.
    t.string('ad', 100).nullable();
    t.string('soyad', 100).nullable();
    t.string('tc_kimlik', 11).nullable();
    t.string('phone', 20).nullable();
    t.text('adres').nullable();
    t.string('acil_ad', 100).nullable();
    t.string('acil_soyad', 100).nullable();
    t.string('acil_telefon', 20).nullable();
    t.string('acil_yakinlik', 16).nullable();
    t.string('dispatched_to', 200).nullable();
    t.string('ip', 64).nullable();
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['created_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('sos_reports');
};
