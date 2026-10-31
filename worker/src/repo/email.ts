/** The email outbox (email_log), customer email addresses and the offers list. */
export interface QueuedEmail { id: number; kind: string; to_email: string; subject: string; html: string; text: string; attempts: number }

/** Queues an email; with a dedupe key the same order event never queues twice. */
export async function queueEmail(db: D1Database, e: { kind: string; to: string; subject: string; html: string; text: string; orderId?: number | null; dedupeKey?: string | null; status?: 'queued' | 'skipped'; error?: string | null }): Promise<boolean> {
  const r = await db.prepare('INSERT INTO email_log (kind, dedupe_key, to_email, subject, html, text, order_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING')
    .bind(e.kind, e.dedupeKey ?? null, e.to, e.subject, e.html, e.text, e.orderId ?? null, e.status ?? 'queued', e.error ?? null).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function queuedEmails(db: D1Database, limit: number): Promise<QueuedEmail[]> {
  return (await db.prepare("SELECT id, kind, to_email, subject, html, text, attempts FROM email_log WHERE status = 'queued' ORDER BY id LIMIT ?").bind(limit).all<QueuedEmail>()).results;
}

export async function markEmail(db: D1Database, id: number, r: { status: 'queued' | 'sent' | 'failed' | 'skipped'; providerId?: string | null; error?: string | null }): Promise<void> {
  await db.prepare("UPDATE email_log SET status = ?, provider_id = COALESCE(?, provider_id), error = ?, attempts = attempts + 1, sent_at = CASE WHEN ? = 'sent' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE sent_at END WHERE id = ?")
    .bind(r.status, r.providerId ?? null, r.error ?? null, r.status, id).run();
}

export async function recentEmails(db: D1Database, limit = 60): Promise<Array<Record<string, unknown>>> {
  return (await db.prepare('SELECT id, kind, to_email, subject, order_id, status, attempts, error, created_at, sent_at FROM email_log ORDER BY id DESC LIMIT ?').bind(limit).all()).results;
}

export async function emailCounts(db: D1Database, sinceIso: string): Promise<Record<string, number>> {
  const rows = (await db.prepare('SELECT status, COUNT(*) AS n FROM email_log WHERE created_at >= ? GROUP BY status').bind(sinceIso).all<{ status: string; n: number }>()).results;
  return Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
}

/** Bodies of old emails are not kept: after 60 days only the log line stays. */
export async function trimEmailBodies(db: D1Database, beforeIso: string): Promise<void> {
  await db.prepare("UPDATE email_log SET html = '', text = '' WHERE created_at < ? AND html != ''").bind(beforeIso).run();
}

/** Saves the email the customer gave at checkout on the order and on the customer, with their offers choice. */
export async function saveCustomerEmail(db: D1Database, orderId: number, phone: string, email: string, offers: boolean): Promise<void> {
  await db.batch([
    db.prepare('UPDATE orders SET customer_email = ? WHERE id = ?').bind(email, orderId),
    db.prepare("UPDATE customers SET email = ?, email_marketing = CASE WHEN ? THEN 1 ELSE email_marketing END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE phone = ?").bind(email, offers ? 1 : 0, phone),
  ]);
}

export async function offersAudience(db: D1Database): Promise<Array<{ id: number; name: string | null; email: string }>> {
  return (await db.prepare("SELECT id, name, email FROM customers WHERE email_marketing = 1 AND email IS NOT NULL AND email != '' ORDER BY id").all<{ id: number; name: string | null; email: string }>()).results;
}

export async function unsubscribeCustomer(db: D1Database, customerId: number): Promise<boolean> {
  const r = await db.prepare('UPDATE customers SET email_marketing = 0 WHERE id = ? AND email_marketing = 1').bind(customerId).run();
  return (r.meta.changes ?? 0) > 0;
}

/** Yesterday's numbers for the owner's morning email (Bangladesh day range as UTC instants). */
export async function dailyNumbers(db: D1Database, startIso: string, endIso: string): Promise<{ orders: number; revenuePaisa: number; delivered: number; returned: number; incomplete: number }> {
  const [o, d, i] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_paisa), 0) AS v FROM orders WHERE created_at >= ? AND created_at < ? AND is_test = 0 AND status != 'cancelled'").bind(startIso, endIso),
    db.prepare("SELECT SUM(status IN ('delivered','partial_delivered')) AS delivered, SUM(status = 'returned') AS returned FROM orders WHERE updated_at >= ? AND updated_at < ? AND is_test = 0").bind(startIso, endIso),
    db.prepare("SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE status = 'new' AND updated_at >= ? AND updated_at < ?").bind(startIso, endIso),
  ]);
  const a = o.results[0] as { n: number; v: number };
  const b = d.results[0] as { delivered: number | null; returned: number | null };
  return { orders: Number(a.n), revenuePaisa: Number(a.v), delivered: Number(b.delivered ?? 0), returned: Number(b.returned ?? 0), incomplete: Number((i.results[0] as { n: number }).n) };
}
