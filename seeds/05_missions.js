'use strict';

const MISSIONS = [
  {
    id: 'am_marmaris',
    category: 'LOJİSTİK DESTEK',
    title: 'Su ve Kumanya Dağıtımı',
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
    coverage_radius_km: 50,
    gallery: ['seed/missions/am_marmaris/1.jpg', 'seed/missions/am_marmaris/2.jpg'],
    needs: ['Lojistik Destek', 'Su ve Kumanya'],
    stat_volunteers: 124,
    stat_hectares: 12.4,
    meeting_point: 'Marmaris Yangın Yönetim Merkezi',
    required_equipment: 'Kask, eldiven, yangın botu',
    subtitle: 'Hisarönü Mevkii',
    summary: 'Devam eden müdahale; lojistik destek ihtiyacı sürüyor.',
    cover_path: 'seed/missions/am_marmaris/cover.jpg',
  },
  {
    id: 'am_fethiye',
    category: 'SAHA OPERASYONU',
    title: 'Yangın Söndürme',
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
    coverage_radius_km: 40,
    gallery: ['seed/missions/am_fethiye/1.jpg'],
    needs: ['Saha Operasyonu'],
    stat_volunteers: 86,
    stat_hectares: 8.1,
    meeting_point: 'Fethiye Orman İşletme Müdürlüğü',
    required_equipment: 'Kask, eldiven, yangın botu, telsiz',
    subtitle: 'Ölüdeniz Mevkii',
    summary: 'Aktif saha operasyonu sürüyor.',
    cover_path: 'seed/missions/am_fethiye/cover.jpg',
  },
  {
    id: 'fm_marmaris_2025',
    category: 'SAHA OPERASYONU',
    title: 'Marmaris Yangını',
    full_title: 'Marmaris Yangını 2025',
    short_location: 'Muğla / Marmaris',
    region_label: 'MUĞLA BÖLGE MÜDÜRLÜĞÜ',
    description: 'Tamamlanmış geçmiş görev.',
    icon_name: 'helmet',
    status: 'completed',
    location_label: 'Muğla Orman İşletme Müdürlüğü',
    started_at: '2025-09-18T08:00:00Z',
    start_date: '2025-09-18',
    end_date: '2025-09-22',
    lat: 36.85,
    lng: 28.27,
    coverage_radius_km: 50,
    gallery: [
      'seed/missions/fm_marmaris/1.jpg',
      'seed/missions/fm_marmaris/2.jpg',
      'seed/missions/fm_marmaris/3.jpg',
    ],
    needs: ['Saha Operasyonu'],
    stat_volunteers: 124,
    stat_hectares: 12.4,
    meeting_point: 'Marmaris Yangın Yönetim Merkezi',
    required_equipment: 'Kask, eldiven, yangın botu',
    subtitle: 'Hisarönü Mevkii',
    summary: '5 günlük müdahale sonucu kontrol altına alındı.',
    cover_path: 'seed/missions/fm_marmaris/cover.jpg',
  },
];

const ANNOUNCEMENTS = [
  { id: 'ann_1', mission_id: 'am_marmaris', message: "Kumanyalar 14:00'te dağıtılacak.", severity: 'info', published_at: '2026-05-20T11:00:00Z' },
  { id: 'ann_2', mission_id: 'am_marmaris', message: 'Rüzgâr yön değiştirdi, doğu kanada dikkat.', severity: 'alert', published_at: '2026-05-20T12:30:00Z' },
];

exports.seed = async function seed(knex) {
  await knex('mission_announcements').del();
  await knex('missions').del();

  await knex('missions').insert(
    MISSIONS.map((m) => ({
      ...m,
      started_at: m.started_at ? new Date(m.started_at) : null,
      gallery: JSON.stringify(m.gallery),
      needs: JSON.stringify(m.needs),
      is_active: true,
    })),
  );

  await knex('mission_announcements').insert(
    ANNOUNCEMENTS.map((a) => ({ ...a, published_at: new Date(a.published_at) })),
  );
};
