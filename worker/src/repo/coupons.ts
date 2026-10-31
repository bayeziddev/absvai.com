/** Coupons and their uses (coupons, coupon_redemptions; migration 0009). */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export interface CouponRow {
  id: number; code: string; kind: 'percent' | 'fixed' | 'free_delivery'; value: number; min_subtotal_paisa: number; max_discount_paisa: number | null;
  starts_at: string | null; ends_at: string | null; usage_limit: number | null; per_phone_limit: number | null; used_count: number; is_active: number;
  note: string | null; created_at: string | null;
}
export interface CouponInput {
  code: string; kind: CouponRow['kind']; value: number; minSubtotalPaisa: number; maxDiscountPaisa: number | null; startsAt: string | null; endsAt: string | null;
  usageLimit: number | null; perPhoneLimit: number | null; isActive: boolean; note: string | null;
}

export async function couponByCode(db: D1Database, code: string): Promise<CouponRow | null> {
  return db.prepare('SELECT * FROM coupons WHERE code = ?').bind(code).first<CouponRow>();
}

export async function couponById(db: D1Database, id: number): Promise<CouponRow | null> {
  return db.prepare('SELECT * FROM coupons WHERE id = ?').bind(id).first<CouponRow>();
}

/** Every coupon with what it brought in (orders not cancelled). */
export async function listCoupons(db: D1Database): Promise<Array<CouponRow & { orders: number; discount_paisa: number; revenue_paisa: number }>> {
  return (await db.prepare(
    `SELECT c.*, COUNT(o.id) AS orders, COALESCE(SUM(r.discount_paisa), 0) AS discount_paisa, COALESCE(SUM(o.total_paisa), 0) AS revenue_paisa
       FROM coupons c LEFT JOIN coupon_redemptions r ON r.coupon_id = c.id LEFT JOIN orders o ON o.id = r.order_id AND o.status != 'cancelled'
      GROUP BY c.id ORDER BY c.is_active DESC, c.id DESC LIMIT 500`,
  ).all<CouponRow & { orders: number; discount_paisa: number; revenue_paisa: number }>()).results;
}

export async function saveCoupon(db: D1Database, id: number | null, c: CouponInput): Promise<number> {
  const vals = [c.code, c.kind, c.value, c.minSubtotalPaisa, c.maxDiscountPaisa, c.startsAt, c.endsAt, c.usageLimit, c.perPhoneLimit, c.isActive ? 1 : 0, c.note];
  if (id) {
    await db.prepare(`UPDATE coupons SET code = ?, kind = ?, value = ?, min_subtotal_paisa = ?, max_discount_paisa = ?, starts_at = ?, ends_at = ?, usage_limit = ?, per_phone_limit = ?, is_active = ?, note = ?, updated_at = ${NOW} WHERE id = ?`)
      .bind(...vals, id).run();
    return id;
  }
  const r = await db.prepare(`INSERT INTO coupons (code, kind, value, min_subtotal_paisa, max_discount_paisa, starts_at, ends_at, usage_limit, per_phone_limit, is_active, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW}, ${NOW}) RETURNING id`).bind(...vals).first<{ id: number }>();
  return r!.id;
}

export async function setCouponActive(db: D1Database, id: number, active: boolean): Promise<void> {
  await db.prepare(`UPDATE coupons SET is_active = ?, updated_at = ${NOW} WHERE id = ?`).bind(active ? 1 : 0, id).run();
}

/** A coupon that was never used can be deleted; a used one is switched off instead (its history stays in the report). */
export async function deleteUnusedCoupon(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare('DELETE FROM coupons WHERE id = ? AND NOT EXISTS (SELECT 1 FROM coupon_redemptions WHERE coupon_id = ?)').bind(id, id).run();
  return (r.meta.changes ?? 0) > 0;
}

/** How many times this number used the coupon on orders that were not cancelled. */
export async function phoneUses(db: D1Database, couponId: number, phone: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM coupon_redemptions r JOIN orders o ON o.id = r.order_id WHERE r.coupon_id = ? AND r.phone = ? AND o.status != 'cancelled'`)
    .bind(couponId, phone).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** For the order batch: records the use and counts it (the order id is looked up by its number inside the batch). */
export function redemptionStmts(db: D1Database, orderNo: string, couponId: number, phone: string, discountPaisa: number): D1PreparedStatement[] {
  return [
    db.prepare('INSERT INTO coupon_redemptions (coupon_id, order_id, phone, discount_paisa) SELECT ?, id, ?, ? FROM orders WHERE order_no = ?').bind(couponId, phone, discountPaisa, orderNo),
    db.prepare(`UPDATE coupons SET used_count = used_count + 1, updated_at = ${NOW} WHERE id = ?`).bind(couponId),
  ];
}
