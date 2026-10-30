# Abs Vai · absvai.com

Seasonal multi-category marketplace for **ABS VAI LTD**: households buying gur, masala, clothing, gadgets and home items, and
small food businesses buying presses, sealers, tools, packaging and bulk Master Masala. English only, mobile-first, Bangladesh.

One **Cloudflare Worker** (Hono + TypeScript) serves the server-rendered storefront, the admin app and every `/api/*` route,
backed by **D1** (catalog, orders, geo), **KV** (sessions, cached geo JSON, rate limits) and **R2** (photos, manuals, claim documents).

| | |
|---|---|
| Full A–Z specification (all 24 sections, data model, diagrams, what is built vs planned) | [docs/SPEC.md](docs/SPEC.md) |
| Review of the reference site and the Facebook ad creatives | [docs/DESIGN-REVIEW.md](docs/DESIGN-REVIEW.md) |
| Owner guide: add a product, start a season, confirm orders, fix postcodes | [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md) |
| Geo data sources, pinned commit and licensing note | [data/geo/SOURCES.md](data/geo/SOURCES.md) |
| Postcode → area match report | [data/geo/reports/postcode-match-summary.md](data/geo/reports/postcode-match-summary.md) |

<p>
  <img src="docs/screenshots/store-home.png" width="230" alt="Storefront homepage on a phone">
  <img src="docs/screenshots/store-checkout-location.png" width="230" alt="Checkout: district found from location, outline map">
  <img src="docs/screenshots/store-option-picker.png" width="230" alt="Option picker for a sized and coloured product">
</p>
<img src="docs/screenshots/admin-form-options.png" width="720" alt="Admin smart upload form, options and prices step">

## What is in Phase 1 (this build)

- **Product templates** (Section 3): 10 launch templates as data. They drive the upload form, the product-page info panels,
  the card key-spec line and the listing filters. Admins can create new templates and categories with no code. "Customers choose this"
  promotes a spec to an option for one product only.
- **Smart upload form** (Section 4): 9 steps, variant table with bulk fill, automatic unique SKUs (`ORG-PTGR-500G-0001`), photos
  compressed in the browser and stored in R2, a plain-language publish checklist (e.g. *"Add a best-before date. Required for food
  products."*), draft / schedule / publish, duplicate, and a CSV layout per template for bulk import.
- **Storefront** (Section 2): an ad-continuity design (chili, turmeric, cream), season-aware hero, category carousel, In Season Now,
  Abs Vai Originals, Hot Deals, a band for food businesses, a trust strip, bottom tabs, a chat channel picker, an option-picker sheet,
  Add to Cart + Order Now, and `Product` / `BreadcrumbList` JSON-LD.
- **Seasons** (Section 5): automatic switching of the hero, rails and category visibility. Out-of-season pages stay live with
  "Back in season from …" and Notify me. Pre-orders take an advance. A cron sends back-in-season SMS and publishes scheduled products.
- **Checkout with address detection** (Section 6): a 4-digit postcode auto-fills Division/District/Area with a post-office picker;
  "Use my location" works at district level only (point-in-polygon on district outlines, nearest centre as fallback) and says so;
  manual cascading dropdowns always work. The lazy-loaded Leaflet map card shows the district outline. Delivery charge and ETA are
  live by zone, packed weight, bulky rule and free-delivery rules. The server re-validates everything. No GPS is stored.
- **Orders**: COD can't be confirmed without the SMS code (OTP) or a logged confirmation call. Advances are verified by transaction ID.
  Sequential `INV-YYYYMMDD-####` invoices are generated as PDFs. Risk signals cover postcode mismatch, short address, double taps,
  velocity and returns. Abandoned checkouts are captured. Stock changes are atomic.
- **Admin**: dashboard with "needs your attention", health strip and season card; orders pipeline with bulk actions; delivery zones;
  postcode fixing with bulk assign; courier area mapping; seasons; inventory with a batch log; synonyms; staff roles enforced on the
  server; audit log; SMS outbox.

Phase 2 (payment gateways, courier APIs, fraud lookup, Pixel + CAPI, landing pages, coupons, reviews) and Phase 3 (starter kits,
recipes hub, AI chat, planning report, offline PWA) are specified in [docs/SPEC.md](docs/SPEC.md#22-phased-roadmap). Their tables
already exist, so no destructive migration is needed later.

## Quick start (local)

```bash
npm ci
cp .dev.vars.example worker/.dev.vars          # local-only secrets (SETUP_TOKEN, OTP_PEPPER)
npm run db:migrate:local                        # schema + geo data + launch configuration
npm run db:seed:demo:local                      # optional demo catalog (never run in production)
npm run dev                                     # http://localhost:8787 and http://localhost:8787/admin/
```

On first visit, `/admin/` asks for the `SETUP_TOKEN` and creates the Super Admin. Without an SMS provider, every message (including
OTP codes) is written to **Admin → SMS outbox** with status `logged`.

| Script | What it does |
|---|---|
| `npm run typecheck` | TypeScript build check for the Worker, scripts and tests |
| `npm test` | 115 unit + integration tests (integration runs the real app on local D1/KV/R2 through workerd) |
| `npm run test:e2e` | Playwright: weighed food, size + colour clothing, machine with models, pre-order with advance, notify-me, admin upload form |
| `npm run gen:geo` | Re-imports geo data and rewrites the match report (before the first production migration only) |
| `npm run gen:seed` | Regenerates the launch configuration and demo SQL from `scripts/seed-defs.ts` |
| `npm run deploy` | Build assets and deploy the Worker |

## Deploying to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create absvai                  # put the id in worker/wrangler.toml
npx wrangler kv namespace create absvai        # put the id in worker/wrangler.toml
npx wrangler r2 bucket create absvai-media
npx wrangler secret put SETUP_TOKEN -c worker/wrangler.toml
npx wrangler secret put OTP_PEPPER -c worker/wrangler.toml
npx wrangler secret put TURNSTILE_SECRET -c worker/wrangler.toml   # optional; also set TURNSTILE_SITE_KEY as a var
npm run db:migrate:remote
npm run deploy
```

`absvai.com` and `www.absvai.com` are attached as custom domains in `worker/wrangler.toml`; `www` redirects to the apex.
GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, generated-file drift, tests and E2E on every PR, and on `main` applies
D1 migrations and deploys. It needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Folder structure

```
absvai.com/
├── worker/
│   ├── src/
│   │   ├── routes/        api.ts (public JSON) · pages.tsx (SSR storefront) · admin*.ts (admin API)
│   │   ├── lib/           templates · sku · delivery-charge · geo · risk · seasons · search · invoice/pdf · auth · sms · …
│   │   ├── services/      cart pricing · checkout quote + advance rules · order placement, OTP, status changes
│   │   ├── data/          catalog + settings queries
│   │   ├── views/         Hono JSX layout, components and pages
│   │   ├── cron/          scheduled publish, season start notifications
│   │   ├── generated/     geo-version.ts (written by the geo import)
│   │   └── index.ts
│   ├── migrations/        0001 schema · 0002 geo data (generated) · 0003 launch configuration (generated)
│   ├── seed/demo.sql      demo catalog for local use and tests
│   └── wrangler.toml
├── scripts/               import-geo.ts · gen-seed.ts + seed-defs.ts · build-assets.mjs
├── data/geo/              pinned source files · generated outlines · match report
├── public/                storefront CSS, JS, images, manifest
├── admin/                 admin single-page app (vanilla JS modules)
├── tests/                 unit · integration · e2e
├── .github/workflows/
└── docs/
```

## Things to confirm with ABS VAI LTD before launch

1. Logo files and final brand colours (the palette is a starting point; contrast is tested in `tests/unit/contrast.test.ts`).
2. The launch category list and template per category (`scripts/seed-defs.ts`, or edit in admin).
3. Delivery zone charges and the free-delivery threshold (placeholders: ৳70 / ৳100 / ৳130, free over ৳1,500).
4. Advance rules (which products, how much).
5. Which seasons to set up first, with this year's exact dates (Ramadan and Eid move every year; the seasons ship without dates).
6. BSTI / licence numbers and label details for the Master Masala line, checked with BSTI and the Bangladesh Food Safety Authority.
7. The preferred courier(s) and SMS gateway.
8. Real product photos: the demo uses original placeholder drawings. No photo from any other shop or reference site is in this repository.
