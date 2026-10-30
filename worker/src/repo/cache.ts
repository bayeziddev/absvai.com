/** Edge-cache purge queue. One row per tag, so bulk edits collapse into a single batched purge. */
export async function queuePurgeTags(db: D1Database, tags: string[]): Promise<void> {
  const unique = [...new Set(tags)];
  if (!unique.length) return;
  await db.batch(unique.map(t => db.prepare('INSERT INTO cache_purges (tag) VALUES (?) ON CONFLICT(tag) DO NOTHING').bind(t)));
}

export async function pendingPurgeTags(db: D1Database, limit: number): Promise<string[]> {
  return (await db.prepare('SELECT tag FROM cache_purges ORDER BY requested_at LIMIT ?').bind(limit).all<{ tag: string }>()).results.map(r => r.tag);
}

export async function clearPurgeTags(db: D1Database, tags: string[]): Promise<void> {
  if (!tags.length) return;
  await db.prepare(`DELETE FROM cache_purges WHERE tag IN (${tags.map(() => '?').join(',')})`).bind(...tags).run();
}

export async function failPurgeTags(db: D1Database, tags: string[]): Promise<void> {
  if (!tags.length) return;
  await db.prepare(`UPDATE cache_purges SET attempts = attempts + 1 WHERE tag IN (${tags.map(() => '?').join(',')})`).bind(...tags).run();
}

export async function purgeBacklog(db: D1Database): Promise<number> {
  return Number((await db.prepare('SELECT COUNT(*) AS n FROM cache_purges').first<{ n: number }>())?.n ?? 0);
}
