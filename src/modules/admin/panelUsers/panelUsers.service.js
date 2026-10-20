'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../../config/db');
const { redis } = require('../../../config/redis');
const { errors } = require('../../../shared/errors');
const { generateTempPassword } = require('../../../shared/temp-password');
const auth = require('../auth/panelAuth.service');

const REQUEST_MAX_PER_WINDOW = 10;
const REQUEST_WINDOW_SEC = 3600;
const REQUEST_RL_PREFIX = 'rl:panel-request:';
const AUDIT_LIMIT = 100;

function toItem(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    isSystem: Boolean(u.is_system),
    bolge: u.bolge_mudurlugu || null,
    isletme: u.isletme_mudurlugu || null,
    phone: u.phone || null,
    requestNote: u.request_note || null,
    requestedAt: u.requested_at || null,
    approvedBy: u.approved_by || null,
    approvedAt: u.approved_at || null,
    rejectionReason: u.rejection_reason || null,
    lastLoginAt: u.last_login_at || null,
    createdAt: u.created_at || null,
  };
}

const collator = new Intl.Collator('tr');

async function listUnits() {
  const rows = await db('forest_units').select('bolge_mudurlugu', 'isletme_mudurlugu');
  const byBolge = new Map();
  for (const r of rows) {
    if (!byBolge.has(r.bolge_mudurlugu)) byBolge.set(r.bolge_mudurlugu, new Set());
    byBolge.get(r.bolge_mudurlugu).add(r.isletme_mudurlugu);
  }
  return [...byBolge.keys()].sort(collator.compare).map((bolge) => ({
    bolge,
    isletmeler: [...byBolge.get(bolge)].sort(collator.compare),
  }));
}

// Sayaç sorgudan önce artırılır: eşzamanlı talepler de sınırı aşamaz.
async function assertRequestAllowed(ip) {
  const key = `${REQUEST_RL_PREFIX}${ip || '-'}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, REQUEST_WINDOW_SEC);
  if (count <= REQUEST_MAX_PER_WINDOW) return;
  let ttl = await redis.ttl(key);
  if (ttl < 0) {
    await redis.expire(key, REQUEST_WINDOW_SEC);
    ttl = REQUEST_WINDOW_SEC;
  }
  throw errors.make(429, 'rate_limited', 'Çok fazla talep gönderildi. Daha sonra tekrar deneyin.', {
    retryAfterSec: ttl,
  });
}

async function submitRequest(body, meta = {}) {
  await assertRequestAllowed(meta.ip);
  const email = auth.normalizeEmail(body.email);
  const unit = await db('forest_units')
    .where({ bolge_mudurlugu: body.bolge, isletme_mudurlugu: body.isletme })
    .first();
  if (!unit) {
    throw errors.validation('Seçilen birim bulunamadı.', undefined, 'unit_invalid');
  }

  const now = new Date();
  const fields = {
    name: body.name,
    password_hash: await auth.hashPassword(body.password),
    bolge_mudurlugu: body.bolge,
    isletme_mudurlugu: body.isletme,
    phone: body.phone || null,
    request_note: body.note || null,
    status: 'pending',
    requested_at: now,
    updated_at: now,
  };

  const existing = await db('panel_users').where({ email }).first();
  if (existing && existing.status === 'pending') {
    throw errors.conflict('Bu e-postayla bir talep zaten inceleniyor.', undefined, 'request_pending');
  }
  if (existing && existing.status !== 'rejected') {
    throw errors.conflict('Bu e-postayla bir panel hesabı zaten var.', undefined, 'email_taken');
  }

  if (existing) {
    // Koşullu güncelleme: aynı anda onaylanan bir kaydın üzerine yazılmaz.
    const updated = await db('panel_users')
      .where({ id: existing.id, status: 'rejected' })
      .update({ ...fields, rejection_reason: null, approved_by: null, approved_at: null });
    if (!updated) {
      throw errors.conflict('Bu e-postayla bir talep zaten inceleniyor.', undefined, 'request_pending');
    }
    await auth.writePanelAudit({ targetId: existing.id, action: 'request.resubmit', detail: { ip: meta.ip || null } });
    return { status: 'pending' };
  }

  const id = uuidv4();
  try {
    await db('panel_users').insert({ id, email, role: 'admin', ...fields, created_at: now });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw errors.conflict('Bu e-postayla bir talep zaten inceleniyor.', undefined, 'request_pending');
    }
    throw err;
  }
  await auth.writePanelAudit({ targetId: id, action: 'request.create', detail: { ip: meta.ip || null } });
  return { status: 'pending' };
}

// Rota katmanı da süper admin ister; servis kendi başına çağrılırsa da yetkisiz işlem yapılmaz.
function assertSuperAdmin(actor) {
  if (actor?.role !== 'super_admin') {
    throw errors.forbidden('Bu işlem için süper admin yetkisi gerekir.', 'super_admin_required');
  }
}

async function findOr404(id, conn = db) {
  const user = await conn('panel_users').where({ id }).first();
  if (!user) throw errors.notFound('Panel kullanıcısı bulunamadı', 'panel_user_not_found');
  return user;
}

// "ELIF" (İngilizce klavye) ile "Elif" eşleşsin: Türkçe küçük harfte I → ı olur, ı da i sayılır.
const foldSearch = (value) => value.toLocaleLowerCase('tr').replace(/ı/g, 'i');

// ponytail: panel kullanıcıları en fazla birkaç yüz kişi; arama ve sıralama bellekte, sayfalama yok.
async function listUsers({ status, q } = {}) {
  const query = db('panel_users').orderBy('created_at', 'desc');
  if (status) query.where({ status });
  let rows = await query;
  const needle = foldSearch((q || '').trim());
  if (needle) {
    rows = rows.filter((u) => foldSearch(`${u.name} ${u.email}`).includes(needle));
  }
  return { items: rows.map(toItem), total: rows.length };
}

async function getUser(id) {
  return toItem(await findOr404(id));
}

async function decide(actor, id, { from, to, action, extra = {}, detail = null }) {
  assertSuperAdmin(actor);
  const now = new Date();
  const updated = await db('panel_users')
    .where({ id, status: from })
    .update({ status: to, updated_at: now, ...extra });
  if (!updated) {
    await findOr404(id);
    throw errors.conflict('Bu işlem yalnız onay bekleyen taleplerde yapılabilir.', undefined, 'invalid_state');
  }
  await auth.writePanelAudit({ actorId: actor.id, targetId: id, action, detail });
  return getUser(id);
}

function approve(actor, id) {
  return decide(actor, id, {
    from: 'pending',
    to: 'active',
    action: 'user.approve',
    extra: { approved_by: actor.id, approved_at: new Date(), rejection_reason: null },
  });
}

function reject(actor, id, reason) {
  return decide(actor, id, {
    from: 'pending',
    to: 'rejected',
    action: 'user.reject',
    extra: { rejection_reason: reason || null },
    detail: reason ? { reason } : null,
  });
}

// Son aktif süper admin kuralı: iki eşzamanlı işlem birbirini görmeden son iki süper admini
// birden düşüremesin diye süper admin satırları kilitlenir. Kilit sırası her işlemde aynı
// (önce süper adminler, sonra hedef); aksi halde çapraz bekleyen iki işlem deadlock olur.
async function lockTarget(trx, id) {
  const supers = await trx('panel_users')
    .where({ role: 'super_admin', status: 'active' })
    .orderBy('id')
    .forUpdate()
    .select('id');
  const target = await trx('panel_users').where({ id }).forUpdate().first();
  if (!target) throw errors.notFound('Panel kullanıcısı bulunamadı', 'panel_user_not_found');
  return { target, activeSuperCount: supers.length };
}

function assertNotLastSuperAdmin({ target, activeSuperCount }) {
  if (target.role !== 'super_admin' || target.status !== 'active') return;
  if (activeSuperCount <= 1) {
    throw errors.conflict('Son aktif süper adminin yetkisi alınamaz.', undefined, 'last_super_admin');
  }
}

async function setRole(actor, id, role) {
  assertSuperAdmin(actor);
  if (actor.id === id) {
    throw errors.forbidden('Kendi rolünüzü değiştiremezsiniz.', 'cannot_change_own_role');
  }
  let from;
  await db.transaction(async (trx) => {
    const locked = await lockTarget(trx, id);
    from = locked.target.role;
    if (from === role) return;
    if (role !== 'super_admin') assertNotLastSuperAdmin(locked);
    await trx('panel_users').where({ id }).update({ role, updated_at: new Date() });
  });
  if (from !== role) {
    await auth.writePanelAudit({ actorId: actor.id, targetId: id, action: 'user.role', detail: { from, to: role } });
  }
  return getUser(id);
}

async function setStatus(actor, id, status) {
  assertSuperAdmin(actor);
  if (actor.id === id) {
    throw errors.forbidden('Kendi hesabınızın durumunu değiştiremezsiniz.', 'cannot_change_own_status');
  }
  let changed = false;
  await db.transaction(async (trx) => {
    const locked = await lockTarget(trx, id);
    const { target } = locked;
    if (target.status === status) return;
    const allowedFrom = status === 'disabled' ? 'active' : 'disabled';
    if (target.status !== allowedFrom) {
      throw errors.conflict('Bu işlem hesabın şu anki durumunda yapılamaz.', undefined, 'invalid_state');
    }
    if (status === 'disabled') assertNotLastSuperAdmin(locked);
    await trx('panel_users').where({ id }).update({ status, updated_at: new Date() });
    changed = true;
  });
  if (changed) {
    if (status === 'disabled') await auth.revokeAllForUser(id);
    await auth.writePanelAudit({
      actorId: actor.id,
      targetId: id,
      action: status === 'disabled' ? 'user.disable' : 'user.enable',
    });
  }
  return getUser(id);
}

async function resetPassword(actor, id) {
  assertSuperAdmin(actor);
  if (actor.id === id) {
    throw errors.forbidden('Kendi şifrenizi Şifre Değiştir ile güncelleyin.', 'cannot_reset_own_password');
  }
  const target = await findOr404(id);
  if (!['active', 'disabled'].includes(target.status)) {
    throw errors.conflict('Onaylanmamış hesabın şifresi sıfırlanamaz.', undefined, 'invalid_state');
  }
  const temporaryPassword = generateTempPassword();
  await db('panel_users').where({ id }).update({
    password_hash: await auth.hashPassword(temporaryPassword),
    must_change_password: true,
    updated_at: new Date(),
  });
  await auth.revokeAllForUser(id);
  await auth.writePanelAudit({ actorId: actor.id, targetId: id, action: 'user.reset_password' });
  return { temporaryPassword };
}

async function listAudit(id) {
  await findOr404(id);
  const rows = await db('panel_user_audit')
    .where({ target_id: id })
    .orderBy([{ column: 'at', order: 'desc' }, { column: 'id', order: 'desc' }])
    .limit(AUDIT_LIMIT);
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))];
  const actors = actorIds.length
    ? await db('panel_users').whereIn('id', actorIds).select('id', 'name')
    : [];
  const names = new Map(actors.map((a) => [a.id, a.name]));
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor_id ? { id: r.actor_id, name: names.get(r.actor_id) || null } : null,
      detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail || null,
      at: r.at,
    })),
  };
}

module.exports = {
  listUnits,
  submitRequest,
  listUsers,
  getUser,
  approve,
  reject,
  setRole,
  setStatus,
  resetPassword,
  listAudit,
  REQUEST_MAX_PER_WINDOW,
};
