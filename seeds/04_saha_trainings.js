'use strict';

const TRAININGS = [
  {
    id: 'st_1',
    title: 'Yangın Söndürme Saha Eğitimi',
    location: 'Muğla / Marmaris Eğitim Kampı',
    start_date: '2026-09-18',
    start_time: '09:00',
    end_time: '17:00',
    instructor_name: 'Ahmet Yıldız',
    instructor_avatar_path: 'seed/instructors/ahmet.jpg',
    cover_path: 'seed/saha/yangin.jpg',
    total_seats: 30,
  },
  {
    id: 'st_2',
    title: 'Arama Kurtarma Tatbikatı',
    location: 'Antalya / Kemer',
    start_date: '2026-10-05',
    start_time: '10:00',
    end_time: '16:00',
    instructor_name: 'Canan Aksoy',
    instructor_avatar_path: 'seed/instructors/canan.jpg',
    cover_path: 'seed/saha/arama-kurtarma.jpg',
    total_seats: 5,
  },
];

exports.seed = async function seed(knex) {
  // Idempotent: başvuruları (saha_training_applications) ve var olan eğitimleri silme; yalnızca eksikleri ekle.
  await knex('saha_trainings')
    .insert(TRAININGS.map((t) => ({ ...t, is_active: true })))
    .onConflict('id')
    .ignore();
};
