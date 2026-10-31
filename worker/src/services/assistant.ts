/**
 * The AI helpers: the shop assistant in the customer chat, and the admin assistant that guides the team. Both run on
 * Cloudflare Workers AI (the `AI` binding, added to the Worker at deploy). Answers come only from the shop's own data
 * put into the prompt (products found for the question, delivery zones and charges, payment and return rules, or the
 * owner guide). Without the binding (local runs, tests), when it fails, or once the day's free allowance is used, the
 * built-in answers below reply instead, so the chat never breaks.
 */
import type { Env } from '../env';
import { formatTaka } from '../lib/money';
import { POLICIES } from '../lib/policies';
import { expandQuery } from '../lib/search';
import { queryProducts, suggestCategories, synonymGroups, zoneSummaries, type ProductCard } from '../repo/catalog';
import { settingInt } from '../repo/settings';

/** Google Gemma 4 on Workers AI: on the Workers Free plan, multilingual (Bangla and English), 256k context. */
export const AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

/** The last few turns of a conversation from the browser, trimmed and checked. */
export function cleanTurns(raw: unknown, max = 8): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns = raw
    .filter((t): t is ChatTurn => Boolean(t) && typeof t === 'object' && ['user', 'assistant'].includes((t as ChatTurn).role) && typeof (t as ChatTurn).content === 'string')
    .map(t => ({ role: t.role, content: t.content.replace(/\s+/g, ' ').trim().slice(0, 600) }))
    .filter(t => t.content)
    .slice(-max);
  // The conversation must end with the customer's question.
  return turns.length && turns[turns.length - 1].role === 'user' ? turns : [];
}

/**
 * One answer from the model, or null (no binding, an error, or the daily budget is used up). The budget is a rough
 * per-day counter in KV that keeps usage inside the free Workers AI allowance; the owner can change it in Settings.
 */
export async function askModel(env: Env, system: string, turns: ChatTurn[], o: { budgetKey: string; dailyLimit: number; maxTokens?: number }): Promise<string | null> {
  if (!env.AI || o.dailyLimit <= 0) return null;
  const day = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
  const key = `ai:${o.budgetKey}:${day}`;
  const used = Number((await env.KV.get(key)) ?? 0);
  if (used >= o.dailyLimit) return null;
  await env.KV.put(key, String(used + 1), { expirationTtl: 2 * 86_400 });
  try {
    const run = env.AI.run as unknown as (model: string, input: object) => Promise<{ response?: unknown; choices?: Array<{ message?: { content?: unknown } }> }>;
    const r = await run.call(env.AI, AI_MODEL, {
      messages: [{ role: 'system', content: system }, ...turns],
      max_tokens: o.maxTokens ?? 450,
      temperature: 0.3,
      chat_template_kwargs: { enable_thinking: false },
    });
    const text = typeof r?.response === 'string' ? r.response : r?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim().slice(0, 2000) : null;
  } catch (e) {
    console.warn('Workers AI failed', e instanceof Error ? e.message : e);
    return null;
  }
}

// ───────────── Customer chat ─────────────

export interface ShopFacts { store: string; text: string; products: ProductCard[]; zones: Array<{ name: string; eta_text: string; base_charge_paisa: number }> }

const tk = (paisa: number | null | undefined) => (paisa ? formatTaka(paisa) : null);

/** Everything the shop assistant may say: facts from settings and delivery zones, and the products matching the question. */
export async function shopFacts(db: D1Database, settings: Record<string, string>, question: string, activeSeason: string | null): Promise<ShopFacts> {
  const store = settings.store_name || 'Abs Vai';
  const terms = expandQuery(question, await synonymGroups(db));
  const [found, zones, cats] = await Promise.all([
    terms.length ? queryProducts(db, { terms, limit: 5, sort: 'best_selling' }) : Promise.resolve({ items: [] as ProductCard[], total: 0 }),
    zoneSummaries(db),
    terms.length ? suggestCategories(db, terms) : Promise.resolve([]),
  ]);
  const free = settingInt(settings, 'free_delivery_threshold_paisa', 0);
  const cod = settingInt(settings, 'cod_fee_paisa', 0);
  const lines = [
    `Shop: ${store}, an online shop in Bangladesh. Website pages: all products /shop, deals /deals, new arrivals /new, track an order /track, contact /contact.`,
    settings.support_phone ? `Phone: ${settings.support_phone}.` : '',
    settings.whatsapp_number ? `WhatsApp: +${settings.whatsapp_number} (the team answers there).` : '',
    'Payment: Cash on Delivery all over Bangladesh (pay the rider when the parcel arrives). Some pre-orders and large items need a small advance by bKash, Nagad or Rocket; the team tells the customer when they call to confirm.',
    `Delivery charges by area: ${zones.map(z => `${z.name} ${formatTaka(Number(z.base_charge_paisa))} (${z.eta_text})`).join('; ')}.${free ? ` Free delivery on orders over ${formatTaka(free)}.` : ''}${cod ? ` Cash on Delivery fee: ${formatTaka(cod)}.` : ''} Heavy or large items can cost more; the exact charge shows at checkout.`,
    'Orders: after ordering, the team calls the customer to confirm, then packs and sends it with the courier. Customers can track at /track with either their mobile number or their order number (one is enough).',
    `Returns: ${POLICIES.returns.body.join(' ')}`,
    activeSeason ? `In season now: ${activeSeason}.` : '',
    cats.length ? `Matching categories: ${cats.map(c => `${c.name} (/c/${c.slug})`).join(', ')}.` : '',
    found.items.length
      ? `Products matching the question (only these exist; use their exact names, prices and links):\n${found.items.map(p => `- ${p.name}: ${p.variantCount > 1 ? 'from ' : ''}${formatTaka(p.pricePaisa)}${tk(p.compareAtPaisa) ? ` (was ${tk(p.compareAtPaisa)})` : ''}; ${p.availability.label || p.availability.state}; link /p/${p.slug}${p.keySpecs ? `; ${p.keySpecs}` : ''}`).join('\n')}`
      : 'No product in the shop matches this question by name.',
  ];
  return { store, text: lines.filter(Boolean).join('\n'), products: found.items, zones };
}

export function shopSystemPrompt(f: ShopFacts): string {
  return `You are the friendly shop assistant on the ${f.store} website. Help customers find products and answer questions about delivery, payment, orders and returns.
Rules:
- Reply in the customer's language: Bangla if they write in Bangla (or Banglish), otherwise simple English.
- Keep it short: 1 to 4 sentences, or a short list. Be warm and polite.
- Use ONLY the facts below. Never invent products, prices, stock, discounts, delivery times or policies. If the answer is not in the facts, say you are not sure and suggest WhatsApp or a phone call.
- When you mention a product, give its link exactly as shown (for example /p/khejur-patali-gur).
- You cannot see or change orders. For an order's status send them to /track; to change or cancel an order, ask them to WhatsApp or call.
- Never ask for passwords, card numbers, PINs or SMS codes.
Facts:
${f.text}`;
}

const has = (q: string, re: RegExp) => re.test(q.toLowerCase());

/** The built-in reply when the AI is not available: simple keyword answers from the same facts. */
export function builtInShopReply(question: string, f: ShopFacts, settings: Record<string, string>): string {
  const zones = f.zones;
  const wa = settings.whatsapp_number ? ` You can also WhatsApp us at +${settings.whatsapp_number}.` : '';
  const free = settingInt(settings, 'free_delivery_threshold_paisa', 0);
  if (has(question, /deliver|shipping|charge|courier|days?\b|ডেলিভারি|চার্জ|কত দিন|কবে/)) {
    return `Delivery charges: ${zones.map(z => `${z.name} ${formatTaka(Number(z.base_charge_paisa))} (${z.eta_text})`).join(', ')}.${free ? ` Free delivery on orders over ${formatTaka(free)}.` : ''} The exact charge shows at checkout.`;
  }
  if (has(question, /cash|cod|pay|bkash|nagad|rocket|advance|টাকা|পেমেন্ট|বিকাশ|ক্যাশ/)) {
    return 'You can pay Cash on Delivery all over Bangladesh: pay the rider when the parcel arrives. A few pre-orders and large items need a small advance by bKash, Nagad or Rocket; we tell you when we call to confirm.';
  }
  if (has(question, /return|refund|exchange|damage|broken|ফেরত|রিটার্ন|বদল/)) return POLICIES.returns.body.slice(0, 2).join(' ');
  if (has(question, /track|status|where is|my order|order no|অর্ডার|কোথায়/)) return `You can track your order at /track: type your mobile number or your order number (either one).${wa}`;
  if (f.products.length) return `Here is what I found:\n${f.products.slice(0, 4).map(p => `- ${p.name}, ${p.variantCount > 1 ? 'from ' : ''}${formatTaka(p.pricePaisa)}: /p/${p.slug}`).join('\n')}`;
  if (has(question, /^(hi|hello|hey|salam|assalam|আসসালামু|হ্যালো|হাই)\b/)) return `Hello! I can help you find products and answer questions about delivery, payment and returns. What are you looking for?`;
  return `Sorry, I couldn't find that. Try a product name (for example "gur" or "masala"), or ask about delivery, payment or returns.${wa}`;
}

// ───────────── Admin assistant ─────────────

let guide: string | null = null;
/** docs/OWNER-GUIDE.md, copied to the static assets at build (dist/admin/guide.md); read once per isolate. */
export async function ownerGuide(assets: Fetcher | undefined): Promise<string> {
  if (guide !== null) return guide;
  try {
    const r = await assets?.fetch('https://assets.local/admin/guide.md');
    if (r?.ok) guide = await r.text();
  } catch { /* fall through */ }
  return guide ?? '';
}
/** For tests: use this guide text. */
export const setOwnerGuide = (text: string | null) => { guide = text; };

/** The owner guide split into sections, for the admin assistant (and its built-in search when the AI is off). */
export function guideSections(markdown: string): Array<{ title: string; body: string }> {
  return markdown.split(/\n(?=## )/).map(part => {
    const [head, ...rest] = part.split('\n');
    return { title: head.replace(/^#+\s*/, '').trim(), body: rest.join('\n').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim() };
  }).filter(s => s.title && s.body);
}

/** The guide sections that best match a question (by shared words), best first. */
export function matchGuide(sections: Array<{ title: string; body: string }>, question: string, n = 2) {
  const words = question.toLowerCase().match(/[a-zঀ-৿]{3,}/g) ?? [];
  const stop = new Set(['how', 'the', 'and', 'can', 'what', 'where', 'add', 'for', 'with', 'this', 'that', 'need', 'want', 'make', 'does', 'from', 'into', 'you', 'your', 'are']);
  const score = (s: { title: string; body: string }) => words.filter(w => !stop.has(w)).reduce((a, w) => a + (s.title.toLowerCase().includes(w) ? 5 : 0) + (s.body.toLowerCase().split(w).length - 1), 0);
  return sections.map(s => ({ s, v: score(s) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, n).map(x => x.s);
}

export function adminSystemPrompt(o: { store: string; role: string; page: string; guide: string; live: string }): string {
  return `You are the admin assistant for the ${o.store} online shop's admin dashboard. The person asking is a shop team member (role: ${o.role}) who is not technical. Guide them step by step.
Rules:
- Reply in their language: Bangla if they write in Bangla (or Banglish), otherwise simple English.
- Give numbered steps using the exact menu and button names from the guide (for example: Products → + Add product). Keep it short.
- Use only the guide and the live numbers below. If something is not in the guide, say so and suggest asking the developer; never invent features, menus or settings.
- You cannot click or change anything yourself. Never ask for or repeat passwords, API keys or secrets.
They are on the "${o.page}" page.
Live numbers: ${o.live}
Owner guide:
${o.guide}`;
}
