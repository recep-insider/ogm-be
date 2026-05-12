'use strict';

const path = require('path');
const fs = require('fs');
const winston = require('winston');
require('winston-daily-rotate-file');

const env = require('./env');

const logDir = env.logging.dir;
try {
  fs.mkdirSync(logDir, { recursive: true });
} catch (_err) {
  // Eğer dizin oluşturulamazsa stdout'a düşeriz; servis çalışmaya devam etmeli.
}

const baseFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, ...rest }) => {
        const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
        return `${timestamp} [${level}] ${message}${meta}`;
      }),
    ),
  }),
];

if (env.nodeEnv !== 'test') {
  transports.push(
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: '90d',
      format: baseFormat,
    }),
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'error-%DATE%.log',
      level: 'error',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: '90d',
      format: baseFormat,
    }),
  );
}

const logger = winston.createLogger({
  level: env.logging.level,
  defaultMeta: { service: 'ogm-gonullu-api' },
  format: baseFormat,
  transports,
});

logger.logFile = path.join(logDir, 'app.log');

module.exports = logger;
