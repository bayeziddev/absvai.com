/**
 * Content Security Policy generated from the enabled integrations (Section 19): third-party hosts are allowed only when
 * the owner has entered a valid ID for that integration. No inline scripts anywhere; speculation rules are allowed inline.
 */
import { TRACKING_FORMATS } from './settings-schema';

export function buildCsp(settings: Record<string, string> | undefined): string {
  const s = settings ?? {};
  const on = (k: keyof typeof TRACKING_FORMATS) => Boolean(s[k] && TRACKING_FORMATS[k].test(s[k]));
  const script = ["'self'", "'inline-speculation-rules'", 'https://challenges.cloudflare.com'];
  const connect = ["'self'"];
  const img = ["'self'", 'data:', 'blob:', 'https:'];
  const frame = ['https://www.youtube-nocookie.com', 'https://challenges.cloudflare.com'];
  if (on('pixel_id')) { script.push('https://connect.facebook.net'); connect.push('https://www.facebook.com', 'https://connect.facebook.net'); }
  if (on('ga4_id') || on('gtm_id')) {
    script.push('https://www.googletagmanager.com');
    connect.push('https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com');
  }
  if (on('gtm_id')) frame.push('https://www.googletagmanager.com');
  if (on('clarity_id')) { script.push('https://www.clarity.ms', 'https://*.clarity.ms'); connect.push('https://*.clarity.ms', 'https://c.bing.com'); }
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src ${img.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
    `frame-src ${frame.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
