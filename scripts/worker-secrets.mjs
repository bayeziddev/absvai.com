// Deploy helper (CI): writes the JSON file passed to `wrangler deploy --secrets-file`.
// - Secrets set in GitHub are always used.
// - OTP_PEPPER, SIGNING_KEY and SETTINGS_KEY are internal random keys nobody types. If GitHub doesn't have one, the key the
//   Worker already holds is kept; on the very first deploy a random one is generated and stored only as a Worker secret on
//   Cloudflare (never printed, never in the repository). Secrets left out of the file keep their current value.
// Usage: node scripts/worker-secrets.mjs <out.json>
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('Usage: node scripts/worker-secrets.mjs <out.json>'); process.exit(1); }

const PASS_THROUGH = ['SETUP_TOKEN', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET', 'SMS_PROVIDER', 'SMS_API_KEY'];
const AUTO = ['OTP_PEPPER', 'SIGNING_KEY', 'SETTINGS_KEY'];

/**
 * Names of the secrets the Worker already has. Only "Worker not found" (the first deploy) counts as none; any other error
 * stops the deploy, so a passing network problem can never replace existing keys (a new SETTINGS_KEY would make saved
 * credentials unreadable).
 */
async function existingSecretNames() {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
  const script = readFileSync('worker/wrangler.toml', 'utf8').match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  if (!token || !account || !script) throw new Error('CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and the Worker name are needed.');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${script}/secrets`, { headers: { authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  if (r.ok && body.success !== false) return new Set((body.result ?? []).map(x => x.name));
  if (r.status === 404) {
    // Confirm the Worker really doesn't exist before treating this as the first deploy.
    const list = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts`, { headers: { authorization: `Bearer ${token}` } });
    const scripts = await list.json().catch(() => ({}));
    if (list.ok && scripts.success !== false && !(scripts.result ?? []).some(x => x.id === script)) return new Set();
  }
  throw new Error(`Could not read the Worker's secrets (HTTP ${r.status}): ${(body.errors ?? []).map(e => e.message).join('; ')}. Nothing was changed.`);
}

const secrets = {};
const notes = [];
for (const k of PASS_THROUGH) if (process.env[k]) secrets[k] = process.env[k];

// Half a Turnstile setup would block every checkout: the secret makes the server demand a token the page can't produce.
if (Boolean(process.env.TURNSTILE_SITE_KEY) !== Boolean(process.env.TURNSTILE_SECRET)) {
  console.error('Add both TURNSTILE_SITE_KEY and TURNSTILE_SECRET (Cloudflare → Turnstile → your widget), or neither.');
  process.exit(1);
}

if (process.env.SETTINGS_KEY && Buffer.from(process.env.SETTINGS_KEY, 'base64').length !== 32) {
  console.error('SETTINGS_KEY in GitHub must be 32 random bytes in base64 (openssl rand -base64 32), or remove it and let the deploy create one.');
  process.exit(1);
}

let existing;
try { existing = await existingSecretNames(); } catch (e) { console.error(e.message); process.exit(1); }
for (const k of AUTO) {
  if (process.env[k]) { secrets[k] = process.env[k]; notes.push(`${k}: from GitHub secrets`); }
  else if (existing.has(k)) notes.push(`${k}: kept (already on Cloudflare)`);
  else {
    const value = randomBytes(32).toString('base64');
    if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${value}`);
    secrets[k] = value;
    notes.push(`${k}: created now and stored on Cloudflare only`);
  }
}

writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 });
console.log(notes.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Worker secrets\n\n${notes.map(n => `- ${n}`).join('\n')}\n- Set this run: ${Object.keys(secrets).join(', ') || 'none'}\n`);
