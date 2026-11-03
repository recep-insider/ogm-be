'use strict';

const fs = require('fs');

/**
 * İstekle diske yazılmış dosyaları siler (multer: tek dosya, dizi ya da `{alan: [dosyalar]}`).
 * multer reddettiği dosyayı yolsuz bırakabilir; yolu olmayan kayıt atlanır (hata yakalayıcı içinde çalışır, atmamalı).
 */
function discardUploads(req) {
  const { file, files } = req;
  const list = [
    ...(file ? [file] : []),
    ...(Array.isArray(files) ? files : Object.values(files || {}).flat()),
  ];
  for (const f of list) {
    if (typeof f?.path === 'string') fs.unlink(f.path, () => {});
  }
}

module.exports = { discardUploads };
