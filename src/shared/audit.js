'use strict';

const { db } = require('../config/db');
const logger = require('../config/logger');

/**
 * Audit log kaydı oluşturur. Hata olursa fırlatmaz, sadece warn loglar — audit
 * yazımı bir iş akışını bloke etmemelidir.
 *
 * @param {object} opts
 * @param {string|null} opts.userId
 * @param {string} opts.action  - 'auth.login', 'auth.refresh', 'auth.logout',
 *                                'users.patch', 'users.avatar', 'users.consent',
 *                                'users.delete', 'users.export',
 *                                'reports.fire', 'onboarding.complete'
 * @param {string} [opts.entity]
 * @param {string} [opts.entityId]
 * @param {string} [opts.ip]
 * @param {string} [opts.userAgent]
 * @param {object} [opts.payload]
 */
async function writeAudit({ userId = null, action, entity = null, entityId = null, ip = null, userAgent = null, payload = null }) {
  try {
    await db('audit_log').insert({
      user_id: userId,
      action,
      entity,
      entity_id: entityId,
      ip,
      user_agent: userAgent,
      payload: payload ? JSON.stringify(payload) : null,
    });
  } catch (err) {
    logger.warn('Audit log yazılamadı', { error: err.message, action, userId });
  }
}

function fromReq(req) {
  return {
    ip: req.ip,
    userAgent: req.headers?.['user-agent'],
  };
}

module.exports = { writeAudit, fromReq };
