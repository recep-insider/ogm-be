'use strict';

// backend-gereksinimleri.md §2/§3/§12 — olay yaşam döngüsü ve gönüllü olay durumu.
//
//  * Olay durumu YALNIZCA `active` → `archived`. Dört durumlu model (İzleniyor → Aktif →
//    Kontrol Altında → Kapatıldı) kaldırıldı. Arşivlendi TERMİNALDİR: aynı kayıt tekrar
//    Aktif'e alınamaz; yeniden alevlenirse YENİ olay kaydı açılır.
//  * Gönüllü olay durumu sinyalden türer: cagrildi (bildirim) · yolda/katilamiyor (mobil
//    buton) · sahada (QR check-in) · tamamladi (olayın arşivlenmesi).
//  * §12: merkez operatörünün masa başında bilemeyeceği saha alanları kaldırıldı —
//    tahmini alan (hektar), sahadaki ihtiyaçlar, kapsama yarıçapı, gerekli ekipman metni.
exports.up = async function up(knex) {
  // ── missions.status: active | archived ───────────────────────────────────
  await knex.schema.alterTable('missions', (t) => {
    t.enu('status_v2', ['active', 'archived'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('active');
    t.timestamp('archived_at').nullable();
  });
  // staffed → active (yeterli gönüllü olması olayı kapatmaz), completed → archived.
  await knex('missions').whereIn('status', ['active', 'staffed']).update({ status_v2: 'active' });
  await knex('missions').where({ status: 'completed' }).update({ status_v2: 'archived' });
  await knex('missions')
    .where({ status: 'completed' })
    .whereNull('archived_at')
    .update({ archived_at: knex.fn.now() });
  await knex.schema.alterTable('missions', (t) => {
    t.dropColumn('status');
  });
  await knex.schema.alterTable('missions', (t) => {
    t.renameColumn('status_v2', 'status');
  });
  await knex.schema.alterTable('missions', (t) => {
    t.dropColumn('needs');
    t.dropColumn('stat_hectares');
    t.dropColumn('coverage_radius_km');
    t.dropColumn('required_equipment');
  });

  // ── mission_participants.status: olay durumu sözleşmesi ──────────────────
  await knex.schema.alterTable('mission_participants', (t) => {
    t.enu('status_v2', ['cagrildi', 'yolda', 'sahada', 'tamamladi', 'katilamiyor'], {
      useNative: false,
      enumName: null,
    })
      .notNullable()
      .defaultTo('cagrildi');
    t.timestamp('called_at').nullable();
    t.timestamp('responded_at').nullable();
    t.timestamp('completed_at').nullable();
  });
  await knex('mission_participants').where({ status: 'accepted' }).update({ status_v2: 'yolda' });
  await knex('mission_participants').where({ status: 'on_site' }).update({ status_v2: 'sahada' });
  await knex.schema.alterTable('mission_participants', (t) => {
    t.dropColumn('status');
  });
  await knex.schema.alterTable('mission_participants', (t) => {
    t.renameColumn('status_v2', 'status');
  });

  // ── Toplanma noktası: olay başına TEK nokta ──────────────────────────────
  // Bağın tek kaynağı assembly_points.mission_id'dir (§12: missions.assemblyPointId
  // alanı bilinçli olarak YOK — bağın iki yerde tutulması ayrışmaya açıktı).
  // Kontenjan alanı da yoktur: toplanma noktası açık bir alandır, kapasitesi ölçülemez.
  await knex.schema.createTable('assembly_points', (t) => {
    t.string('id', 36).primary();
    t.string('mission_id', 36).notNullable().unique().references('id').inTable('missions').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.string('address', 300).nullable();
    t.decimal('lat', 10, 7).notNullable();
    t.decimal('lng', 10, 7).notNullable();
    t.boolean('is_open').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
  await knex.schema.alterTable('missions', (t) => {
    t.dropColumn('meeting_point');
  });

  // ── QR check-in: yangın sahası giriş kaydı (§13) ─────────────────────────
  // Sahadaki gönüllü sayısının TEK kaynağı budur; panel, mobil ve toplanma noktası
  // ekranı aynı sayıyı gösterir. Çıkış kaydı faz 1 kapsamı dışında.
  await knex.schema.createTable('check_ins', (t) => {
    t.string('id', 36).primary();
    t.string('mission_id', 36).notNullable().references('id').inTable('missions').onDelete('CASCADE');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('checked_in_at').notNullable().defaultTo(knex.fn.now());
    // QR okutulamazsa TC kimlik numarasıyla manuel kayıt yedek yöntemdir.
    t.enu('method', ['qr', 'tc_manual'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('qr');
    t.string('recorded_by', 120).nullable();
    t.timestamps(true, true);
    t.unique(['mission_id', 'user_id']);
    t.index(['mission_id', 'checked_in_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('check_ins');
  await knex.schema.dropTableIfExists('assembly_points');

  await knex.schema.alterTable('mission_participants', (t) => {
    t.renameColumn('status', 'status_v2');
  });
  await knex.schema.alterTable('mission_participants', (t) => {
    t.enu('status', ['accepted', 'on_site'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('accepted');
  });
  await knex('mission_participants').where({ status_v2: 'sahada' }).update({ status: 'on_site' });
  await knex.schema.alterTable('mission_participants', (t) => {
    t.dropColumn('status_v2');
    t.dropColumn('called_at');
    t.dropColumn('responded_at');
    t.dropColumn('completed_at');
  });

  await knex.schema.alterTable('missions', (t) => {
    t.json('needs').nullable();
    t.float('stat_hectares').notNullable().defaultTo(0);
    t.float('coverage_radius_km').nullable();
    t.string('required_equipment', 200).nullable();
    t.string('meeting_point', 200).nullable();
    t.renameColumn('status', 'status_v2');
  });
  await knex.schema.alterTable('missions', (t) => {
    t.enu('status', ['active', 'staffed', 'completed'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('active');
  });
  await knex('missions').where({ status_v2: 'archived' }).update({ status: 'completed' });
  await knex.schema.alterTable('missions', (t) => {
    t.dropColumn('status_v2');
    t.dropColumn('archived_at');
  });
};
