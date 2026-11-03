'use strict';

jest.mock('../../src/config/logger', () => ({ warn: jest.fn(), error: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../../src/config/logger');
const { errorHandler } = require('../../src/middlewares/error-handler');
const { errors } = require('../../src/shared/errors');

// fs.unlink geri çağrısı iş parçacığı havuzunda biter; dosya kontrolünden önce kısa bekleme.
const flush = () => new Promise((done) => setTimeout(done, 50));

function tempFile() {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eh-')), 'belge.pdf');
  fs.writeFileSync(p, 'x');
  return { path: p };
}

function run(err, req = {}) {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  errorHandler(err, { method: 'POST', originalUrl: '/v1/x', ...req }, res, () => {});
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('errorHandler — yüklenen dosyalar', () => {
  it('4xx yanıtında tek dosya, dizi ve alan nesnesindeki dosyalar silinir', async () => {
    const single = tempFile();
    const list = [tempFile(), tempFile()];
    const fields = { saglikRaporu: [tempFile()], sabikaKaydi: [tempFile()] };

    run(errors.validation('hata'), { file: single });
    run(errors.rateLimit(), { files: list });
    run(errors.conflict('çakışma'), { files: fields });
    await flush();

    for (const f of [single, ...list, ...fields.saglikRaporu, ...fields.sabikaKaydi]) {
      expect(fs.existsSync(f.path)).toBe(false);
    }
  });

  it('multer\'ın yolsuz bıraktığı dosya kaydı yanıtı bozmaz; diğer dosya silinir (415)', async () => {
    const written = tempFile();
    const res = run(errors.make(415, 'unsupported_media_type', 'Dosya formatı desteklenmiyor'), {
      files: { saglikRaporu: [written], sabikaKaydi: [{ fieldname: 'sabikaKaydi', originalname: 'x.heic' }] },
    });
    await flush();

    expect(res.status).toHaveBeenCalledWith(415);
    expect(fs.existsSync(written.path)).toBe(false);
  });

  it('5xx yanıtında dosya silinmez (kayıt yazıldıktan sonra da oluşabilir)', async () => {
    const f = tempFile();
    run(new Error('beklenmeyen'), { file: f });
    await flush();
    expect(fs.existsSync(f.path)).toBe(true);
  });
});

describe('errorHandler — log', () => {
  it('SQL hatasında mesaj ve stack yazılmaz, yalnız kodlar yazılır', () => {
    const err = Object.assign(new Error("Duplicate entry '+905551112233' for key 'users_phone_unique'"), {
      code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000',
      sqlMessage: "Duplicate entry '+905551112233' for key 'users_phone_unique'",
      sql: "insert into `users` (`phone`, `tc_kimlik`) values ('+905551112233', '10000000146')",
    });

    const res = run(err);

    expect(res.status).toHaveBeenCalledWith(500);
    const [message, meta] = logger.error.mock.calls[0];
    expect(message).toBe('Veritabanı hatası');
    expect(meta).toEqual({ code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000', method: 'POST', path: '/v1/x' });
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/905551112233|10000000146/);
  });

  it('SQL dışı 500 hatası mesajı ve stack ile yazılır', () => {
    run(new Error('beklenmeyen'));
    expect(logger.error).toHaveBeenCalledWith('beklenmeyen', expect.objectContaining({ stack: expect.any(String) }));
  });
});
