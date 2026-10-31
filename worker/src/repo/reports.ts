/**
 * Sales report for a date range (Bangladesh days, given as UTC instants by the route). Test orders never count.
 * "Sales" means orders that were not cancelled; "delivered" means delivered or partly delivered. Product cost uses the
 * current average cost of each option (the shop keeps one average cost per option).
 */
type Row = Record<string, unknown>;
const RANGE = 'o.created_at >= ?1 AND o.created_at < ?2 AND o.is_test = 0';
const KEPT = "o.status != 'cancelled'";
const BD_DAY = "substr(datetime(o.created_at, '+6 hours'), 1, 10)";

export async function salesReport(db: D1Database, startIso: string, endIso: string, withCost: boolean) {
  const q = (sql: string) => db.prepare(sql).bind(startIso, endIso);
  const res = await db.batch([
    q(`SELECT COUNT(*) AS orders, SUM(${KEPT}) AS kept, COALESCE(SUM(CASE WHEN ${KEPT} THEN o.total_paisa END), 0) AS sales_paisa,
              COALESCE(SUM(CASE WHEN o.status IN ('delivered','partial_delivered') THEN o.total_paisa END), 0) AS delivered_paisa,
              SUM(o.status = 'delivered') AS delivered, SUM(o.status = 'partial_delivered') AS partial, SUM(o.status = 'returned') AS returned,
              SUM(o.status = 'cancelled') AS cancelled, SUM(o.status IN ('new','confirmed','packed')) AS open, SUM(o.status = 'in_courier') AS in_courier,
              COALESCE(SUM(CASE WHEN ${KEPT} THEN o.discount_paisa END), 0) AS discount_paisa,
              COALESCE(SUM(CASE WHEN ${KEPT} THEN o.delivery_charge_paisa END), 0) AS delivery_paisa,
              COALESCE(SUM(CASE WHEN ${KEPT} THEN o.subtotal_paisa END), 0) AS products_paisa,
              COUNT(DISTINCT CASE WHEN ${KEPT} THEN o.phone END) AS customers
         FROM orders o WHERE ${RANGE}`),
    q(`SELECT ${BD_DAY} AS day, COUNT(*) AS orders, SUM(${KEPT}) AS kept, COALESCE(SUM(CASE WHEN ${KEPT} THEN o.total_paisa END), 0) AS sales_paisa,
              SUM(o.status IN ('delivered','partial_delivered')) AS delivered, SUM(o.status = 'returned') AS returned
         FROM orders o WHERE ${RANGE} GROUP BY day ORDER BY day`),
    q(`SELECT i.product_id, MAX(i.name) AS name, SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS orders, SUM(i.line_total_paisa) AS sales_paisa,
              ${withCost ? 'SUM(i.qty * COALESCE(v.cost_paisa, 0)) AS cost_paisa, SUM(v.cost_paisa IS NULL) AS missing_cost' : 'NULL AS cost_paisa, 0 AS missing_cost'}
         FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN product_variants v ON v.id = i.variant_id
        WHERE ${RANGE} AND ${KEPT} GROUP BY i.product_id ORDER BY sales_paisa DESC LIMIT 50`),
    q(`SELECT COALESCE(c.name, 'Other') AS name, SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS orders, SUM(i.line_total_paisa) AS sales_paisa
         FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${RANGE} AND ${KEPT} GROUP BY c.id ORDER BY sales_paisa DESC LIMIT 30`),
    q(`SELECT o.district_name AS name, COUNT(*) AS orders, COALESCE(SUM(o.total_paisa), 0) AS sales_paisa,
              SUM(o.status IN ('delivered','partial_delivered')) AS delivered, SUM(o.status = 'returned') AS returned
         FROM orders o WHERE ${RANGE} AND ${KEPT} GROUP BY o.district_name ORDER BY orders DESC LIMIT 25`),
    q(`SELECT o.source AS name, COUNT(*) AS orders, COALESCE(SUM(o.total_paisa), 0) AS sales_paisa, SUM(o.status IN ('delivered','partial_delivered')) AS delivered
         FROM orders o WHERE ${RANGE} AND ${KEPT} GROUP BY o.source ORDER BY orders DESC`),
    q(`SELECT l.id, l.title AS name, l.slug, l.views, COUNT(*) AS orders, COALESCE(SUM(o.total_paisa), 0) AS sales_paisa, SUM(o.status IN ('delivered','partial_delivered')) AS delivered
         FROM orders o JOIN landing_pages l ON l.id = o.landing_page_id WHERE ${RANGE} AND ${KEPT} GROUP BY l.id ORDER BY orders DESC LIMIT 30`),
    q(`SELECT o.coupon_code AS name, COUNT(*) AS orders, COALESCE(SUM(o.discount_paisa), 0) AS discount_paisa, COALESCE(SUM(o.total_paisa), 0) AS sales_paisa
         FROM orders o WHERE ${RANGE} AND ${KEPT} AND o.coupon_code IS NOT NULL GROUP BY o.coupon_code ORDER BY orders DESC LIMIT 30`),
    q(`SELECT COALESCE(o.courier, 'not set') AS name, COUNT(*) AS orders, SUM(o.status = 'in_courier') AS on_the_way,
              SUM(o.status IN ('delivered','partial_delivered')) AS delivered, SUM(o.status = 'returned') AS returned
         FROM orders o WHERE ${RANGE} AND o.status IN ('in_courier','delivered','partial_delivered','returned') GROUP BY o.courier ORDER BY orders DESC`),
    q(`SELECT COALESCE(a.name, 'Website') AS name, COUNT(*) AS orders, COALESCE(SUM(CASE WHEN ${KEPT} THEN o.total_paisa END), 0) AS sales_paisa,
              SUM(o.status IN ('delivered','partial_delivered')) AS delivered
         FROM orders o LEFT JOIN admins a ON a.id = o.created_by WHERE ${RANGE} AND o.created_by IS NOT NULL GROUP BY o.created_by ORDER BY orders DESC LIMIT 30`),
  ]);
  const rows = (i: number) => res[i].results as Row[];
  return {
    totals: rows(0)[0] ?? {}, byDay: rows(1), products: rows(2), categories: rows(3), districts: rows(4), sources: rows(5),
    landingPages: rows(6), coupons: rows(7), couriers: rows(8), staff: rows(9),
  };
}
