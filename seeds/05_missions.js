'use strict';

const MISSIONS = [
  {
    id: 'am_marmaris',
    il: 'Muğla',
    ilce: 'Marmaris',
    // mobil §5: görev adı ve rol etiketi kaldırıldı — olayın kendisi gösterilir.
    title: 'Marmaris Orman Yangını',
    full_title: 'Marmaris Orman Yangını',
    short_location: 'Muğla / Marmaris',
    region_label: 'MUĞLA BÖLGE MÜDÜRLÜĞÜ',
    description: 'Marmaris bölgesinde devam eden yangın müdahalesi için lojistik destek.',
    icon_name: 'water',
    status: 'active',
    location_label: 'Hisarönü, Marmaris',
    started_at: '2025-08-15T14:30:00Z',
    start_date: '2025-08-15',
    end_date: null,
    lat: 36.85,
    lng: 28.27,
    gallery: ['seed/missions/am_marmaris/1.jpg', 'seed/missions/am_marmaris/2.jpg'],
    stat_volunteers: 124,
    subtitle: 'Hisarönü Mevkii',
    summary: 'Devam eden müdahale; lojistik destek ihtiyacı sürüyor.',
    cover_path: 'seed/missions/am_marmaris/cover.jpg',
  },
  {
    id: 'am_fethiye',
    il: 'Muğla',
    ilce: 'Fethiye',
    title: 'Fethiye Orman Yangını',
    full_title: 'Fethiye Orman Yangını',
    short_location: 'Muğla / Fethiye',
    region_label: 'MUĞLA BÖLGE MÜDÜRLÜĞÜ',
    description: 'Fethiye bölgesinde aktif saha operasyonu.',
    icon_name: 'helmet',
    status: 'active',
    location_label: 'Ölüdeniz, Fethiye',
    started_at: '2025-08-16T09:00:00Z',
    start_date: '2025-08-16',
    end_date: null,
    lat: 36.6,
    lng: 29.12,
    gallery: ['seed/missions/am_fethiye/1.jpg'],
    stat_volunteers: 86,
    subtitle: 'Ölüdeniz Mevkii',
    summary: 'Aktif saha operasyonu sürüyor.',
    cover_path: 'seed/missions/am_fethiye/cover.jpg',
  },
  {
    id: 'fm_marmaris_2025',
    il: 'Muğla',
    ilce: 'Marmaris',
    title: 'Marmaris Yangını',
    full_title: 'Marmaris Yangını 2025',
    short_location: 'Muğla / Marmaris',
    region_label: 'MUĞLA BÖLGE MÜDÜRLÜĞÜ',
    description: 'Tamamlanmış geçmiş görev.',
    icon_name: 'helmet',
    status: 'archived',
    location_label: 'Muğla Orman İşletme Müdürlüğü',
    started_at: '2025-09-18T08:00:00Z',
    start_date: '2025-09-18',
    end_date: '2025-09-22',
    lat: 36.85,
    lng: 28.27,
    gallery: [
      'seed/missions/fm_marmaris/1.jpg',
      'seed/missions/fm_marmaris/2.jpg',
      'seed/missions/fm_marmaris/3.jpg',
    ],
    stat_volunteers: 124,
    subtitle: 'Hisarönü Mevkii',
    summary: '5 günlük müdahale sonucu kontrol altına alındı.',
    cover_path: 'seed/missions/fm_marmaris/cover.jpg',
  },
];

// Olay başına TEK toplanma noktası (§4/§12) — olaysız/noktasız kayıt oluşmaz.
const ASSEMBLY_POINTS = [
  { id: 'ap_marmaris', mission_id: 'am_marmaris', name: 'Marmaris Yangın Yönetim Merkezi', address: 'Hisarönü, Marmaris', lat: 36.85, lng: 28.27 },
  { id: 'ap_fethiye', mission_id: 'am_fethiye', name: 'Fethiye Orman İşletme Müdürlüğü', address: 'Ölüdeniz, Fethiye', lat: 36.6, lng: 29.12 },
];

exports.seed = async function seed(knex) {
  // Idempotent: missions'ı silme (FK CASCADE ile mission_participants/photos/announcements GİTMESİN).
  // Yalnızca eksik kayıtları ekle.
  await knex('missions')
    .insert(
      MISSIONS.map((m) => ({
        ...m,
        started_at: m.started_at ? new Date(m.started_at) : null,
        gallery: JSON.stringify(m.gallery),
        is_active: true,
      })),
    )
    .onConflict('id')
    .ignore();

  // Daha önce seed'lenmiş kurulumlarda il/ilçe'yi doldur (yalnızca boşsa — elle girileni ezmez).
  for (const m of MISSIONS) {
    // eslint-disable-next-line no-await-in-loop
    await knex('missions').where({ id: m.id }).whereNull('il').whereNull('ilce').update({ il: m.il, ilce: m.ilce });
  }

  await knex('assembly_points')
    .insert(ASSEMBLY_POINTS.map((a) => ({ ...a, is_open: true })))
    .onConflict('id')
    .ignore();

};
