/** Courier bookings and their status updates on orders (consignment and tracking ids, courier sub-statuses). */
import { courierLine } from '../lib/tracking';
import { trackStmt } from './tracking';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** The courier's city / zone / area ids saved for one of our upazilas (Courier area mapping). */
export async function courierAreaFor(db: D1Database, courier: string, upazilaId: number): Promise<{ city: string | null; zone: string | null; area: string | null } | null> {
  const r = await db.prepare('SELECT courier_city_id AS city, courier_zone_id AS zone, courier_area_id AS area FROM courier_area_map WHERE courier = ? AND upazila_id = ?')
    .bind(courier, upazilaId).first<{ city: string | null; zone: string | null; area: string | null }>();
  return r ?? null;
}

/** Saves a booking: the consignment id and tracking code the courier gave us. */
export async function setConsignment(db: D1Database, orderId: number, courier: string, consignmentId: string, trackingId: string): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE orders SET courier = ?, consignment_id = ?, tracking_id = ?, last_courier_update_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).bind(courier, consignmentId, trackingId, orderId),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type) VALUES (?, 'note', ?, 'courier')").bind(orderId, `Booked with ${courier}: consignment ${consignmentId}, tracking ${trackingId}`),
  ]);
}

export async function orderByConsignment(db: D1Database, courier: string, consignmentId: string): Promise<Record<string, unknown> | null> {
  return db.prepare('SELECT * FROM orders WHERE courier = ? AND consignment_id = ?').bind(courier, consignmentId).first();
}

/** A courier status that does not change our stage (in transit, on hold…): the sub-status, the time and a timeline note. */
export async function courierProgress(db: D1Database, orderId: number, subStatus: string | null, note: string, courier?: { name: string; words: string }): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE orders SET sub_status = COALESCE(?, sub_status), last_courier_update_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).bind(subStatus, orderId),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type) VALUES (?, 'note', ?, 'courier')").bind(orderId, note),
    trackStmt(db, orderId, courierLine(courier?.name ?? null, subStatus, courier?.words ?? null)),
  ]);
}

/** Orders with a courier booking that have not heard from the courier for a while (the cron asks the courier). */
export async function ordersToSync(db: D1Database, quietSinceIso: string, limit: number): Promise<Array<{ id: number; courier: string; consignment_id: string; order_no: string }>> {
  return (await db.prepare(
    `SELECT id, courier, consignment_id, order_no FROM orders
      WHERE status = 'in_courier' AND consignment_id IS NOT NULL AND courier IN ('steadfast','pathao')
        AND (last_courier_update_at IS NULL OR last_courier_update_at < ?)
      ORDER BY last_courier_update_at LIMIT ?`,
  ).bind(quietSinceIso, limit).all<{ id: number; courier: string; consignment_id: string; order_no: string }>()).results;
}

export async function touchCourierUpdate(db: D1Database, orderId: number): Promise<void> {
  await db.prepare(`UPDATE orders SET last_courier_update_at = ${NOW} WHERE id = ?`).bind(orderId).run();
}
