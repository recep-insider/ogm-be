'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { assetUrl } = require('../../shared/asset-url');
const { toDateOnly, toIso } = require('../../shared/dates');
const { writeAudit } = require('../../shared/audit');

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

// ── Admin (panel) ───────────────────────────────────────────
// Admin görünümü public mapPost'tan iki noktada ayrılır: (1) isActive ve ham
// path'ler de döner — panel düzenleme roundtrip'inde relative path gerekir
// (URL'den path'e geri çevirmek kırılgandır); (2) taslaklar (is_active=false) da listelenir.

function mapAdminContentBlock(block) {
  if (block && block.type === 'image') {
    return { ...block, source: block.source, sourceUrl: assetUrl(block.source) };
  }
  return block;
}

function mapAdminPost(row) {
  return {
    ...mapPost(row),
    isActive: !!row.is_active,
    coverPath: row.cover_path || null,
    content: safeJson(row.content, []).map(mapAdminContentBlock),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** Admin — tüm yazılar (taslaklar dahil). @param {{isActive?:boolean}} params */
async function adminList({ isActive } = {}) {
  const base = db('blog_posts');
  if (isActive !== undefined) base.where({ is_active: isActive });
  const rows = await base.orderBy([
    { column: 'published_at', order: 'desc' },
    { column: 'id', order: 'desc' },
  ]);
  return { items: rows.map(mapAdminPost), total: rows.length };
}

function toRow(body) {
  const row = {};
  if (body.title !== undefined) row.title = body.title;
  if (body.description !== undefined) row.description = body.description || null;
  if (body.coverPath !== undefined) row.cover_path = body.coverPath || null;
  if (body.publishedAt !== undefined) row.published_at = body.publishedAt;
  if (body.readTimeMin !== undefined) row.read_time_min = body.readTimeMin;
  if (body.themes !== undefined) row.themes = JSON.stringify(body.themes || []);
  if (body.authorName !== undefined) row.author_name = body.authorName || null;
  if (body.authorRole !== undefined) row.author_role = body.authorRole || null;
  if (body.content !== undefined) row.content = JSON.stringify(body.content || []);
  if (body.isActive !== undefined) row.is_active = body.isActive;
  return row;
}

/** Admin — yazı oluştur. publishedAt verilmezse bugün. */
async function adminCreate(body, actor = {}) {
  const id = uuidv4();
  const now = new Date();
  // published_at DATE kolonudur; verilmezse sunucunun yerel tarihini kullan
  // (Date objesi UTC'ye çevrilince TR gece yarısı–03:00 arası bir gün geri kayabilir).
  await db('blog_posts').insert({
    id,
    published_at: db.fn.now(),
    ...toRow(body),
    created_at: now,
    updated_at: now,
  });

  await writeAudit({
    userId: actor.userId || null,
    action: 'blog.create',
    entity: 'blog_post',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { title: body.title },
  });

  const row = await db('blog_posts').where({ id }).first();
  return mapAdminPost(row);
}

/** Admin — yazı güncelle (kısmi). */
async function adminUpdate(id, body, actor = {}) {
  const existing = await db('blog_posts').where({ id }).first();
  if (!existing) throw errors.notFound('Yazı bulunamadı', 'post_not_found');

  await db('blog_posts').where({ id }).update({ ...toRow(body), updated_at: new Date() });

  await writeAudit({
    userId: actor.userId || null,
    action: 'blog.update',
    entity: 'blog_post',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { fields: Object.keys(body) },
  });

  const row = await db('blog_posts').where({ id }).first();
  return mapAdminPost(row);
}

/** Admin — yazıyı KALICI siler (FK bağı yok; panel onay dialoğu da 'kalıcı' der). */
async function adminRemove(id, actor = {}) {
  const existing = await db('blog_posts').where({ id }).first();
  if (!existing) throw errors.notFound('Yazı bulunamadı', 'post_not_found');

  await db('blog_posts').where({ id }).del();

  await writeAudit({
    userId: actor.userId || null,
    action: 'blog.delete',
    entity: 'blog_post',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { title: existing.title },
  });
}

module.exports = { list, getById, adminList, adminCreate, adminUpdate, adminRemove, mapAdminPost };
