'use strict';

const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const { db } = require('../../config/db');
const env = require('../../config/env');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');

const ROLES = ['admin', 'officer'];

function publicStaff(row) {
  return {
    id: row.id,
    eposta: row.eposta,
    ad: row.ad,
    soyad: row.soyad,
    role: row.role,
    isActive: !!row.is_active,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
  };
}

/** Lists all admin/officer accounts (excluding the password hash). */
async function listStaff() {
  const rows = await db('admin_users')
    .whereNull('deleted_at')
    .select('id', 'eposta', 'ad', 'soyad', 'role', 'is_active', 'last_login_at', 'created_at')
    .orderBy('created_at', 'desc');
  return rows.map(publicStaff);
}

/** Creates a new admin/officer account (admin-only — gated at the route layer). */
async function createStaff({ eposta, ad, soyad, sifre, role }, actor) {
  const normalized = String(eposta).toLowerCase();
  const existing = await db('admin_users')
    .whereRaw('LOWER(eposta) = ?', [normalized])
    .whereNull('deleted_at')
    .first();
  if (existing) {
    throw errors.conflict('Bu e-posta zaten kayıtlı', undefined, 'admin_email_exists');
  }

  const id = uuidv4();
  const passwordHash = await bcrypt.hash(sifre, env.admin.bcryptRounds);

  await db('admin_users').insert({
    id,
    eposta,
    ad: ad || null,
    soyad: soyad || null,
    password_hash: passwordHash,
    role,
    is_active: true,
  });

  await writeAudit({
    userId: actor.userId,
    action: 'admin.staff.create',
    entity: 'admin_user',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { role },
  });

  return publicStaff({ id, eposta, ad, soyad, role, is_active: true });
}

/**
 * Updates the account: `isActive` and/or `role`. When deactivated, the related
 * refresh tokens are revoked (any open session is dropped).
 */
async function updateStaff(id, patch, actor) {
  const admin = await db('admin_users').where({ id }).whereNull('deleted_at').first();
  if (!admin) throw errors.notFound('Yönetici bulunamadı', 'admin_not_found');

  const update = {};
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  if (patch.role !== undefined) update.role = patch.role;
  if (Object.keys(update).length === 0) {
    throw errors.validation('Güncellenecek alan yok');
  }

  await db('admin_users').where({ id }).update({ ...update, updated_at: db.fn.now() });

  // On deactivation, revoke refresh tokens so no NEW access token can be minted.
  // Access tokens already issued stay valid until they expire (~15m, stateless JWT).
  if (patch.isActive === false) {
    await db('admin_refresh_tokens')
      .where({ admin_user_id: id })
      .whereNull('revoked_at')
      .update({ revoked_at: db.fn.now() });
  }

  await writeAudit({
    userId: actor.userId,
    action: 'admin.staff.update',
    entity: 'admin_user',
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: update,
  });

  return publicStaff({ ...admin, ...update });
}

module.exports = { ROLES, listStaff, createStaff, updateStaff, publicStaff };
