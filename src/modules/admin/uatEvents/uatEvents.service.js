'use strict';

const { db } = require('../../../config/db');

async function insertEvents(panelUserId, { sessionId, events }) {
  const rows = events.map((e) => ({
    panel_user_id: panelUserId,
    session_id: sessionId,
    seq: e.seq,
    client_ts: e.at,
    type: e.type,
    page: e.page ?? null,
    context: e.context ?? null,
    target: e.target ?? null,
    detail: e.detail ? JSON.stringify(e.detail) : null,
  }));
  await db('uat_events').insert(rows).onConflict(['session_id', 'seq']).ignore();
}

module.exports = { insertEvents };
