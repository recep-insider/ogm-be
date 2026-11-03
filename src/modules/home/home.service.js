'use strict';

const { db } = require('../../config/db');
const { assetUrl } = require('../../shared/asset-url');
const { toDateOnly, startOfLocalDay } = require('../../shared/dates');

const NEWS_LIMIT = 5;

// K31: "Haberler & Duyurular" panelde yayımlanan "Haber" kategorisindeki blog yazılarıdır.
async function latestNews() {
  const rows = await db('blog_posts')
    .where({ is_active: true, category: 'haber' })
    .orderBy([
      { column: 'published_at', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .limit(NEWS_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    type: 'haber',
    title: r.title,
    imageUrl: assetUrl(r.cover_path),
    publishedAt: toDateOnly(r.published_at),
    url: null,
  }));
}

async function getFeed(userId) {
  let userRow = null;
  if (userId) {
    userRow = await db('users').where({ id: userId }).first('ad', 'avatar_path');
  }

  const todayCount = await db('fire_reports')
    .where('created_at', '>=', startOfLocalDay())
    .count({ c: '*' })
    .first();

  return {
    user: userRow
      ? { ad: userRow.ad, avatarUrl: assetUrl(userRow.avatar_path) }
      : { ad: null, avatarUrl: null },
    emergencyAction: {
      enabled: true,
      reportsToday: Number(todayCount?.c || 0),
    },
    activeTasks: {
      items: [],
      permissionRequired: 'location',
    },
    trainings: {
      volunteerLevel: {
        level: 1,
        name: 'Yeni Gönüllü',
        progressPercent: 0,
        trainingsRemaining: 4,
      },
      next: {
        id: '00000000-0000-0000-0000-000000000001',
        title: 'İlkyardım Eğitimi',
        description: 'Doğa koşullarında temel müdahale yöntemleri',
        durationMin: 120,
        status: 'not_started',
      },
    },
    news: await latestNews(),
  };
}

module.exports = { getFeed };
