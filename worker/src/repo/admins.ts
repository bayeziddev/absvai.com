/** Staff accounts and the audit log. */
import type { Role } from '../lib/auth';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export interface AdminRow { id: string; email: string; name: string; role: Role; password_hash: string; is_active: number; on_duty: number; last_login_at: string | null; created_at: string }

export async function adminCount(db: D1Database): Promise<number> {
  return Number((await db.prepare('SELECT COUNT(*) AS n FROM admins').first<{ n: number }>())?.n ?? 0);
}

export async function activeAdminByEmail(db: D1Database, email: string): Promise<AdminRow | null> {
  return db.prepare('SELECT * FROM admins WHERE email = ? AND is_active = 1').bind(email).first<AdminRow>();
}

export async function createAdmin(db: D1Database, a: { id: string; email: string; name: string; role: Role; passwordHash: string }): Promise<void> {
  await db.prepare('INSERT INTO admins (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)').bind(a.id, a.email, a.name, a.role, a.passwordHash).run();
}

export async function touchLogin(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE admins SET last_login_at = ${NOW} WHERE id = ?`).bind(id).run();
}

export async function listAdmins(db: D1Database) {
  return (await db.prepare('SELECT id, email, name, role, is_active, on_duty, last_login_at, created_at FROM admins ORDER BY created_at').all()).results;
}

/** Active staff for assignment pickers. */
export async function staffOptions(db: D1Database) {
  return (await db.prepare('SELECT id, name, role, on_duty FROM admins WHERE is_active = 1 ORDER BY name').all()).results;
}

export async function adminExists(db: D1Database, id: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM admins WHERE id = ? AND is_active = 1').bind(id).first());
}

export async function updateAdmin(db: D1Database, id: string, u: { role?: Role; isActive?: boolean; onDuty?: boolean; passwordHash?: string }): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  if (u.role) stmts.push(db.prepare('UPDATE admins SET role = ? WHERE id = ?').bind(u.role, id));
  if (u.isActive !== undefined) stmts.push(db.prepare('UPDATE admins SET is_active = ? WHERE id = ?').bind(u.isActive ? 1 : 0, id));
  if (u.onDuty !== undefined) stmts.push(db.prepare('UPDATE admins SET on_duty = ? WHERE id = ?').bind(u.onDuty ? 1 : 0, id));
  if (u.passwordHash) stmts.push(db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').bind(u.passwordHash, id));
  if (stmts.length) await db.batch(stmts);
}

export async function writeAudit(db: D1Database, e: { adminId: string | null; action: string; entity: string | null; entityId: string | null; detail: string | null; ip: string }): Promise<void> {
  await db.prepare('INSERT INTO audit_log (admin_id, action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)').bind(e.adminId, e.action, e.entity, e.entityId, e.detail, e.ip).run();
}

export async function listAudit(db: D1Database, cursorId: number | null) {
  return (await db.prepare(`SELECT l.*, a.name AS admin_name FROM audit_log l LEFT JOIN admins a ON a.id = l.admin_id ${cursorId ? 'WHERE l.id < ?' : ''} ORDER BY l.id DESC LIMIT 100`)
    .bind(...(cursorId ? [cursorId] : [])).all()).results;
}
