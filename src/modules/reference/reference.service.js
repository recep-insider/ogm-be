'use strict';

const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');

const ALLOWED_CATEGORIES = [
  'kan-grubu',
  'ogrenim',
  'meslek',
  'hobiler',
  'yakinlik',
  'ulkeler',
];

async function getCategory(category) {
  if (!ALLOWED_CATEGORIES.includes(category)) {
    throw errors.notFound('Kategori bulunamadı');
  }
  const rows = await db('reference_data')
    .where({ category, is_active: true })
    .orderBy('sort_order', 'asc')
    .orderBy('label', 'asc')
    .select('value', 'label');
  return { items: rows };
}

module.exports = { getCategory, ALLOWED_CATEGORIES };
