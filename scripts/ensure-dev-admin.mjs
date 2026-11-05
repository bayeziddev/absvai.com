#!/usr/bin/env node
/**
 * Keeps the developer's support (break-glass) admin account in step with two GitHub secrets, on every deploy.
 *
 * This is a normal Super Admin account, not a hidden one: it shows in the admin under Staff & roles like any other,
 * and the shop owner is told it exists. Its password lives only in the GitHub secret and, hashed, in the database —
 * never in the code, the logs or anywhere it can be read back. Re-running is safe: the account is created once and its
 * password refreshed to match the secret.
 *
 * Secrets (GitHub → Settings → Secrets and variables → Actions). With neither set, this does nothing.
 *   DEV_ADMIN_EMAIL     the support account's email
 *   DEV_ADMIN_PASSWORD  its password (at least 10 characters, with a letter and a number)
 *   DEV_ADMIN_NAME      optional display name (default below)
 *
 * It never creates the FIRST admin: while the store has no admins, it steps aside so the shop owner's one-time setup
 * token still opens the first-run screen and the owner picks their own password. Once the owner's account exists, the
 * next deploy adds (or repairs) this support account beside it.
 *
 * Run in the deploy job, where the Cloudflare credentials and `wrangler` are already set up:
 *   node scripts/ensure-dev-admin.mjs
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';

const ITERATIONS = 100_000; // must match worker/src/lib/auth.ts

/** The exact format worker/src/lib/auth.ts verifies: pbkdf2_sha256$<iterations>$<base64 salt>$<base64 hash>. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2_sha256$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Same rule as the admin's own password check (worker/src/lib/auth.ts passwordProblem). */
export function passwordProblem(pw) {
  if (pw.length < 10) return 'the password must be at least 10 characters';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'the password must have letters and at least one number';
  return null;
}

const sql = s => `'${String(s).replace(/'/g, "''")}'`;

/** A note for the deploy summary and the log. This step never fails the deploy, so a problem is a warning, not an error. */
function note(message) {
  console.log(`Developer support account: ${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Developer support account: ${message}\n`); } catch { /* summary is best-effort */ } }
}

function d1(args, opts = {}) {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--remote', '-c', 'worker/wrangler.toml', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function adminCount() {
  const out = d1(['--json', '--command', 'SELECT COUNT(*) AS n FROM admins']);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results[0].n;
}

async function main() {
  const email = (process.env.DEV_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.DEV_ADMIN_PASSWORD || '';
  const name = (process.env.DEV_ADMIN_NAME || 'Developer support (Bayezid)').trim();
  // Nothing set: the account is simply not in use.
  if (!email && !password) { note('not configured (set DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD to enable). Nothing to do.'); return; }
  // Anything misconfigured only skips THIS account; it must never block the shop's deploy, so these are warnings.
  if (!email || !password) return note('⚠️ set BOTH DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD, or neither — skipped for now.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return note('⚠️ DEV_ADMIN_EMAIL is not a valid email — skipped for now.');
  const problem = passwordProblem(password);
  if (problem) return note(`⚠️ ${problem} (DEV_ADMIN_PASSWORD). Choose a stronger password and re-deploy; the account was not changed. The password itself is never printed.`);

  let count;
  try {
    count = adminCount();
  } catch (e) {
    return note(`⚠️ could not read the database (${e.message}); skipped, the deploy continues.`);
  }
  if (count === 0) {
    note('the store has no admin yet, so the shop owner can still use the one-time setup token to create the first account. This account will be added on the next deploy after that.');
    return;
  }

  // Create once, then only refresh the password/role so the account is restored to full access if it was changed.
  const id = crypto.randomUUID();
  const statement =
    `INSERT INTO admins (id, email, name, role, password_hash, is_active, on_duty) ` +
    `VALUES (${sql(id)}, ${sql(email)}, ${sql(name)}, 'super_admin', ${sql(hashPassword(password))}, 1, 1) ` +
    `ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, role = 'super_admin', is_active = 1;`;
  const dir = mkdtempSync(join(tmpdir(), 'dev-admin-'));
  const file = join(dir, 'dev-admin.sql');
  try {
    writeFileSync(file, statement); // the file holds only the hash, never the password
    d1(['--file', file], { stdio: 'inherit' });
    note(`ready: ${email} (Super Admin). It appears in the admin under Staff & roles.`);
  } catch (e) {
    note(`⚠️ could not write to the database (${e.message}); skipped, the deploy continues.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Run when invoked directly (node scripts/ensure-dev-admin.mjs); importing it for tests does not run it.
if (process.argv[1] && process.argv[1].endsWith('ensure-dev-admin.mjs')) {
  // Never fail the deploy over the optional support account.
  main().catch(e => note(`⚠️ skipped (${e.message}); the deploy continues.`));
}
