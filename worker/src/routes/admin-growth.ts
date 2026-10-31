/**
 * Admin → Marketing tools: landing pages, coupons and reviews, and the sales report.
 * Landing pages and coupons change what customers see and pay, so they need catalog:write; the report needs
 * reports:read, and product cost/profit only shows to roles with cost:read (owner and accountant).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { TAG } from '../lib/cache-tags';
import { bad, int, notFound, posInt, readJson, str } from '../lib/http';
import { cleanLanding, landingSlug } from '../lib/landing';
import { maskPhone } from '../lib/phone';
import { couponById, deleteUnusedCoupon, listCoupons, saveCoupon, setCouponActive, type CouponInput } from '../repo/coupons';
import { deleteLanding, landingById, landingSlugTaken, listLanding, saveLanding } from '../repo/landing';
import { salesReport } from '../repo/reports';
import { addReview, deleteReview, listReviews, reviewById, reviewCounts, setReviewReply, setReviewStatus } from '../repo/reviews';
import { productExists } from '../repo/catalog';
import { loadSettings, saveSettings } from '../repo/settings';
import { COUPON_KINDS, normalizeCode } from '../services/coupons';
import { allowed, audit, need, refresh } from './admin-helpers';

export const adminGrowth = new Hono<AppEnv>();

// ───────────── Landing pages ─────────────

adminGrowth.get('/landing-pages', need('catalog:read'), async c => c.json(await listLanding(c.env.DB)));

adminGrowth.get('/landing-pages/:id', need('catalog:read'), async c => {
  const l = await landingById(c.env.DB, posInt(c.req.param('id')) ?? 0);
  if (!l) throw notFound('Landing page not found.');
  return c.json({ ...l, content: cleanLanding(JSON.parse(l.blocks || '{}')).content });
});

async function saveLandingPage(c: import('hono').Context<AppEnv>, id: number | null) {
  const b = await readJson(c);
  const title = str(b.title, 120);
  if (title.length < 2) throw bad('Give the page a name (for example “Khejur gur winter offer”).');
  const productId = posInt(b.productId);
  if (!productId || !(await productExists(c.env.DB, productId))) throw bad('Choose the product this page sells.');
  const slug = landingSlug(str(b.slug, 80) || title) || `offer-${Date.now().toString(36)}`;
  if (await landingSlugTaken(c.env.DB, slug, id)) throw bad(`Another page already uses the address /lp/${slug}. Change the page address.`);
  const { content, problems } = cleanLanding(b.content);
  if (problems.length) throw bad(problems[0]);
  const status = b.status === 'published' ? 'published' : 'draft';
  if (status === 'published' && !content.headline) throw bad('Write the headline before publishing the page.');
  if (id && !(await landingById(c.env.DB, id))) throw notFound('Landing page not found.');
  const saved = await saveLanding(c.env.DB, id, { slug, title, status, productId, blocks: JSON.stringify(content) });
  await audit(c, id ? 'landing.update' : 'landing.create', 'landing_page', saved, { slug, status });
  await refresh(c, [TAG.landing(saved)]);
  return c.json({ ok: true, id: saved, slug, url: `/lp/${slug}` }, id ? 200 : 201);
}
adminGrowth.post('/landing-pages', need('catalog:write'), c => saveLandingPage(c, null));
adminGrowth.put('/landing-pages/:id', need('catalog:write'), c => saveLandingPage(c, posInt(c.req.param('id'))));

/** A copy of a page to start a new offer from (as a draft with its own address). */
adminGrowth.post('/landing-pages/:id/copy', need('catalog:write'), async c => {
  const l = await landingById(c.env.DB, posInt(c.req.param('id')) ?? 0);
  if (!l || !l.product_id) throw notFound('Landing page not found.');
  let slug = `${l.slug}-copy`;
  for (let i = 2; await landingSlugTaken(c.env.DB, slug, null); i++) slug = `${l.slug}-copy-${i}`;
  const id = await saveLanding(c.env.DB, null, { slug, title: `${l.title} (copy)`, status: 'draft', productId: l.product_id, blocks: l.blocks });
  await audit(c, 'landing.copy', 'landing_page', id, { from: l.id });
  return c.json({ ok: true, id, slug }, 201);
});

adminGrowth.delete('/landing-pages/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  if (!(await landingById(c.env.DB, id))) throw notFound('Landing page not found.');
  await deleteLanding(c.env.DB, id);
  await audit(c, 'landing.delete', 'landing_page', id);
  await refresh(c, [TAG.landing(id)]);
  return c.json({ ok: true });
});

// ───────────── Coupons ─────────────

adminGrowth.get('/coupons', need('catalog:read'), async c => c.json(await listCoupons(c.env.DB)));

/** BD calendar day → the UTC instant it starts (or ends). */
const dayStart = (d: string) => new Date(Date.parse(`${d}T00:00:00+06:00`)).toISOString();
const dayEnd = (d: string) => new Date(Date.parse(`${d}T00:00:00+06:00`) + 86_400_000 - 1).toISOString();
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

function readCoupon(b: Record<string, unknown>): CouponInput {
  const code = normalizeCode(b.code);
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw bad('The code needs 3 to 30 letters or numbers, for example EID100 or WINTER20.');
  const kind = str(b.kind, 20) as CouponInput['kind'];
  if (!COUPON_KINDS.includes(kind)) throw bad('Choose the coupon type: percent off, taka off or free delivery.');
  const value = int(b.value) ?? 0;
  if (kind === 'percent' && !(value >= 1 && value <= 90)) throw bad('A percentage coupon takes 1 to 90 % off.');
  if (kind === 'fixed' && value < 100) throw bad('Type how many taka the coupon takes off.');
  const money = (k: string) => { const n = int(b[k]); if (n !== null && n < 0) throw bad('Amounts cannot be negative.'); return n; };
  const count = (k: string) => { const n = int(b[k]); if (n !== null && n < 1) throw bad('Limits are 1 or more (leave empty for no limit).'); return n; };
  const starts = str(b.startsOn, 10);
  const ends = str(b.endsOn, 10);
  if ((starts && !isDay(starts)) || (ends && !isDay(ends))) throw bad('Pick the dates from the calendar.');
  if (starts && ends && ends < starts) throw bad('The end date is before the start date.');
  return {
    code, kind, value: kind === 'free_delivery' ? 0 : value, minSubtotalPaisa: money('minSubtotalPaisa') ?? 0, maxDiscountPaisa: kind === 'percent' ? money('maxDiscountPaisa') : null,
    startsAt: starts ? dayStart(starts) : null, endsAt: ends ? dayEnd(ends) : null, usageLimit: count('usageLimit'), perPhoneLimit: count('perPhoneLimit'),
    isActive: b.isActive !== false, note: str(b.note, 200) || null,
  };
}

async function saveCouponRoute(c: import('hono').Context<AppEnv>, id: number | null) {
  const input = readCoupon(await readJson(c));
  if (id && !(await couponById(c.env.DB, id))) throw notFound('Coupon not found.');
  let saved: number;
  try { saved = await saveCoupon(c.env.DB, id, input); } catch { throw bad(`The code ${input.code} is already used by another coupon.`); }
  await audit(c, id ? 'coupon.update' : 'coupon.create', 'coupon', saved, input);
  return c.json({ ok: true, id: saved }, id ? 200 : 201);
}
adminGrowth.post('/coupons', need('catalog:write'), c => saveCouponRoute(c, null));
adminGrowth.put('/coupons/:id', need('catalog:write'), c => saveCouponRoute(c, posInt(c.req.param('id'))));

adminGrowth.post('/coupons/:id/active', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  if (!(await couponById(c.env.DB, id))) throw notFound('Coupon not found.');
  const on = (await readJson(c)).active !== false;
  await setCouponActive(c.env.DB, id, on);
  await audit(c, on ? 'coupon.on' : 'coupon.off', 'coupon', id);
  return c.json({ ok: true });
});

adminGrowth.delete('/coupons/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  if (!(await couponById(c.env.DB, id))) throw notFound('Coupon not found.');
  if (!(await deleteUnusedCoupon(c.env.DB, id))) {
    await setCouponActive(c.env.DB, id, false);
    return c.json({ ok: true, switchedOff: true, message: 'This coupon was already used, so it is switched off instead (its sales stay in the report).' });
  }
  await audit(c, 'coupon.delete', 'coupon', id);
  return c.json({ ok: true });
});

// ───────────── Reviews ─────────────

adminGrowth.get('/reviews', need('catalog:read'), async c => {
  const status = str(c.req.query('status'), 20);
  const [rows, counts, s] = await Promise.all([listReviews(c.env.DB, ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending'), reviewCounts(c.env.DB), loadSettings(c.env.DB)]);
  return c.json({
    reviews: rows.map(r => ({ ...r, phone: r.phone ? maskPhone(r.phone) : null })), counts,
    settings: { enabled: s.reviews_enabled !== '0', autoPublishVerified: s.reviews_auto_publish_verified === '1' },
  });
});

adminGrowth.put('/reviews/settings', need('catalog:write'), async c => {
  const b = await readJson(c);
  await saveSettings(c.env.DB, { reviews_enabled: b.enabled === false ? '0' : '1', reviews_auto_publish_verified: b.autoPublishVerified ? '1' : '0' });
  await audit(c, 'reviews.settings', 'settings', null, b);
  await refresh(c, [TAG.site]);
  return c.json({ ok: true });
});

adminGrowth.post('/reviews/:id/status', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const r = await reviewById(c.env.DB, id);
  if (!r) throw notFound('Review not found.');
  const status = str((await readJson(c)).status, 20);
  if (status !== 'approved' && status !== 'rejected') throw bad('Choose publish or hide.');
  await setReviewStatus(c.env.DB, id, status);
  await audit(c, `review.${status}`, 'review', id);
  await refresh(c, [TAG.product(r.product_id)]);
  return c.json({ ok: true });
});

adminGrowth.post('/reviews/:id/reply', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const r = await reviewById(c.env.DB, id);
  if (!r) throw notFound('Review not found.');
  const reply = str((await readJson(c)).reply, 600) || null;
  await setReviewReply(c.env.DB, id, reply);
  await audit(c, 'review.reply', 'review', id);
  await refresh(c, [TAG.product(r.product_id)]);
  return c.json({ ok: true });
});

adminGrowth.delete('/reviews/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const r = await reviewById(c.env.DB, id);
  if (!r) throw notFound('Review not found.');
  await deleteReview(c.env.DB, id);
  await audit(c, 'review.delete', 'review', id);
  await refresh(c, [TAG.product(r.product_id)]);
  return c.json({ ok: true });
});

/** A review the shop adds itself (a customer wrote it on Facebook or WhatsApp). Published at once, never "verified". */
adminGrowth.post('/reviews', need('catalog:write'), async c => {
  const b = await readJson(c);
  const productId = posInt(b.productId);
  if (!productId || !(await productExists(c.env.DB, productId))) throw bad('Choose the product.');
  const name = str(b.name, 60);
  const body = str(b.body, 1000);
  const rating = int(b.rating) ?? 0;
  if (name.length < 2) throw bad('Type the customer’s name.');
  if (!(rating >= 1 && rating <= 5)) throw bad('Choose 1 to 5 stars.');
  if (body.length < 3) throw bad('Type what the customer said.');
  const id = await addReview(c.env.DB, { productId, name, rating, body, phone: null, verified: false, status: 'approved', source: 'shop', ipHash: null, orderId: null });
  await audit(c, 'review.add', 'review', id, { productId });
  await refresh(c, [TAG.product(productId)]);
  return c.json({ ok: true, id }, 201);
});

// ───────────── Sales report ─────────────

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (Bangladesh days, both included; at most a year). */
adminGrowth.get('/reports/sales', need('reports:read'), async c => {
  const from = str(c.req.query('from'), 10);
  const to = str(c.req.query('to'), 10);
  if (!isDay(from) || !isDay(to)) throw bad('Choose the dates.');
  if (to < from) throw bad('The end date is before the start date.');
  const start = dayStart(from);
  const end = new Date(Date.parse(`${to}T00:00:00+06:00`) + 86_400_000).toISOString();
  if (Date.parse(end) - Date.parse(start) > 367 * 86_400_000) throw bad('Choose at most one year at a time.');
  const withCost = allowed(c, 'cost:read');
  return c.json({ from, to, withCost, ...(await salesReport(c.env.DB, start, end, withCost)) });
});
