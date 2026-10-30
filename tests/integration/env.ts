import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { app } from '../../worker/src/index';
import type { Env } from '../../worker/src/env';
import { issueCheckoutToken, SESSION_COOKIE } from '../../worker/src/services/incomplete';

const ROOT = join(__dirname, '../..');
const wrangler = (args: string[], persist: string) =>
  execFileSync('npx', ['wrangler', ...args, '--local', '--persist-to', persist, '-c', 'worker/wrangler.toml'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });

type JsonInit = Omit<RequestInit, 'body' | 'headers'> & { body?: unknown; headers?: Record<string, string> };

export interface TestEnv {
  env: Env;
  dispose: () => Promise<void>;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  json: <T = any>(path: string, init?: JsonInit) => Promise<{ status: number; body: T }>;
  admin: { cookie: string; csrf: string };
  /** Waits for work handed to ctx.waitUntil (cache purges, SMS queueing) to finish. */
  settle: () => Promise<void>;
  /** Tag batches sent to the Storefront entrypoint's invalidate(), as the deployed gateway would. */
  purged: string[][];
  /**
   * Starts a storefront checkout session like the browser does (cookies plus the signed token). The token is
   * back-dated by `ageSeconds` so tests don't wait out the "faster than a person" timing check; pass 0 to test it.
   */
  checkoutSession: (ageSeconds?: number) => Promise<{ cookie: string; token: string; sid: string }>;
  adminJson: <T = any>(path: string, method?: string, body?: unknown) => Promise<{ status: number; body: T }>;
  sql: <T = any>(query: string, ...params: unknown[]) => Promise<T[]>;
}

/** Fresh local D1 (all migrations + demo catalog), KV and R2, with the real Hono app. */
export async function createTestEnv(): Promise<TestEnv> {
  const persist = mkdtempSync(join(tmpdir(), 'absvai-test-'));
  wrangler(['d1', 'migrations', 'apply', 'DB'], persist);
  wrangler(['d1', 'execute', 'DB', '--file', 'worker/seed/demo.sql'], persist);
  // `wrangler --persist-to X` stores state under X/v3; getPlatformProxy expects that v3 folder itself.
  const proxy = await getPlatformProxy<Env>({ configPath: join(ROOT, 'worker/wrangler.toml'), persist: { path: join(persist, 'v3') } });
  const env = {
    ...proxy.env, SITE_URL: 'https://absvai.test', ENVIRONMENT: 'test', SETUP_TOKEN: 'setup-token-for-tests', OTP_PEPPER: 'test-pepper',
    SIGNING_KEY: 'test-signing-key-0123456789abcdef', SETTINGS_KEY: Buffer.alloc(32, 9).toString('base64'),
  } as Env;
  const pending: Promise<unknown>[] = [];
  const purged: string[][] = [];
  // Stands in for ctx.exports.Storefront (the cached entrypoint) so the purge queue can be observed.
  const exportsStub = { Storefront: { purgeTags: async (tags: string[]) => { purged.push(tags); return { success: true }; } } };
  const ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {}, props: {}, exports: exportsStub } as unknown as ExecutionContext;
  const fetch = (path: string, init?: RequestInit) => app.fetch(new Request(`https://absvai.test${path}`, init), env, ctx) as Promise<Response>;
  const json = async (path: string, init: JsonInit = {}) => {
    const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body) });
    const text = await r.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: r.status, body };
  };
  const t: TestEnv = {
    env, fetch, json, admin: { cookie: '', csrf: '' },
    settle: async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); },
    purged,
    checkoutSession: async (ageSeconds = 10) => {
      const r = await fetch('/api/checkout/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://absvai.test' }, body: '{}' });
      if (r.status !== 200) throw new Error(`checkout session: ${r.status} ${await r.text()}`);
      const cookies = r.headers.getSetCookie().map(c => c.split(';')[0]);
      const sid = cookies.find(c => c.startsWith(`${SESSION_COOKIE}=`))!.split('=')[1];
      const { token } = ageSeconds ? await issueCheckoutToken(env, sid, Date.now() - ageSeconds * 1000) : ((await r.json()) as { token: string });
      return { cookie: cookies.join('; '), token, sid };
    },
    dispose: async () => { await proxy.dispose(); rmSync(persist, { recursive: true, force: true }); },
    adminJson: (path, method = 'GET', body) => json(`/api/admin${path}`, { method, body, headers: { cookie: t.admin.cookie, 'x-csrf-token': t.admin.csrf, origin: 'https://absvai.test' } }),
    sql: async (query, ...params) => (await env.DB.prepare(query).bind(...params).all()).results as any[],
  };
  const r = await fetch('/api/admin/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'setup-token-for-tests', name: 'Owner', email: 'owner@absvai.test', password: 'correct-horse-42' }) });
  const setup = (await r.json()) as { csrf: string };
  t.admin = { cookie: (r.headers.get('set-cookie') ?? '').split(';')[0], csrf: setup.csrf };
  return t;
}
