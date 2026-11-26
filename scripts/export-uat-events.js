#!/usr/bin/env node
'use strict';

// UAT etkileşim olaylarından Excel'de açılan CSV raporu üretir; bilgisayara indirmek için scripts/uat-rapor.sh.
//
// Kullanım (sunucuda; npm run değil node, npm'in başlık satırı CSV'ye karışır):
//   docker compose exec -T backend node scripts/export-uat-events.js <raw|pages|fields|actions|people|messages>

const BOM = String.fromCharCode(0xfeff);
const IDLE_CAP_MS = 5 * 60 * 1000;
const ACTIVITY = ['session_start', 'page_view', 'click', 'field_focus', 'field_change'];
const TOUCH = ['click', 'field_focus', 'field_change'];
const DENOMINATOR = ['input', 'textarea', 'select', 'combobox', 'checkbox', 'radio', 'switch', 'tab'];
const WRITE_METHODS = ['post', 'put', 'patch', 'delete'];
const EXTRA_WRITE_OPS = ['POST /missions/active/:id/scan'];
const EXCLUDED = [
  'POST /admin/auth/refresh',
  'POST /admin/auth/logout',
  'POST /admin/auth/request',
  'POST /admin/uat-events',
  'PUT /admin/users/:id/application',
  'POST /admin/missions/:id/call',
];

const EVENT_LABELS = {
  session_start: 'Oturum açıldı',
  page_view: 'Sayfa açıldı',
  click: 'Tıklandı',
  field_focus: 'Alana girildi',
  field_change: 'Alan değiştirildi',
  api: 'İşlem',
  message: 'Mesaj gösterildi',
  js_error: 'JS hatası',
  inventory: 'Ekrandaki alanlar',
  lost: 'Kayıp olay',
};
const KIND_LABELS = {
  button: 'Buton',
  a: 'Bağlantı',
  tab: 'Sekme',
  option: 'Seçenek',
  checkbox: 'Onay kutusu',
  radio: 'Seçim düğmesi',
  combobox: 'Açılır liste',
  select: 'Açılır liste',
  menuitem: 'Menü öğesi',
  input: 'Metin alanı',
  textarea: 'Çok satırlı alan',
  card: 'Kart',
  switch: 'Anahtar',
};
const LEVEL_LABELS = { alert: 'Uyarı', status: 'Bilgi', error: 'Hata metni', js_error: 'JS hatası' };

const HEADERS = {
  raw: ['Zaman', 'Kullanıcı', 'Rol', 'Oturum', 'Sıra', 'Olay', 'Sayfa', 'Bölüm', 'Hedef', 'Ayrıntı'],
  pages: ['Sayfa', 'Kişi', 'Oturum', 'Açılma', 'Aktif süre (dk)', 'Etkileşim', 'Alan kapsamı', 'Kapsam %', 'Filtreler', 'İlk', 'Son'],
  fields: ['Sayfa', 'Bölüm', 'Tür', 'Ad', 'Durum', 'Dokunma', 'Kişi', 'Kişiler', 'İlk', 'Son'],
  actions: ['Yöntem', 'Yol', 'Durum', 'Deneme', 'Başarılı', 'Hatalı', 'Hata kodları', 'Ort. süre (ms)', 'Kişi'],
  people: [
    'Kullanıcı', 'E-posta', 'Rol', 'Oturum', 'Aktif süre (dk)', 'Sayfa', 'Dokunulan alan', 'İşlem', 'Hatalı işlem',
    'Hata mesajı', 'JS hatası', 'İlk', 'Son',
  ],
  messages: ['Sayfa', 'Bölüm', 'Seviye', 'Metin', 'Adet', 'Kişi', 'İlk', 'Son'],
};

function cell(value) {
  let s = value == null ? '' : String(value);
  // Excel =, +, -, @ ile başlayan hücreyi formül sayar.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return BOM + rows.map((row) => `${row.map(cell).join(';')}\n`).join('');
}

const specTemplate = (path) => path.replace(/\{[^}]+\}/g, ':id');

function writeOperations(spec) {
  const ops = Object.entries(spec.paths || {})
    .filter(([path]) => path.startsWith('/admin/'))
    .flatMap(([path, item]) =>
      Object.keys(item)
        .filter((method) => WRITE_METHODS.includes(method))
        .map((method) => `${method.toUpperCase()} ${specTemplate(path)}`),
    );
  return [...ops, ...EXTRA_WRITE_OPS].filter((op) => !EXCLUDED.includes(op));
}

const time = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' });
const minutes = (ms) => (ms / 60000).toFixed(1).replace('.', ',');
const cmp = (a, b) => String(a).localeCompare(String(b), 'tr');
const keyOf = (...parts) => parts.join('\u0000');
const distinct = (list, fn) => new Set(list.map(fn)).size;

function groupBy(list, fn) {
  const groups = new Map();
  for (const item of list) {
    const key = fn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function range(list) {
  if (!list.length) return ['', ''];
  const ts = list.map((e) => e.ts);
  return [time(ts.reduce((a, b) => Math.min(a, b))), time(ts.reduce((a, b) => Math.max(a, b)))];
}

function tally(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `${v}×${n}`)
    .join(', ');
}

function splitTarget(target) {
  const i = target.indexOf('|');
  return i < 0 ? ['', target] : [target.slice(0, i), target.slice(i + 1)];
}

// ponytail: aktif süre tahmindir; ardışık etkileşim arası en çok 5 dk sayılır. Gerçek odak süresi gerekirse
// visibilitychange olayı kaydedilip boşluklar ona göre kesilir.
function activeSpans(events) {
  const spans = [];
  const sessions = groupBy(events.filter((e) => ACTIVITY.includes(e.type)), (e) => e.session_id);
  for (const list of sessions.values()) {
    list.sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < list.length - 1; i += 1) {
      spans.push({ event: list[i], ms: Math.min(Math.max(list[i + 1].ts - list[i].ts, 0), IDLE_CAP_MS) });
    }
  }
  return spans;
}

const activeMinutes = (spans, pred) => minutes(spans.filter((s) => pred(s.event)).reduce((sum, s) => sum + s.ms, 0));

function fieldRows(events) {
  const fields = new Map();
  const field = (e, target) => {
    const key = keyOf(e.page, e.context, target);
    if (!fields.has(key)) {
      const [kind, name] = splitTarget(target);
      fields.set(key, { page: e.page, context: e.context, kind, name, touches: [] });
    }
    return fields.get(key);
  };
  for (const e of events) {
    if (e.type === 'inventory') (e.detail.keys || []).forEach((k) => field(e, k));
    else if (TOUCH.includes(e.type) && e.target) field(e, e.target).touches.push(e);
  }
  return [...fields.values()];
}

function rawReport({ events, userById }) {
  return events.map((e) => {
    const user = userById.get(e.panel_user_id) || {};
    const detail =
      e.type === 'inventory'
        ? `${(e.detail.keys || []).length} alan`
        : Object.entries(e.detail)
          .filter(([, v]) => v != null && v !== '')
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
    return [
      time(e.ts), user.name ?? e.panel_user_id, user.role, String(e.session_id).slice(0, 8), e.seq,
      EVENT_LABELS[e.type] ?? e.type, e.page, e.context, e.target, detail,
    ];
  });
}

function pagesReport({ events }) {
  const spans = activeSpans(events);
  const fields = fieldRows(events).filter((f) => DENOMINATOR.includes(f.kind));
  return [...groupBy(events, (e) => e.page)]
    .sort(([a], [b]) => cmp(a, b))
    .map(([page, list]) => {
      const pageFields = fields.filter((f) => f.page === page);
      const touched = pageFields.filter((f) => f.touches.length).length;
      const views = list.filter((e) => e.type === 'page_view');
      return [
        page,
        distinct(list, (e) => e.panel_user_id),
        distinct(list, (e) => e.session_id),
        views.length,
        activeMinutes(spans, (e) => e.page === page),
        list.filter((e) => TOUCH.includes(e.type)).length,
        `${touched} / ${pageFields.length}`,
        pageFields.length ? Math.round((100 * touched) / pageFields.length) : '',
        tally(views.map((e) => e.detail.query).filter(Boolean)),
        ...range(list),
      ];
    });
}

function fieldsReport({ events, userById }) {
  return fieldRows(events)
    .sort(
      (a, b) =>
        cmp(a.page, b.page) ||
        cmp(a.context, b.context) ||
        Math.sign(a.touches.length) - Math.sign(b.touches.length) ||
        cmp(a.name, b.name),
    )
    .map((f) => {
      const people = [...new Set(f.touches.map((e) => e.panel_user_id))];
      return [
        f.page, f.context, KIND_LABELS[f.kind] ?? f.kind, f.name, f.touches.length ? 'Dokunuldu' : 'Dokunulmadı',
        f.touches.length, people.length, people.map((id) => userById.get(id)?.name ?? id).join(', '), ...range(f.touches),
      ];
    });
}

function actionsReport({ events, writeOps }) {
  const calls = groupBy(events.filter((e) => e.type === 'api' && e.target), (e) => e.target);
  return [...new Set([...writeOps, ...calls.keys()])]
    .map((op) => {
      const list = calls.get(op) || [];
      const failed = list.filter((e) => e.detail.code);
      const ms = list.map((e) => e.detail.ms).filter(Number.isFinite);
      const [method, ...path] = op.split(' ');
      return [
        method, path.join(' '), list.length ? 'Denendi' : 'Denenmedi', list.length, list.length - failed.length,
        failed.length, tally(failed.map((e) => e.detail.code)),
        ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : '',
        distinct(list, (e) => e.panel_user_id),
      ];
    })
    .sort((a, b) => cmp(a[1], b[1]) || cmp(a[0], b[0]));
}

function peopleReport({ events, userById }) {
  const spans = activeSpans(events);
  return [...groupBy(events, (e) => e.panel_user_id)]
    .map(([id, list]) => {
      const user = userById.get(id) || {};
      const api = list.filter((e) => e.type === 'api');
      const touchedFields = list.filter(
        (e) => TOUCH.includes(e.type) && e.target && DENOMINATOR.includes(splitTarget(e.target)[0]),
      );
      return [
        user.name ?? id, user.email, user.role,
        distinct(list, (e) => e.session_id),
        activeMinutes(spans, (e) => e.panel_user_id === id),
        distinct(list.filter((e) => e.type === 'page_view'), (e) => e.page),
        distinct(touchedFields, (e) => keyOf(e.page, e.context, e.target)),
        api.length,
        api.filter((e) => e.detail.code).length,
        list.filter((e) => e.type === 'message' && e.detail.level !== 'status').length,
        list.filter((e) => e.type === 'js_error').length,
        ...range(list),
      ];
    })
    .sort((a, b) => cmp(a[0], b[0]));
}

function messagesReport({ events }) {
  const levelOf = (e) => (e.type === 'js_error' ? 'js_error' : e.detail.level || '');
  const groups = groupBy(
    events.filter((e) => e.type === 'message' || e.type === 'js_error'),
    (e) => keyOf(e.page, e.context, levelOf(e), e.target || ''),
  );
  return [...groups.values()]
    .map((list) => {
      const [e] = list;
      return [
        e.page, e.context, LEVEL_LABELS[levelOf(e)] ?? levelOf(e), e.target, list.length,
        distinct(list, (x) => x.panel_user_id), ...range(list),
      ];
    })
    .sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]) || b[4] - a[4]);
}

const REPORTS = {
  raw: rawReport,
  pages: pagesReport,
  fields: fieldsReport,
  actions: actionsReport,
  people: peopleReport,
  messages: messagesReport,
};

function buildReport(name, { events, users = [], writeOps = [] }) {
  const input = {
    events: events.map((e) => ({
      ...e,
      seq: Number(e.seq),
      ts: Number(e.client_ts),
      page: e.page || '',
      context: e.context || '',
      detail: (typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail) || {},
    })),
    userById: new Map(users.map((u) => [u.id, u])),
    writeOps,
  };
  return [HEADERS[name], ...REPORTS[name](input)].map((row) => row.map((v) => (v == null ? '' : String(v))));
}

async function main() {
  // stdout yalnız CSV taşır; kütüphanelerin yazdığı her satır stderr'e gider.
  console.log = console.error;
  const names = Object.keys(REPORTS);
  const name = process.argv[2];
  if (!names.includes(name)) {
    console.error(`Kullanım: node scripts/export-uat-events.js <${names.join('|')}>`);
    process.exitCode = 1;
    return;
  }
  const { db } = require('../src/config/db');
  // docs/ imaja girmez (SIM-1131); işlem listesi spec'ten çalışma anında üretilir.
  const { buildSpec } = require('../src/config/swagger');
  try {
    const [events, users] = await Promise.all([
      db('uat_events').select('*').orderBy(['session_id', 'seq']),
      db('panel_users').select('id', 'name', 'email', 'role'),
    ]);
    process.stdout.write(toCsv(buildReport(name, { events, users, writeOps: writeOperations(buildSpec()) })));
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('UAT raporu üretilemedi:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { toCsv, specTemplate, writeOperations, buildReport };
