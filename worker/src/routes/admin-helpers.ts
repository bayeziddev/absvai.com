import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { can } from '../lib/auth';
import { clientIp, forbidden } from '../lib/http';

export async function audit(c: Context<AppEnv>, action: string, entity: string | null, entityId: string | number | null, detail?: unknown) {
  await c.env.DB.prepare('INSERT INTO audit_log (admin_id, action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(c.var.session?.adminId ?? null, action, entity, entityId === null ? null : String(entityId), detail === undefined ? null : JSON.stringify(detail).slice(0, 4000), clientIp(c)).run();
}

/** Role check, enforced on the server for every admin route. */
export const need = (permission: string): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!can(c.var.session.role, permission)) throw forbidden();
  await next();
};
