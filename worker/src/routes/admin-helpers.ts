import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { can } from '../lib/auth';
import { clientIp, forbidden } from '../lib/http';
import { writeAudit } from '../repo/admins';
import { purge } from '../services/cache';

export async function audit(c: Context<AppEnv>, action: string, entity: string | null, entityId: string | number | null, detail?: unknown) {
  await writeAudit(c.env.DB, {
    adminId: c.var.session?.adminId ?? null, action, entity, entityId: entityId === null ? null : String(entityId),
    detail: detail === undefined ? null : JSON.stringify(detail).slice(0, 4000), ip: clientIp(c),
  });
}

/** Role check, enforced on the server for every admin route. */
export const need = (permission: string): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!can(c.var.session.role, permission)) throw forbidden();
  await next();
};

/** Either permission is enough (e.g. sales agents confirm, warehouse staff pack). */
export const needAny = (...permissions: string[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!permissions.some(p => can(c.var.session.role, p))) throw forbidden();
  await next();
};

export const allowed = (c: Context<AppEnv>, permission: string) => can(c.var.session.role, permission);

/** Queue edge-cache tags for refresh after an admin save. */
export async function refresh(c: Context<AppEnv>, tags: string[]) {
  let ctx: ExecutionContext | undefined;
  try { ctx = c.executionCtx as unknown as ExecutionContext; } catch { ctx = undefined; }
  await purge(c.env, ctx, tags);
}
