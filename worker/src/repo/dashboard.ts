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
