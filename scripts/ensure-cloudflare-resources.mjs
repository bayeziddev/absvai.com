// Deploy helper (CI): finds or creates the D1 database, KV namespace and R2 bucket named in worker/wrangler.toml, writes
// their ids into wrangler.toml for this run only (never committed), and drops the custom-domain routes when the
// absvai.com zone is not in the Cloudflare account yet, so the first deploy lands on workers.dev instead of failing.
// Needs CLOUDFLARE_API_TOKEN (Edit Cloudflare Workers template + D1 Edit) and CLOUDFLARE_ACCOUNT_ID.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '../worker/wrangler.toml');
const KV_TITLE = 'absvai-kv';
const ZONE = 'absvai.com';
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;

if (!token || !account) {
  console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (GitHub → Settings → Secrets and variables → Actions).');
  process.exit(1);
}

async function cf(path, init = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
  const body = await r.json().catch(() => ({ success: false, errors: [{ message: `HTTP ${r.status}` }] }));
  return { status: r.status, ok: r.ok && body.success !== false, body };
}
const fail = (what, res, hint = '') => {
  console.error(`${what} failed (HTTP ${res.status}): ${(res.body.errors ?? []).map(e => `${e.code ?? ''} ${e.message}`).join('; ')}${hint ? `\n${hint}` : ''}`);
  process.exit(1);
};

let toml = readFileSync(CONFIG, 'utf8');
const pick = re => toml.match(re)?.[1];
const dbName = pick(/database_name\s*=\s*"([^"]+)"/);
const bucket = pick(/bucket_name\s*=\s*"([^"]+)"/);
if (!dbName || !bucket) { console.error('wrangler.toml must name the D1 database and the R2 bucket.'); process.exit(1); }

// D1 (primary close to Bangladesh).
let res = await cf(`/accounts/${account}/d1/database?name=${encodeURIComponent(dbName)}`);
if (!res.ok) fail('Listing D1 databases', res, 'The API token needs Account → D1 → Edit.');
let db = (res.body.result ?? []).find(d => d.name === dbName);
let created = [];
if (!db) {
  res = await cf(`/accounts/${account}/d1/database`, { method: 'POST', body: JSON.stringify({ name: dbName, primary_location_hint: 'apac' }) });
  if (!res.ok) fail('Creating the D1 database', res);
  db = res.body.result;
  created.push(`D1 ${dbName}`);
}

// KV namespace, by title.
let kv = null;
for (let page = 1; !kv; page++) {
  res = await cf(`/accounts/${account}/storage/kv/namespaces?per_page=100&page=${page}`);
  if (!res.ok) fail('Listing KV namespaces', res, 'The API token needs Account → Workers KV Storage → Edit.');
  kv = res.body.result.find(n => n.title === KV_TITLE) ?? null;
  if (kv || res.body.result.length < 100) break;
}
if (!kv) {
  res = await cf(`/accounts/${account}/storage/kv/namespaces`, { method: 'POST', body: JSON.stringify({ title: KV_TITLE }) });
  if (!res.ok) fail('Creating the KV namespace', res);
  kv = res.body.result;
  created.push(`KV ${KV_TITLE}`);
}

// R2 bucket (photos, logo, manuals). R2 has to be switched on once per account in the dashboard; until then the store deploys
// without photo storage (uploads say so) instead of not deploying at all.
const r2Off = r => (r.body.errors ?? []).some(e => e.code === 10042);
let hasR2 = true;
res = await cf(`/accounts/${account}/r2/buckets/${bucket}`);
if (r2Off(res)) hasR2 = false;
else if (res.status === 404) {
  res = await cf(`/accounts/${account}/r2/buckets`, { method: 'POST', body: JSON.stringify({ name: bucket, locationHint: 'apac' }) });
  if (r2Off(res)) hasR2 = false;
  else if (!res.ok) fail('Creating the R2 bucket', res, 'The token needs Workers R2 Storage → Edit.');
  else created.push(`R2 ${bucket}`);
} else if (!res.ok) fail('Reading the R2 bucket', res, 'The token needs Workers R2 Storage → Edit.');
if (!hasR2 && GITHUB_OUTPUT) console.log('::warning::R2 is not switched on for this Cloudflare account, so photo and logo uploads are off for now. Dashboard → R2 Object Storage → Get started (or Purchase R2 Plan, the free tier is enough), then deploy again.');

// Custom domains only when the zone is in this account; otherwise deploy to workers.dev for now.
res = await cf(`/zones?name=${ZONE}&account.id=${account}`);
const hasZone = res.ok && (res.body.result ?? []).length > 0;

// Without the zone the Worker is reached at <name>.<subdomain>.workers.dev, which needs the account's workers.dev subdomain.
let subdomain = null;
if (!hasZone) {
  res = await cf(`/accounts/${account}/workers/subdomain`);
  subdomain = res.ok ? res.body.result?.subdomain ?? null : null;
  if (!subdomain) {
    // First Worker on this account: register one (it can be renamed later in Workers & Pages → Your subdomain).
    res = await cf(`/accounts/${account}/workers/subdomain`, { method: 'PUT', body: JSON.stringify({ subdomain: 'absvai' }) });
    if (!res.ok) fail('Registering a workers.dev subdomain', res, 'Open Workers & Pages in the Cloudflare dashboard once to choose your workers.dev subdomain, or add the absvai.com zone, then deploy again.');
    subdomain = res.body.result?.subdomain ?? 'absvai';
    created.push(`workers.dev subdomain ${subdomain}`);
  }
}

toml = toml
  .replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${db.uuid}"`)
  .replace(/(\[\[kv_namespaces\]\][^[]*?)id\s*=\s*"[^"]*"/, `$1id = "${kv.id}"`);
if (!hasZone) toml = toml.replace(/^routes\s*=\s*\[[\s\S]*?^\]\n/m, '');
if (!hasR2) toml = toml.replace(/^\[\[r2_buckets\]\]\n(?:[^\n[]*\n)*/m, '');
// Workers AI for the shop and admin assistants. Only the deployed Worker gets it: locally and in tests the AI binding
// would call the real account (and need a login), so there the assistants use their built-in answers.
if (!/^\[ai\]/m.test(toml)) toml += '\n[ai]\nbinding = "AI"\n';
writeFileSync(CONFIG, toml);

const lines = [
  `D1 ${dbName}: ${db.uuid}`,
  `KV ${KV_TITLE}: ${kv.id}`,
  hasR2 ? `R2 ${bucket}: ready` : `R2: not switched on for this account yet, so photo and logo uploads are off. Dashboard → R2 Object Storage → Get started, then deploy again.`,
  'Workers AI: on (shop chat and admin assistant, within the free daily allowance)',
  created.length ? `Created this run: ${created.join(', ')}` : 'All resources already existed.',
  hasZone ? `Custom domains: ${ZONE} and www.${ZONE}` : `The ${ZONE} zone is not in this Cloudflare account yet, so this deploy goes to https://absvai.${subdomain}.workers.dev only. Add the zone (and point the domain's nameservers to Cloudflare), then deploy again.`,
];
console.log(lines.join('\n'));
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `has_zone=${hasZone}\nhas_r2=${hasR2}\nworkers_dev_url=${subdomain ? `https://absvai.${subdomain}.workers.dev` : ''}\nd1_id=${db.uuid}\n`);
if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `### Cloudflare resources\n\n${lines.map(l => `- ${l}`).join('\n')}\n`);
