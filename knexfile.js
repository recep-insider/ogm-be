'use strict';

require('dotenv').config();

const sharedPool = {
  min: 2,
  max: 10,
};

const baseConfig = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'ogm_app',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ogm_gonullu',
    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
  },
  pool: sharedPool,
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
    stub: undefined,
  },
  seeds: {
    directory: './seeds',
  },
};

module.exports = {
  development: baseConfig,
  staging: baseConfig,
  production: baseConfig,
  test: {
    ...baseConfig,
    connection: {
      ...baseConfig.connection,
      database: `${baseConfig.connection.database}_test`,
    },
  },
};
