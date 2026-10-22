'use strict';

// Bölge kapsamı SOS'u da süzer; SOS'un bölgesi çağrının BASILDIĞI yerden (lat/lng → il)
// türer. Koordinatsız çağrının il'i boş kalır ve yalnızca "Tüm Bölgeler"de görünür.
exports.up = async function up(knex) {
  await knex.schema.alterTable('sos_reports', (t) => {
    t.string('il', 60).nullable();
    t.string('ilce', 60).nullable();
    t.index(['il']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('sos_reports', (t) => {
    t.dropIndex(['il']);
    t.dropColumn('il');
    t.dropColumn('ilce');
  });
};
