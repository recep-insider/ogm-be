'use strict';

// Gerçek app.js üzerinden /uploads: KVKK belgeleri (onboarding/) yalnız imzalı URL ile,
// diğer klasörler herkese açık ve Range (video seek) destekli kalır.

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogm-uploads-'));
process.env.UPLOAD_DIR = mockUploadDir;

jest.mock('bcrypt', () => require('../modules/admin/panel-fakes').fakeBcrypt);
jest.mock('../../src/config/db', () => ({ db: require('../modules/admin/panel-fakes').createFakeDb() }));
jest.mock('../../src/config/redis', () => ({ redis: require('../modules/admin/panel-fakes').createFakeRedis() }));

const request = require('supertest');
const app = require('../../src/app');
const { assetUrl, signedUploadGuard, SIGNED_URL_TTL_SEC } = require('../../src/shared/asset-url');

const DOC = 'onboarding/saglik.pdf';

function signedPath(rel) {
  const url = new URL(assetUrl(rel));
  return `/uploads/${rel}${url.search}`;
}

beforeAll(() => {
  for (const dir of ['onboarding', 'reports']) fs.mkdirSync(path.join(mockUploadDir, dir), { recursive: true });
  fs.writeFileSync(path.join(mockUploadDir, DOC), 'PDF-SAGLIK');
  fs.writeFileSync(path.join(mockUploadDir, 'onboarding/sabika.pdf'), 'PDF-SABIKA');
  fs.writeFileSync(path.join(mockUploadDir, 'reports/video.mp4'), '0123456789');
});

afterAll(() => {
  fs.rmSync(mockUploadDir, { recursive: true, force: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('/uploads — imzalı KVKK belgeleri', () => {
  it('imzasız istek 403 signed_url_invalid döner', async () => {
    const res = await request(app).get(`/uploads/${DOC}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('signed_url_invalid');
  });

  it('assetUrl imzası ile dosya döner, önbelleğe alınmaz ve Range çalışır', async () => {
    const url = signedPath(DOC);

    const full = await request(app).get(url);
    expect(full.status).toBe(200);
    expect(full.body.toString()).toBe('PDF-SAGLIK');
    expect(full.headers['cache-control']).toBe('private, no-store');

    const part = await request(app).get(url).set('Range', 'bytes=0-2');
    expect(part.status).toBe(206);
    expect(part.body.toString()).toBe('PDF');
  });

  it('süresi dolan imza 403 döner', async () => {
    const issuedAt = Date.now();
    const url = signedPath(DOC);
    jest.spyOn(Date, 'now').mockReturnValue(issuedAt + (SIGNED_URL_TTL_SEC + 1) * 1000);

    const res = await request(app).get(url);
    expect(res.status).toBe(403);
  });

  it('başka dosyanın imzası, bozuk imza ve oynanmış exp reddedilir', async () => {
    const { search } = new URL(assetUrl(DOC));
    const params = new URLSearchParams(search);

    const otherFile = await request(app).get(`/uploads/onboarding/sabika.pdf${search}`);
    expect(otherFile.status).toBe(403);

    const badSig = await request(app).get(`/uploads/${DOC}?exp=${params.get('exp')}&sig=${'A'.repeat(43)}`);
    expect(badSig.status).toBe(403);

    const longerExp = await request(app).get(`/uploads/${DOC}?exp=${Number(params.get('exp')) + 3600}&sig=${params.get('sig')}`);
    expect(longerExp.status).toBe(403);
  });

  it('`..` ile başka klasörden dolanan yol da imza ister', () => {
    // supertest URL'i normalize ettiğinden ham yol doğrudan guard'a verilir.
    const next = jest.fn();
    signedUploadGuard({ path: '/reports/../onboarding/saglik.pdf', query: {} }, { set: jest.fn() }, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403, code: 'signed_url_invalid' }));
  });

  it.each([
    ['/uploads//onboarding/saglik.pdf'],
    ['/uploads/%6Fnboarding/saglik.pdf'],
    ['/uploads/onboarding%2Fsaglik.pdf'],
    ['/uploads/ONBOARDING/saglik.pdf'],
  ])('yol hileleriyle imzasız erişilemez: %s', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(403);
  });
});

describe('/uploads — herkese açık medya', () => {
  it('imza istemez ve Range (video seek) çalışır', async () => {
    expect(assetUrl('reports/video.mp4')).not.toContain('?');

    const res = await request(app).get('/uploads/reports/video.mp4').set('Range', 'bytes=2-5');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 2-5/10');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });
});
