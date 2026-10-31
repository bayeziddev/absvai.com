/**
 * Every browser script (storefront, admin, seller portal) must parse: one syntax error, like a name declared twice,
 * stops the whole admin app from loading. esbuild (the same parser the build minifies with) checks each file without
 * running it. `node --check` is not enough: it skips files that use `import`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const files = ['public/js', 'public/seller', 'admin/js', 'admin/js/views']
  .flatMap(dir => readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.js')).map(f => `${dir}/${f}`));

describe('browser scripts', () => {
  it('finds the scripts', () => expect(files.length).toBeGreaterThan(20));

  it.each(files)('%s parses', f => {
    expect(() => transformSync(readFileSync(join(ROOT, f), 'utf8'), { loader: 'js', format: 'esm', sourcefile: f })).not.toThrow();
  });

  it('catches a name declared twice (the mistake this test is for)', () => {
    expect(() => transformSync('export function f() { const open = 1; const open = 2; return open; }', { loader: 'js', format: 'esm' })).toThrow(/already been declared/);
  });
});
