import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
beforeAll(async () => { t = await createTestEnv(); });
afterAll(async () => { await t?.dispose(); });

describe('smoke', () => {
  it('serves the homepage and an admin session', async () => {
    const home = await t.fetch('/');
    expect(home.status).toBe(200);
    const me = await t.adminJson('/me');
    expect(me.body.user.role).toBe('super_admin');
  });
});
