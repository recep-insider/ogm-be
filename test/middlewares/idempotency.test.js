'use strict';

jest.mock('../../src/config/logger', () => ({ warn: jest.fn(), error: jest.fn() }));
jest.mock('../../src/config/redis', () => {
  const store = new Map();
  return {
    redis: {
      store,
      set: jest.fn(async (key, value, ...args) => {
        if (args.includes('NX') && store.has(key)) return null;
        store.set(key, { value, args });
        return 'OK';
      }),
      get: jest.fn(async (key) => (store.has(key) ? store.get(key).value : null)),
      del: jest.fn(async (key) => (store.delete(key) ? 1 : 0)),
      expire: jest.fn(async (key) => (store.has(key) ? 1 : 0)),
    },
  };
});

const express = require('express');
const request = require('supertest');
const { redis } = require('../../src/config/redis');
const logger = require('../../src/config/logger');
const { idempotent } = require('../../src/middlewares/idempotency');
const { errorHandler } = require('../../src/middlewares/error-handler');
const { errors } = require('../../src/shared/errors');

const KEY = 'idem:p1:POST:/admin/things:k-1';
const handler = jest.fn();
const flush = () => new Promise((done) => setImmediate(done));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.panelUser = { id: 'p1' };
    next();
  });
  const router = express.Router();
  router.post('/things', idempotent(), (req, res, next) => handler(req, res, next));
  app.use('/admin', router);
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const post = (body, key = 'k-1') => {
  const req = request(app).post('/admin/things');
  if (key !== null) req.set('Idempotency-Key', key);
  return req.send(body);
};

beforeEach(() => {
  jest.clearAllMocks();
  redis.store.clear();
  handler.mockImplementation((req, res) => res.json({ ok: true, echo: req.body.a }));
});

describe('idempotent()', () => {
  it('başlık yoksa Redis\'e dokunmadan geçer', async () => {
    const res = await post({ a: 1 }, null);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('anahtarı tek atomik SET NX EX ile alır, 2xx yanıtı 24 saatlik kayıtla saklar', async () => {
    const res = await post({ a: 1 });
    await flush();

    expect(res.status).toBe(200);
    expect(redis.set).toHaveBeenNthCalledWith(1, KEY, expect.any(String), 'EX', 60, 'NX');
    const stored = redis.store.get(KEY);
    expect(stored.args).toEqual(['EX', 86400]);
    expect(JSON.parse(stored.value)).toMatchObject({ state: 'done', status: 200, body: { ok: true, echo: 1 } });
  });

  it('aynı anahtar ve gövdeyle tekrarı işleyiciyi çağırmadan aynı yanıtla döner', async () => {
    handler.mockImplementation((req, res) => res.status(201).json({ ok: true, id: 'm1' }));
    const first = await post({ a: 1 });
    await flush();
    const second = await post({ a: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
  });

  it('aynı anahtar farklı gövdeyle gelirse 422 idempotency_key_reused', async () => {
    await post({ a: 1 });
    await flush();
    const res = await post({ a: 2 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('idempotency_key_reused');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ilk istek sürerken aynı anahtar 409 idempotency_in_flight alır', async () => {
    let release;
    handler.mockImplementation((_req, res) => {
      release = () => res.json({ ok: true });
    });
    const first = post({ a: 1 }).then((r) => r);
    while (!release) await flush();
    const second = await post({ a: 1 });
    release();

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('idempotency_in_flight');
    expect((await first).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ilk istek sürerken aynı anahtar farklı gövdeyle gelirse 409 değil 422 idempotency_key_reused alır', async () => {
    let release;
    handler.mockImplementation((_req, res) => {
      release = () => res.json({ ok: true });
    });
    const first = post({ a: 1 }).then((r) => r);
    while (!release) await flush();
    const second = await post({ a: 2 });
    release();

    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('idempotency_key_reused');
    expect((await first).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('işleyici 4xx hata verirse anahtar silinir ve yeniden deneme işlenir', async () => {
    handler.mockImplementationOnce((_req, _res, next) => next(errors.business('olmadı')));
    const failed = await post({ a: 1 });
    await flush();

    expect(failed.status).toBe(422);
    expect(redis.store.has(KEY)).toBe(false);

    const retry = await post({ a: 1 });
    expect(retry.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('işleyici 5xx verirse anahtar pending kalır; tekrar deneme 409 alır', async () => {
    handler.mockImplementationOnce((_req, _res, next) => next(new Error('push sağlayıcısı düştü')));
    const failed = await post({ a: 1 });
    await flush();

    expect(failed.status).toBe(500);
    expect(redis.del).not.toHaveBeenCalled();
    expect(JSON.parse(redis.store.get(KEY).value).state).toBe('pending');

    const retry = await post({ a: 1 });
    expect(retry.status).toBe(409);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('işleyici sürdükçe pending anahtarın süresi uzatılır, yanıttan sonra durur', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      let finish;
      handler.mockImplementationOnce((_req, res) => { finish = () => res.json({ ok: true }); });
      const pending = post({ a: 1 }).then((r) => r);
      while (!finish) await flush();

      jest.advanceTimersByTime(45000);
      expect(redis.expire).toHaveBeenCalledTimes(2);
      expect(redis.expire).toHaveBeenCalledWith(KEY, 60);

      finish();
      await pending;
      jest.advanceTimersByTime(60000);
      expect(redis.expire).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['sendStatus', (res) => res.sendStatus(500)],
    ['send', (res) => res.status(503).send('servis yok')],
    ['end', (res) => res.status(502).end()],
  ])('5xx json dışında (%s) gönderilse de anahtar pending kalır', async (_label, reply) => {
    handler.mockImplementationOnce((_req, res) => reply(res));
    const failed = await post({ a: 1 });
    await flush();

    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(redis.del).not.toHaveBeenCalled();
    expect(JSON.parse(redis.store.get(KEY).value).state).toBe('pending');

    const retry = await post({ a: 1 });
    expect(retry.status).toBe(409);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('4xx json dışında gönderilirse anahtar silinir', async () => {
    handler.mockImplementationOnce((_req, res) => res.status(404).send('yok'));
    await post({ a: 1 });
    await flush();

    expect(redis.store.has(KEY)).toBe(false);
  });

  it('15 dakikayı aşan işlemde de yanıt gelene kadar anahtar uzatılmaya devam eder', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      let finish;
      handler.mockImplementationOnce((_req, res) => { finish = () => res.json({ ok: true }); });
      const pending = post({ a: 1 }).then((r) => r);
      while (!finish) await flush();

      jest.advanceTimersByTime(20 * 60 * 1000);
      expect(redis.expire).toHaveBeenCalledTimes(60);

      finish();
      await pending;
      jest.advanceTimersByTime(60000);
      expect(redis.expire).toHaveBeenCalledTimes(60);
    } finally {
      jest.useRealTimers();
    }
  });

  it('done kaydı ilk denemede yazılamazsa bir kez daha denenir', async () => {
    redis.set
      .mockImplementationOnce(async (key, value, ...args) => {
        redis.store.set(key, { value, args });
        return 'OK';
      })
      .mockImplementationOnce(async () => { throw new Error('timeout'); });
    const res = await post({ a: 1 });
    await flush();
    await flush();

    expect(res.status).toBe(200);
    expect(JSON.parse(redis.store.get(KEY).value).state).toBe('done');
  });

  it('yanıt json dışında biterse anahtar silinir', async () => {
    handler.mockImplementationOnce((_req, res) => res.sendStatus(204));
    await post({ a: 1 });
    await flush();

    expect(redis.store.has(KEY)).toBe(false);
  });

  it('anahtar SET ile GET arasında kaybolursa bir kez daha alınır', async () => {
    redis.set.mockResolvedValueOnce(null);
    const res = await post({ a: 1 });

    expect(res.status).toBe(200);
    expect(redis.set.mock.calls.filter((c) => c.includes('NX'))).toHaveLength(2);
    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('Redis erişilemezse panel isteği işlenmez: 503 idempotency_unavailable (K23)', async () => {
    redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await post({ a: 1 });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('idempotency_unavailable');
    expect(handler).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it.each([
    ['200 karakterden uzun', 'a'.repeat(201)],
    ['boşluktan ibaret', '   '],
  ])('%s anahtarı 400 idempotency_key_invalid ile reddeder', async (_label, key) => {
    const res = await post({ a: 1 }, key);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('idempotency_key_invalid');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('idempotent() — gönüllü, misafir ve dosyalı istek', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  function buildVolunteerApp({ user = null, file = null, options } = {}) {
    const vApp = express();
    vApp.use(express.json());
    vApp.use((req, _res, next) => {
      if (user) req.user = user;
      if (file) req.file = file();
      next();
    });
    vApp.post('/sos', idempotent(options), (req, res, next) => handler(req, res, next));
    vApp.use(errorHandler);
    return vApp;
  }
  const tempFile = (size = 3) => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'idem-')), 'a.jpg');
    fs.writeFileSync(p, 'x'.repeat(size));
    return { path: p, fieldname: 'file', originalname: 'a.jpg', size };
  };

  it('gönüllü anahtarı kullanıcıya bağlıdır; aynı anahtarla ikinci istek tek kayıt açar', async () => {
    const vApp = buildVolunteerApp({ user: { id: 'v1' } });
    const first = await request(vApp).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });
    await flush();
    const second = await request(vApp).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });

    expect(redis.set).toHaveBeenNthCalledWith(1, 'idem:v1:POST:/sos:k-1', expect.any(String), 'EX', 60, 'NX');
    expect(first.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('misafir anahtarı IP\'ye bağlıdır', async () => {
    await request(buildVolunteerApp()).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });
    expect(redis.set.mock.calls[0][0]).toMatch(/^idem:ip:.+:POST:\/sos:k-1$/);
  });

  it('Redis erişilemezse gönüllü isteği işlenir (K23)', async () => {
    redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(buildVolunteerApp({ user: { id: 'v1' } })).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('releaseOn5xx: gönüllü isteği 5xx alırsa anahtar bırakılır, aynı anahtarla tekrar deneme işlenir', async () => {
    const vApp = buildVolunteerApp({ user: { id: 'v1' }, options: { releaseOn5xx: true } });
    handler.mockImplementationOnce((req, res) => res.status(500).json({ error: { code: 'internal_error' } }));
    const first = await request(vApp).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });
    await flush();
    const retry = await request(vApp).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });

    expect(first.status).toBe(500);
    expect(retry.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('tekrar oynatılan istekle yüklenen dosya silinir, ilk isteğinki kalır', async () => {
    const files = [];
    const vApp = buildVolunteerApp({ user: { id: 'v1' }, file: () => { const f = tempFile(); files.push(f); return f; } });
    await request(vApp).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });
    await flush();
    const replay = await request(vApp).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });
    await new Promise((done) => setTimeout(done, 50));

    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(fs.existsSync(files[0].path)).toBe(true);
    expect(fs.existsSync(files[1].path)).toBe(false);
  });

  it('aynı anahtar farklı dosyayla gelirse 422 ve yeni dosya silinir', async () => {
    const files = [];
    let size = 3;
    const vApp = buildVolunteerApp({ user: { id: 'v1' }, file: () => { const f = tempFile(size); files.push(f); return f; } });
    await request(vApp).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });
    await flush();
    size = 5;
    const res = await request(vApp).post('/sos').set('Idempotency-Key', 'k-1').send({ a: 1 });
    await new Promise((done) => setTimeout(done, 50));

    expect(res.status).toBe(422);
    expect(fs.existsSync(files[1].path)).toBe(false);
  });
});
