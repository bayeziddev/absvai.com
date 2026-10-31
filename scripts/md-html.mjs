// A small Markdown → HTML converter for the guides the build publishes (docs/ADMIN-GUIDE-BN.md → /admin/guide-bn.html).
// It handles what the guides use: headings, paragraphs, lists (one level of nesting), tables, quotes, bold, code and
// links. Everything is escaped first; links to the live address become relative, so the page works on any domain.

const LIVE = /^https:\/\/absvai\.absvai\.workers\.dev(?=\/)/;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const url = href.replace(/&amp;/g, '&').replace(LIVE, '');
    const safe = /^(https?:\/\/|\/|#|[\w.-]+\.(md|html)$)/.test(url) ? url : '#';
    return `<a href="${esc(safe)}">${label}</a>`;
  });
  return s;
}

const slug = (text, used) => {
  let base = text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
  let s = base;
  for (let i = 2; used.has(s); i++) s = `${base}-${i}`;
  used.add(s);
  return s;
};

export function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const toc = [];
  const used = new Set();
  let i = 0;
  const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const html = inline(h[2]);
      const id = slug(h[2], used);
      if (level === 2) toc.push({ id, html });
      out.push(`<h${level} id="${id}">${html}</h${level}>`);
      i++; continue;
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
    if (li.test(line)) {
      // A list, with items indented by two or more spaces under an item as a nested list.
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length) {
        const m = li.exec(lines[i]);
        if (m && m[1].length < 2) { items.push({ text: m[3], sub: [], subOrdered: false }); i++; continue; }
        if (m && items.length) { const last = items[items.length - 1]; last.subOrdered = /\d+\./.test(m[2]); last.sub.push(m[3]); i++; continue; }
        if (/^\s{2,}\S/.test(lines[i]) && items.length) { const last = items[items.length - 1]; if (last.sub.length) last.sub[last.sub.length - 1] += ` ${lines[i].trim()}`; else last.text += ` ${lines[i].trim()}`; i++; continue; }
        if (!lines[i].trim() && /^\s{2,}\S/.test(lines[i + 1] ?? '') && items.length) { i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(it => `<li>${inline(it.text)}${it.sub.length ? `<${it.subOrdered ? 'ol' : 'ul'}>${it.sub.map(x => `<li>${inline(x)}</li>`).join('')}</${it.subOrdered ? 'ol' : 'ul'}>` : ''}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||>|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim());
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    else i++;
  }
  return { html: out.join('\n'), toc };
}

/** A whole page: the guide with a table of contents, in the admin's look. */
export function guidePage(md, { title, lang = 'bn' }) {
  const { html, toc } = mdToHtml(md);
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/admin/admin.css">
<style>
body { background: var(--bg); }
.guide { max-width: 860px; margin: 0 auto; padding: 18px 16px 80px; line-height: 1.75; font-size: 1.05rem; font-family: Inter, 'Noto Sans Bengali', 'Hind Siliguri', 'Nirmala UI', 'Vrinda', system-ui, sans-serif; }
.guide th { font-size: .9rem; text-transform: none; letter-spacing: 0; color: var(--clove); }
.guide-top { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px; align-items: center; justify-content: space-between; padding: 10px 16px; background: #fff; border-bottom: 1px solid var(--line); }
.guide h1 { font-size: 1.6rem; line-height: 1.35; margin: 10px 0 12px; }
.guide h2 { margin: 34px 0 10px; padding-top: 8px; font-size: 1.3rem; scroll-margin-top: 64px; }
.guide h3 { margin: 20px 0 6px; font-size: 1.05rem; scroll-margin-top: 64px; }
.guide li { margin: 4px 0; }
.guide blockquote { margin: 14px 0; padding: 12px 14px; background: #FFFBEB; border-left: 4px solid var(--turmeric); border-radius: 8px; }
.guide .table-wrap { margin: 10px 0 16px; }
.guide td, .guide th { vertical-align: top; }
.guide code { background: var(--cream); padding: 1px 6px; border-radius: 6px; font-size: .9em; overflow-wrap: anywhere; }
.toc { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; margin: 14px 0 6px; }
.toc summary { font-weight: 700; cursor: pointer; }
.toc ol { columns: 2 240px; margin: 10px 0 0; padding-left: 22px; }
.top-link { position: fixed; right: 16px; bottom: 16px; z-index: 5; }
@media print { .guide-top, .top-link { display: none; } .guide { max-width: none; } }
</style>
</head>
<body>
<header class="guide-top"><a class="wordmark" href="/admin/">Abs<span>Vai</span><small>Admin</small></a><a class="btn btn-sm btn-outline" href="/admin/#/help">Help center</a></header>
<main class="guide">
${html.replace(/(<h1[^>]*>.*?<\/h1>)/, `$1\n<details class="toc" open><summary>সূচিপত্র</summary><ol>${toc.map(t => `<li><a href="#${t.id}">${t.html}</a></li>`).join('')}</ol></details>`)}
</main>
<a class="btn btn-sm btn-primary top-link" href="#">↑ উপরে</a>
</body>
</html>
`;
}
