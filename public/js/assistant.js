// Shop assistant in the chat popup. Loaded only when a customer opens it. The conversation stays in this browser
// tab (sessionStorage) so it survives moving between pages; nothing is saved on the server.
import { api, esc, small, taka } from './app.js';

const KEY = 'absvai.assistant';
const $ = s => document.querySelector(s);
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) ?? []; } catch { return []; } };
const save = turns => { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-16))); } catch { /* private mode */ } };

// Plain text only; shop links (/p/…, /c/…, /track…) become tappable, nothing else is turned into HTML.
const format = text => esc(text)
  .replace(/(^|\s)(\/(?:p|c|track|shop|deals|new|contact|season)(?:\/[\w-]+)?)(?=[\s.,!?)]|$)/g, (_, pre, path) => `${pre}<a href="${path}">${path.startsWith('/p/') ? 'View product' : path}</a>`)
  .replace(/\n/g, '<br>');

let started = false;

export function openAssistant() {
  $('[data-chat-menu]').hidden = true;
  $('[data-chat-box]').hidden = false;
  $('[data-chat]').classList.add('chatting');
  const log = $('[data-chat-log]');
  const form = $('[data-chat-form]');
  const input = form.q;
  if (!started) {
    started = true;
    const turns = load();
    if (!turns.length) bubble(log, 'assistant', 'Hi! I’m the shop assistant. Ask me about any product, delivery charges, Cash on Delivery or returns. বাংলায়ও জিজ্ঞেস করতে পারেন।');
    for (const t of turns) bubble(log, t.role, t.content, t.products);
    $('[data-chat-back]').addEventListener('click', () => { $('[data-chat-box]').hidden = true; $('[data-chat-menu]').hidden = false; $('[data-chat]').classList.remove('chatting'); });
    $('[data-chat-chips]').addEventListener('click', e => { if (e.target.matches('button')) ask(e.target.textContent); });
    form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  }
  setTimeout(() => input.focus(), 50);

  async function ask(q) {
    const text = q.trim();
    if (!text) return;
    input.value = '';
    $('[data-chat-chips]').hidden = true;
    const turns = load();
    turns.push({ role: 'user', content: text });
    save(turns);
    bubble(log, 'user', text);
    const typing = bubble(log, 'assistant typing', '<span></span><span></span><span></span>', null, true);
    form.querySelector('button').disabled = true;
    try {
      const r = await api('/api/assistant', { messages: turns.map(({ role, content }) => ({ role, content })) });
      typing.remove();
      bubble(log, 'assistant', r.reply, r.products);
      turns.push({ role: 'assistant', content: r.reply, products: r.products });
      save(turns);
    } catch (err) {
      typing.remove();
      bubble(log, 'assistant', err.message || 'Sorry, something went wrong. Please try again, or WhatsApp us.');
    } finally {
      form.querySelector('button').disabled = false;
    }
  }
}

function bubble(log, role, content, products, raw = false) {
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  el.innerHTML = `<div class="chat-bubble">${raw ? content : format(content)}</div>${products?.length ? `<div class="chat-products">${products.map(p => `<a href="/p/${esc(p.slug)}"><img src="${esc(small(p.image))}" alt="" width="44" height="44" loading="lazy"><span>${esc(p.name)}<b>${taka(p.pricePaisa)}</b></span></a>`).join('')}</div>` : ''}`;
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
