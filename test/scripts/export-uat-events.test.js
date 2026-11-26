'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  toCsv,
  apiTemplate,
  specTemplate,
  writeOperations,
  buildReport,
} = require('../../scripts/export-uat-events');

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
  });

  it('templates hide ids', () => {
    expect(apiTemplate('/admin/missions/3f2a9c1e-0b1d-4c55-9a77-12ab34cd56ef/photos/77')).toBe('/admin/missions/:id/photos/:id');
    expect(specTemplate('/admin/trainings/saha/applications/{applicationId}')).toBe('/admin/trainings/saha/applications/:id');
  });

  it('writeOperations skips reads, refresh and unreachable routes', () => {
    const spec = {
      paths: {
        '/admin/missions': { get: {}, post: {} },
        '/admin/fire-reports/{id}': { get: {}, put: {}, delete: {} },
        '/admin/auth/refresh': { post: {} },
        '/admin/auth/logout': { post: {} },
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
      'Kullanıcı;E-posta;Rol;Oturum;Aktif süre (dk);Sayfa;Dokunulan alan;İşlem;Hatalı işlem;Hata mesajı;JS hatası;İlk;Son',
    );
    expect(header('messages')).toBe('Sayfa;Bölüm;Seviye;Metin;Adet;Kişi;İlk;Son');
  });

  it('raw report shows readable labels and details', () => {
    const rows = report('raw', FIXTURE);

    expect(rows).toHaveLength(FIXTURE.length + 1);
    expect(rows[5]).toEqual([
      '2026-11-26 12:03:00', 'Ayşe Demir', 'admin', 'aaaaaaaa', '4', 'İşlem', 'yangin', DIALOG,
      'POST /admin/missions', 'status=400, code=validation_error, ms=120',
    ]);
    expect(rows[8].slice(5)).toEqual(['Ekrandaki alanlar', 'yangin', DIALOG, '', '2 alan']);
  });

  it('pages report caps idle gaps at 5 minutes', () => {
    const rows = report('pages', [
      { ...A, seq: 0, client_ts: at(0), type: 'page_view', detail: null },
      { ...A, seq: 1, client_ts: at(1), type: 'click', target: 'button|Kaydet', detail: null },
      { ...A, seq: 2, client_ts: at(60), type: 'click', target: 'button|Kaydet', detail: null },
    ]);

    expect(rows[1]).toEqual(['yangin', '1', '1', '1', '6,0', '2', '0/0', '', '', '2026-11-26 12:00:00', '2026-11-26 13:00:00']);
  });

  it('pages report counts people, sessions and filters', () => {
    const row = rowOf(report('pages', FIXTURE), 0, 'yangin');

    expect(row.slice(1, 9)).toEqual(['2', '2', '2', '4,0', '3', '1/2', '50', 'durum=active×2']);
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
    expect(report('pages', events)[1].slice(6, 8)).toEqual(['1/2', '50']);
  });

  it('actions report lists never-tried write operations', () => {
    const rows = report('actions', FIXTURE.slice(4, 5), ['POST /admin/missions', 'PUT /admin/fire-reports/:id']);
    const post = rows.find((r) => r[0] === 'POST' && r[1] === '/admin/missions');
    const put = rows.find((r) => r[0] === 'PUT');

    expect(post.slice(2, 9).join(';')).toBe('Denendi;1;0;1;validation_error×1;120;1');
    expect(put.slice(2, 4).join(';')).toBe('Denenmedi;0');
    expect(rows).toHaveLength(3);
  });

  it('people report attributes events by panel user', () => {
    const rows = report('people', FIXTURE);

    expect(rows.slice(1)).toEqual([
      ['Ayşe Demir', 'ayse@ogm.gov.tr', 'admin', '1', '2,0', '1', '1', '1', '1', '1', '1', '2026-11-26 12:00:00', '2026-11-26 12:04:00'],
      ['Mehmet Kaya', 'mehmet@ogm.gov.tr', 'super_admin', '1', '2,0', '1', '1', '0', '0', '1', '0', '2026-11-26 12:10:00', '2026-11-26 12:12:00'],
    ]);
  });

  it('messages report groups identical texts', () => {
    const rows = report('messages', FIXTURE);

    expect(rows).toHaveLength(3);
    expect(rowOf(rows, 3, 'Başlık girin.')).toEqual(['yangin', DIALOG, 'Hata metni', 'Başlık girin.', '2', '2', '2026-11-26 12:03:00', '2026-11-26 12:12:00']);
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

    expect(rows[1][9]).toBe('1');
  });

  it('raw report shows the id of an unknown panel user', () => {
    const rows = report('raw', [{ ...A, panel_user_id: 'u9', seq: 0, client_ts: at(0), type: 'page_view', detail: null }]);

    expect(rows[1][1]).toBe('u9');
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
          + '2026-11-26 12:00:00;Ayşe Demir;admin;aaaaaaaa;1;Sayfa açıldı;yangin;;;query=durum=active\n',
      );
      expect(res.stderr).toContain('select uat_events *');
      expect(res.stderr).toContain('orderBy uat_events session_id,seq');
      expect(res.stderr).toContain('select panel_users id,name,email,role');
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
