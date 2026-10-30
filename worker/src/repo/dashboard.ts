/** Dashboard aggregates: the eight stage cards, today's figures and "needs your attention". */
import { STAGES, type OrderStatus } from '../lib/state-machine';

export async function stageCounts(db: D1Database, terminalSinceIso: string): Promise<Record<OrderStatus, number> & { held: number; awaitingReturnScan: number }> {
  const [open, terminal, held, scan] = await db.batch([
    db.prepare("SELECT status, COUNT(*) AS n FROM orders WHERE status IN ('new','confirmed','packed','in_courier') AND is_test = 0 GROUP BY status"),
    db.prepare("SELECT status, COUNT(*) AS n FROM orders WHERE status IN ('delivered','partial_delivered','cancelled','returned') AND is_test = 0 AND updated_at >= ? GROUP BY status").bind(terminalSinceIso),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE hold_reason IS NOT NULL AND status = 'new'"),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('returned','partial_delivered') AND return_received_at IS NULL AND is_test = 0"),
  ]);
  const out = Object.fromEntries(STAGES.map(s => [s, 0])) as Record<OrderStatus, number> & { held: number; awaitingReturnScan: number };
  for (const r of [...open.results, ...terminal.results] as Array<{ status: OrderStatus; n: number }>) out[r.status] = Number(r.n);
  out.held = Number((held.results[0] as { n: number }).n);
  out.awaitingReturnScan = Number((scan.results[0] as { n: number }).n);
  return out;
}

export async function dashboardFigures(db: D1Database, a: { todayStartIso: string; todayEndIso: string; chartStartIso: string; weekAgoIso: string; todayBd: string }) {
  const live = "status NOT IN ('cancelled','returned') AND is_test = 0";
  const [kpi, recent, chart, abandoned, advances, preorders, codOut, expired] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_paisa),0) AS revenue FROM orders WHERE created_at >= ? AND created_at < ? AND ${live}`).bind(a.todayStartIso, a.todayEndIso),
    db.prepare('SELECT id, order_no, customer_name, district_name, total_paisa, status, risk_level, hold_reason, payment_method, source, created_at FROM orders ORDER BY created_at DESC LIMIT 8'),
    db.prepare(`SELECT substr(datetime(created_at, '+6 hours'), 1, 10) AS day, COUNT(*) AS orders, SUM(total_paisa) AS revenue FROM orders WHERE created_at >= ? AND ${live} GROUP BY day ORDER BY day`).bind(a.chartStartIso),
    db.prepare("SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE status = 'new' AND updated_at >= ?").bind(a.weekAgoIso),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE advance_status = 'submitted'"),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE fulfilment_type = 'pre_order' AND status = 'confirmed'"),
    db.prepare("SELECT COALESCE(SUM(total_paisa),0) AS v FROM orders WHERE payment_method = 'cod' AND status = 'in_courier' AND is_test = 0"),
    db.prepare("SELECT COUNT(*) AS n FROM product_spec_values s JOIN products p ON p.id = s.product_id WHERE s.field_key = 'best_before' AND s.value < ? AND p.status = 'published' AND p.deleted_at IS NULL").bind(a.todayBd),
  ]);
  const n = (r: D1Result) => Number((r.results[0] as { n: number })?.n ?? 0);
  return {
    todayOrders: Number((kpi.results[0] as { orders: number }).orders), todayRevenuePaisa: Number((kpi.results[0] as { revenue: number }).revenue),
    recent: recent.results, chart: chart.results, abandoned7d: n(abandoned), advancesToVerify: n(advances), preordersToDispatch: n(preorders),
    codWithCourierPaisa: Number((codOut.results[0] as { v: number }).v), expiredFood: n(expired),
  };
}

/**
 * Overview charts (last N days): sales per day, the website checkout funnel, top districts and customers, orders by channel.
 * Locations come from order addresses, not visitor IPs (Section 16 honesty correction).
 */
export async function dashboardCharts(db: D1Database, sinceIso: string) {
  const real = "is_test = 0 AND status NOT IN ('cancelled')";
  const [daily, funnel, started, places, customers, channels] = await db.batch([
    db.prepare(`SELECT substr(datetime(created_at, '+6 hours'), 1, 10) AS day, COUNT(*) AS orders,
                       COALESCE(SUM(CASE WHEN status != 'returned' THEN total_paisa END), 0) AS revenue
                  FROM orders WHERE created_at >= ? AND ${real} GROUP BY day ORDER BY day`).bind(sinceIso),
    db.prepare(`SELECT COUNT(*) AS placed,
                       SUM(status IN ('confirmed','packed','in_courier','delivered','partial_delivered','returned')) AS confirmed,
                       SUM(status IN ('in_courier','delivered','partial_delivered','returned')) AS shipped,
                       SUM(status IN ('delivered','partial_delivered')) AS delivered
                  FROM orders WHERE created_at >= ? AND is_test = 0 AND source IN ('web','landing')`).bind(sinceIso),
    db.prepare('SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE created_at >= ?').bind(sinceIso),
    db.prepare(`SELECT district_name AS district, division_name AS division, COUNT(*) AS orders, COALESCE(SUM(total_paisa), 0) AS revenue
                  FROM orders WHERE created_at >= ? AND ${real} GROUP BY district_name ORDER BY orders DESC, revenue DESC LIMIT 8`).bind(sinceIso),
    db.prepare(`SELECT phone, MAX(customer_name) AS name, MAX(district_name) AS district, COUNT(*) AS orders, COALESCE(SUM(total_paisa), 0) AS spent
                  FROM orders WHERE created_at >= ? AND ${real} AND status != 'returned' GROUP BY phone ORDER BY spent DESC LIMIT 5`).bind(sinceIso),
    db.prepare(`SELECT source, COUNT(*) AS orders FROM orders WHERE created_at >= ? AND ${real} GROUP BY source ORDER BY orders DESC`).bind(sinceIso),
  ]);
  const f = funnel.results[0] as Record<string, number>;
  const placed = Number(f.placed ?? 0);
  return {
    daily: daily.results as Array<{ day: string; orders: number; revenue: number }>,
    // Every website order starts as a captured checkout; the max() keeps the funnel honest if a capture was missed.
    funnel: { started: Math.max(Number((started.results[0] as { n: number }).n ?? 0), placed), placed, confirmed: Number(f.confirmed ?? 0), shipped: Number(f.shipped ?? 0), delivered: Number(f.delivered ?? 0) },
    places: places.results as Array<{ district: string; division: string; orders: number; revenue: number }>,
    customers: customers.results as Array<{ phone: string; name: string; district: string; orders: number; spent: number }>,
    channels: channels.results as Array<{ source: string; orders: number }>,
  };
}
