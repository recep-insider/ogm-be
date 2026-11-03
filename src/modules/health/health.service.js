'use strict';

const { pingDb } = require('../../config/db');
const { pingRedis } = require('../../config/redis');
const logger = require('../../config/logger');

async function checkComponent(name, fn) {
  const startedAt = Date.now();
  try {
    await fn();
    return { name, status: 'up', latencyMs: Date.now() - startedAt };
  } catch (err) {
    // Uç kimliksizdir; hata metni (iç adresler, sürücü mesajı) yalnız loga yazılır.
    logger.warn('Hazırlık kontrolü başarısız', { component: name, error: err.message });
    return { name, status: 'down', latencyMs: Date.now() - startedAt };
  }
}

async function getReadiness() {
  const checks = await Promise.all([
    checkComponent('mysql', pingDb),
    checkComponent('redis', pingRedis),
  ]);

  const allUp = checks.every((c) => c.status === 'up');
  return {
    status: allUp ? 'ok' : 'degraded',
    checks,
  };
}

function getLiveness() {
  return {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

module.exports = { getReadiness, getLiveness };
