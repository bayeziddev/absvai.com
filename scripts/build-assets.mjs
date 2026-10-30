// Assembles dist/ for Workers Static Assets: storefront (public/), admin app (admin/ → /admin/),
// generated district outlines (versioned, cached forever), self-hosted fonts (OFL, latin subset) and Leaflet.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const version = readFileSync(join(root, 'worker/src/generated/geo-version.ts'), 'utf8').match(/GEO_VERSION = '([a-f0-9]+)'/)[1];

// Empty dist/ in place (not delete it) so a running `wrangler dev` keeps watching the same folder.
mkdirSync(dist, { recursive: true });
for (const entry of readdirSync(dist)) rmSync(join(dist, entry), { recursive: true, force: true });
cpSync(join(root, 'public'), dist, { recursive: true });
cpSync(join(root, 'admin'), join(dist, 'admin'), { recursive: true });
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
  '/admin/*', '  Cache-Control: no-cache', '  X-Robots-Tag: noindex',
  // Static files (including the admin app) get the same security headers the Worker sets on its own responses.
  '/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: strict-origin-when-cross-origin', '  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  '  X-Frame-Options: DENY',
  '',
].join('\n'));
console.log(`dist/ built (geo ${version}, service worker ${swVersion})`);
