/** SMS outbox. A Phase 2 queue consumer delivers "queued" rows through the chosen gateway. */
export async function queueSms(db: D1Database, m: { to: string; body: string; kind: string; status: 'queued' | 'logged'; orderId: number | null }): Promise<void> {
  await db.prepare('INSERT INTO sms_outbox (to_phone, body, kind, status, order_id) VALUES (?, ?, ?, ?, ?)').bind(m.to, m.body, m.kind, m.status, m.orderId).run();
}

export async function listOutbox(db: D1Database, cursorId: number | null) {
  return (await db.prepare(`SELECT * FROM sms_outbox ${cursorId ? 'WHERE id < ?' : ''} ORDER BY id DESC LIMIT 100`).bind(...(cursorId ? [cursorId] : [])).all()).results;
}
