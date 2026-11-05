// Assembles dist/ for Workers Static Assets: storefront (public/), admin app (admin/ → /admin/),
// generated district outlines (versioned, cached forever), self-hosted fonts (OFL, latin subset) and Leaflet.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guidePage } from './md-html.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const version = readFileSync(join(root, 'worker/src/generated/geo-version.ts'), 'utf8').match(/GEO_VERSION = '([a-f0-9]+)'/)[1];

// Empty dist/ in place (not delete it) so a running `wrangler dev` keeps watching the same folder.
mkdirSync(dist, { recursive: true });
for (const entry of readdirSync(dist)) rmSync(join(dist, entry), { recursive: true, force: true });
cpSync(join(root, 'public'), dist, { recursive: true });
cpSync(join(root, 'admin'), join(dist, 'admin'), { recursive: true });
// The owner guides. The admin assistant (worker/src/services/assistant.ts) reads them all, English and Bangla, from
// /admin/guide.md; the Bangla guides are also pages of their own for the owner (Help center): the full guide
// (/admin/guide-bn.html) and the photo and website sections guide (/admin/photo-guide-bn.html).
const guideBn = readFileSync(join(root, 'docs/ADMIN-GUIDE-BN.md'), 'utf8');
const photoGuideBn = readFileSync(join(root, 'docs/PHOTO-GUIDE-BN.md'), 'utf8');
const body = md => md.replace(/^# .*\n/, '').trim();
writeFileSync(join(dist, 'admin/guide.md'), `${readFileSync(join(root, 'docs/OWNER-GUIDE.md'), 'utf8').trim()}\n\n${body(guideBn)}\n\n${body(photoGuideBn)}\n`);
writeFileSync(join(dist, 'admin/guide-bn.html'), guidePage(guideBn, { title: 'বাংলা গাইড · Abs Vai Admin' }));
writeFileSync(join(dist, 'admin/photo-guide-bn.html'), guidePage(photoGuideBn, { title: 'ছবি ও ওয়েবসাইট গাইড · Abs Vai Admin' }));
const geo = join(dist, 'geo', version);
mkdirSync(geo, { recursive: true });
cpSync(join(root, 'data/geo/generated/outlines'), join(geo, 'outlines'), { recursive: true });
cpSync(join(root, 'data/geo/generated/districts.json'), join(geo, 'districts.json'));
const leaflet = join(root, 'node_modules/leaflet/dist');
if (existsSync(leaflet)) {
  mkdirSync(join(dist, 'vendor/leaflet'), { recursive: true });
  for (const f of ['leaflet.js', 'leaflet.css']) cpSync(join(leaflet, f), join(dist, 'vendor/leaflet', f));
  cpSync(join(leaflet, 'images'), join(dist, 'vendor/leaflet/images'), { recursive: true });
}
// Self-hosted fonts (Section 2.4): Inter for text, Poppins ExtraBold for headings and price stickers.
const fonts = join(dist, 'fonts');
mkdirSync(fonts, { recursive: true });
const FONT_FILES = [['inter', [400, 600, 700]], ['poppins', [700, 800]]];
for (const [family, weights] of FONT_FILES) {
  for (const w of weights) cpSync(join(root, `node_modules/@fontsource/${family}/files/${family}-latin-${w}-normal.woff2`), join(fonts, `${family}-latin-${w}-normal.woff2`));
}

// Minify the storefront CSS (the Worker puts it inside every page, see worker/src/lib/page-css.ts) and scripts.
// esbuild comes with wrangler; without it the files are served as written.
try {
  const { transformSync } = await import('esbuild');
  for (const f of readdirSync(join(dist, 'css')).filter(f => f.endsWith('.css'))) {
    const css = join(dist, 'css', f);
    writeFileSync(css, transformSync(readFileSync(css, 'utf8'), { loader: 'css', minify: true }).code);
  }
  for (const f of readdirSync(join(dist, 'js')).filter(f => f.endsWith('.js'))) {
    const p = join(dist, 'js', f);
    writeFileSync(p, transformSync(readFileSync(p, 'utf8'), { loader: 'js', minify: true }).code);
  }
  // The admin is one bundle: its ~25 modules arrive in one request instead of a chain of imports, one after another,
  // which is what kept the admin on "Loading…" on a phone. The unbundled files stay next to it (nothing loads them).
  const { buildSync } = await import('esbuild');
  buildSync({ entryPoints: [join(root, 'admin/js/app.js')], outfile: join(dist, 'admin/js/app.js'), allowOverwrite: true, bundle: true, format: 'esm', minify: true, target: 'es2022', legalComments: 'none', logLevel: 'warning' });
  writeFileSync(join(dist, 'admin/admin.css'), transformSync(readFileSync(join(dist, 'admin/admin.css'), 'utf8'), { loader: 'css', minify: true }).code);
  // The admin page names its bundle and stylesheet with a fingerprint of their content, so a phone keeps them for a year
  // (a reopened admin downloads no code at all) and a deploy still gets the new ones at once.
  const tag = f => createHash('sha256').update(readFileSync(join(dist, f))).digest('hex').slice(0, 10);
  const adminHtml = join(dist, 'admin/index.html');
  writeFileSync(adminHtml, readFileSync(adminHtml, 'utf8')
    .replace('src="/admin/js/app.js"', `src="/admin/js/app.js?v=${tag('admin/js/app.js')}"`)
    .replace('href="/admin/admin.css"', `href="/admin/admin.css?v=${tag('admin/admin.css')}"`));
} catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  console.warn('esbuild not found: storefront CSS and JS are not minified.');
}

// The service worker's cache name follows the content of the files it caches, so a deploy refreshes it.
const hash = createHash('sha256');
const walk = dir => { for (const f of readdirSync(dir).sort()) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else hash.update(f).update(readFileSync(p)); } };
for (const d of ['css', 'js', 'fonts']) walk(join(dist, d));
const swVersion = hash.digest('hex').slice(0, 10);
writeFileSync(join(dist, 'sw.js'), readFileSync(join(dist, 'sw.js'), 'utf8').replace('__SW_VERSION__', swVersion));

writeFileSync(join(dist, '_headers'), [
  '/geo/*', '  Cache-Control: public, max-age=31536000, immutable',
  '/fonts/*', '  Cache-Control: public, max-age=31536000, immutable',
  '/sw.js', '  Cache-Control: no-cache',
  '/vendor/*', '  Cache-Control: public, max-age=2592000',
  '/img/*', '  Cache-Control: public, max-age=604800',
  '/css/*', '  Cache-Control: public, max-age=600, stale-while-revalidate=86400',
  '/js/*', '  Cache-Control: public, max-age=600, stale-while-revalidate=86400',
  // The admin page itself is always checked; its fingerprinted bundle and stylesheet are kept (see the build above).
  '/admin/', '  Cache-Control: no-cache',
  '/admin/index.html', '  Cache-Control: no-cache',
  '/admin/*.html', '  Cache-Control: no-cache',
  '/admin/guide.md', '  Cache-Control: no-cache',
  '/admin/js/*', '  Cache-Control: public, max-age=31536000, immutable',
  '/admin/admin.css', '  Cache-Control: public, max-age=31536000, immutable',
  '/admin/*', '  X-Robots-Tag: noindex',
  '/seller/*', '  Cache-Control: no-cache', '  X-Robots-Tag: noindex',
  // Static files (including the admin app) get the same security headers the Worker sets on its own responses.
  '/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: strict-origin-when-cross-origin', '  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  '  X-Frame-Options: DENY',
  '',
].join('\n'));
console.log(`dist/ built (geo ${version}, service worker ${swVersion})`);
