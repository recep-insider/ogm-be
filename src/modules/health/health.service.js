'use strict';

const { pingDb } = require('../../config/db');
const { pingRedis } = require('../../config/redis');

async function checkComponent(name, fn) {
  const startedAt = Date.now();
  try {
    await fn();
    return { name, status: 'up', latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      name,
      status: 'down',
      latencyMs: Date.now() - startedAt,
      error: err.message,
    };
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
