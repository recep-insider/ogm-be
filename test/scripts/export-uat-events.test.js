'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  toCsv,
  specTemplate,
  writeOperations,
  buildReport,
  renderHtml,
} = require('../../scripts/export-uat-events');
const SCREENS = require('../../scripts/uat-screens');

const BOM = String.fromCharCode(0xfeff);
const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
const at = (minutes) => String(T0 + minutes * 60_000);

const USERS = [
  { id: 'u1', name: 'Ayşe Demir', email: 'ayse@ogm.gov.tr', role: 'admin' },
  { id: 'u2', name: 'Mehmet Kaya', email: 'mehmet@ogm.gov.tr', role: 'super_admin' },
];

const A = { panel_user_id: 'u1', session_id: 'aaaaaaaa-1111-4111-8111-111111111111', page: 'yangin', context: '' };
const B = { panel_user_id: 'u2', session_id: 'bbbbbbbb-2222-4222-8222-222222222222', page: 'yangin', context: '' };
const DIALOG = 'Dialog: Olay Ekle';
const FIRES = 'Yangın Yönetimi › Olay Kayıtları';

const FIXTURE = [
  { ...A, seq: 0, client_ts: at(0), type: 'session_start', detail: { role: 'admin', ua: 'UA' } },
  { ...A, seq: 1, client_ts: at(0), type: 'page_view', detail: { query: 'durum=active' } },
  { ...A, seq: 2, client_ts: at(1), type: 'click', target: 'button|Yeni olay', detail: null },
  { ...A, seq: 3, client_ts: at(2), type: 'field_focus', context: DIALOG, target: 'input|Başlık', detail: { inputType: 'text' } },
  { ...A, seq: 4, client_ts: at(3), type: 'api', context: DIALOG, target: 'POST /admin/missions', detail: { status: 400, code: 'validation_error', ms: 120 } },
  { ...A, seq: 5, client_ts: at(3), type: 'message', context: DIALOG, target: 'Başlık girin.', detail: { level: 'error' } },
  { ...A, seq: 6, client_ts: at(4), type: 'js_error', target: 'boom', detail: { source: 'x.js:3' } },
  { ...A, seq: 7, client_ts: at(4), type: 'inventory', context: DIALOG, detail: JSON.stringify({ keys: ['input|Başlık', 'textarea|Açıklama'] }) },
  { ...B, seq: 0, client_ts: at(10), type: 'session_start', detail: { role: 'super_admin' } },
  { ...B, seq: 1, client_ts: at(10), type: 'page_view', detail: { query: 'durum=active' } },
  { ...B, seq: 2, client_ts: at(12), type: 'field_focus', context: DIALOG, target: 'input|Başlık', detail: { inputType: 'text' } },
  { ...B, seq: 3, client_ts: at(12), type: 'message', context: DIALOG, target: 'Başlık girin.', detail: { level: 'error' } },
];

const report = (name, events, writeOps = []) => buildReport(name, { events, users: USERS, writeOps });
const rowOf = (rows, col, value) => rows.find((r) => r[col] === value);

describe('export-uat-events', () => {
  it('toCsv quotes separators and adds BOM', () => {
    expect(toCsv([['a;b', 'c"d']])).toBe(`${BOM}"a;b";"c""d"\n`);
    expect(toCsv([['x\ny', 'Çığ', 3]])).toBe(`${BOM}"x\ny";Çığ;3\n`);
    expect(toCsv([['=1+1', '-x', '@a', 'ok']])).toBe(`${BOM}'=1+1;'-x;'@a;ok\n`);
  });

  it('templates hide ids', () => {
    expect(specTemplate('/admin/trainings/saha/applications/{applicationId}')).toBe('/admin/trainings/saha/applications/:id');
  });

  it('writeOperations skips reads, refresh and unreachable routes', () => {
    const spec = {
      paths: {
        '/admin/missions': { get: {}, post: {} },
        '/admin/fire-reports/{id}': { get: {}, put: {}, delete: {} },
        '/admin/auth/refresh': { post: {} },
        '/admin/auth/logout': { post: {} },
        '/admin/auth/request': { post: {} },
        '/admin/uat-events': { post: {} },
        '/admin/missions/{id}/call': { post: {} },
        '/admin/users/{id}/application': { put: {} },
        '/users/me': { patch: {} },
        '/missions/active/{id}/scan': { post: {} },
      },
    };

    expect(writeOperations(spec)).toEqual([
      'POST /admin/missions',
      'PUT /admin/fire-reports/:id',
      'DELETE /admin/fire-reports/:id',
      'POST /missions/active/:id/scan',
    ]);
  });

  it('reports have the agreed headers', () => {
    const header = (name) => report(name, [])[0].join(';');

    expect(header('raw')).toBe('Zaman;Kullanıcı;Rol;Oturum;Sıra;Olay;Sayfa;Bölüm;Hedef;Ayrıntı');
    expect(header('pages')).toBe('Sayfa;Kişi;Oturum;Açılma;Aktif süre (dk);Etkileşim;Alan kapsamı;Kapsam %;Filtreler;İlk;Son');
    expect(header('fields')).toBe('Sayfa;Bölüm;Tür;Ad;Durum;Dokunma;Kişi;Kişiler;İlk;Son');
    expect(header('actions')).toBe('Yöntem;Yol;Durum;Deneme;Başarılı;Hatalı;Hata kodları;Ort. süre (ms);Kişi');
    expect(header('people')).toBe(
      'Kullanıcı;E-posta;Rol;Oturum;Aktif süre (dk);Sayfa;Açılan ekran;Dokunulan alan;İşlem;Hatalı işlem;Hata mesajı;JS hatası;İlk;Son',
    );
    expect(header('messages')).toBe('Sayfa;Bölüm;Seviye;Metin;Adet;Kişi;İlk;Son');
  });

  it('raw report shows readable labels and details', () => {
    const rows = report('raw', FIXTURE);

    expect(rows).toHaveLength(FIXTURE.length + 1);
    expect(rows[5]).toEqual([
      '2026-11-26 12:03:00', 'Ayşe Demir', 'admin', 'aaaaaaaa', '4', 'İşlem', FIRES, DIALOG,
      'POST /admin/missions', 'status=400, code=validation_error, ms=120',
    ]);
    expect(rows[8].slice(5)).toEqual(['Ekrandaki alanlar', FIRES, DIALOG, '', '2 alan']);
  });

  it('pages report caps idle gaps at 5 minutes', () => {
    const rows = report('pages', [
      { ...A, seq: 0, client_ts: at(0), type: 'page_view', detail: null },
      { ...A, seq: 1, client_ts: at(1), type: 'click', target: 'button|Kaydet', detail: null },
      { ...A, seq: 2, client_ts: at(60), type: 'click', target: 'button|Kaydet', detail: null },
    ]);

    expect(rows[1]).toEqual([FIRES, '1', '1', '1', '6,0', '2', '0 / 0', '', '', '2026-11-26 12:00:00', '2026-11-26 13:00:00']);
  });

  it('pages report counts people, sessions and filters', () => {
    const row = rowOf(report('pages', FIXTURE), 0, FIRES);

    expect(row.slice(1, 9)).toEqual(['2', '2', '2', '4,0', '3', '1 / 2', '50', 'durum=active×2']);
  });

  it('fields report lists untouched inventory controls', () => {
    const events = [
      { ...A, page: 'ayarlar', seq: 0, client_ts: at(0), type: 'inventory', detail: { keys: ['input|E-posta', 'input|Telefon'] } },
      { ...A, page: 'ayarlar', seq: 1, client_ts: at(1), type: 'field_focus', target: 'input|E-posta', detail: '{"inputType":"email"}' },
    ];

    expect(report('fields', events).slice(1)).toEqual([
      ['ayarlar', '', 'Metin alanı', 'Telefon', 'Dokunulmadı', '0', '0', '', '', ''],
      ['ayarlar', '', 'Metin alanı', 'E-posta', 'Dokunuldu', '1', '1', 'Ayşe Demir', '2026-11-26 12:01:00', '2026-11-26 12:01:00'],
    ]);
    expect(report('pages', events)[1].slice(6, 8)).toEqual(['1 / 2', '50']);
  });

  it('actions report lists never-tried write operations', () => {
    const rows = report('actions', FIXTURE.slice(4, 5), ['POST /admin/missions', 'PUT /admin/fire-reports/:id']);
    const post = rows.find((r) => r[0] === 'POST' && r[1] === '/admin/missions');
    const put = rows.find((r) => r[0] === 'PUT');

    expect(post.slice(2, 9).join(';')).toBe('Denendi;1;0;1;validation_error×1;120;1');
    expect(put.slice(2, 4).join(';')).toBe('Denenmedi;0');
    expect(rows).toHaveLength(3);
  });

  it('actions report also lists observed calls that are not write operations', () => {
    const failedRead = { ...FIXTURE[4], seq: 9, target: 'GET /admin/missions/:id', detail: { status: 500, code: 'internal_error', ms: 80 } };
    const rows = report('actions', [failedRead], ['POST /admin/missions']);

    expect(rows.slice(1).map((r) => r.slice(0, 6).join(';'))).toEqual([
      'POST;/admin/missions;Denenmedi;0;0;0',
      'GET;/admin/missions/:id;Denendi;1;0;1',
    ]);
  });

  it('people report attributes events by panel user', () => {
    const rows = report('people', FIXTURE);

    expect(rows.slice(1)).toEqual([
      ['Ayşe Demir', 'ayse@ogm.gov.tr', 'admin', '1', '2,0', '1', `1 / ${SCREENS.length}`, '1', '1', '1', '1', '1', '2026-11-26 12:00:00', '2026-11-26 12:04:00'],
      ['Mehmet Kaya', 'mehmet@ogm.gov.tr', 'super_admin', '1', '2,0', '1', `1 / ${SCREENS.length}`, '1', '0', '0', '1', '0', '2026-11-26 12:10:00', '2026-11-26 12:12:00'],
    ]);
  });

  it('messages report groups identical texts', () => {
    const rows = report('messages', FIXTURE);

    expect(rows).toHaveLength(3);
    expect(rowOf(rows, 3, 'Başlık girin.')).toEqual([FIRES, DIALOG, 'Hata metni', 'Başlık girin.', '2', '2', '2026-11-26 12:03:00', '2026-11-26 12:12:00']);
    expect(rowOf(rows, 3, 'boom').slice(2, 6)).toEqual(['JS hatası', 'boom', '1', '1']);
  });

  it('unknown report exits with usage', () => {
    const res = spawnSync(process.execPath, [path.join(__dirname, '../../scripts/export-uat-events.js'), 'nope'], {
      encoding: 'utf8',
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('raw|pages|fields|actions|people|messages');
    expect(res.stdout).toBe('');
  });

  it('people report does not count status messages as errors', () => {
    const rows = report('people', [
      { ...A, seq: 0, client_ts: at(0), type: 'message', target: 'Kaydedildi.', detail: { level: 'status' } },
      { ...A, seq: 1, client_ts: at(1), type: 'message', target: 'Başlık girin.', detail: { level: 'error' } },
    ]);

    expect(rows[1][10]).toBe('1');
  });

  it('shows who opened each screen and how many screens each person opened', () => {
    const events = [
      { ...A, seq: 0, client_ts: at(0), type: 'page_view', detail: null },
      { ...B, seq: 0, client_ts: at(1), type: 'page_view', detail: null },
      { ...B, page: 'sos', seq: 1, client_ts: at(2), type: 'page_view', detail: null },
    ];

    expect(rowOf(report('screens', events), 2, 'Olay Kayıtları')[6]).toBe('Ayşe Demir, Mehmet Kaya');
    expect(rowOf(report('screens', events), 2, 'Acil SOS')[6]).toBe('Mehmet Kaya');
    expect(report('people', events).slice(1).map((r) => [r[0], r[6]])).toEqual([
      ['Ayşe Demir', `1 / ${SCREENS.length}`],
      ['Mehmet Kaya', `2 / ${SCREENS.length}`],
    ]);
  });

  it('toCsv guards +, tab and CR leading characters', () => {
    expect(toCsv([['+1', '\tx', '\rx']])).toBe(`${BOM}'+1;'\tx;"'\rx"\n`);
  });

  it('raw report leaves null and empty detail values out', () => {
    const rows = report('raw', [
      { ...A, seq: 0, client_ts: at(0), type: 'api', target: 'GET /admin/missions', detail: { status: 200, code: null, ms: 40, level: '' } },
    ]);

    expect(rows[1][9]).toBe('status=200, ms=40');
  });

  it('pages report counts an out-of-order client clock as zero active time', () => {
    const rows = report('pages', [
      { ...A, seq: 0, client_ts: at(0), type: 'page_view', detail: null },
      { ...A, seq: 1, client_ts: at(3), type: 'click', target: 'button|Kaydet', detail: null },
      { ...A, seq: 2, client_ts: at(1), type: 'click', target: 'button|Kaydet', detail: null },
    ]);

    expect(rows[1][4]).toBe('3,0');
  });

  it('raw report shows the id of an unknown panel user', () => {
    const rows = report('raw', [{ ...A, panel_user_id: 'u9', seq: 0, client_ts: at(0), type: 'page_view', detail: null }]);

    expect(rows[1][1]).toBe('u9');
  });

  describe('screens', () => {
    const DETAIL = { ...A, page: 'yangin/olay/:id' };
    const EVENTS = [
      { ...A, seq: 0, client_ts: at(0), type: 'page_view', detail: null },
      { ...DETAIL, seq: 1, client_ts: at(1), type: 'click', target: 'tab|Gönüllüler #', detail: null },
      { ...DETAIL, seq: 2, client_ts: at(2), type: 'click', context: 'Sekme: Medya #', target: 'button|Yükle', detail: null },
      { ...DETAIL, seq: 3, client_ts: at(3), type: 'click', context: 'Dialog: Olay Düzenle', target: 'button|İptal', detail: null },
      { ...A, page: 'raporlar', seq: 4, client_ts: at(4), type: 'page_view', detail: null },
      { ...A, page: 'icerik', seq: 5, client_ts: at(5), type: 'page_view', detail: null },
    ];
    const status = (rows, name) => rows.find((r) => r[2] === name)?.[4];

    it('marks every inventoried screen as opened or not opened', () => {
      const rows = report('screens', EVENTS);

      expect(rows[0].join(';')).toBe('Bölüm;Tür;Ad;Adres;Durum;Kişi;Kişiler;Oturum;İlk;Son');
      expect(rows).toHaveLength(SCREENS.length + 1);
      expect(rowOf(rows, 2, 'Olay Kayıtları').slice(0, 8)).toEqual(['Yangın Yönetimi', 'Sayfa', 'Olay Kayıtları', '/panel/yangin', 'Açıldı', '1', 'Ayşe Demir', '1']);
      expect(status(rows, 'Olay Kayıtları › olay detayı')).toBe('Açıldı');
      expect(status(rows, 'Acil SOS')).toBe('Açılmadı');
      expect(status(rows, 'Gönüllüler')).toBe('Açıldı');
      expect(status(rows, 'Medya')).toBe('Açıldı');
      expect(status(rows, 'Zaman Çizelgesi')).toBe('Açılmadı');
      expect(status(rows, 'Olay Düzenle')).toBe('Açıldı');
      expect(status(rows, 'Olay kapatılsın mı?')).toBe('Açılmadı');
    });

    it('counts a default tab as opened when its page was opened, and page aliases as the page', () => {
      const rows = report('screens', EVENTS);

      expect(status(rows, 'Son # Ay')).toBe('Açıldı');
      expect(status(rows, 'Son # Gün')).toBe('Açılmadı');
      expect(status(rows, 'Genel Bakış')).toBe('Açıldı');
      expect(status(rows, 'Profil')).toBe('Açılmadı');
      expect(status(rows, 'Blog Yazıları')).toBe('Açıldı');
    });

    it('counts the login screen as opened from its field and click events', () => {
      const login = { ...A, page: 'giris', session_id: '' };
      const rows = report('screens', [{ ...login, seq: 0, client_ts: at(0), type: 'field_focus', target: 'input|E-posta', detail: null }]);

      expect(status(rows, 'Giriş ve Hesap Talebi')).toBe('Açıldı');
    });

    it('does not let a tab name match a longer tab name', () => {
      const rows = report('screens', [{ ...A, page: 'gonullu/:id', seq: 0, client_ts: at(0), type: 'click', target: 'tab|Eğitimlerim', detail: null }]);

      expect(status(rows, 'Eğitimler')).toBe('Açılmadı');
    });

    it('lists each screen once with a known kind', () => {
      const keys = SCREENS.map((s) => `${s.kind}|${s.path}|${s.name}`);

      expect(new Set(keys).size).toBe(SCREENS.length);
      expect(SCREENS.every((s) => ['page', 'tab', 'dialog'].includes(s.kind) && s.area && s.name)).toBe(true);
    });
  });

  it('renderHtml shows screen coverage first and escapes recorded text', () => {
    const events = [...FIXTURE, { ...A, seq: 8, client_ts: at(5), type: 'message', target: '<img src=x onerror=alert(1)>', detail: { level: 'alert' } }];
    const input = { events, users: USERS, writeOps: ['POST /admin/missions'] };
    const reports = Object.fromEntries(['raw', 'pages', 'fields', 'actions', 'people', 'messages', 'screens'].map((n) => [n, buildReport(n, input)]));

    const html = renderHtml(reports, '2026-11-26 13:00:00');

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.indexOf('<h2>Ekranlar')).toBeLessThan(html.indexOf('<h2>Sayfalar'));
    expect(html).toContain(`1 / ${SCREENS.length}`);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  describe('renderHtml', () => {
    const NAMES = ['raw', 'pages', 'fields', 'actions', 'people', 'messages', 'screens'];
    const html = (events, writeOps = []) => {
      const input = { events, users: USERS, writeOps };
      return renderHtml(Object.fromEntries(NAMES.map((n) => [n, buildReport(n, input)])), '2026-11-26 13:00:00');
    };

    it('groups screens by area with the opened count and greys out screens nobody opened', () => {
      const out = html([{ ...A, seq: 0, client_ts: at(0), type: 'page_view', detail: null }]);
      const fireScreens = SCREENS.filter((s) => s.area === 'Yangın Yönetimi').length;

      expect(out).toContain(`<h3>Yangın Yönetimi <span class="muted">1 / ${fireScreens}</span></h3>`);
      expect(out).toContain('<tr class=""><td>Sayfa</td><td>Olay Kayıtları</td><td>/panel/yangin</td><td>Açıldı</td>');
      expect(out).toContain('<tr class="no"><td>Sayfa</td><td>Gelen İhbarlar</td><td>/panel/yangin/ihbar</td><td>Açılmadı</td>');
    });

    it('summary cards count opened screens, tried and failed operations and testers', () => {
      const S = { ...B, page: 'sos' };
      const out = html(
        [
          { ...A, seq: 0, client_ts: at(0), type: 'page_view', detail: null },
          { ...A, seq: 1, client_ts: at(1), type: 'api', target: 'POST /admin/missions', detail: { status: 400, code: 'validation_error', ms: 50 } },
          { ...A, seq: 2, client_ts: at(2), type: 'api', target: 'POST /admin/missions', detail: { status: 400, code: 'validation_error', ms: 50 } },
          { ...S, seq: 0, client_ts: at(3), type: 'page_view', detail: null },
          { ...S, seq: 1, client_ts: at(4), type: 'api', target: 'PUT /admin/fire-reports/:id', detail: { status: 409, code: 'conflict', ms: 50 } },
        ],
        ['POST /admin/missions', 'PUT /admin/fire-reports/:id', 'DELETE /admin/fire-reports/:id'],
      );

      expect(out).toContain(`<div class="card"><b>2 / ${SCREENS.length}</b>açılan ekran (sayfa, sekme, dialog)</div>`);
      expect(out).toContain('<div class="card"><b>2 / 3</b>denenen işlem</div>');
      expect(out).toContain('<div class="card"><b>3</b>hatalı işlem</div>');
      expect(out).toContain('<div class="card"><b>2</b>test eden kişi</div>');
    });
  });

  describe('CLI', () => {
    const ROOT = path.join(__dirname, '../..');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uat-export-'));
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const runCli = (name, { events = [], fail = false } = {}) => {
      const preload = path.join(tmp, `${name}-${fail}.js`);
      fs.writeFileSync(
        preload,
        `'use strict';
const path = require('path');
const stub = (rel, exports) => {
  const id = require.resolve(path.join(${JSON.stringify(ROOT)}, rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const tables = ${JSON.stringify({ uat_events: events, panel_users: USERS })};
const db = (table) => ({
  select: (...cols) => {
    console.log('select', table, cols.join(','));
    const rows = ${fail} ? Promise.reject(new Error('connect ECONNREFUSED')) : Promise.resolve(tables[table]);
    return Object.assign(rows, {
      orderBy: (order) => {
        console.log('orderBy', table, order.join(','));
        return rows;
      },
    });
  },
});
db.destroy = async () => process.stderr.write('db destroyed\\n');
stub('src/config/db', { db });
stub('src/config/swagger', { buildSpec: () => ({ paths: {} }) });
`,
      );
      return spawnSync(process.execPath, ['--require', preload, path.join(ROOT, 'scripts/export-uat-events.js'), name], {
        encoding: 'utf8',
      });
    };

    it('writes only the CSV to stdout and closes the db', () => {
      const res = runCli('raw', { events: [FIXTURE[1]] });

      expect(res.status).toBe(0);
      expect(res.stdout).toBe(
        `${BOM}Zaman;Kullanıcı;Rol;Oturum;Sıra;Olay;Sayfa;Bölüm;Hedef;Ayrıntı\n`
          + '2026-11-26 12:00:00;Ayşe Demir;admin;aaaaaaaa;1;Sayfa açıldı;Yangın Yönetimi › Olay Kayıtları;;;query=durum=active\n',
      );
      expect(res.stderr).toContain('select uat_events *');
      expect(res.stderr).toContain('orderBy uat_events session_id,seq');
      expect(res.stderr).toContain('select panel_users id,name,email,role');
      expect(res.stderr).toContain('db destroyed');
    });

    it('html writes one HTML page with every report', () => {
      const res = runCli('html', { events: [FIXTURE[1]] });

      expect(res.status).toBe(0);
      expect(res.stdout.startsWith('<!doctype html>')).toBe(true);
      for (const title of ['Ekranlar', 'Kişiler', 'Sayfalar', 'Alanlar ve butonlar', 'İşlemler', 'Mesajlar ve hatalar', 'Olay akışı']) {
        expect(res.stdout).toContain(`<h2>${title}`);
      }
      expect(res.stderr).toContain('db destroyed');
    });

    it('closes the db and exits 1 when the query fails', () => {
      const res = runCli('raw', { fail: true });

      expect(res.status).toBe(1);
      expect(res.stdout).toBe('');
      expect(res.stderr).toContain('UAT raporu üretilemedi: connect ECONNREFUSED');
      expect(res.stderr).toContain('db destroyed');
    });
  });
});
