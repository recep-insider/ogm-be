'use strict';

// Panelin ekran envanteri (ogm-gonullu-panel: src/lib/router.js yolları, sayfalardaki sekme ve dialog başlıkları).
// Rapordaki "Açılmadı" satırları bu listeden gelir; panele ekran eklenince burası da güncellenir.
// Adlar paneldeki menü, sekme ve dialog başlıklarıdır; rakamlar panelin kaydettiği gibi # olur.
const page = (area, name, path, aliases = []) => ({ kind: 'page', area, name, path, pages: [path, ...aliases] });
const tab = (area, path, name, isDefault = false) => ({ kind: 'tab', area, name, path, isDefault });
const dialog = (area, name) => ({ kind: 'dialog', area, name, path: '' });

const FIRE = 'Yangın Yönetimi';
const VOL = 'Gönüllü Yönetimi';
const CONTENT = 'İçerik Yönetimi';
const USERS = 'Kullanıcı Yönetimi';

module.exports = [
  page('Giriş ve Hesap Talebi', 'Giriş ve Hesap Talebi', 'giris'),
  page('Operasyon Merkezi', 'Operasyon Merkezi', 'operasyon'),

  page(FIRE, 'Olay Kayıtları', 'yangin'),
  page(FIRE, 'Gelen İhbarlar', 'yangin/ihbar'),
  page(FIRE, 'Olay Kayıtları › olay detayı', 'yangin/olay/:id'),
  tab(FIRE, 'yangin/olay/:id', 'Genel Bakış', true),
  tab(FIRE, 'yangin/olay/:id', 'Gönüllüler'),
  tab(FIRE, 'yangin/olay/:id', 'Toplanma Noktası'),
  tab(FIRE, 'yangin/olay/:id', 'Bildirimler'),
  tab(FIRE, 'yangin/olay/:id', 'Medya'),
  tab(FIRE, 'yangin/olay/:id', 'Zaman Çizelgesi'),
  dialog(FIRE, 'Olay Düzenle'),
  dialog(FIRE, 'Mevcut Olaya Ekle'),
  dialog(FIRE, 'İhbar olaydan ayrılsın mı?'),
  dialog(FIRE, 'Olay kapatılsın mı?'),
  dialog(FIRE, 'Medya silinsin mi?'),
  dialog(FIRE, 'İhbarı kapat'),

  page('Acil SOS', 'Acil SOS', 'sos'),
  page('Acil SOS', 'çağrı detayı', 'sos/:id'),
  dialog('Acil SOS', 'Çağrı kapatılsın mı?'),

  page(VOL, 'Gönüllü Yönetimi', 'gonullu'),
  page(VOL, 'gönüllü detayı', 'gonullu/:id'),
  tab(VOL, 'gonullu/:id', 'Profil', true),
  tab(VOL, 'gonullu/:id', 'Ekipman'),
  tab(VOL, 'gonullu/:id', 'Eğitimler'),
  dialog(VOL, 'Başvuru onaylansın mı?'),
  dialog(VOL, 'Başvuru reddedilsin mi?'),

  page('QR Check-in', 'QR Check-in', 'qr'),

  page('Bildirim Merkezi', 'Genel', 'bildirim/genel'),
  page('Bildirim Merkezi', 'Yangın Bazlı', 'bildirim/yangin/:id', ['bildirim/yangin', 'bildirim']),
  dialog('Bildirim Merkezi', 'Bildirim gönderilsin mi?'),

  page(CONTENT, 'Blog Yazıları', 'icerik/blog', ['icerik']),
  page(CONTENT, 'Blog Yazıları › yeni yazı', 'icerik/blog/yeni'),
  page(CONTENT, 'Blog Yazıları › yazı düzenleme', 'icerik/blog/:id'),
  page(CONTENT, 'Eğitim Yönetimi', 'icerik/egitim'),
  tab(CONTENT, 'icerik/egitim', 'Teorik Eğitimler', true),
  tab(CONTENT, 'icerik/egitim', 'Uygulamalı Eğitimler'),
  page(CONTENT, 'Eğitim Yönetimi › yeni eğitim', 'icerik/egitim/yeni'),
  page(CONTENT, 'Eğitim Yönetimi › eğitim düzenleme', 'icerik/egitim/:id'),
  page(CONTENT, 'Eğitim Yönetimi › katılımcılar', 'icerik/egitim/:id/katilimcilar'),
  dialog(CONTENT, 'Yayınlansın mı?'),
  dialog(CONTENT, 'Yayından kaldırılsın mı?'),
  dialog(CONTENT, 'Yazıyı sil'),
  dialog(CONTENT, 'Eğitimi sil'),
  dialog(CONTENT, 'Eğitim silinemez'),
  dialog(CONTENT, 'Katılımcı eğitimden çıkarılsın mı?'),

  page('Raporlar', 'Raporlar', 'raporlar'),
  tab('Raporlar', 'raporlar', 'Son # Ay', true),
  tab('Raporlar', 'raporlar', 'Son # Gün'),
  tab('Raporlar', 'raporlar', 'Son # Hafta'),

  page(USERS, 'Bekleyen Talepler', 'kullanicilar'),
  page(USERS, 'Kullanıcılar', 'kullanicilar/kullanicilar'),
  page(USERS, 'kullanıcı detayı', 'kullanicilar/:id'),
  dialog(USERS, 'Hesap talebi onaylansın mı?'),
  dialog(USERS, 'Hesap talebi reddedilsin mi?'),
  dialog(USERS, 'Süper admin yapılsın mı?'),
  dialog(USERS, 'Süper admin yetkisi alınsın mı?'),
  dialog(USERS, 'Hesap devre dışı bırakılsın mı?'),
  dialog(USERS, 'Hesap etkinleştirilsin mi?'),
  dialog(USERS, 'Şifre sıfırlansın mı?'),
  dialog(USERS, 'Geçici şifre'),

  dialog('Her sayfada', 'Yeni Olay Kaydı Oluştur'),
  dialog('Her sayfada', 'Şifre Değiştir'),
];
