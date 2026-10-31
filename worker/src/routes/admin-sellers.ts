/**
 * Admin → Sellers: approve seller applications, set their commission, approve each seller product before it goes live
 * and each seller payment account before the shop pays into it.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { bad, HttpError, notFound, posInt, readJson, str } from '../lib/http';
import { listSellers, payoutById, productSeller, reviewPayout, reviewQueue, reviewSeller, sellerById, sellerPayouts, sellerProducts, setReview } from '../repo/sellers';
import { payoutView } from './seller';
import { sellerEmail } from '../services/email';
import { audit, need } from './admin-helpers';
import { loadAdminProduct, publishProduct, unpublishProduct } from './admin-catalog';

export const adminSellers = new Hono<AppEnv>();

adminSellers.get('/sellers', need('catalog:read'), async c => {
  const status = str(c.req.query('status'), 20);
  return c.json(await listSellers(c.env.DB, ['pending', 'approved', 'rejected', 'suspended'].includes(status) ? status : null));
});

adminSellers.get('/sellers/:id', need('catalog:read'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const s = await sellerById(c.env.DB, id);
  if (!s) throw notFound();
  const [products, payouts] = await Promise.all([sellerProducts(c.env.DB, id), sellerPayouts(c.env.DB, id)]);
  return c.json({ seller: s, products, payouts: payouts.map(payoutView) });
});

/** Approve or turn down a seller's payment account (bKash, Nagad, Rocket or bank). Only approved ones are paid into. */
adminSellers.post('/seller-payouts/:id/review', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const action = str(b.action, 20);
  if (action !== 'approve' && action !== 'reject') throw bad('Choose approve or not approve.');
  const note = str(b.note, 300) || null;
  if (action === 'reject' && !note) throw bad('Write why, so the seller knows what to fix.');
  const p = await payoutById(c.env.DB, id);
  if (!p) throw notFound('Account not found.');
  await reviewPayout(c.env.DB, id, action === 'approve' ? 'approved' : 'rejected', note, c.var.session.adminId);
  await audit(c, `seller_payout.${action}`, 'seller', p.seller_id, { payout: id, method: p.method, note });
  const owner = await sellerById(c.env.DB, p.seller_id);
  const label = `${p.method === 'bank' ? 'Bank account' : p.method === 'bkash' ? 'bKash' : p.method === 'nagad' ? 'Nagad' : 'Rocket'} ${p.account_number}`;
  if (owner) {
    await sellerEmail(c.env, owner.email, action === 'approve' ? `Payment account approved: ${label}` : `Payment account not approved: ${label}`,
      action === 'approve' ? 'Your payment account is approved' : 'Please check your payment account',
      action === 'approve' ? [`The shop will pay your earnings into ${label}.`] : [note!, 'Open the seller portal, fix it and add it again.'], { label: 'Open the seller portal', href: `${c.env.SITE_URL}/seller/` });
  }
  return c.json({ ok: true });
});

/** Approve, reject, pause or re-open a seller (with a note the seller sees), and set their commission. */
adminSellers.post('/sellers/:id/review', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const action = str(b.action, 20);
  const ACTIONS: Record<string, 'approved' | 'rejected' | 'suspended'> = { approve: 'approved', reject: 'rejected', suspend: 'suspended', reopen: 'approved' };
  const to = ACTIONS[action];
  if (!to) throw bad('Choose approve, reject or pause.');
  const note = str(b.note, 500) || null;
  if (to === 'rejected' && !note) throw bad('Write why, so the seller knows what to fix.');
  const commission = b.commissionPercent === undefined || b.commissionPercent === '' ? null : Number(b.commissionPercent);
  if (commission !== null && !(Number.isInteger(commission) && commission >= 0 && commission <= 90)) throw bad('Commission is a whole number from 0 to 90 (%).');
  const s = await sellerById(c.env.DB, id);
  if (!s) throw notFound();
  await reviewSeller(c.env.DB, id, { status: to, note, adminId: c.var.session.adminId, commission });
  if (to === 'suspended') {
    // A paused seller's products leave the shop until they are re-opened.
    for (const p of await sellerProducts(c.env.DB, id)) if (p.status === 'published') await unpublishProduct(c, Number(p.id));
  }
  await audit(c, `seller.${action}`, 'seller', id, { note, commission });
  const portal = `${c.env.SITE_URL}/seller/`;
  if (to === 'approved' && action === 'approve') await sellerEmail(c.env, s.email, 'Your seller account is approved', `Welcome, ${s.shop_name}!`, ['Your seller account is approved. Products you have sent are being checked now; each one shows in the shop once the shop approves it. Your payment account is used after it is approved too.'], { label: 'Open the seller portal', href: portal });
  if (to === 'rejected') await sellerEmail(c.env, s.email, 'About your seller application', 'Your application was not approved', [note!, 'You can reply to this email if you have questions.']);
  if (to === 'suspended') await sellerEmail(c.env, s.email, 'Your seller account is paused', 'Your seller account is paused', [note ?? 'Please contact the shop.']);
  return c.json({ ok: true });
});

/** Seller products waiting for approval. */
adminSellers.get('/seller-products', need('catalog:read'), async c => c.json(await reviewQueue(c.env.DB)));

/** Approves a seller product and puts it live (it must pass the same checklist as the shop's own products). */
adminSellers.post('/seller-products/:id/approve', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const p = await productSeller(c.env.DB, id);
  if (!p?.seller_id) throw notFound();
  const owner = await sellerById(c.env.DB, p.seller_id);
  if (owner?.status !== 'approved') throw new HttpError(409, `Approve the seller first: ${owner?.shop_name ?? 'this seller'} is not approved yet (Sellers tab).`);
  const r = await publishProduct(c, id, '');
  await setReview(c.env.DB, id, 'approved', null);
  await audit(c, 'seller_product.approve', 'product', id);
  const d = await loadAdminProduct(c, id);
  await sellerEmail(c.env, owner.email, `Approved: ${d.product.name}`, 'Your product is live', [`${String(d.product.name)} is approved and now shows in the shop.`], { label: 'See it in the shop', href: `${c.env.SITE_URL}/p/${d.product.slug}` });
  return c.json(r);
});

/** Sends a seller product back with what to change; a live one is taken off the shop. */
adminSellers.post('/seller-products/:id/reject', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const note = str((await readJson(c)).note, 500);
  if (!note) throw bad('Write what the seller should change.');
  const p = await productSeller(c.env.DB, id);
  if (!p?.seller_id) throw notFound();
  if (p.status === 'published' || p.status === 'scheduled') await unpublishProduct(c, id);
  await setReview(c.env.DB, id, 'rejected', note);
  await audit(c, 'seller_product.reject', 'product', id, { note });
  const owner = await sellerById(c.env.DB, p.seller_id);
  const d = await loadAdminProduct(c, id);
  if (owner) await sellerEmail(c.env, owner.email, `Changes needed: ${d.product.name}`, 'Please update your product', [note, 'Open the seller portal, make the change and send it for approval again.'], { label: 'Open the seller portal', href: `${c.env.SITE_URL}/seller/` });
  return c.json({ ok: true });
});
