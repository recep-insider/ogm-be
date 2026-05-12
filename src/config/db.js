'use strict';

const knex = require('knex');
const knexConfig = require('../../knexfile');
const env = require('./env');

const config = knexConfig[env.nodeEnv] || knexConfig.development;

const db = knex(config);

async function pingDb() {
  await db.raw('SELECT 1');
}

async function closeDb() {
  await db.destroy();
}

module.exports = { db, pingDb, closeDb };
