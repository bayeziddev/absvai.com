import type { Session } from './lib/auth';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  /** Photos, logo, manuals. Missing until R2 is switched on for the Cloudflare account; uploads then say so. */
  MEDIA?: R2Bucket;
  ASSETS: Fetcher;
  SITE_URL: string;
  ENVIRONMENT: string;
  SETUP_TOKEN?: string;
  OTP_PEPPER?: string;
  /** HMAC key for checkout tokens and the salt for device/IP/phone hashes. */
  SIGNING_KEY?: string;
  /** 32 random bytes (base64) that encrypt settings secrets with AES-GCM. */
  SETTINGS_KEY?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  SMS_PROVIDER?: string;
  SMS_API_KEY?: string;
}

export type AppEnv = { Bindings: Env; Variables: { session: Session; settings: Record<string, string> } };
