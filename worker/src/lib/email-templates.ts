/**
 * Email bodies (HTML with inline styles, which is what email apps understand, plus a plain-text copy). One simple
 * layout for every email: the shop name on top, a white card, the shop's contact line at the bottom.
 */
import { formatTaka } from './money';

const h = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const C = { chili: '#B3261E', ink: '#2A1F1A', muted: '#6B5A4E', line: '#EDE3D3', cream: '#FFF8EC' };

export interface Mail { subject: string; html: string; text: string }
export interface ShopInfo { store: string; siteUrl: string; phone?: string; whatsapp?: string; company?: string; address?: string }

export interface OrderView {
  orderNo: string; invoiceNo: string | null; name: string; phone: string; email: string | null; address: string; note: string | null;
  items: Array<{ name: string; variantLabel: string; qty: number; linePaisa: number }>;
  subtotalPaisa: number; deliveryPaisa: number; codFeePaisa: number; discountPaisa: number; totalPaisa: number;
  payment: string; eta: string | null; courier: string | null; trackingId: string | null; holdReason: string | null; source: string;
  createdAt: string; trackUrl: string; adminUrl: string;
}

function layout(shop: ShopInfo, title: string, body: string, footerNote = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)}</title></head>
<body style="margin:0;padding:0;background:${C.cream};font-family:Arial,Helvetica,sans-serif;color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 14px;font:800 24px Arial,Helvetica,sans-serif;letter-spacing:-.5px"><a href="${h(shop.siteUrl)}" style="color:${C.ink};text-decoration:none">${h(shop.store)}</a></td></tr>
<tr><td style="background:#ffffff;border-radius:14px;padding:24px;border:1px solid ${C.line}">${body}</td></tr>
<tr><td style="padding:16px 4px;font-size:12px;line-height:1.5;color:${C.muted}">${footerNote}${[shop.phone && `Call ${h(shop.phone)}`, shop.whatsapp && `WhatsApp +${h(shop.whatsapp)}`].filter(Boolean).join(' · ')}<br>${h(shop.company ?? shop.store)}${shop.address ? `, ${h(shop.address)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) => `<a href="${h(href)}" style="display:inline-block;background:${C.chili};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;margin-top:8px">${h(label)}</a>`;
const p = (t: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${t}</p>`;
const heading = (t: string) => `<h1 style="margin:0 0 10px;font:800 22px Arial,Helvetica,sans-serif;line-height:1.25">${h(t)}</h1>`;

function itemsTable(o: OrderView): string {
  const row = (a: string, b: string, strong = false) => `<tr><td style="padding:6px 0;font-size:14px;${strong ? 'font-weight:700;' : ''}">${a}</td><td align="right" style="padding:6px 0;font-size:14px;white-space:nowrap;${strong ? 'font-weight:700;' : ''}">${b}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line};border-bottom:1px solid ${C.line};margin:12px 0">
${o.items.map(i => row(`${h(i.name)}${i.variantLabel ? ` <span style="color:${C.muted}">· ${h(i.variantLabel)}</span>` : ''} × ${i.qty}`, formatTaka(i.linePaisa))).join('')}
${row('Subtotal', formatTaka(o.subtotalPaisa))}
${row('Delivery', o.deliveryPaisa ? formatTaka(o.deliveryPaisa) : 'Free')}
${o.codFeePaisa ? row('Cash on Delivery fee', formatTaka(o.codFeePaisa)) : ''}
${o.discountPaisa ? row('Discount', `−${formatTaka(o.discountPaisa)}`) : ''}
${row('Total', formatTaka(o.totalPaisa), true)}
</table>`;
}

const itemsText = (o: OrderView) => [...o.items.map(i => `- ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} x ${i.qty}: ${formatTaka(i.linePaisa)}`),
  `Subtotal: ${formatTaka(o.subtotalPaisa)}`, `Delivery: ${o.deliveryPaisa ? formatTaka(o.deliveryPaisa) : 'Free'}`,
  ...(o.codFeePaisa ? [`Cash on Delivery fee: ${formatTaka(o.codFeePaisa)}`] : []), ...(o.discountPaisa ? [`Discount: -${formatTaka(o.discountPaisa)}`] : []),
  `Total: ${formatTaka(o.totalPaisa)}`].join('\n');

const addressBlock = (o: OrderView) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:${C.muted}"><b style="color:${C.ink}">Delivery to</b><br>${h(o.name)} · ${h(o.phone)}<br>${h(o.address)}</p>`;

// ───────────── To the owner ─────────────

export function ownerNewOrder(shop: ShopInfo, o: OrderView): Mail {
  const held = o.holdReason ? `<p style="margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#FDECEA;font-size:14px"><b>On hold:</b> ${h(o.holdReason)}</p>` : '';
  return {
    subject: `${o.holdReason ? 'On hold · ' : ''}New order ${o.orderNo} · ${formatTaka(o.totalPaisa)} · ${o.name}`,
    html: layout(shop, 'New order', `${heading(`New order ${o.orderNo}`)}${held}${p(`${h(o.name)} ordered ${o.items.reduce((a, i) => a + i.qty, 0)} item(s) for <b>${formatTaka(o.totalPaisa)}</b> (${h(o.payment)}, from ${h(o.source)}).`)}
      ${itemsTable(o)}${addressBlock(o)}${o.email ? p(`Email: ${h(o.email)}`) : ''}${o.note ? p(`Note: ${h(o.note)}`) : ''}${button(o.adminUrl, 'Open the order')}`),
    text: `New order ${o.orderNo}\n${o.holdReason ? `ON HOLD: ${o.holdReason}\n` : ''}${o.name}, ${o.phone}\n${o.address}\n\n${itemsText(o)}\nPayment: ${o.payment}\n\nOpen: ${o.adminUrl}`,
  };
}

const UPDATE_LABEL: Record<string, string> = { cancelled: 'was cancelled', returned: 'is coming back (returned)', delivered: 'was delivered', partial_delivered: 'was partly delivered' };

export function ownerUpdate(shop: ShopInfo, o: OrderView, status: string, reason: string | null): Mail {
  const what = UPDATE_LABEL[status] ?? `moved to ${status}`;
  return {
    subject: `Order ${o.orderNo} ${what} · ${formatTaka(o.totalPaisa)}`,
    html: layout(shop, 'Order update', `${heading(`Order ${o.orderNo} ${what}`)}${p(`${h(o.name)} · ${h(o.phone)} · ${formatTaka(o.totalPaisa)}`)}${reason ? p(`Reason: ${h(reason)}`) : ''}${button(o.adminUrl, 'Open the order')}`),
    text: `Order ${o.orderNo} ${what}\n${o.name}, ${o.phone}, ${formatTaka(o.totalPaisa)}${reason ? `\nReason: ${reason}` : ''}\n\nOpen: ${o.adminUrl}`,
  };
}

export function ownerDaily(shop: ShopInfo, day: string, n: { orders: number; revenuePaisa: number; delivered: number; returned: number; incomplete: number }, attention: string[], adminUrl: string): Mail {
  const li = attention.map(a => `<li style="margin:0 0 6px">${h(a)}</li>`).join('');
  return {
    subject: `${shop.store} daily summary · ${day}: ${n.orders} order(s), ${formatTaka(n.revenuePaisa)}`,
    html: layout(shop, 'Daily summary', `${heading(`Yesterday (${day})`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 14px"><tr>
      ${[['Orders', String(n.orders)], ['Sales', formatTaka(n.revenuePaisa)], ['Delivered', String(n.delivered)], ['Returned', String(n.returned)]].map(([k, v]) => `<td style="padding:10px;border:1px solid ${C.line};border-radius:10px;text-align:center"><div style="font-size:12px;color:${C.muted}">${k}</div><div style="font:800 18px Arial">${v}</div></td>`).join('<td width="6"></td>')}
      </tr></table>
      ${n.incomplete ? p(`${n.incomplete} customer(s) started checkout but did not finish. Call them from Incomplete orders.`) : ''}
      ${attention.length ? `<p style="margin:0 0 6px;font-weight:700">Needs your attention</p><ul style="margin:0 0 12px;padding-left:18px;font-size:14px;line-height:1.5">${li}</ul>` : p('Nothing is waiting for you. 🎉')}
      ${button(adminUrl, 'Open the admin')}`),
    text: `Yesterday (${day}): ${n.orders} order(s), ${formatTaka(n.revenuePaisa)}; delivered ${n.delivered}, returned ${n.returned}; incomplete checkouts ${n.incomplete}.\n${attention.map(a => `- ${a}`).join('\n')}\n\n${adminUrl}`,
  };
}

export function ownerInquiry(shop: ShopInfo, kind: string, fields: Array<[string, string]>, adminUrl: string): Mail {
  return {
    subject: `New ${kind} from ${fields.find(([k]) => k === 'Name')?.[1] ?? 'a customer'}`,
    html: layout(shop, kind, `${heading(`New ${kind}`)}${fields.map(([k, v]) => p(`<b>${h(k)}:</b> ${h(v)}`)).join('')}${button(adminUrl, 'Open the admin')}`),
    text: `New ${kind}\n${fields.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${adminUrl}`,
  };
}

export function testMail(shop: ShopInfo): Mail {
  return {
    subject: `Test email from ${shop.store}`,
    html: layout(shop, 'Test', `${heading('Email is working ✅')}${p('This is a test from your shop. New orders, order updates and the daily summary will arrive at this address.')}`),
    text: 'Email is working. New orders, order updates and the daily summary will arrive at this address.',
  };
}

// ───────────── To the customer ─────────────

export function customerReceipt(shop: ShopInfo, o: OrderView): Mail {
  return {
    subject: `We got your order ${o.orderNo} · ${shop.store}`,
    html: layout(shop, 'Order received', `${heading(`Thank you, ${o.name.split(' ')[0]}!`)}${p(`We received your order <b>${h(o.orderNo)}</b>. We will call you on ${h(o.phone)} to confirm it, then send it with the courier.${o.eta ? ` Delivery usually takes ${h(o.eta)}.` : ''}`)}
      ${itemsTable(o)}${p(`Payment: ${h(o.payment)}`)}${addressBlock(o)}${button(o.trackUrl, 'Track your order')}`,
      'Please check your parcel in front of the delivery person before you pay. '),
    text: `Thank you! We received your order ${o.orderNo}. We will call you on ${o.phone} to confirm it.\n\n${itemsText(o)}\nPayment: ${o.payment}\nDelivery to: ${o.address}\n\nTrack: ${o.trackUrl}`,
  };
}

export function customerInvoice(shop: ShopInfo, o: OrderView): Mail {
  const no = o.invoiceNo ?? o.orderNo;
  return {
    subject: `Invoice ${no} for your order ${o.orderNo} · ${shop.store}`,
    html: layout(shop, `Invoice ${no}`, `<p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;color:${C.muted}">INVOICE</p>${heading(no)}
      ${p(`Order ${h(o.orderNo)} · ${h(o.createdAt.slice(0, 10))}<br>Your order is confirmed and will be packed soon.`)}
      ${itemsTable(o)}${p(`Payment: ${h(o.payment)}`)}${addressBlock(o)}${button(o.trackUrl, 'Track your order')}`),
    text: `Invoice ${no} for order ${o.orderNo}\nYour order is confirmed.\n\n${itemsText(o)}\nPayment: ${o.payment}\nDelivery to: ${o.address}\n\nTrack: ${o.trackUrl}`,
  };
}

export function customerShipped(shop: ShopInfo, o: OrderView): Mail {
  return {
    subject: `Your order ${o.orderNo} is on the way 🚚`,
    html: layout(shop, 'On the way', `${heading('Your order is on the way')}${p(`Order <b>${h(o.orderNo)}</b> is with ${h(o.courier ?? 'our delivery team')}${o.trackingId ? ` (tracking ID <b>${h(o.trackingId)}</b>)` : ''}. Please keep your phone nearby; the rider will call before delivery.`)}
      ${p(`Amount to pay on delivery: <b>${formatTaka(o.totalPaisa)}</b>`)}${button(o.trackUrl, 'Track your order')}`, 'Please check your parcel in front of the delivery person before you pay. '),
    text: `Your order ${o.orderNo} is on the way with ${o.courier ?? 'our delivery team'}${o.trackingId ? ` (tracking ID ${o.trackingId})` : ''}.\nTrack: ${o.trackUrl}`,
  };
}

export function customerDelivered(shop: ShopInfo, o: OrderView): Mail {
  return {
    subject: `Delivered: order ${o.orderNo}. Thank you!`,
    html: layout(shop, 'Delivered', `${heading('Delivered. Thank you! 💛')}${p(`Order <b>${h(o.orderNo)}</b> has been delivered. If anything is wrong, reply to this email or call us within 24 hours.`)}${button(shop.siteUrl, 'Shop again')}`),
    text: `Order ${o.orderNo} has been delivered. Thank you! If anything is wrong, reply or call us within 24 hours.`,
  };
}

export function offerMail(shop: ShopInfo, m: { subject: string; message: string; ctaText: string; ctaHref: string }, unsubscribeUrl: string): Mail {
  return {
    subject: m.subject,
    html: layout(shop, m.subject, `${heading(m.subject)}${m.message.split(/\n{2,}/).map(par => p(h(par).replace(/\n/g, '<br>'))).join('')}${m.ctaText ? button(m.ctaHref, m.ctaText) : ''}`,
      `You get this because you asked for offers by email. <a href="${h(unsubscribeUrl)}" style="color:${C.muted}">Unsubscribe</a><br>`),
    text: `${m.subject}\n\n${m.message}\n\n${m.ctaText ? `${m.ctaText}: ${m.ctaHref}\n\n` : ''}Unsubscribe: ${unsubscribeUrl}`,
  };
}
