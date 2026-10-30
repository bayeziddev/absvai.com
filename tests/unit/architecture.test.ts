/** Guard rails from the build prompt that are easy to break by accident. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const gz = (files: string[]) => files.reduce((n, f) => n + gzipSync(readFileSync(join(ROOT, f))).length, 0);

describe('architecture (Section 2)', () => {
  it('keeps all SQL in the repository layer (worker/src/repo)', () => {
    const offenders = walk(join(ROOT, 'worker/src'))
      .filter(f => /\.tsx?$/.test(f) && !f.includes(`${join('worker', 'src', 'repo')}`))
      .filter(f => /\.(prepare|batch|exec)\(|D1PreparedStatement/.test(readFileSync(f, 'utf8')))
      .map(f => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('does not reintroduce Redis, Laravel or a Next.js server', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter(d => /redis|ioredis|^next$|laravel/i.test(d))).toEqual([]);
  });
});

describe('JavaScript budgets (Section 2.3, gzipped)', () => {
  it('homepage and listings stay under 50 KB of JS', () => {
    expect(gz(['public/js/app.js', 'public/js/track.js'])).toBeLessThan(50 * 1024);
  });
  it('product pages stay under 100 KB of JS', () => {
    expect(gz(['public/js/app.js', 'public/js/track.js', 'public/js/product.js'])).toBeLessThan(100 * 1024);
  });
});
