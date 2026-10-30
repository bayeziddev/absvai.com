// Starts a throwaway local Worker (fresh D1 with migrations + demo catalog) for end-to-end tests.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };

export async function startServer(port = 8790) {
  const persist = mkdtempSync(join(tmpdir(), 'absvai-e2e-'));
  const w = (...args) => execFileSync('npx', ['wrangler', ...args, '--local', '--persist-to', persist, '-c', 'worker/wrangler.toml'], { cwd: ROOT, env, stdio: 'pipe' });
  execFileSync('node', ['scripts/build-assets.mjs'], { cwd: ROOT, env, stdio: 'pipe' });
  w('d1', 'migrations', 'apply', 'DB');
  w('d1', 'execute', 'DB', '--file', 'worker/seed/demo.sql');
  const proc = spawn('npx', ['wrangler', 'dev', '-c', 'worker/wrangler.toml', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist,
    '--var', 'SETUP_TOKEN:e2e-setup-token', '--var', 'OTP_PEPPER:e2e-pepper', '--var', `SITE_URL:http://127.0.0.1:${port}`, '--show-interactive-dev-session=false'], { cwd: ROOT, env, stdio: 'pipe', detached: true });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/robots.txt`)).ok) break; } catch { /* not up yet */ }
    if (i > 90) throw new Error(`dev server did not start:\n${log}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  return {
    base,
    sql: query => JSON.parse(w('d1', 'execute', 'DB', '--json', '--command', query).toString())[0].results,
    stop: () => {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ }
      rmSync(persist, { recursive: true, force: true });
    },
  };
}

export async function launchBrowser() {
  let pw;
  try { pw = await import('playwright'); } catch { pw = await import('/opt/node-tools/node_modules/playwright/index.mjs'); }
  const chromium = pw.chromium ?? pw.default.chromium;
  return chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
}
