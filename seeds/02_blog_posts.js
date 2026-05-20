'use strict';

// Asset path'leri göreli tutulur; assetUrl() çalışma anında env base (UPLOAD_PUBLIC_BASE_URL / API_URL) ile
// fully-qualified HTTPS URL'e çevirir (kontrat 0.8).
const POSTS = [
  {
    id: 'bp_1',
    title: 'Orman Yangınlarında İlk Müdahale',
    description: 'Yangın çıktığı anda yapılması gerekenler ve güvenli tahliye adımları.',
    cover_path: 'seed/blog/ilk-mudahale.jpg',
    published_at: '2026-05-12',
    read_time_min: 3,
    themes: ['Yangın Haberleri', 'Teknik Bilgiler'],
    author_name: 'OGM Uzman Kadrosu',
    author_role: 'Yangınla Mücadele Birimi',
    author_avatar_path: 'seed/authors/ogm.jpg',
    content: [
      { type: 'paragraph', text: 'İlk dakikalar kritiktir. Dumanı gördüğünüzde sakin kalın.' },
      { type: 'heading', text: 'Müdahale Adımları' },
      { type: 'image', source: 'seed/blog/inline-1.jpg' },
      { type: 'paragraph', text: 'En yakın yetkiliye haber verin ve rüzgâr yönünün tersine hareket edin.' },
    ],
  },
  {
    id: 'bp_2',
    title: 'Gönüllü Teçhizatları Dağıtılmaya Başlandı',
    description: 'Yeni nesil koruyucu kıyafet ve ekipmanlar gönüllülere ulaştırılıyor.',
    cover_path: 'seed/blog/techizat.jpg',
    published_at: '2026-04-20',
    read_time_min: 2,
    themes: ['Eğitim', 'Teknik Bilgiler'],
    author_name: 'OGM İletişim',
    author_role: 'Basın ve Halkla İlişkiler',
    author_avatar_path: 'seed/authors/ogm.jpg',
    content: [
      { type: 'paragraph', text: 'Kask, eldiven ve yangın botları bölge müdürlüklerinde teslim ediliyor.' },
    ],
  },
];

exports.seed = async function seed(knex) {
  await knex('blog_posts').del();
  await knex('blog_posts').insert(
    POSTS.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      cover_path: p.cover_path,
      published_at: p.published_at,
      read_time_min: p.read_time_min,
      themes: JSON.stringify(p.themes),
      author_name: p.author_name,
      author_role: p.author_role,
      author_avatar_path: p.author_avatar_path,
      content: JSON.stringify(p.content),
      is_active: true,
    })),
  );
};
