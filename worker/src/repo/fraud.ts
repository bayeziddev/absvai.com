/** Block list, blocked-attempts log and the OTP send log (Section 11). Values are salted hashes. */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export type Row = Record<string, unknown>;
export type BlockType = 'phone' | 'device' | 'ip';

/** Active blocks (not expired) for any of the given hashes. */
export async function activeBlocks(db: D1Database, keys: Array<{ type: BlockType; hash: string | null }>, nowIso: string): Promise<Row[]> {
  const k = keys.filter(x => x.hash);
  if (!k.length) return [];
  const ors = k.map(() => '(type = ? AND value_hash = ?)').join(' OR ');
  return (await db.prepare(`SELECT * FROM block_list WHERE (${ors}) AND (expires_at IS NULL OR expires_at > ?)`)
    .bind(...k.flatMap(x => [x.type, x.hash]), nowIso).all<Row>()).results;
}

export async function addBlock(db: D1Database, b: { type: BlockType; hash: string; hint: string | null; reason: string; expiresAt: string | null; createdBy: string | null }): Promise<number> {
  const r = await db.prepare(
    `INSERT INTO block_list (type, value_hash, value_hint, reason, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(type, value_hash) DO UPDATE SET reason = excluded.reason, expires_at = excluded.expires_at, value_hint = COALESCE(excluded.value_hint, block_list.value_hint),
       created_by = excluded.created_by, created_at = ${NOW} RETURNING id`,
  ).bind(b.type, b.hash, b.hint, b.reason, b.expiresAt, b.createdBy).first<{ id: number }>();
  return r!.id;
}

export async function removeBlock(db: D1Database, id: number): Promise<Row | null> {
  return db.prepare('DELETE FROM block_list WHERE id = ? RETURNING *').bind(id).first<Row>();
}

export async function listBlocks(db: D1Database, includeExpired: boolean, nowIso: string): Promise<Row[]> {
  return (await db.prepare(
    `SELECT b.*, a.name AS created_by_name FROM block_list b LEFT JOIN admins a ON a.id = b.created_by
      ${includeExpired ? '' : 'WHERE b.expires_at IS NULL OR b.expires_at > ?'} ORDER BY b.created_at DESC LIMIT 300`,
  ).bind(...(includeExpired ? [] : [nowIso])).all<Row>()).results;
}

export interface Attempt {
  layer: 'phone' | 'device' | 'ip' | 'velocity' | 'interval' | 'otp' | 'bot' | 'honeypot' | 'token';
  action: 'blocked' | 'held' | 'rate_limited' | 'silently_rejected';
  route: string;
  reason: string;
  phoneHint?: string | null;
  phoneHash?: string | null;
  deviceHash?: string | null;
  ipHash?: string | null;
  orderId?: number | null;
  blockId?: number | null;
}

export async function logAttempt(db: D1Database, a: Attempt): Promise<void> {
  await db.prepare(
    `INSERT INTO blocked_attempts (layer, action, route, reason, phone_hint, phone_hash, device_hash, ip_hash, order_id, block_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(a.layer, a.action, a.route, a.reason.slice(0, 300), a.phoneHint ?? null, a.phoneHash ?? null, a.deviceHash ?? null, a.ipHash ?? null, a.orderId ?? null, a.blockId ?? null).run();
}

export async function listAttempts(db: D1Database, cursorId: number | null, limit = 100): Promise<Row[]> {
  return (await db.prepare(
    `SELECT t.*, o.order_no, b.id AS active_block_id, b.reason AS block_reason, b.expires_at AS block_expires_at, r.name AS reviewed_by_name
       FROM blocked_attempts t LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN block_list b ON b.id = t.block_id LEFT JOIN admins r ON r.id = t.reviewed_by
      ${cursorId ? 'WHERE t.id < ?' : ''} ORDER BY t.id DESC LIMIT ${Math.min(Math.max(limit, 1), 200)}`,
  ).bind(...(cursorId ? [cursorId] : [])).all<Row>()).results;
}

export async function attemptById(db: D1Database, id: number): Promise<Row | null> {
  return db.prepare('SELECT * FROM blocked_attempts WHERE id = ?').bind(id).first<Row>();
}

export async function reviewAttempt(db: D1Database, id: number, adminId: string, note: string): Promise<void> {
  await db.prepare(`UPDATE blocked_attempts SET reviewed_at = ${NOW}, reviewed_by = ?, review_note = ? WHERE id = ?`).bind(adminId, note, id).run();
}

export async function attemptsToday(db: D1Database, sinceIso: string): Promise<number> {
  return Number((await db.prepare('SELECT COUNT(*) AS n FROM blocked_attempts WHERE created_at >= ? AND reviewed_at IS NULL').bind(sinceIso).first<{ n: number }>())?.n ?? 0);
}

// ───────────── OTP log (strict caps) ─────────────

export async function otpCounts(db: D1Database, a: { phone: string; deviceHash: string | null; hourAgoIso: string; dayAgoIso: string; bdDayStartIso: string }): Promise<{ phoneHour: number; deviceDay: number; globalToday: number }> {
  const [p, d, g] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM otp_log WHERE phone = ? AND created_at >= ? AND status = 'sent'").bind(a.phone, a.hourAgoIso),
    db.prepare("SELECT COUNT(*) AS n FROM otp_log WHERE device_hash = ? AND created_at >= ? AND status = 'sent'").bind(a.deviceHash ?? '-', a.dayAgoIso),
    db.prepare("SELECT COUNT(*) AS n FROM otp_log WHERE created_at >= ? AND status = 'sent'").bind(a.bdDayStartIso),
  ]);
  const n = (r: D1Result) => Number((r.results[0] as { n: number }).n);
  return { phoneHour: n(p), deviceDay: n(d), globalToday: n(g) };
}

export async function logOtp(db: D1Database, o: { phone: string; deviceHash: string | null; ipHash: string | null; orderId: number | null; status: 'sent' | 'capped_phone' | 'capped_device' | 'capped_global' }): Promise<void> {
  await db.prepare('INSERT INTO otp_log (phone, device_hash, ip_hash, order_id, status) VALUES (?, ?, ?, ?, ?)').bind(o.phone, o.deviceHash, o.ipHash, o.orderId, o.status).run();
}
