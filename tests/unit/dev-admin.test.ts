/**
 * The developer support account (scripts/ensure-dev-admin.mjs) is created at deploy time by a Node script, but its
 * password must be readable by the Worker's own login. This checks the Node hash uses the exact same PBKDF2 scheme as
 * worker/src/lib/auth.ts, so an account provisioned from the GitHub secret can actually sign in.
 */
import { describe, expect, it } from 'vitest';
import { verifyPassword } from '../../worker/src/lib/auth';
// @ts-expect-error plain ES module without types
import { hashPassword, passwordProblem } from '../../scripts/ensure-dev-admin.mjs';

describe('developer support account', () => {
  it('hashes a password the Worker login accepts', async () => {
    const stored = hashPassword('Support pass 42');
    expect(stored).toMatch(/^pbkdf2_sha256\$100000\$/);
    expect(await verifyPassword('Support pass 42', stored)).toBe(true);
    expect(await verifyPassword('the wrong one 7', stored)).toBe(false);
  });

  it('refuses the same weak passwords the admin does', () => {
    expect(passwordProblem('short1')).toBeTruthy();
    expect(passwordProblem('letters only here')).toBeTruthy();
    expect(passwordProblem('Good pass 12')).toBeNull();
  });
});
