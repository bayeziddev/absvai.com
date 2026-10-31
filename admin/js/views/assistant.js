// Admin assistant: answers "how do I…?" for the team from the owner guide and the shop's live numbers. The
// conversation stays in this browser tab only.
import { api, esc } from '../app.js';

const KEY = 'absvai.admin.assistant';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) ?? []; } catch { return []; } };
const save = t => { try { sessionStorage.setItem(KEY, JSON.stringify(t.slice(-16))); } catch { /* private mode */ } };
const ASK = ['How do I add a product?', 'How do I change the homepage banner?', 'How do I send an order to the courier?', 'Which orders need me today?'];

// Plain text, with admin links (#/orders…) and **bold** turned into HTML; nothing else.
const format = t => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(#\/[\w/?=&-]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');

let built = false;

export function toggleAssistant() {
  const panel = document.getElementById('ai-panel');
  const fab = document.getElementById('ai-fab');
  if (!built) build(panel);
  panel.hidden = !panel.hidden;
  fab.setAttribute('aria-expanded', String(!panel.hidden));
  fab.classList.toggle('open', !panel.hidden);
  if (!panel.hidden) panel.querySelector('input').focus();
}

function build(panel) {
  built = true;
  panel.innerHTML = `<header><b>Assistant</b><span class="small muted">Ask how to do anything in the admin</span><button class="icon-btn" type="button" data-x aria-label="Close">×</button></header>
    <div class="ai-log" aria-live="polite"></div>
    <div class="ai-chips">${ASK.map(q => `<button type="button">${esc(q)}</button>`).join('')}</div>
    <form class="ai-form"><input name="q" maxlength="400" autocomplete="off" placeholder="Ask in English or বাংলা…" aria-label="Your question"><button class="btn btn-primary" type="submit">Ask</button></form>`;
  const log = panel.querySelector('.ai-log');
  const turns = load();
  if (!turns.length) add(log, 'assistant', 'Hi! I can guide you step by step: adding products and categories, banners, orders and couriers, seasons, settings. What would you like to do?');
  for (const t of turns) add(log, t.role, t.content, t.sections);
  panel.querySelector('[data-x]').onclick = () => toggleAssistant();
  panel.querySelector('.ai-chips').addEventListener('click', e => { if (e.target.matches('button')) ask(e.target.textContent); });
  const form = panel.querySelector('form');
  form.addEventListener('submit', e => { e.preventDefault(); ask(form.q.value); });

  async function ask(q) {
    const text = q.trim();
    if (!text) return;
    form.q.value = '';
    panel.querySelector('.ai-chips').hidden = true;
    const all = load();
    all.push({ role: 'user', content: text });
    save(all);
    add(log, 'user', text);
    const wait = add(log, 'assistant', 'Thinking…');
    form.querySelector('button').disabled = true;
    try {
      const page = document.querySelector('.nav a.active span')?.textContent ?? (location.hash.slice(2).split('?')[0] || 'dashboard');
      const r = await api('/assistant', 'POST', { messages: all.map(({ role, content }) => ({ role, content })), page });
      wait.remove();
      add(log, 'assistant', r.reply, r.sections);
      all.push({ role: 'assistant', content: r.reply, sections: r.sections });
      save(all);
    } catch (err) { wait.remove(); add(log, 'assistant', err.message); } finally { form.querySelector('button').disabled = false; }
  }
}

function add(log, role, content, sections) {
  const el = document.createElement('div');
  el.className = `ai-msg ${role}`;
  el.innerHTML = `<div class="ai-bubble">${format(content)}</div>${(sections ?? []).map(s => `<details class="ai-guide" open><summary>${esc(s.title)}</summary><div>${format(s.body.replace(/^\s*[-*] /gm, '• '))}</div></details>`).join('')}`;
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
