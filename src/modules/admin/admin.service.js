'use strict';

const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { writeAudit } = require('../../shared/audit');

// applications.status enum'u ile aynı (migrations/20260427120200_create_applications.js).
const APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'requires_revision'];

/**
 * Bir gönüllünün EN GÜNCEL başvurusunun durumunu günceller (admin paneli / onay akışı).
 * Bildirim (push/SMS) GÖNDERMEZ — yalnızca status + review meta + audit. FE accessLevel'i
 * applications.status üzerinden türetir (users.service.getMe -> applicationStatus).
 *
 * @param {string} userId      Hedef gönüllünün id'si
 * @param {{status:string, note?:string}} body
 * @param {{userId?:string|null, ip?:string, userAgent?:string}} actor  İşlemi yapan admin
 */
async function setApplicationStatus(userId, { status, note }, actor = {}) {
  if (!APPLICATION_STATUSES.includes(status)) {
    throw errors.validation('Geçersiz başvuru durumu', { status, allowed: APPLICATION_STATUSES });
  }

  const application = await db('applications')
    .where({ user_id: userId })
    .orderBy('submitted_at', 'desc')
    .first();
  if (!application) throw errors.notFound('Başvuru bulunamadı', 'application_not_found');

  const reviewedAt = new Date();
  // Boş/yok not mevcut reviewer_note'u EZMEZ; yalnızca dolu not gelirse günceller.
  const reviewerNote = note && note.trim() ? note : (application.reviewer_note ?? null);
  await db('applications').where({ id: application.id }).update({
    status,
    reviewer_note: reviewerNote,
    reviewed_at: reviewedAt,
    reviewed_by: actor.userId || null,
    updated_at: reviewedAt,
  });

  await writeAudit({
    userId: actor.userId || null,
    action: 'admin.application.status',
    entity: 'application',
    entityId: application.id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    payload: { targetUserId: userId, from: application.status, to: status },
  });

  return {
    applicationId: application.id,
    userId,
    status,
    reviewedAt: reviewedAt.toISOString(),
  };
}

module.exports = { setApplicationStatus, APPLICATION_STATUSES };
