/** Customer list and profile reads for admin. */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export async function listCustomers(db: D1Database, f: { phoneRange?: [string, string] | null; namePrefix?: string | null; cursor?: { updatedAt: string; id: number } | null }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.phoneRange) { where.push('phone >= ? AND phone < ?'); params.push(...f.phoneRange); }
  else if (f.namePrefix) { where.push("name LIKE ? ESCAPE '\\'"); params.push(`${f.namePrefix.replace(/[\\%_]/g, m => `\\${m}`)}%`); }
  if (f.cursor) { where.push('(updated_at, id) < (?, ?)'); params.push(f.cursor.updatedAt, f.cursor.id); }
  return (await db.prepare(`SELECT * FROM customers ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC LIMIT 100`).bind(...params).all()).results;
}

export async function setTrusted(db: D1Database, id: number, trusted: boolean): Promise<void> {
  await db.prepare(`UPDATE customers SET is_trusted = ?, updated_at = ${NOW} WHERE id = ?`).bind(trusted ? 1 : 0, id).run();
}

export async function incompleteCountForPhone(db: D1Database, phone: string): Promise<number> {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE phone = ? AND status != 'converted'").bind(phone).first<{ n: number }>())?.n ?? 0);
}
