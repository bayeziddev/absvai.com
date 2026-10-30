# Deploying Abs Vai to Cloudflare with GitHub Actions

The workflow `.github/workflows/ci.yml` tests every change and deploys the Worker. Nothing on Cloudflare needs creating by hand:
the deploy job finds or creates the D1 database (`absvai`), the KV namespace (`absvai-kv`) and the R2 bucket (`absvai-media`),
applies the migrations, uploads the Worker together with its secrets, and checks that the live site answers.

## When it deploys

| Event | What runs |
|---|---|
| Pull request | Tests only (typecheck, generated-file drift, unit + integration, production dry run, Playwright) |
| Push to `main` | Tests, then deploy |
| Push to the build branch `claude/abs-vai-design-review-dt6sk6` | Tests, then deploy (until it is merged; remove the branch from `ci.yml` afterwards) |
| **Actions → Test and deploy → Run workflow** | Tests, then deploy from the branch you pick; tick *Load the demo catalog* to fill an empty store with the 17 demo products |

Manual runs appear in the Actions tab once `ci.yml` is on the default branch (`main`).

## One-time setup (about 10 minutes)

### 1. Cloudflare API token
Cloudflare dashboard → **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template, then **add** the permission
**Account → D1 → Edit**. Scope it to your account and, under Zone Resources, to the `absvai.com` zone. The template includes
Workers Scripts, Workers KV Storage, Workers R2 Storage, Workers Routes and Account Settings.

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
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | recommended | Cloudflare → Turnstile → add a widget for `absvai.com` |
| `SMS_PROVIDER`, `SMS_API_KEY` | later | once the SMS gateway is chosen; until then messages are logged in Admin → SMS outbox |

The deploy never replaces those three keys once they exist: if it can't read the Worker's secrets it stops instead. If you ever
delete the Worker or change `SETTINGS_KEY`, credentials saved in Settings must be entered again; a new `SIGNING_KEY` logs out open
checkouts and resets device/IP block matching.

### 3. The domain
The Worker attaches `absvai.com` and `www.absvai.com` as custom domains when the **absvai.com zone is in the same Cloudflare
account** (add the site in Cloudflare and point the domain's nameservers to it at the registrar). Until then the workflow removes the
routes for that run and deploys to `https://absvai.<your-subdomain>.workers.dev`, and says so in the run summary. Run it again after
the zone is active.

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
