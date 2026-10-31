/** Admin API: session auth, CSRF and role checks for every route. */
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { hashPassword, passwordProblem, randomToken, ROLE_LABELS, ROLES, SESSION_COOKIE, SESSION_TTL_SECONDS, verifyPassword, type Role, type Session } from '../lib/auth';
import { bad, clientIp, forbidden, HttpError, rateLimit, readJson, str } from '../lib/http';
import { activeAdminByEmail, adminCount, createAdmin, listAdmins, staffOptions, touchLogin, updateAdmin } from '../repo/admins';
import { audit, need } from './admin-helpers';
import { adminCatalog } from './admin-catalog';
import { adminOps } from './admin-ops';
import { adminOrders } from './admin-orders';
import { adminSettings } from './admin-settings';
import { adminSellers } from './admin-sellers';
import { adminGrowth } from './admin-growth';

export const admin = new Hono<AppEnv>();

async function startSession(c: Context<AppEnv>, a: { id: string; role: Role; name: string; email: string }) {
  const token = randomToken();
  const session: Session = { adminId: a.id, role: a.role, name: a.name, email: a.email, csrf: randomToken(16) };
  await c.env.KV.put(`sess:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  setCookie(c, SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: true, sameSite: 'Strict', maxAge: SESSION_TTL_SECONDS });
  await touchLogin(c.env.DB, a.id);
  return session;
}

admin.get('/setup-status', async c => c.json({ needsSetup: (await adminCount(c.env.DB)) === 0 }));

/** First-run: creates the first Super Admin. Needs the SETUP_TOKEN secret and only works while no admin exists. */
admin.post('/setup', async c => {
  if (!(await rateLimit(c.env.KV, `setup:${clientIp(c)}`, 5, 900))) throw new HttpError(429, 'Too many attempts.');
  const body = await readJson(c);
  if (!c.env.SETUP_TOKEN || str(body.token, 200) !== c.env.SETUP_TOKEN) throw forbidden('The setup token is not right.');
  if ((await adminCount(c.env.DB)) > 0) throw forbidden('Setup is already done. Sign in instead.');
  const email = str(body.email, 200).toLowerCase();
  const name = str(body.name, 100);
  const password = str(body.password, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) throw bad('Enter your name and email.');
  const problem = passwordProblem(password);
  if (problem) throw bad(problem);
  const id = crypto.randomUUID();
  await createAdmin(c.env.DB, { id, email, name, role: 'super_admin', passwordHash: await hashPassword(password) });
  const session = await startSession(c, { id, role: 'super_admin', name, email });
  c.set('session', session);
  await audit(c, 'setup', 'admin', id);
  return c.json({ ok: true, csrf: session.csrf, user: { name, email, role: 'super_admin' } });
});

admin.post('/login', async c => {
  const body = await readJson(c);
  const email = str(body.email, 200).toLowerCase();
  if (!(await rateLimit(c.env.KV, `login:${clientIp(c)}`, 10, 900)) || !(await rateLimit(c.env.KV, `login:${email}`, 8, 900))) {
    throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
  }
  const a = await activeAdminByEmail(c.env.DB, email);
  // Always run a hash so response time does not reveal whether the email exists.
  const ok = a ? await verifyPassword(str(body.password, 200), a.password_hash) : (await hashPassword('timing-equaliser'), false);
  if (!a || !ok) throw new HttpError(401, 'Email or password is not right.');
  const session = await startSession(c, a);
  c.set('session', session);
  await audit(c, 'login', 'admin', a.id);
  return c.json({ ok: true, csrf: session.csrf, user: { name: a.name, email: a.email, role: a.role } });
});

// Everything below needs a session.
admin.use('*', async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await c.env.KV.get<Session>(`sess:${token}`, 'json') : null;
  if (!session) throw new HttpError(401, 'Please sign in.');
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) throw forbidden('Cross-site request blocked.');
    if (c.req.header('x-csrf-token') !== session.csrf) throw forbidden('Your session expired. Reload the page.');
  }
  c.set('session', session);
  await next();
});

admin.get('/me', c => c.json({ user: { id: c.var.session.adminId, name: c.var.session.name, email: c.var.session.email, role: c.var.session.role }, csrf: c.var.session.csrf, roles: ROLE_LABELS }));

/** Active staff, for assignment pickers. */
admin.get('/staff-options', need('orders:read'), async c => c.json(await staffOptions(c.env.DB)));

admin.post('/logout', async c => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.KV.delete(`sess:${token}`);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// Staff & roles (Super Admin only)
admin.get('/staff', need('staff:write'), async c => {
  return c.json(await listAdmins(c.env.DB));
});

admin.post('/staff', need('staff:write'), async c => {
  const body = await readJson(c);
  const email = str(body.email, 200).toLowerCase();
  const role = str(body.role) as Role;
  if (!ROLES.includes(role)) throw bad('Choose a role.');
  const problem = passwordProblem(str(body.password, 200));
  if (problem) throw bad(problem);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email.');
  const id = crypto.randomUUID();
  try {
    await createAdmin(c.env.DB, { id, email, name: str(body.name, 100) || email, role, passwordHash: await hashPassword(str(body.password, 200)) });
  } catch {
    throw bad('Someone already uses that email.');
  }
  await audit(c, 'staff.create', 'admin', id, { email, role });
  return c.json({ id }, 201);
});

admin.put('/staff/:id', need('staff:write'), async c => {
  const body = await readJson(c);
  const id = c.req.param('id');
  if (id === c.var.session.adminId && (body.isActive === false || (body.role && body.role !== 'super_admin'))) throw bad('You cannot remove your own Super Admin access.');
  if (body.role && !ROLES.includes(String(body.role) as Role)) throw bad('Choose a role.');
  let passwordHash: string | undefined;
  if (body.password) {
    const problem = passwordProblem(str(body.password, 200));
    if (problem) throw bad(problem);
    passwordHash = await hashPassword(str(body.password, 200));
  }
  await updateAdmin(c.env.DB, id, {
    role: body.role ? (String(body.role) as Role) : undefined, isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    onDuty: typeof body.onDuty === 'boolean' ? body.onDuty : undefined, passwordHash,
  });
  await audit(c, 'staff.update', 'admin', id, { role: body.role, isActive: body.isActive, passwordChanged: Boolean(body.password) });
  return c.json({ ok: true });
});

admin.route('/', adminCatalog);
admin.route('/', adminOrders);
admin.route('/', adminSettings);
admin.route('/', adminOps);
admin.route('/', adminSellers);
admin.route('/', adminGrowth);
