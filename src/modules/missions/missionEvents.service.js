'use strict';

// Olay zaman çizelgesi ayrı bir tabloda tutulmaz; denetim izi, bildirim kaydı ve check-in
// kayıtlarından türetilir.

const { db } = require('../../config/db');
const { errors } = require('../../shared/errors');
const { toIso } = require('../../shared/dates');
const { titlesFor } = require('../fireReports/fireReports.service');

const AUDIT_ACTIONS = [
  'fire_reports.link',
  'fire_reports.unlink',
  'missions.call',
  'assembly_point.update',
  'missions.archive',
  'missions.create',
];

const DELETED_VOLUNTEER = 'Silinmiş gönüllü';

function payloadOf(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

function volunteerOf(row) {
  if (!row.user_id || row.deleted_at || row.ad == null) return { id: null, name: DELETED_VOLUNTEER };
  return { id: row.user_id, name: [row.ad, row.soyad].filter(Boolean).join(' ') };
}

async function panelUserNames(ids) {
  if (!ids.length) return new Map();
  const rows = await db('panel_users').whereIn('id', ids).select('id', 'name');
  return new Map(rows.map((u) => [u.id, u.name]));
}

/** Panel — olayın zaman çizelgesi, `at` artan sırada. */
async function listForMission(missionId) {
  const mission = await db('missions').where({ id: missionId }).first('id', 'status', 'created_at', 'archived_at');
  if (!mission) throw errors.notFound('Görev bulunamadı', 'mission_not_found');

  const [audits, notifications, firstCheckIn, linkedNow] = await Promise.all([
    db('audit_log')
      .where({ entity: 'mission', entity_id: missionId })
      .whereIn('action', AUDIT_ACTIONS)
      .orderBy('id', 'asc'),
    db('notification_log').where({ mission_id: missionId }).orderBy('sent_at', 'asc'),
    db('check_ins as ci')
      .leftJoin('users as u', 'u.id', 'ci.user_id')
      .where('ci.mission_id', missionId)
      .orderBy([
        { column: 'ci.checked_in_at', order: 'asc' },
        { column: 'ci.id', order: 'asc' },
      ])
      .first('ci.id', 'ci.user_id', 'ci.checked_in_at', 'ci.method', 'ci.recorded_by', 'u.ad', 'u.soyad', 'u.deleted_at'),
    db('fire_reports').where({ mission_id: missionId }).pluck('id'),
  ]);

  // Bildirim kaydı gönderenin yalnız adını tutar; panel kullanıcısı denetim izinden gelir.
  const sendAudits = notifications.length
    ? await db('audit_log')
        .where({ action: 'notifications.send' })
        .whereIn('entity_id', notifications.map((n) => n.id))
        .select('entity_id', 'user_id')
    : [];
  const senderOf = new Map(sendAudits.map((a) => [a.entity_id, a.user_id]));
  const names = await panelUserNames([...new Set([...audits, ...sendAudits].map((a) => a.user_id).filter(Boolean))]);
  // user_id'siz yönetim kaydı panel kullanıcılarından önceki API anahtarı dönemindendir.
  const panelActor = (userId) =>
    userId ? { kind: 'panel_user', id: userId, name: names.get(userId) || null } : { kind: 'system', id: null, name: null };

  const linkedByAudit = new Set();
  const reportIds = new Set(linkedNow);
  for (const a of audits) {
    const p = payloadOf(a.payload);
    if (a.action === 'fire_reports.link') {
      for (const rid of p.reportIds || []) {
        reportIds.add(rid);
        linkedByAudit.add(rid);
      }
    }
    if (a.action === 'fire_reports.unlink' && p.reportId) reportIds.add(p.reportId);
  }
  const reportRows = reportIds.size
    ? await db('fire_reports')
        .whereIn('id', [...reportIds])
        .select('id', 'postal_code', 'il', 'ilce', 'location_name', 'created_at')
    : [];
  const titles = reportRows.length ? await titlesFor(reportRows) : new Map();
  const report = (reportId) => ({ reportId, reportTitle: titles.get(reportId) ?? null });

  const events = [];
  for (const a of audits) {
    const p = payloadOf(a.payload);
    const base = { at: toIso(a.created_at), actor: panelActor(a.user_id) };
    const id = `audit-${a.id}`;
    if (a.action === 'fire_reports.link') {
      for (const rid of p.reportIds || []) {
        events.push({ id: `${id}-${rid}`, type: 'report_linked', ...base, detail: report(rid) });
      }
    } else if (a.action === 'fire_reports.unlink') {
      events.push({ id, type: 'report_unlinked', ...base, detail: report(p.reportId) });
    } else if (a.action === 'missions.call') {
      events.push({
        id,
        type: 'mission_called',
        ...base,
        detail: {
          recipients: Number(p.called || 0),
          outOfRange: Number(p.outOfRange || 0),
          notReady: Number(p.notReady || 0),
          withoutBaseLocation: Number(p.withoutBaseLocation || 0),
        },
      });
    } else if (a.action === 'assembly_point.update') {
      events.push({
        id,
        type: 'assembly_point_changed',
        ...base,
        detail: { name: p.name ?? null, locationChanged: !!p.locationChanged, notified: p.notified ?? null },
      });
    } else if (a.action === 'missions.archive') {
      events.push({ id, type: 'mission_closed', ...base, detail: { archivedAt: toIso(mission.archived_at) } });
    }
  }

  // Eski kayıtlar: olay oluşturulurken bağlanan ihbarın bağ kaydı yoktu; oluşturma anına yazılır.
  const createAudit = audits.find((a) => a.action === 'missions.create');
  for (const rid of linkedNow) {
    if (linkedByAudit.has(rid)) continue;
    events.push({
      id: `create-${rid}`,
      type: 'report_linked',
      at: toIso(mission.created_at),
      actor: createAudit ? panelActor(createAudit.user_id) : null,
      detail: report(rid),
    });
  }
  if (mission.status === 'archived' && mission.archived_at && !audits.some((a) => a.action === 'missions.archive')) {
    events.push({
      id: `archive-${mission.id}`,
      type: 'mission_closed',
      at: toIso(mission.archived_at),
      actor: null,
      detail: { archivedAt: toIso(mission.archived_at) },
    });
  }

  for (const n of notifications) {
    const userId = senderOf.get(n.id) || null;
    events.push({
      id: `notification-${n.id}`,
      type: 'notification_sent',
      at: toIso(n.sent_at),
      actor: { kind: 'panel_user', id: userId, name: names.get(userId) || n.sent_by || null },
      detail: {
        notificationId: n.id,
        category: n.category,
        title: n.title,
        recipients: Number(n.push_count || 0),
        smsCount: Number(n.sms_count || 0),
        segments: payloadOf(n.target).segments || [],
      },
    });
  }

  if (firstCheckIn) {
    const volunteer = volunteerOf(firstCheckIn);
    events.push({
      id: `checkin-${firstCheckIn.id}`,
      type: 'first_checkin',
      at: toIso(firstCheckIn.checked_in_at),
      actor: { kind: 'volunteer', ...volunteer },
      detail: { volunteer, method: firstCheckIn.method, recordedBy: firstCheckIn.recorded_by || null },
    });
  }

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { data: events };
}

module.exports = { listForMission, DELETED_VOLUNTEER };
