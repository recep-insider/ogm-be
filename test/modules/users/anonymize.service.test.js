'use strict';

// KVKK 30 gün anonimleştirme: kişisel veri yalnız users satırında değil; başvuru belgeleri,
// sertifikalar, SOS kopyası, ihbar/acil IP'si, rıza ve denetim izi IP'si, cihaz/oturum
// kayıtları ve diskteki dosyalar da kapsanmalı. Biri unutulursa veri sessizce kalır.

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvkk-uploads-'));

jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/env', () => ({ upload: { dir: mockUploadDir } }));
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/config/redis', () => {
  const store = new Map();
  return {
    redis: {
      store,
      set: jest.fn(async (key, value, ...args) => {
        if (args.includes('NX') && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      eval: jest.fn(async (_script, _n, key, token) => {
        if (store.get(key) !== token) return 0;
        store.delete(key);
        return 1;
      }),
    },
  };
});

const { db } = require('../../../src/config/db');
const { redis } = require('../../../src/config/redis');
const service = require('../../../src/modules/users/anonymize.service');

const NOW = new Date('2026-10-23T10:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400 * 1000);

function upload(rel) {
  const abs = path.join(mockUploadDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
  return rel;
}
const exists = (rel) => fs.existsSync(path.join(mockUploadDir, rel));

function user(id, extra = {}) {
  return {
    id,
    tc_kimlik: `tc-${id}`,
    ad: 'Ayşe',
    soyad: 'Yılmaz',
    dogum_tarihi: '1990-01-01',
    phone: `+90532${id}`,
    eposta: `${id}@ornek.com`,
    adres: 'Muğla',
    il: 'Muğla',
    ilce: 'Marmaris',
    kan_grubu: 'A+',
    ogrenim: 'lisans',
    meslek: 'diger',
    meslek_diger: 'Ormancı',
    hobiler: '["kamp"]',
    giysi_bedeni: 'M',
    ayakkabi_numarasi: 40,
    stk_text: 'AKUT',
    acil_ad: 'Mehmet',
    acil_soyad: 'Yılmaz',
    acil_telefon: '+905320000000',
    acil_yakinlik: 'es',
    avatar_path: null,
    is_active: false,
    deleted_at: daysAgo(31),
    anonymized_at: null,
    ...extra,
  };
}

function seed() {
  db.reset({
    users: [
      user('u1', { avatar_path: upload('avatars/u1.jpg') }),
      user('u2', { is_active: true, deleted_at: null }),
      user('u3', { deleted_at: daysAgo(29) }),
    ],
    applications: [
      {
        id: 'a1',
        user_id: 'u1',
        saglik_raporu_path: upload('onboarding/u1-saglik.pdf'),
        sabika_kaydi_path: 'onboarding/u1-sabika-zaten-yok.pdf',
        snapshot: '{"kimlik":{"tcKimlik":"tc-u1"}}',
        reviewer_note: 'Telefonla arandı',
        status: 'approved',
      },
      { id: 'a2', user_id: 'u2', saglik_raporu_path: 'onboarding/u2.pdf', snapshot: '{}', reviewer_note: 'not' },
    ],
    online_training_progress: [{ id: 'p1', user_id: 'u1', status: 'completed', certificate_path: upload('certs/p1.pdf') }],
    saha_training_applications: [{ id: 's1', user_id: 'u1', attendance: 'katildi', certificate_path: null }],
    user_trainings: [{ id: 't1', user_id: 'u1', certificate_path: upload('certs/t1.pdf') }],
    commission_decisions: [{ id: 'c1', user_id: 'u1', decision: 'approved', sms_phone: '+90532u1', note: 'Gerekçe' }],
    consents: [{ id: 'k1', user_id: 'u1', document: 'kvkk', ip: '1.1.1.1', user_agent: 'iOS' }],
    audit_log: [
      { id: 1, user_id: 'u1', action: 'users.delete', ip: '1.1.1.1', user_agent: 'iOS' },
      { id: 2, user_id: 'u2', action: 'users.patch', ip: '2.2.2.2', user_agent: 'Android' },
    ],
    sos_reports: [{
      id: 'sos1',
      user_id: 'u1',
      lat: 36.8,
      lng: 28.2,
      status: 'responded',
      ad: 'Ayşe',
      soyad: 'Yılmaz',
      tc_kimlik: 'tc-u1',
      phone: '+90532u1',
      adres: 'Muğla',
      acil_ad: 'Mehmet',
      acil_soyad: 'Yılmaz',
      acil_telefon: '+905320000000',
      acil_yakinlik: 'es',
      ip: '1.1.1.1',
    }],
    fire_reports: [{ id: 'f1', user_id: 'u1', anonymous: false, latitude: 36.8, ip: '1.1.1.1' }],
    emergency_reports: [{ id: 'e1', user_id: 'u1', lat: 36.8, ip: '1.1.1.1' }],
    devices: [{ id: 'd1', user_id: 'u1', fcm_token: 'tok' }, { id: 'd2', user_id: 'u2', fcm_token: 'tok2' }],
    refresh_tokens: [{ id: 'r1', user_id: 'u1', ip: '1.1.1.1', user_agent: 'iOS' }],
    notification_preferences: [{ user_id: 'u1', base_lat: 36.8, base_lng: 28.2 }],
    mission_participants: [{ id: 'mp1', user_id: 'u1', mission_id: 'm1', status: 'tamamladi' }],
  });
}

const row = (table, id) => db.rows(table).find((r) => r.id === id);

beforeEach(() => {
  jest.clearAllMocks();
  redis.store.clear();
  seed();
});

afterAll(() => fs.rmSync(mockUploadDir, { recursive: true, force: true }));

describe('anonymizeDue — kapsam', () => {
  it('yalnız silinmesinin üzerinden 30 gün geçmiş hesabı işler', async () => {
    const result = await service.anonymizeDue(NOW);

    expect(result).toEqual({ due: 1, anonymized: 1, failed: [] });
    expect(row('users', 'u2').ad).toBe('Ayşe');
    expect(row('users', 'u3').ad).toBe('Ayşe');
    expect(row('users', 'u3').anonymized_at).toBeNull();
  });

  it('users satırındaki kişisel alanları boşaltır ve anonymized_at ile işaretler', async () => {
    await service.anonymizeDue(NOW);

    const u1 = row('users', 'u1');
    for (const col of [
      'tc_kimlik', 'ad', 'soyad', 'dogum_tarihi', 'phone', 'eposta', 'adres', 'il', 'ilce',
      'kan_grubu', 'ogrenim', 'meslek', 'meslek_diger', 'hobiler', 'giysi_bedeni',
      'ayakkabi_numarasi', 'stk_text', 'acil_ad', 'acil_soyad', 'acil_telefon', 'acil_yakinlik',
      'avatar_path',
    ]) {
      expect([col, u1[col]]).toEqual([col, null]);
    }
    expect(u1.anonymized_at).toEqual(NOW);
    expect(u1.deleted_at).toEqual(daysAgo(31));
  });

  it('kullanıcıya bağlı diğer tablolardaki kişisel veriyi de temizler, operasyon kaydını korur', async () => {
    await service.anonymizeDue(NOW);

    expect(row('applications', 'a1')).toMatchObject({
      saglik_raporu_path: null, sabika_kaydi_path: null, snapshot: null, reviewer_note: null, status: 'approved',
    });
    expect(row('online_training_progress', 'p1')).toMatchObject({ certificate_path: null, status: 'completed' });
    expect(row('user_trainings', 't1').certificate_path).toBeNull();
    expect(row('commission_decisions', 'c1')).toMatchObject({ sms_phone: null, note: null, decision: 'approved' });
    expect(row('consents', 'k1')).toMatchObject({ ip: null, user_agent: null, document: 'kvkk' });
    expect(row('audit_log', 1)).toMatchObject({ ip: null, user_agent: null, action: 'users.delete' });
    expect(row('sos_reports', 'sos1')).toMatchObject({
      user_id: null, ad: null, soyad: null, tc_kimlik: null, phone: null, adres: null,
      acil_ad: null, acil_soyad: null, acil_telefon: null, acil_yakinlik: null, ip: null,
      lat: 36.8, status: 'responded',
    });
    expect(row('fire_reports', 'f1')).toMatchObject({ user_id: null, ip: null, latitude: 36.8 });
    expect(row('emergency_reports', 'e1')).toMatchObject({ user_id: null, ip: null, lat: 36.8 });
    expect(db.rows('devices').map((d) => d.id)).toEqual(['d2']);
    expect(db.rows('refresh_tokens')).toHaveLength(0);
    expect(db.rows('notification_preferences')).toHaveLength(0);
    expect(row('mission_participants', 'mp1')).toMatchObject({ user_id: 'u1', status: 'tamamladi' });
  });

  it('başka kullanıcının kayıtlarına dokunmaz', async () => {
    await service.anonymizeDue(NOW);

    expect(row('applications', 'a2')).toMatchObject({ snapshot: '{}', reviewer_note: 'not' });
    expect(row('audit_log', 2)).toMatchObject({ ip: '2.2.2.2', user_agent: 'Android' });
  });

  it('yüklenen kişisel dosyaları diskten siler; zaten olmayan dosya işi durdurmaz', async () => {
    await service.anonymizeDue(NOW);

    for (const rel of ['avatars/u1.jpg', 'onboarding/u1-saglik.pdf', 'certs/p1.pdf', 'certs/t1.pdf']) {
      expect([rel, exists(rel)]).toEqual([rel, false]);
    }
    expect(row('users', 'u1').anonymized_at).toEqual(NOW);
  });

  it('yükleme dizini dışını gösteren yol silinmez', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kvkk-outside-'));
    const victim = path.join(outside, 'keep.txt');
    fs.writeFileSync(victim, 'x');
    db.rows('users').find((u) => u.id === 'u1').avatar_path = path.relative(mockUploadDir, victim);

    await service.anonymizeDue(NOW);

    expect(fs.existsSync(victim)).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('ikinci koşu aynı hesabı yeniden işlemez', async () => {
    await service.anonymizeDue(NOW);
    const again = await service.anonymizeDue(NOW);

    expect(again).toEqual({ due: 0, anonymized: 0, failed: [] });
  });

  it('dosya silinemezse hesap işaretlenmez, yollar kalır ve sonraki koşu yeniden dener', async () => {
    // Dizin unlink edilemez (EISDIR/EPERM) — ENOENT dışındaki hata.
    fs.mkdirSync(path.join(mockUploadDir, 'avatars/u1-dir'), { recursive: true });
    db.rows('users').find((u) => u.id === 'u1').avatar_path = 'avatars/u1-dir';

    const result = await service.anonymizeDue(NOW);

    expect(result).toEqual({ due: 1, anonymized: 0, failed: ['u1'] });
    expect(row('users', 'u1')).toMatchObject({ anonymized_at: null, avatar_path: 'avatars/u1-dir', ad: 'Ayşe' });
    expect(row('applications', 'a1').snapshot).not.toBeNull();
  });
});

describe('runExclusive — tek koşu kilidi', () => {
  it('kilidi tek atomik SET NX EX ile alır ve iş bitince sahibi olarak bırakır', async () => {
    const result = await service.runExclusive(NOW);

    expect(result.anonymized).toBe(1);
    expect(redis.set).toHaveBeenCalledWith(service.LOCK_KEY, expect.any(String), 'EX', expect.any(Number), 'NX');
    const token = redis.set.mock.calls[0][1];
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, service.LOCK_KEY, token);
    expect(redis.store.has(service.LOCK_KEY)).toBe(false);
  });

  it('kilit başka koşudaysa hiçbir hesaba dokunmadan atlar', async () => {
    redis.store.set(service.LOCK_KEY, 'baska-surec');

    const result = await service.runExclusive(NOW);

    expect(result).toEqual({ skipped: true });
    expect(row('users', 'u1').anonymized_at).toBeNull();
    expect(redis.store.get(service.LOCK_KEY)).toBe('baska-surec');
  });
});

describe('startSchedule', () => {
  it('açılışta ve saatte bir çalışır, süreci açık tutmaz', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const timer = service.startSchedule();
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(timer.hasRef()).toBe(false);

      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(redis.set).toHaveBeenCalledTimes(2);
      clearInterval(timer);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('runExclusive — kilit bırakma hatası', () => {
  it('redis.eval reddederse koşunun sonucunu döner ve uyarı loglar', async () => {
    const logger = require('../../../src/config/logger');
    redis.eval.mockRejectedValueOnce(new Error('redis kapalı'));

    const result = await service.runExclusive(NOW);

    expect(result).toEqual({ due: 1, anonymized: 1, failed: [] });
    expect(logger.warn).toHaveBeenCalledWith('KVKK anonimleştirme kilidi bırakılamadı', { error: 'redis kapalı' });
  });
});

describe('startSchedule — koşu hatası', () => {
  it('runExclusive reddederse hata loglanır, işlenmemiş ret kalmaz', async () => {
    const logger = require('../../../src/config/logger');
    redis.set.mockRejectedValueOnce(new Error('redis kapalı'));

    const timer = service.startSchedule();
    clearInterval(timer);
    await new Promise(setImmediate);

    expect(logger.error).toHaveBeenCalledWith('KVKK anonimleştirme çalıştırılamadı', { error: 'redis kapalı' });
  });
});
