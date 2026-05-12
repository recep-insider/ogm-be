#!/usr/bin/env node
'use strict';

/**
 * Swagger / OpenAPI watcher.
 *
 * `src/modules/**\/*.routes.js`, `src/modules/**\/*.controller.js`,
 * `src/modules/**\/*.docs.js` ve `src/config/swagger.js` dosyaları değiştiğinde
 * `docs/openapi.json` çıktısını otomatik üretir.
 *
 * Kullanım:
 *   npm run swagger:watch
 *
 * Geliştirme döngüsü esnasında ayrı bir terminalde çalıştırılması önerilir.
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DEBOUNCE_MS = 500;

const isInteresting = (file) => /\.(routes|controller|docs)\.js$/.test(file)
  || /config\/swagger\.js$/.test(file);

let scheduled = null;
function schedule() {
  if (scheduled) clearTimeout(scheduled);
  scheduled = setTimeout(runExport, DEBOUNCE_MS);
}

function runExport() {
  scheduled = null;
  execFile(
    process.execPath,
    [path.join(ROOT, 'scripts', 'export-openapi.js')],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        LOG_DIR: process.env.LOG_DIR || path.join(ROOT, 'logs'),
        UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),
        NODE_ENV: process.env.NODE_ENV || 'test',
      },
    },
    (err, stdout, stderr) => {
      if (err) {
        process.stderr.write(`[swagger:watch] ${stderr || err.message}\n`);
        return;
      }
      process.stdout.write(`[swagger:watch] ${stdout.trim()}\n`);
    },
  );
}

function watchRecursive(dir) {
  // macOS + Linux'da fs.watch recursive destekleniyor.
  fs.watch(dir, { recursive: true }, (event, filename) => {
    if (!filename) return;
    if (!isInteresting(filename)) return;
    schedule();
  });
}

console.log('[swagger:watch] izleme başlatıldı:', SRC);
watchRecursive(SRC);
runExport(); // ilk export
