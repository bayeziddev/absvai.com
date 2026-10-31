/**
 * Staff authentication. Workers has no native Argon2/bcrypt, so passwords use PBKDF2-SHA256 through WebCrypto
 * at 100,000 iterations (the Workers maximum) with a per-password random salt.
 * Sessions are random tokens stored in KV; the cookie is HttpOnly, Secure, SameSite=Strict.
 */
export type Role = 'super_admin' | 'manager' | 'order_processor' | 'warehouse' | 'accountant' | 'viewer' | 'seller';

export const ROLES: Role[] = ['super_admin', 'manager', 'order_processor', 'warehouse', 'accountant', 'viewer'];
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Owner / Super Admin',
  manager: 'Manager',
  order_processor: 'Sales Agent',
  warehouse: 'Warehouse',
  accountant: 'Accountant',
  viewer: 'Viewer',
  seller: 'Seller (marketplace)',
};

const ITERATIONS = 100_000;
const enc = new TextEncoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => { const bin = atob(s); const out = new Uint8Array(new ArrayBuffer(bin.length)); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2_sha256$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2_sha256' || !iter || !saltB64 || !hashB64) return false;
  const actual = await pbkdf2(password, unb64(saltB64), Number(iter));
  const expected = unb64(hashB64);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number.';
  return null;
}

/**
 * What each role may do. Enforced on the server for every admin route.
 * Field-level rules: `cost:read` (cost price, stock value, profit) is Owner/Accountant only; `secrets:write`
 * (payment, SMS, courier and CAPI credentials) is Super Admin only and is granted only through '*'.
 */
const PERMISSIONS: Record<Role, string[]> = {
  super_admin: ['*'],
  manager: ['dashboard', 'orders:read', 'orders:write', 'orders:export', 'orders:discount', 'catalog:read', 'catalog:write', 'seasons:write', 'customers:read', 'geo:write',
    'settings:read', 'settings:write', 'security:read', 'security:write', 'inventory:write', 'audit:read', 'reports:read'],
  order_processor: ['dashboard', 'orders:read', 'orders:write', 'catalog:read', 'customers:read', 'settings:read', 'security:read'],
  warehouse: ['dashboard', 'orders:read', 'orders:pack', 'catalog:read', 'inventory:write', 'settings:read'],
  accountant: ['dashboard', 'orders:read', 'orders:export', 'catalog:read', 'customers:read', 'settings:read', 'cost:read', 'reports:read', 'audit:read'],
  viewer: ['dashboard', 'orders:read', 'catalog:read', 'customers:read', 'settings:read', 'reports:read'],
  // Marketplace sellers never use the admin API: they have their own portal, limited to their own products.
  seller: [],
};

export function can(role: Role, permission: string): boolean {
  const p = PERMISSIONS[role] ?? [];
  return p.includes('*') || p.includes(permission);
}

export interface Session { adminId: string; role: Role; name: string; email: string; csrf: string }

export const SESSION_COOKIE = '__Host-absvai_admin';
export const SESSION_TTL_SECONDS = 60 * 60 * 12;
