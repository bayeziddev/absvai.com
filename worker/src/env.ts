import type { Session } from './lib/auth';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  SITE_URL: string;
  ENVIRONMENT: string;
  SETUP_TOKEN?: string;
  OTP_PEPPER?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  SMS_PROVIDER?: string;
  SMS_API_KEY?: string;
}

export type AppEnv = { Bindings: Env; Variables: { session: Session; settings: Record<string, string> } };
