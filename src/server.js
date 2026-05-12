'use strict';

const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const { pingDb, closeDb } = require('./config/db');
const { connectRedis, pingRedis, closeRedis } = require('./config/redis');

async function bootstrap() {
  try {
    await pingDb();
    logger.info('MySQL bağlantısı başarılı', { host: env.db.host, db: env.db.name });
  } catch (err) {
    logger.error('MySQL bağlantısı başarısız', { error: err.message });
  }

  try {
    await connectRedis();
    await pingRedis();
    logger.info('Redis bağlantısı başarılı', { host: env.redis.host });
  } catch (err) {
    logger.error('Redis bağlantısı başarısız', { error: err.message });
  }

  const server = app.listen(env.port, () => {
    logger.info(`OGM Gönüllü API başladı`, {
      port: env.port,
      nodeEnv: env.nodeEnv,
    });
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} alındı, kapanıyor...`);
    server.close(async () => {
      try {
        await closeDb();
        await closeRedis();
      } catch (err) {
        logger.error('Kapanış sırasında hata', { error: err.message });
      }
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Zarif kapanış zaman aşımına uğradı, zorla kapatılıyor');
      process.exit(1);
    }, 10000).unref();
  };

  ['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

  process.on('unhandledRejection', (reason) => {
    logger.error('Yakalanmamış promise reddi', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Yakalanmamış istisna', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error('Bootstrap başarısız', { error: err.message, stack: err.stack });
  process.exit(1);
});
