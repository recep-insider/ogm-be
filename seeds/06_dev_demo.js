'use strict';

// Yalnızca non-production: QA'nın dolu ekran görmesi için demo gönüllü + ilişkili kayıtlar.
// Production'da no-op (kontrat B.8 — prod'da seed user yok).
const DEMO_USER_ID = 'u_demo';
const DEMO_PHONE = '+905555555555';
const DEMO_TC = '10000000146';

exports.seed = async function seed(knex) {
  if (process.env.NODE_ENV === 'production') return;

  // Önceki demo kullanıcısını (id veya aynı TC ile) sil — FK CASCADE çocuk kayıtları temizler. Idempotent.
  await knex('users').where({ id: DEMO_USER_ID }).orWhere({ tc_kimlik: DEMO_TC }).del();

  const now = new Date();

  await knex('users').insert({
    id: DEMO_USER_ID,
    tc_kimlik: DEMO_TC,
    ad: 'Özge',
    soyad: 'Demir',
    dogum_tarihi: '1992-03-14',
    phone: DEMO_PHONE,
    eposta: 'ozge@example.com',
    adres: 'Atatürk Cad. No:1 Daire 5, Kadıköy / İstanbul',
    kan_grubu: '0+',
    ogrenim: 'Lisans',
    meslek: 'Mühendis',
    hobiler: JSON.stringify(['Doğa yürüyüşü', 'Fotoğrafçılık']),
    acil_ad: 'Ali',
    acil_soyad: 'Demir',
    acil_telefon: '+905551110000',
    acil_yakinlik: 'Eş',
    profile_complete: true,
    is_active: true,
    created_at: now,
    updated_at: now,
  });

  await knex('applications').insert({
    id: 'app_demo',
    user_id: DEMO_USER_ID,
    status: 'approved',
    submitted_at: now,
    reviewed_at: now,
    created_at: now,
    updated_at: now,
  });

  await knex('equipment').insert([
    {
      id: 'eq_1',
      user_id: DEMO_USER_ID,
      name: 'Kask',
      type: 'Koruyucu Ekipman',
      assigned_at: '2025-09-25',
      expires_at: '2026-09-25',
      status: 'active',
      icon_name: 'helmet',
    },
    {
      id: 'eq_2',
      user_id: DEMO_USER_ID,
      name: 'Telsiz',
      type: 'İletişim Ekipmanı',
      assigned_at: '2025-06-16',
      expires_at: null,
      status: 'active',
      icon_name: 'radio',
    },
  ]);

  await knex('user_trainings').insert([
    {
      id: 'ct_1',
      user_id: DEMO_USER_ID,
      title: 'Orman Yangınları',
      description: 'Temel yangın davranışı',
      duration_min: 45,
      completed_at: null,
      instructor_name: 'Ahmet Yıldız',
      progress_percent: 65,
      status: 'in_progress',
      certificate_path: null,
    },
    {
      id: 'ct_2',
      user_id: DEMO_USER_ID,
      title: 'İlkyardım',
      description: 'Saha ilkyardım',
      duration_min: 120,
      completed_at: '2025-08-12',
      instructor_name: 'Canan Aksoy',
      progress_percent: 100,
      status: 'completed',
      certificate_path: 'seed/certs/ct_2.pdf',
    },
  ]);

  // Geçmiş görev katılımı (history) + aktif görevde accepted.
  await knex('mission_participants').insert([
    { id: 'mp_demo_hist', user_id: DEMO_USER_ID, mission_id: 'fm_marmaris_2025', status: 'on_site', joined_at: now, on_site_at: now },
    { id: 'mp_demo_active', user_id: DEMO_USER_ID, mission_id: 'am_marmaris', status: 'accepted', joined_at: now },
  ]);

  await knex('notification_preferences').insert({
    user_id: DEMO_USER_ID,
    task_calls: true,
    trainings: true,
    announcements: false,
    distance_km: 50,
    distance_min: 5,
    distance_max: 200,
    created_at: now,
    updated_at: now,
  });
};
