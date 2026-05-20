'use strict';

const TRAININGS = [
  {
    id: 'ot_1',
    title: 'Orman Yangınları Temel Bilgisi',
    description: 'Yangın davranışı ve müdahale prensipleri.',
    duration_min: 45,
    icon_tone: 'primary',
    sort_order: 0,
  },
  {
    id: 'ot_2',
    title: 'İlkyardım',
    description: 'Saha koşullarında temel ilkyardım.',
    duration_min: 120,
    icon_tone: 'tertiary',
    sort_order: 1,
  },
  {
    id: 'ot_3',
    title: 'Telsiz ve İletişim',
    description: 'Saha iletişiminde telsiz kullanımı.',
    duration_min: 30,
    icon_tone: 'primary',
    sort_order: 2,
  },
];

exports.seed = async function seed(knex) {
  // Idempotent: var olanı koru, yalnızca eksikleri ekle (kullanıcı progress'i korunur).
  await knex('online_trainings')
    .insert(TRAININGS.map((t) => ({ ...t, is_active: true })))
    .onConflict('id')
    .ignore();
};
