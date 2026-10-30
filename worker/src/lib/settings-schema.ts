/**
 * Dynamic settings (Section 19): what the owner can change without code, how each value is validated, and which
 * values are secrets (encrypted at rest, masked after saving, Super Admin only).
 */
export type SettingGroup = 'store' | 'branding' | 'delivery' | 'payments' | 'sms' | 'tracking' | 'fraud' | 'incomplete' | 'couriers';

export interface SettingDef {
  key: string;
  group: SettingGroup;
  label: string;
  kind: 'text' | 'longtext' | 'paisa' | 'int' | 'bool' | 'json' | 'url' | 'secret';
  help?: string;
  /** Format check for IDs (never raw script). Returns an error message or null. */
  validate?: (v: string) => string | null;
}

const re = (pattern: RegExp, message: string) => (v: string) => (!v || pattern.test(v) ? null : message);

export const SOCIAL_NETWORKS = { facebook: 'Facebook page', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' } as const;
const SOCIAL_HOSTS: Record<string, RegExp> = {
  facebook: /^https:\/\/(www\.|m\.|web\.)?(facebook|fb)\.com\//, instagram: /^https:\/\/(www\.)?instagram\.com\//,
  youtube: /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//, tiktok: /^https:\/\/(www\.)?tiktok\.com\//,
};

/** Social links: plain https links to the four networks the footer shows. */
function validateSocial(v: string): string | null {
  const o = JSON.parse(v || '{}') as Record<string, unknown>;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'Social links are not valid.';
  for (const [k, x] of Object.entries(o)) {
    if (!(k in SOCIAL_HOSTS)) return `Unknown social network "${k}".`;
    if (x && (typeof x !== 'string' || !SOCIAL_HOSTS[k].test(x))) return `The ${SOCIAL_NETWORKS[k as keyof typeof SOCIAL_NETWORKS]} link should start with https:// and the ${k} address, e.g. https://www.${k === 'youtube' ? 'youtube' : k}.com/absvai`;
  }
  return null;
}

export const BANNER_THEMES = ['chili', 'turmeric', 'clove', 'leaf'] as const;
/** One banner: text fields, an uploaded or built-in picture, a link inside the store (or https), a known colour theme. */
export function bannerProblem(b: unknown, n: string): string | null {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return `${n} is not valid.`;
  const x = b as Record<string, unknown>;
  if (typeof x.headline !== 'string' || !x.headline.trim()) return `${n}: add a headline.`;
  for (const k of ['headline', 'subline', 'cta_text', 'kicker']) if (x[k] !== undefined && (typeof x[k] !== 'string' || (x[k] as string).length > 160)) return `${n}: the text is too long.`;
  if (x.image !== undefined && x.image !== '' && (typeof x.image !== 'string' || !/^(\/media\/b\/[\w-]+\.(png|jpg|webp)|\/img\/[\w/.-]+|https:\/\/\S+)$/.test(x.image))) return `${n}: upload the picture again.`;
  if (x.cta_href !== undefined && x.cta_href !== '' && (typeof x.cta_href !== 'string' || !/^(\/[\w/?=&.-]*|https:\/\/\S+)$/.test(x.cta_href))) return `${n}: the button link should be a page of the store (starting with /) or an https:// link.`;
  if (x.theme !== undefined && !(BANNER_THEMES as readonly unknown[]).includes(x.theme)) return `${n}: choose one of the colours.`;
  return null;
}
function validateBanners(v: string): string | null {
  const list = JSON.parse(v || '[]') as unknown;
  if (!Array.isArray(list)) return 'Banners are not valid.';
  if (list.length > 6) return 'Use at most 6 homepage banners.';
  for (const [i, b] of list.entries()) { const e = bannerProblem(b, `Banner ${i + 1}`); if (e) return e; }
  return null;
}
function validatePromo(v: string): string | null {
  const b = JSON.parse(v || 'null') as unknown;
  return b === null ? null : bannerProblem(b, 'The second banner');
}

export const TRACKING_FORMATS = {
  gtm_id: /^GTM-[A-Z0-9]{4,10}$/,
  pixel_id: /^\d{10,20}$/,
  ga4_id: /^G-[A-Z0-9]{6,14}$/,
  clarity_id: /^[a-z0-9]{8,14}$/,
};

export const SETTINGS: SettingDef[] = [
  { key: 'store_name', group: 'store', label: 'Store name', kind: 'text' },
  { key: 'tagline', group: 'store', label: 'Tagline', kind: 'text' },
  { key: 'announcement', group: 'store', label: 'Announcement bar', kind: 'text' },
  { key: 'support_phone', group: 'store', label: 'Support phone', kind: 'text' },
  { key: 'whatsapp_number', group: 'store', label: 'WhatsApp number', kind: 'text', validate: re(/^8801[3-9]\d{8}$/, 'WhatsApp number must look like 8801712345678.') },
  { key: 'messenger_page', group: 'store', label: 'Facebook page / Messenger username', kind: 'text', validate: re(/^[\w.-]{2,80}$/, 'Use the page username only, e.g. absvai.') },
  { key: 'social_links', group: 'store', label: 'Social links', kind: 'json', validate: validateSocial },
  { key: 'company_name', group: 'store', label: 'Company name (invoices)', kind: 'text' },
  { key: 'company_address', group: 'store', label: 'Company address (invoices)', kind: 'longtext' },
  { key: 'default_banners', group: 'store', label: 'Homepage banners', kind: 'json', validate: validateBanners },
  { key: 'promo_banner', group: 'store', label: 'Second banner', kind: 'json', validate: validatePromo },

  { key: 'brand_logo_url', group: 'branding', label: 'Logo', kind: 'url', validate: re(/^\/media\/brand\/[\w-]+\.(png|webp|svg|jpg)$/, 'Upload the logo here instead of pasting a link.') },
  { key: 'brand_colors', group: 'branding', label: 'Brand colours', kind: 'json' },

  { key: 'free_delivery_threshold_paisa', group: 'delivery', label: 'Free delivery from', kind: 'paisa' },
  { key: 'free_delivery_excludes_bulky', group: 'delivery', label: 'Free delivery excludes large items', kind: 'bool' },
  { key: 'cod_fee_paisa', group: 'delivery', label: 'Cash on Delivery fee', kind: 'paisa' },
  { key: 'map_tile_url', group: 'delivery', label: 'Map tile URL', kind: 'url', validate: re(/^https:\/\/[^\s]+\{z\}[^\s]*\{x\}[^\s]*\{y\}/, 'Map tile URL must be https and contain {z}, {x} and {y}.') },
  { key: 'map_tile_attribution', group: 'delivery', label: 'Map attribution', kind: 'text' },

  { key: 'manual_wallets', group: 'payments', label: 'bKash / Nagad / Rocket numbers for advances', kind: 'json' },
  { key: 'advance_high_value_threshold_paisa', group: 'payments', label: 'Advance for new customers above', kind: 'paisa' },

  { key: 'gtm_id', group: 'tracking', label: 'Google Tag Manager container ID', kind: 'text', help: 'Not loaded on cart, checkout or account pages.', validate: re(TRACKING_FORMATS.gtm_id, 'GTM IDs look like GTM-ABC1234.') },
  { key: 'pixel_id', group: 'tracking', label: 'Meta Pixel ID', kind: 'text', validate: re(TRACKING_FORMATS.pixel_id, 'A Meta Pixel ID is 10–20 digits.') },
  { key: 'ga4_id', group: 'tracking', label: 'GA4 measurement ID', kind: 'text', validate: re(TRACKING_FORMATS.ga4_id, 'GA4 IDs look like G-ABC123DEF4.') },
  { key: 'clarity_id', group: 'tracking', label: 'Microsoft Clarity project ID', kind: 'text', validate: re(TRACKING_FORMATS.clarity_id, 'Clarity project IDs are 8–14 lowercase letters and numbers.') },

  { key: 'order_interval_minutes', group: 'fraud', label: 'Hold a second order from the same phone or device within (minutes)', kind: 'int' },
  { key: 'velocity_max_orders_24h', group: 'fraud', label: 'Hold when a phone places more than this many orders in 24 hours', kind: 'int' },
  { key: 'otp_max_per_phone_hour', group: 'fraud', label: 'SMS codes per phone per hour', kind: 'int' },
  { key: 'otp_max_per_device_day', group: 'fraud', label: 'SMS codes per device per day', kind: 'int' },
  { key: 'otp_daily_cap', group: 'fraud', label: 'SMS codes per day for the whole store', kind: 'int' },

  { key: 'incomplete_conversion_window_hours', group: 'incomplete', label: 'Link an order to an incomplete checkout from the same phone within (hours)', kind: 'int' },
  { key: 'incomplete_retention_days', group: 'incomplete', label: 'Delete unconverted incomplete checkouts after (days)', kind: 'int' },
  { key: 'manual_discount_max_percent', group: 'incomplete', label: 'Largest discount a Sales Agent may give on a manual order (%)', kind: 'int' },

  // Secrets: encrypted with SETTINGS_KEY, masked after saving, Super Admin only. Used by the Phase 2 integrations.
  { key: 'sms_api_key', group: 'sms', label: 'SMS gateway API key', kind: 'secret' },
  { key: 'sms_sender_id', group: 'sms', label: 'SMS sender ID', kind: 'text', validate: re(/^[A-Za-z0-9 ]{3,11}$/, 'Sender IDs are 3–11 letters or numbers.') },
  { key: 'capi_access_token', group: 'tracking', label: 'Meta Conversions API access token', kind: 'secret' },
  { key: 'steadfast_api_key', group: 'couriers', label: 'Steadfast API key', kind: 'secret' },
  { key: 'steadfast_secret_key', group: 'couriers', label: 'Steadfast secret key', kind: 'secret' },
  { key: 'pathao_client_secret', group: 'couriers', label: 'Pathao client secret', kind: 'secret' },
  { key: 'redx_api_token', group: 'couriers', label: 'RedX API token', kind: 'secret' },
  { key: 'carrybee_api_token', group: 'couriers', label: 'Carrybee API token', kind: 'secret' },
  { key: 'bkash_app_secret', group: 'payments', label: 'bKash app secret', kind: 'secret' },
  { key: 'sslcommerz_store_password', group: 'payments', label: 'SSLCommerz store password', kind: 'secret' },
];

export const SETTING_BY_KEY = new Map(SETTINGS.map(s => [s.key, s]));
export const SECRET_KEYS = new Set(SETTINGS.filter(s => s.kind === 'secret').map(s => s.key));

/** Changing one of these changes what every cached page shows. */
export const SITEWIDE_KEYS = new Set(['store_name', 'tagline', 'announcement', 'support_phone', 'whatsapp_number', 'messenger_page', 'social_links',
  'brand_logo_url', 'brand_colors', 'gtm_id', 'pixel_id', 'ga4_id', 'clarity_id', 'free_delivery_threshold_paisa', 'default_banners', 'promo_banner']);

export function validateSetting(def: SettingDef, value: string): string | null {
  switch (def.kind) {
    case 'paisa':
    case 'int':
      if (!/^\d{1,9}$/.test(value)) return `${def.label} must be a whole number.`;
      break;
    case 'bool':
      if (!['0', '1'].includes(value)) return `${def.label} must be on or off.`;
      break;
    case 'json':
      try { JSON.parse(value || 'null'); } catch { return `${def.label} is not valid.`; }
      break;
  }
  return def.validate ? def.validate(value) : null;
}

// ───────────── Brand colours with an automatic contrast check ─────────────

export const DEFAULT_COLORS = { chili: '#B3261E', turmeric: '#F2B705', cream: '#FFF8EC', leaf: '#2E7D32', clove: '#2A1F1A', husk: '#E9DCC6' };
export type BrandColors = typeof DEFAULT_COLORS;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Text/background pairs the storefront uses. Each must reach WCAG AA (4.5:1). */
export function contrastWarnings(c: BrandColors): string[] {
  const pairs: Array<[string, string, string]> = [
    ['White text on chili buttons', '#FFFFFF', c.chili],
    ['Clove text on turmeric badges', c.clove, c.turmeric],
    ['Clove text on the cream page', c.clove, c.cream],
    ['White text on leaf chips', '#FFFFFF', c.leaf],
    ['Chili prices on the cream page', c.chili, c.cream],
  ];
  return pairs.filter(([, fg, bg]) => contrastRatio(fg, bg) < 4.5).map(([what, fg, bg]) => `${what} would be hard to read (${contrastRatio(fg, bg).toFixed(1)}:1, needs 4.5:1).`);
}

export function parseBrandColors(raw: unknown): BrandColors {
  const out = { ...DEFAULT_COLORS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(DEFAULT_COLORS) as Array<keyof BrandColors>) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out[k] = v.toUpperCase();
    }
  }
  return out;
}
