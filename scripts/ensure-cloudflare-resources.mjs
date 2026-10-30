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

// R2 bucket.
res = await cf(`/accounts/${account}/r2/buckets/${bucket}`);
if (res.status === 404) {
  res = await cf(`/accounts/${account}/r2/buckets`, { method: 'POST', body: JSON.stringify({ name: bucket, locationHint: 'apac' }) });
  if (!res.ok) fail('Creating the R2 bucket', res, 'R2 must be enabled once in the dashboard (R2 → Get started), and the token needs Workers R2 Storage → Edit.');
  created.push(`R2 ${bucket}`);
} else if (!res.ok) fail('Reading the R2 bucket', res, 'R2 must be enabled once in the dashboard (R2 → Get started).');

// Custom domains only when the zone is in this account; otherwise deploy to workers.dev for now.
res = await cf(`/zones?name=${ZONE}&account.id=${account}`);
const hasZone = res.ok && (res.body.result ?? []).length > 0;

toml = toml
  .replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${db.uuid}"`)
  .replace(/(\[\[kv_namespaces\]\][^[]*?)id\s*=\s*"[^"]*"/, `$1id = "${kv.id}"`);
if (!hasZone) toml = toml.replace(/^routes\s*=\s*\[[\s\S]*?^\]\n/m, '');
writeFileSync(CONFIG, toml);

const lines = [
  `D1 ${dbName}: ${db.uuid}`,
  `KV ${KV_TITLE}: ${kv.id}`,
  `R2 ${bucket}: ready`,
  created.length ? `Created this run: ${created.join(', ')}` : 'All resources already existed.',
  hasZone ? `Custom domains: ${ZONE} and www.${ZONE}` : `The ${ZONE} zone is not in this Cloudflare account yet, so this deploy goes to workers.dev only. Add the zone (and point the domain's nameservers to Cloudflare), then deploy again.`,
];
console.log(lines.join('\n'));
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `has_zone=${hasZone}\nd1_id=${db.uuid}\n`);
if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `### Cloudflare resources\n\n${lines.map(l => `- ${l}`).join('\n')}\n`);
