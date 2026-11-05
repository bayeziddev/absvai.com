/**
 * An admin session is only good while its staff account is still there and active. Removing or disabling a staff
 * member signs them out on their very next request, instead of leaving their 12-hour session alive. This matters at
 * a handover: the shop owner can cut off a password at once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
beforeAll(async () => { t = await createTestEnv(); });
afterAll(async () => { await t?.dispose(); });

const EMAIL = 'temp-auth@absvai.test';
const PASSWORD = 'Temp agent 123';
const me = (cookie: string) => t.json('/api/admin/me', { headers: { cookie, origin: 'https://absvai.test' } });
async function login() {
  const r = await t.fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://absvai.test' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('admin sessions follow the live staff list', () => {
  it('signs out a disabled admin, then a deleted one, on the next request', async () => {
    expect((await t.adminJson('/staff', 'POST', { name: 'Temp', email: EMAIL, role: 'manager', password: PASSWORD })).status).toBe(201);

    // A normal session works.
    let cookie = await login();
    expect((await me(cookie)).status).toBe(200);
    // The owner's own session is unaffected throughout.
    expect((await t.adminJson('/me')).status).toBe(200);

    // Disabled → the next request is rejected.
    await t.sql('UPDATE admins SET is_active = 0 WHERE email = ?', EMAIL);
    expect((await me(cookie)).status).toBe(401);

    // Re-enabled → a fresh sign-in works again.
    await t.sql('UPDATE admins SET is_active = 1 WHERE email = ?', EMAIL);
    cookie = await login();
    expect((await me(cookie)).status).toBe(200);

    // Deleted → signed out at once, and the owner still works.
    await t.sql('DELETE FROM admins WHERE email = ?', EMAIL);
    expect((await me(cookie)).status).toBe(401);
    expect((await t.adminJson('/me')).status).toBe(200);
  });
});
