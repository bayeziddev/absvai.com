/** Customer accounts (customer_accounts, account_codes; migration 0013): email-code sign-in, profile, orders, offers. */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export interface AccountRow {
  id: number; email: string; name: string; phone: string | null; address_line: string | null; zone_id: number | null; offers: number;
  created_at: string; last_login_at: string | null;
}
export interface CodeRow { email: string; code_hash: string; name: string | null; phone: string | null; offers: number; attempts: number; expires_at: string }

export function accountByEmail(db: D1Database, email: string): Promise<AccountRow | null> {
  return db.prepare('SELECT * FROM customer_accounts WHERE email = ?').bind(email).first<AccountRow>();
}

export function accountById(db: D1Database, id: number): Promise<AccountRow | null> {
  return db.prepare('SELECT * FROM customer_accounts WHERE id = ?').bind(id).first<AccountRow>();
}

/** A new code for this email (replacing an older one, with fresh tries), plus the sign-up details waiting for it. */
export async function saveCode(db: D1Database, c: { email: string; codeHash: string; name: string | null; phone: string | null; offers: boolean; expiresAt: string }): Promise<void> {
  await db.prepare(`INSERT INTO account_codes (email, code_hash, name, phone, offers, attempts, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ${NOW})
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, name = excluded.name, phone = excluded.phone, offers = excluded.offers, attempts = 0, expires_at = excluded.expires_at, created_at = excluded.created_at`)
    .bind(c.email, c.codeHash, c.name, c.phone, c.offers ? 1 : 0, c.expiresAt).run();
}

export function codeFor(db: D1Database, email: string): Promise<CodeRow | null> {
  return db.prepare('SELECT email, code_hash, name, phone, offers, attempts, expires_at FROM account_codes WHERE email = ?').bind(email).first<CodeRow>();
}

/** Counts a wrong try; returns the tries used so far. */
export async function countWrongCode(db: D1Database, email: string): Promise<number> {
  const r = await db.prepare('UPDATE account_codes SET attempts = attempts + 1 WHERE email = ? RETURNING attempts').bind(email).first<{ attempts: number }>();
  return Number(r?.attempts ?? 99);
}

export async function deleteCode(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM account_codes WHERE email = ?').bind(email).run();
}

/** Old codes nobody typed are removed by the cron. */
export async function deleteExpiredCodes(db: D1Database, nowIso: string): Promise<void> {
  await db.prepare('DELETE FROM account_codes WHERE expires_at < ?').bind(nowIso).run();
}

/**
 * The right code was typed: the account is created (sign-up) or found (sign-in) and its sign-in time noted. The
 * customer's offers choice also goes on the shop's customer record for that mobile number, so offers emails reach them.
 */
export async function signedIn(db: D1Database, a: { email: string; name: string | null; phone: string | null; offers: boolean }): Promise<AccountRow> {
  const stmts = [
    db.prepare(`INSERT INTO customer_accounts (email, name, phone, offers, created_at, last_login_at) VALUES (?, ?, ?, ?, ${NOW}, ${NOW})
        ON CONFLICT(email) DO UPDATE SET last_login_at = ${NOW}, name = COALESCE(NULLIF(customer_accounts.name, ''), excluded.name), phone = COALESCE(customer_accounts.phone, excluded.phone)`)
      .bind(a.email, a.name ?? a.email.split('@')[0], a.phone, a.offers ? 1 : 0),
    db.prepare('DELETE FROM account_codes WHERE email = ?').bind(a.email),
  ];
  await db.batch(stmts);
  const row = (await accountByEmail(db, a.email))!;
  if (row.phone) await linkCustomer(db, row);
  return row;
}

/**
 * The shop's customer record for the account's mobile number gets its email and offers choice. The mobile number is
 * not proven, so a record that already has a different email keeps it.
 */
export async function linkCustomer(db: D1Database, a: Pick<AccountRow, 'email' | 'phone' | 'name' | 'offers'>): Promise<void> {
  if (!a.phone) return;
  const mine = "(customers.email IS NULL OR customers.email = '' OR customers.email = excluded.email)";
  await db.prepare(`INSERT INTO customers (phone, name, email, email_marketing) VALUES (?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET email = CASE WHEN ${mine} THEN excluded.email ELSE customers.email END,
        email_marketing = CASE WHEN ${mine} THEN excluded.email_marketing ELSE customers.email_marketing END,
        name = COALESCE(customers.name, excluded.name), updated_at = ${NOW}`)
    .bind(a.phone, a.name, a.email, a.offers ? 1 : 0).run();
}

export async function updateAccount(db: D1Database, id: number, p: { name: string; phone: string | null; addressLine: string | null; offers: boolean }): Promise<void> {
  await db.prepare('UPDATE customer_accounts SET name = ?, phone = ?, address_line = ?, offers = ? WHERE id = ?').bind(p.name, p.phone, p.addressLine, p.offers ? 1 : 0, id).run();
}

/** After an order: the address and delivery area are kept for next time, and the mobile number if none was saved. */
export async function rememberDelivery(db: D1Database, id: number, d: { phone: string; addressLine: string; zoneId: number | null }): Promise<void> {
  await db.prepare('UPDATE customer_accounts SET address_line = ?, zone_id = COALESCE(?, zone_id), phone = COALESCE(phone, ?) WHERE id = ?').bind(d.addressLine, d.zoneId, d.phone, id).run();
}

export interface AccountOrder {
  id: number; order_no: string; access_token: string; created_at: string; status: string; total_paisa: number; invoice_no: string | null;
  courier: string | null; tracking_id: string | null; items: number; first_item: string | null; image: string | null;
}

/** The account's orders: every order placed with its verified email, newest first. */
export async function accountOrders(db: D1Database, email: string, limit = 50): Promise<AccountOrder[]> {
  return (await db.prepare(
    `SELECT o.id, o.order_no, o.access_token, o.created_at, o.status, o.total_paisa, o.invoice_no, o.courier, o.tracking_id,
            (SELECT COALESCE(SUM(i.qty), 0) FROM order_items i WHERE i.order_id = o.id) AS items,
            (SELECT i.name FROM order_items i WHERE i.order_id = o.id ORDER BY i.id LIMIT 1) AS first_item,
            (SELECT m.url FROM order_items i JOIN product_media m ON m.product_id = i.product_id AND m.kind = 'image'
              WHERE i.order_id = o.id ORDER BY i.id, m.sort_order, m.id LIMIT 1) AS image
       FROM orders o WHERE o.customer_email = ? AND o.is_test = 0 ORDER BY o.id DESC LIMIT ?`,
  ).bind(email, limit).all<AccountOrder>()).results;
}

export interface MemberOffer { code: string; kind: 'percent' | 'fixed' | 'free_delivery'; value: number; min_subtotal_paisa: number; max_discount_paisa: number | null; ends_at: string | null; note: string | null }

/** Coupons the owner shows to signed-in customers, while they work. */
export async function memberOffers(db: D1Database, nowIso: string): Promise<MemberOffer[]> {
  return (await db.prepare(
    `SELECT code, kind, value, min_subtotal_paisa, max_discount_paisa, ends_at, note FROM coupons
      WHERE for_members = 1 AND is_active = 1 AND (starts_at IS NULL OR starts_at <= ?1) AND (ends_at IS NULL OR ends_at > ?1)
        AND (usage_limit IS NULL OR used_count < usage_limit) ORDER BY id DESC LIMIT 20`,
  ).bind(nowIso).all<MemberOffer>()).results;
}

/** How many customers have an account (the admin's Customers page). */
export async function accountCount(db: D1Database): Promise<number> {
  return Number((await db.prepare('SELECT COUNT(*) AS n FROM customer_accounts').first<{ n: number }>())?.n ?? 0);
}
