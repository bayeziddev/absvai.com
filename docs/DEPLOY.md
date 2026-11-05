# Deploying Vandar Mart to Cloudflare with GitHub Actions

The workflow `.github/workflows/ci.yml` tests every change and deploys the Worker. Nothing on Cloudflare needs creating by hand:
the deploy job finds or creates the D1 database (`absvai`), the KV namespace (`absvai-kv`) and the R2 bucket (`absvai-media`)
(internal names from the first launch; customers never see them),
applies the migrations, uploads the Worker together with its secrets, and checks that the live site answers.

## When it deploys

| Event | What runs |
|---|---|
| Pull request | Tests only (typecheck, generated-file drift, unit + integration, production dry run, Playwright) |
| Push to `main` | Tests, then deploy |
| **Actions → Test and deploy → Run workflow** | Tests, then deploy from the branch you pick; tick *Load the demo catalog* to fill an empty store with the 17 demo products |

Live at **https://vandarmart.com** (admin: **https://vandarmart.com/admin/**). The `workers.dev` address
(https://absvai.absvai.workers.dev) keeps working too.

## One-time setup (about 10 minutes)

### 1. Cloudflare API token
Cloudflare dashboard → **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template, then **add** the permission
**Account → D1 → Edit**. Scope it to your account and, under Zone Resources, to the `vandarmart.com` zone. The template includes
Workers Scripts, Workers KV Storage, Workers R2 Storage, Workers Routes and Account Settings. Also add **Account → Turnstile → Edit**:
then the deploy adds the shop's domain to the Turnstile widget by itself (step 3).

**Photo storage (R2)**: switch R2 on once (dashboard → R2 Object Storage → Get started; the free tier is enough, Cloudflare asks
for a payment method). Until then the store still deploys and works, but photo and logo uploads say *"Photo storage is not
switched on yet"* and the dashboard health strip shows it. The next deploy after you switch it on creates the bucket by itself.

The `workers.dev` address is set up automatically on the first deploy (`absvai.<subdomain>.workers.dev`) when the domain isn't
connected yet.

### 2. Repository secrets
GitHub → the repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Required | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes | the token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | yes | dashboard → Workers & Pages → Account ID (right side) |
| `SETUP_TOKEN` | yes | any long random text you choose (like a password); you type it once at `/admin/` to create the Super Admin |
| `OTP_PEPPER`, `SIGNING_KEY`, `SETTINGS_KEY` | **no, created for you** | internal random keys nobody types (they hash SMS codes, sign checkout sessions and encrypt passwords saved in Settings). The first deploy creates them and keeps them on Cloudflare; later deploys keep the same ones. Add your own only if you want a copy (`openssl rand -base64 32` each) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | recommended | **not random**: Cloudflare dashboard → **Turnstile** → **Add widget** → hostnames `vandarmart.com`, `www.vandarmart.com` and `absvai.absvai.workers.dev`, mode **Managed** → copy the *Site Key* and *Secret Key*. Add both or neither (the deploy refuses only one) |
| `SMS_PROVIDER`, `SMS_API_KEY` | later | once the SMS gateway is chosen; until then messages are logged in Admin → SMS outbox |

The deploy never replaces those three keys once they exist: if it can't read the Worker's secrets it stops instead. If you ever
delete the Worker or change `SETTINGS_KEY`, credentials saved in Settings must be entered again; a new `SIGNING_KEY` logs out open
checkouts and resets device/IP block matching.

### 3. The domain
Add the domain in the Cloudflare dashboard: **Workers & Pages → `absvai` → Settings → Domains & Routes → Add → Custom domain**
(`vandarmart.com`, and `www.vandarmart.com` if you want it; `www` is sent on to the main address). The domain's zone must be in the
same Cloudflare account (point its nameservers to Cloudflare at the registrar). `wrangler.toml` lists no routes on purpose, so a
deploy never removes a domain added in the dashboard.

Each deploy finds the domains attached to the Worker and uses the first one as the shop's address (links in emails, SMS, invoices,
the sitemap and the smoke test); with none it uses the `workers.dev` address. The run summary shows which.

**Turnstile**: the checkout's human check only runs on the hostnames its widget lists. Each deploy checks that the shop's domains
are listed and adds the missing ones (this needs the Turnstile permission from step 1). If it cannot, the run shows a warning:
then open Cloudflare dashboard → **Turnstile** → your widget → **Hostname management** and add `vandarmart.com` and
`www.vandarmart.com`. Until a domain is listed there, the checkout on it says the security check could not start and offers
"Order on WhatsApp" instead.

### 4. Email to customers (Resend)
Customer emails (sign-in codes, receipts, offers) need the shop's domain verified in Resend; Resend cannot send as a
gmail.com address. The domain `vandarmart.com` is already added in Resend (region Tokyo). With the `RESEND_API_KEY` secret,
each deploy checks it: if it is not verified yet it adds its DNS records to the Cloudflare zone (needs **Zone → DNS → Edit**
on the API token) and asks Resend to check them; once verified, the deploy sets `EMAIL_DOMAIN`, so emails come from
`Vandar Mart <hello@vandarmart.com>` with replies to the owner's Gmail. If the token cannot edit DNS, the run summary lists
the records to add by hand in **Cloudflare → vandarmart.com → DNS** (then deploy again):

| Type | Name | Value |
|---|---|---|
| TXT | `resend._domainkey` | the DKIM key shown in Resend → Domains → vandarmart.com |
| MX | `send` | `feedback-smtp.ap-northeast-1.amazonses.com` (priority 10) |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| CNAME | `rsend` | `send.forge.rmta.net` (DNS only, not proxied) |

If the Resend key may only send (not read domains), verify the domain in Resend and set the repository **variable**
`EMAIL_DOMAIN` = `vandarmart.com` (GitHub → Settings → Secrets and variables → Actions → Variables).

## First run
1. Push (or press **Run workflow**). The run summary lists the D1/KV/R2 ids, whether each was created, the live URL and the smoke
   test results.
2. Open `/admin/` on the live URL, enter the `SETUP_TOKEN`, and create the Super Admin.
3. Settings → fill the store details, wallet numbers, delivery threshold and tracking IDs. Upload the logo under Branding.

## Day to day
- Every push to `main` redeploys. Migrations in `worker/migrations/` are applied in order and only once.
- The resource ids are written into `worker/wrangler.toml` inside the run only; the repository keeps placeholders, so the same
  workflow works for a second Cloudflare account (for example a staging copy) with different secrets.
- Roll back: Cloudflare dashboard → Workers & Pages → `absvai` → Deployments → choose an earlier version → **Rollback**. Database
  migrations are not rolled back automatically.

## Local alternative
```bash
npx wrangler login
npm run build
npx wrangler d1 migrations apply DB --remote -c worker/wrangler.toml   # after putting the real ids in wrangler.toml
npx wrangler deploy -c worker/wrangler.toml --secrets-file secrets.json  # {"SETUP_TOKEN": "...", ...}; never commit it
```
