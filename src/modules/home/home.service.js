'use strict';

const { db } = require('../../config/db');
const { assetUrl } = require('../../shared/asset-url');

async function getFeed(userId) {
  let userRow = null;
  if (userId) {
    userRow = await db('users').where({ id: userId }).first('ad', 'avatar_path');
  }

  const todayCount = await db('fire_reports')
    .whereRaw('DATE(created_at) = CURDATE()')
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
    news: [
      {
        id: '00000000-0000-0000-0000-000000000010',
        type: 'haber',
        title: 'Yeni Gönüllü Teçhizatları Dağıtılmaya Başlandı',
        imageUrl: null,
        publishedAt: new Date().toISOString(),
        url: 'https://www.ogm.gov.tr/',
      },
    ],
  };
}

module.exports = { getFeed };
