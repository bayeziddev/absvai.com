/**
 * The Bangla admin guide (docs/ADMIN-GUIDE-BN.md → /admin/guide-bn.html): it converts cleanly, its links work on any
 * domain, and every admin page it links to exists in the admin's routes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without types
import { guidePage, inline, mdToHtml } from '../../scripts/md-html.mjs';

const ROOT = join(__dirname, '../..');
const md = readFileSync(join(ROOT, 'docs/ADMIN-GUIDE-BN.md'), 'utf8');
const routesJs = readFileSync(join(ROOT, 'admin/js/routes.js'), 'utf8');
const routeNames = new Set(routesJs.slice(routesJs.indexOf('export const routes')).match(/[a-z]+/g) ?? []);

describe('Bangla admin guide', () => {
  const { html, toc } = mdToHtml(md);

  it('has the sections, tables and lists', () => {
    expect(toc.length).toBeGreaterThan(20);
    expect(toc.map((t: { html: string }) => t.html)).toEqual(expect.arrayContaining(['সরাসরি লিংক (এক নজরে)', 'সেলার (মার্কেটপ্লেস)', 'কাস্টমার যেভাবে অর্ডার ট্র্যাক করেন', 'সেটিংস']));
    expect(html.match(/<table>/g)!.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('<ol><li>');
    expect(html).toContain('<b>Approve seller</b>');
    expect(toc[0].id).toBe('সরাসরি-লিংক-এক-নজরে');
  });

  it('links to the live site as relative links, so they work on absvai.com too', () => {
    expect(html).not.toContain('absvai.absvai.workers.dev/admin');
    expect(html).toContain('<a href="/admin/#/orders?status=new">');
    expect(html).toContain('<a href="/track">/track</a>');
  });

  it('every admin page it links to exists', () => {
    const linked = [...new Set([...md.matchAll(/\/admin\/#\/([a-z]+)/g)].map(m => m[1]))];
    expect(linked.length).toBeGreaterThan(15);
    for (const r of linked) expect(routeNames, `#/${r}`).toContain(r);
    expect(linked).not.toContain('geo');
  });

  it('escapes HTML and refuses script links', () => {
    expect(inline('<script>alert(1)</script> **bold** `code`')).toBe('&lt;script&gt;alert(1)&lt;/script&gt; <b>bold</b> <code>code</code>');
    expect(inline('[x](javascript:alert)')).toBe('<a href="#">x</a>');
    expect(inline('[x](data:text/html,hi)')).toBe('<a href="#">x</a>');
  });

  it('makes a whole page with a table of contents', () => {
    const page = guidePage(md, { title: 'বাংলা গাইড' });
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<html lang="bn">');
    expect(page).toContain('<summary>সূচিপত্র</summary>');
    expect(page).not.toMatch(/<script/);
  });
});

describe('Bangla photo and website sections guide', () => {
  const photoMd = readFileSync(join(ROOT, 'docs/PHOTO-GUIDE-BN.md'), 'utf8');
  const { html, toc } = mdToHtml(photoMd);

  it('covers every place a picture goes, the homepage sections, the steps, tips, problems and a checklist', () => {
    expect(toc.map((t: { html: string }) => t.html)).toEqual(expect.arrayContaining(['১. এক নজরে: কোন ছবি কোন মাপে', '২. হোমপেইজে উপর থেকে নিচে কী আছে', '৪. ধাপে ধাপে: কীভাবে ছবি দেবেন', '৭. ছবি দেওয়ার আগে চেকলিস্ট']));
    for (const place of ['বড় ব্যানার', 'ক্যাটাগরির গোল ছবি', 'প্রোডাক্টের ছবি', 'দ্বিতীয় ব্যানার', 'পপআপ', 'লোগো', 'ল্যান্ডিং পেইজ']) expect(html).toContain(place);
    // The sizes it recommends are the ones the site is built for (lib/images.ts).
    expect(photoMd).toContain('২০০০ × ৮৬০');
    expect(photoMd).toContain('১০০০ × ১০০০');
  });

  it('links to admin pages that exist, as relative links', () => {
    const linked = [...new Set([...photoMd.matchAll(/\/admin\/#\/([a-z]+)/g)].map(m => m[1]))];
    expect(linked.length).toBeGreaterThan(5);
    for (const r of linked) expect(routeNames, `#/${r}`).toContain(r);
    expect(html).not.toContain('absvai.absvai.workers.dev/admin');
  });

  it('labels every table cell, so tables read as cards on phones', () => {
    expect(html).toContain('<td data-label="কোথায় দেখায়">');
    expect(html).toContain('<td data-label="কোথা থেকে বদলাবেন">');
    expect(html).not.toMatch(/<td>/);
    expect(guidePage(photoMd, { title: 'ছবি গাইড' })).toContain('td[data-label]');
  });
});
