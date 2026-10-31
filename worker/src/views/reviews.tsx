/** Customer reviews: the rating summary, the published reviews and the "Write a review" form (product and landing pages). */
import { formatDate } from '../lib/dates';

export interface ReviewSummary {
  items: Array<{ id: number; name: string; rating: number; body: string | null; verified: boolean; reply: string | null; created_at: string }>;
  count: number; average: number; stars: number[];
}

export function Stars({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return <span class="stars" role="img" aria-label={label ?? `${value} out of 5 stars`}><span class="stars-on" style={`width:${pct}%`}>★★★★★</span>★★★★★</span>;
}

/** "★ 4.8 (12 reviews)" next to the product name; links to the reviews. */
export function RatingLine({ s }: { s: ReviewSummary }) {
  if (!s.count) return null;
  return <a class="rating-line" href="#reviews"><Stars value={s.average} /> <b>{s.average.toFixed(1)}</b> <span class="muted">({s.count} review{s.count === 1 ? '' : 's'})</span></a>;
}

export function ReviewsSection(p: { productId: number; s: ReviewSummary; canWrite: boolean; title?: string; extra?: Array<{ name: string; place: string; rating: number; text: string; image: string | null }> }) {
  const extra = p.extra ?? [];
  const total = p.s.count;
  return (
    <section class="section reviews" id="reviews" aria-labelledby="reviews-title">
      <h2 class="brush-title" id="reviews-title"><span>{p.title ?? 'Customer reviews'}</span></h2>
      {total > 0 && (
        <div class="rev-summary">
          <div class="rev-score"><b>{p.s.average.toFixed(1)}</b><Stars value={p.s.average} /><span class="muted">{total} review{total === 1 ? '' : 's'}</span></div>
          <ul class="rev-bars">{[5, 4, 3, 2, 1].map(n => (
            <li><span>{n} ★</span><span class="rev-bar"><span style={`width:${total ? Math.round((p.s.stars[n - 1] / total) * 100) : 0}%`} /></span><span class="muted">{p.s.stars[n - 1]}</span></li>
          ))}</ul>
        </div>
      )}
      {(extra.length > 0 || p.s.items.length > 0) ? (
        <div class="rev-list">
          {extra.map(r => (
            <article class="rev-item">
              <header>{r.image && <img src={r.image} alt="" width="44" height="44" loading="lazy" />}<div><b>{r.name}</b>{r.place && <span class="muted"> · {r.place}</span>}<br /><Stars value={r.rating} /></div></header>
              <p>{r.text}</p>
            </article>
          ))}
          {p.s.items.map(r => (
            <article class="rev-item">
              <header><div><b>{r.name}</b>{r.verified && <span class="rev-verified">✓ Verified buyer</span>}<br /><Stars value={r.rating} /> <span class="muted small">{formatDate(r.created_at)}</span></div></header>
              {r.body && <p>{r.body}</p>}
              {r.reply && <p class="rev-reply"><b>Reply from the shop:</b> {r.reply}</p>}
            </article>
          ))}
        </div>
      ) : <p class="muted">No reviews yet. Bought it? Be the first to review it.</p>}
      {p.canWrite && (
        <details class="rev-write">
          <summary class="btn btn-outline">Write a review</summary>
          <form class="card-box rev-form" data-review-form data-product={String(p.productId)} novalidate>
            <fieldset class="rev-rate"><legend>Your rating</legend>
              {[5, 4, 3, 2, 1].map(n => <><input type="radio" name="rating" id={`rate-${p.productId}-${n}`} value={String(n)} checked={n === 5} /><label for={`rate-${p.productId}-${n}`} title={`${n} star${n === 1 ? '' : 's'}`}>★</label></>)}
            </fieldset>
            <label class="field"><span>Your name</span><input name="name" maxlength={60} required autocomplete="name" /></label>
            <label class="field"><span>Mobile number you ordered with <small class="muted">(not shown; buyers get a “Verified buyer” badge)</small></span><input name="phone" type="tel" inputmode="numeric" maxlength={14} required placeholder="01XXXXXXXXX" autocomplete="tel" /></label>
            <label class="field"><span>Your review</span><textarea name="body" rows={4} maxlength={1000} required placeholder="How was the quality, the taste, the delivery?" /></label>
            <label class="hp" aria-hidden="true">Website<input name="website" tabindex={-1} autocomplete="off" /></label>
            <button class="btn btn-primary" type="submit">Send review</button>
            <p class="form-msg" data-msg aria-live="polite" />
          </form>
        </details>
      )}
    </section>
  );
}
