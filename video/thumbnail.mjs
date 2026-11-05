// The YouTube thumbnail (1280×720), drawn as a page and photographed: node video/thumbnail.mjs video/work
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser } from '../tests/e2e/server.mjs';

const WORK = resolve(process.argv[2] ?? 'video/work');
const A = `file://${WORK}/guide/assets`;
const face = (w, sub, range) => `@font-face{font-family:'Hind Siliguri';font-weight:${w};src:url(${A}/fonts/hind-siliguri-${sub}-${w}-normal.woff2);unicode-range:${range}}`;
const fonts = [600, 700].flatMap(w => [face(w, 'bengali', 'U+0980-09FF,U+200C-200D,U+25CC'), face(w, 'latin', 'U+0000-00FF,U+2013-2014,U+2192')]).join('');
const html = `<!doctype html><html lang="bn"><head><meta charset="utf-8"><style>${fonts}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1280px;height:720px;overflow:hidden;font-family:'Hind Siliguri',sans-serif;position:relative;
  background:radial-gradient(900px 600px at 0% 0%,rgba(255,120,0,.35),transparent 60%),radial-gradient(700px 500px at 100% 100%,rgba(46,125,50,.25),transparent 60%),linear-gradient(160deg,#2A1F1A,#120D0A)}
.wm{position:absolute;left:56px;top:46px;font:800 64px/1 'Poppins','Hind Siliguri',sans-serif;color:#FFF8EC;letter-spacing:-.02em}.wm b{color:#FF7800}
.h{position:absolute;left:52px;top:140px;width:640px;font:700 104px/1.12 'Hind Siliguri';color:#FFF8EC}.h span{color:#FFB347}
.s{position:absolute;left:56px;top:392px;width:560px;font:600 40px/1.38 'Hind Siliguri';color:rgba(255,248,236,.92)}
.tag{position:absolute;left:56px;top:560px;display:flex;gap:14px}
.tag i{font-style:normal;padding:10px 22px;border-radius:999px;background:#FF7800;color:#fff;font:700 30px/1.2 'Hind Siliguri'}.tag i.g{background:#25D366}
.desk{position:absolute;left:640px;top:120px;width:720px;border-radius:14px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.6);transform:rotate(-4deg);border:6px solid #fff}
.desk img,.phone img{display:block;width:100%}
.phone{position:absolute;left:1000px;top:300px;width:230px;border-radius:30px;overflow:hidden;border:8px solid #0E0B09;box-shadow:0 30px 70px rgba(0,0,0,.7);transform:rotate(5deg)}
.ring{position:absolute;left:640px;top:95px;width:120px;height:120px;border-radius:50%;background:linear-gradient(135deg,#FF7800,#B3261E);color:#fff;font:700 30px/1.1 'Hind Siliguri';display:flex;align-items:center;justify-content:center;text-align:center;box-shadow:0 14px 40px rgba(255,120,0,.5);transform:rotate(-8deg);z-index:3}
.ch{position:absolute;right:28px;top:24px;z-index:4;display:flex;align-items:center;gap:10px;padding:8px 18px 8px 10px;border-radius:999px;background:rgba(21,16,13,.85);font:500 24px/1 'Poppins',sans-serif;color:#FFF8EC}
.ch i{width:34px;height:24px;border-radius:7px;background:#FF0033;position:relative}.ch i::after{content:"";position:absolute;left:13px;top:6px;border-style:solid;border-width:6px 0 6px 10px;border-color:transparent transparent transparent #fff}
.ch b{color:#FF9A3C;font-weight:800}
</style></head><body>
<div class="wm">Vandar<b>Mart</b></div>
<div class="h">সম্পূর্ণ <span>গাইড</span></div>
<div class="s">ওয়েবসাইট ও অ্যাডমিন<br>ড্যাশবোর্ড, ধাপে ধাপে বাংলায়</div>
<div class="tag"><i>অর্ডার</i><i class="g">WhatsApp</i><i>ডেলিভারি</i></div>
<div class="desk"><img src="${A}/shots/a-order-wa.png"></div>
<div class="phone"><img src="${A}/shots/m-checkout-2.png"></div>
<div class="ring">বাংলা<br>গাইড</div>
<div class="ch"><i></i>connect with <b>Bayezid</b></div>
</body></html>`;
mkdirSync(`${WORK}/out`, { recursive: true });
writeFileSync(`${WORK}/out/thumbnail.html`, html);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`file://${WORK}/out/thumbnail.html`);
await page.waitForTimeout(800);
await page.screenshot({ path: `${WORK}/out/VandarMart-thumbnail.png` });
await browser.close();
console.log('thumbnail', `${WORK}/out/VandarMart-thumbnail.png`);
