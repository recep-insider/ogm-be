'use strict';

const UNITS = require('./data/forest-units');

const CHUNK_SIZE = 200;

exports.seed = async function seed(knex) {
  // Idempotent: var olanı koru, yalnızca eksikleri ekle (deterministik id, .del() yok).
  for (let i = 0; i < UNITS.length; i += CHUNK_SIZE) {
    const chunk = UNITS.slice(i, i + CHUNK_SIZE).map((u) => ({
      id: u.id,
      il: u.il,
      ilce: u.ilce,
      bolge_mudurlugu: u.bolgeMudurlugu,
      isletme_mudurlugu: u.isletmeMudurlugu,
    }));
    await knex('forest_units').insert(chunk).onConflict('id').ignore();
  }
};
