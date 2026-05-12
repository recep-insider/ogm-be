'use strict';

const Redis = require('ioredis');
const env = require('./env');
const logger = require('./logger');

const redis = new Redis({
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  logger.error('Redis bağlantı hatası', { error: err.message });
});

async function connectRedis() {
  if (redis.status === 'ready' || redis.status === 'connecting') return;
  await redis.connect();
}

async function pingRedis() {
  const result = await redis.ping();
  if (result !== 'PONG') {
    throw new Error(`Beklenmeyen Redis ping yanıtı: ${result}`);
  }
}

async function closeRedis() {
  if (redis.status !== 'end') {
    await redis.quit();
  }
}

module.exports = { redis, connectRedis, pingRedis, closeRedis };
