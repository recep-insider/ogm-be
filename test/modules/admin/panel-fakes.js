'use strict';

// Panel auth testleri için bellek içi knex/ioredis taklitleri; yalnız servisin kullandığı
// sorgu biçimlerini (where/whereNot/whereNull + first/update/insert) destekler.

function createFakeDb() {
  let tables = {};

  function builder(name) {
    if (!tables[name]) tables[name] = [];
    const rows = tables[name];
    const preds = [];
    const matches = (row) => preds.every((p) => p(row));
    const eq = (obj) => (row) => Object.entries(obj).every(([k, v]) => row[k] === v);
    const q = {
      where(obj) {
        preds.push(eq(obj));
        return q;
      },
      whereNot(obj) {
        const p = eq(obj);
        preds.push((row) => !p(row));
        return q;
      },
      whereNull(col) {
        preds.push((row) => row[col] === null || row[col] === undefined);
        return q;
      },
      async first() {
        const row = rows.find(matches);
        return row ? { ...row } : undefined;
      },
      async update(values) {
        const hit = rows.filter(matches);
        hit.forEach((row) => Object.assign(row, values));
        return hit.length;
      },
      async insert(row) {
        rows.push({ ...row });
        return [rows.length];
      },
    };
    return q;
  }

  const db = (name) => builder(name);
  db.rows = (name) => tables[name] || [];
  db.reset = (seed = {}) => {
    tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  };
  db.destroy = async () => {};
  // app.js yüklenirken bazı servisler modül seviyesinde db.raw / db.fn çağırıyor.
  db.raw = (sql) => ({ sql });
  db.fn = { now: () => new Date() };
  return db;
}

function createFakeRedis() {
  const store = new Map();
  const alive = (key) => {
    const entry = store.get(key);
    if (entry && entry.expiresAt && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    store,
    async get(key) {
      const entry = alive(key);
      return entry ? String(entry.value) : null;
    },
    async incr(key) {
      const entry = alive(key) || { value: 0, expiresAt: null };
      entry.value = Number(entry.value) + 1;
      store.set(key, entry);
      return entry.value;
    },
    async expire(key, sec) {
      const entry = alive(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + sec * 1000;
      return 1;
    },
    async ttl(key) {
      const entry = alive(key);
      if (!entry) return -2;
      if (!entry.expiresAt) return -1;
      return Math.ceil((entry.expiresAt - Date.now()) / 1000);
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
}

// bcrypt native binding'i bazı makinelerde yüklenemiyor; deterministik sahte özet.
const fakeBcrypt = {
  hash: async (value) => `hash:${value}`,
  compare: async (value, hash) => hash === `hash:${value}`,
};

module.exports = { createFakeDb, createFakeRedis, fakeBcrypt };
