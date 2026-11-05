// Deploy helper (CI): finds or creates the D1 database, KV namespace and R2 bucket named in worker/wrangler.toml, writes
// their ids into wrangler.toml for this run only (never committed), and finds the shop's own domain (vandarmart.com),
// added to the Worker in the Cloudflare dashboard. The deploy never adds or removes domains (wrangler.toml has no
// routes, so Wrangler leaves dashboard domains alone); it only reads which one is attached, so the links in SMS, emails,
// the sitemap and canonical tags use it. Without one, the shop answers at its workers.dev address.
// Needs CLOUDFLARE_API_TOKEN (Edit Cloudflare Workers template + D1 Edit) and CLOUDFLARE_ACCOUNT_ID. Optional: Turnstile Edit
// (adds the shop's domain to the widget), Zone DNS Edit (adds the email DNS records) and RESEND_API_KEY.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '../worker/wrangler.toml');
const KV_TITLE = 'absvai-kv';
const WORKER = (readFileSync(CONFIG, 'utf8').match(/^name\s*=\s*"([^"]+)"/m) ?? [])[1] ?? 'absvai';
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

// The shop's domain: a Custom Domain on this Worker (preferred), or a route on one of the account's zones.
let domains = [];
res = await cf(`/accounts/${account}/workers/domains?service=${encodeURIComponent(WORKER)}`);
if (res.ok) domains = (res.body.result ?? []).filter(d => !d.service || d.service === WORKER).map(d => d.hostname).filter(Boolean);
if (!domains.length) {
  const zones = await cf(`/zones?account.id=${account}&per_page=50`);
  for (const z of zones.ok ? zones.body.result ?? [] : []) {
    const routes = await cf(`/zones/${z.id}/workers/routes`);
    for (const r of routes.ok ? routes.body.result ?? [] : []) if (r.script === WORKER) domains.push(String(r.pattern).replace(/\/.*$/, '').replace(/^\*\.?/, ''));
  }
}
domains = [...new Set(domains.filter(h => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)))];
const domain = domains.find(h => !h.startsWith('www.')) ?? domains[0] ?? null;

// Turnstile (the checkout's human check) only runs on the hostnames its widget lists. If the shop's domain is missing,
// customers there can never start checkout, so add it (and the workers.dev address) to the widget.
let turnstileNote = null;
const sitekey = process.env.TURNSTILE_SITE_KEY;
if (sitekey && domains.length) {
  const w = await cf(`/accounts/${account}/challenges/widgets/${sitekey}`);
  const widget = w.ok ? w.body.result : null;
  const missing = widget ? domains.filter(h => !(widget.domains ?? []).includes(h)) : domains;
  if (widget && !missing.length) turnstileNote = `Turnstile: ${domains.join(', ')} allowed`;
  else if (widget) {
    const { name, mode, region, bot_fight_mode, clearance_level, offlabel, ephemeral_id } = widget;
    const body = { name, mode, domains: [...new Set([...(widget.domains ?? []), ...domains])], region, bot_fight_mode, clearance_level, offlabel, ephemeral_id };
    const u = await cf(`/accounts/${account}/challenges/widgets/${sitekey}`, { method: 'PUT', body: JSON.stringify(body) });
    turnstileNote = u.ok ? `Turnstile: added ${missing.join(', ')} to the widget's hostnames` : null;
  }
  if (!turnstileNote) {
    turnstileNote = `Turnstile does not allow ${missing.join(', ')} yet, so checkout cannot start there. Cloudflare dashboard → Turnstile → your widget → Hostname management → add ${missing.join(' and ')} (or give the API token Account → Turnstile → Edit).`;
    console.log(`::warning::${turnstileNote}`);
  }
}

// Email (Resend): emails reach customers only from a domain verified in Resend (Resend cannot send as a gmail.com
// address). With the Resend key, the deploy finds (or adds) the shop's domain in Resend, puts its DNS records into the
// Cloudflare zone when the token may edit DNS, asks Resend to check them, and once the domain is verified turns on
// sending from it (EMAIL_DOMAIN). Never fails the deploy: it says what is missing instead.
let emailDomain = '';
let emailNote = null;
const resendKey = process.env.RESEND_API_KEY;
const apex = domain ? domain.replace(/^www\./, '') : null;
async function resend(path, init = {}) {
  try {
    const r = await fetch(`https://api.resend.com${path}`, { ...init, headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json', ...init.headers } });
    return { status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) };
  } catch (err) { return { status: 0, ok: false, body: { message: String(err) } }; }
}
const recordText = recs => recs.map(r => `${r.type} ${r.name} → ${r.value}${r.priority ? ` (priority ${r.priority})` : ''}`).join('; ');
if (resendKey && apex) {
  const list = await resend('/domains');
  if (!list.ok) {
    emailNote = `Email: the Resend key cannot read domains (HTTP ${list.status}${list.body.message ? `: ${list.body.message}` : ''}). Customer emails (sign-in codes, receipts) start once ${apex} is verified in Resend; then set the repository variable EMAIL_DOMAIN=${apex} and deploy again.`;
  } else {
    let d = (list.body.data ?? []).find(x => x.name === apex);
    if (!d) {
      const made = await resend('/domains', { method: 'POST', body: JSON.stringify({ name: apex, region: 'ap-northeast-1' }) });
      if (made.ok) { d = made.body; created.push(`Resend domain ${apex}`); }
    }
    const info = d ? ((await resend(`/domains/${d.id}`)).body ?? d) : null;
    if (!info) emailNote = `Email: could not add ${apex} to Resend. Add it at resend.com → Domains, then deploy again.`;
    else if (info.status === 'verified') emailDomain = apex;
    else {
      const pending = (info.records ?? []).filter(r => r.status !== 'verified');
      const zone = await cf(`/zones?name=${encodeURIComponent(apex)}`);
      const zoneId = zone.ok ? zone.body.result?.[0]?.id : null;
      let added = 0;
      let refused = !zoneId;
      for (const r of refused ? [] : pending) {
        const fqdn = !r.name || r.name === '@' ? apex : r.name.endsWith(apex) ? r.name : `${r.name}.${apex}`;
        const have = await cf(`/zones/${zoneId}/dns_records?type=${r.type}&name=${encodeURIComponent(fqdn)}`);
        if (!have.ok) { refused = true; break; }
        if ((have.body.result ?? []).some(x => String(x.content).replace(/^"|"$/g, '') === r.value)) continue;
        const rec = { type: r.type, name: fqdn, content: r.value, ttl: 1, ...(r.type === 'MX' ? { priority: r.priority ?? 10 } : {}), ...(r.type === 'CNAME' ? { proxied: false } : {}) };
        const add = await cf(`/zones/${zoneId}/dns_records`, { method: 'POST', body: JSON.stringify(rec) });
        if (add.ok) added++; else { refused = true; break; }
      }
      await resend(`/domains/${d.id}/verify`, { method: 'POST' });
      const now = await resend(`/domains/${d.id}`);
      if (now.ok && now.body.status === 'verified') emailDomain = apex;
      else if (refused) emailNote = `Email: ${apex} is not verified in Resend yet and this Cloudflare token may not edit DNS. Add these records in Cloudflare → ${apex} → DNS (or give the token Zone → DNS → Edit), then deploy again: ${recordText(pending)}`;
      else emailNote = `Email: ${added ? `added ${added} DNS record(s) for ${apex}; ` : ''}Resend is checking ${apex} (usually a few minutes). The next deploy turns on emails to customers.`;
    }
  }
}
if (!emailDomain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(process.env.EMAIL_DOMAIN ?? '')) emailDomain = process.env.EMAIL_DOMAIN;
if (emailDomain) emailNote = `Email: sending as hello@${emailDomain} (verified in Resend), replies go to the owner's inbox; customers get sign-in codes, receipts and offers.`;
else if (!emailNote) emailNote = resendKey ? 'Email: no shop domain yet, so only the owner gets emails (Resend test sender).' : 'Email: RESEND_API_KEY is not set, so no emails are sent.';
if (emailNote && !emailDomain) console.log(`::warning::${emailNote}`);

// The workers.dev address (always on, for the admin and as the fallback) needs the account's workers.dev subdomain.
let subdomain = null;
{
  res = await cf(`/accounts/${account}/workers/subdomain`);
  subdomain = res.ok ? res.body.result?.subdomain ?? null : null;
  if (!subdomain && !domain) {
    // First Worker on this account: register one (it can be renamed later in Workers & Pages → Your subdomain).
    res = await cf(`/accounts/${account}/workers/subdomain`, { method: 'PUT', body: JSON.stringify({ subdomain: 'absvai' }) });
    if (!res.ok) fail('Registering a workers.dev subdomain', res, 'Open Workers & Pages in the Cloudflare dashboard once to choose your workers.dev subdomain, or add your domain to the Worker, then deploy again.');
    subdomain = res.body.result?.subdomain ?? 'absvai';
    created.push(`workers.dev subdomain ${subdomain}`);
  }
}

toml = toml
  .replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${db.uuid}"`)
  .replace(/(\[\[kv_namespaces\]\][^[]*?)id\s*=\s*"[^"]*"/, `$1id = "${kv.id}"`);
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
  ...(turnstileNote ? [turnstileNote] : []),
  emailNote,
  domain ? `Shop address: https://${domain}${domains.length > 1 ? ` (also ${domains.filter(h => h !== domain).join(', ')})` : ''}` : `No domain is attached to the ${WORKER} Worker yet, so links use https://${WORKER}.${subdomain}.workers.dev. Add the domain in Workers & Pages → ${WORKER} → Settings → Domains & Routes, then deploy again.`,
];
console.log(lines.join('\n'));
const workersDev = subdomain ? `https://${WORKER}.${subdomain}.workers.dev` : '';
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `has_domain=${Boolean(domain)}\nhas_r2=${hasR2}\nworkers_dev_url=${workersDev}\nsite_url=${domain ? `https://${domain}` : workersDev}\nd1_id=${db.uuid}\nemail_domain=${emailDomain}\n`);
if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `### Cloudflare resources\n\n${lines.map(l => `- ${l}`).join('\n')}\n`);
