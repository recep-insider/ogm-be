'use strict';

const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { assetUrl } = require('../../shared/asset-url');
const { toDateOnly } = require('../../shared/dates');

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapContentBlock(block) {
  if (block && block.type === 'image') {
    return { type: 'image', source: assetUrl(block.source) };
  }
  return block;
}

function mapPost(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    cover: assetUrl(row.cover_path),
    publishedAt: toDateOnly(row.published_at),
    readTimeMin: row.read_time_min,
    themes: safeJson(row.themes, []),
    author: {
      name: row.author_name || '',
      role: row.author_role || '',
      avatar: assetUrl(row.author_avatar_path),
    },
    content: safeJson(row.content, []).map(mapContentBlock),
  };
}

async function list() {
  const rows = await db('blog_posts').where({ is_active: true }).orderBy('published_at', 'desc');
  return rows.map(mapPost);
}

async function getById(id) {
  const row = await db('blog_posts').where({ id, is_active: true }).first();
  if (!row) throw errors.notFound('Yazı bulunamadı', 'post_not_found');
  return mapPost(row);
}

module.exports = { list, getById };
