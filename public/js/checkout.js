// One-page checkout with automatic address detection (build prompt Section 6).
// Three ways to find the address all fill the same Division → District → Area → Union selects:
//   1. a 4-digit postcode (looked up in the browser, instantly),
//   2. "Use my location" (district-level only: the data has district coordinates and outlines, nothing finer),
//   3. the dropdowns themselves.
// GPS coordinates never leave the browser. The server re-validates everything on submit.
import { api, cart, esc, taka } from './app.js';

const pd = JSON.parse(document.getElementById('page-data').textContent);
const form = document.getElementById('checkout-form');
const $ = s => form.querySelector(s);
const sel = { division: form.divisionId, district: form.districtId, upazila: form.upazilaId, union: form.unionId };
const finderMsg = $('[data-finder-msg]');
const placeBtn = $('[data-place]');
const errorBox = $('[data-co-error]');

const params = new URLSearchParams(location.search);
const buyNow = Number(params.get('buy'));
const lines = buyNow ? [{ variantId: buyNow, qty: Math.max(1, Math.min(99, Number(params.get('qty')) || 1)) }] : cart.lines();

let geo = null; // { divisions, districts, upazilas, postcodes }
let lastQuote = null;

function token() {
  try {
    let t = localStorage.getItem('absvai.co.token');
    if (!t || !/^[a-f0-9]{32}$/.test(t)) { t = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('absvai.co.token', t); }
    return t;
  } catch { return null; }
}

function fill(select, rows, placeholder) {
  select.replaceChildren(new Option(placeholder, ''), ...rows.map(([id, name]) => new Option(name, String(id))));
  select.disabled = rows.length === 0;
}

const districtsOf = div => geo.districts.filter(d => d[1] === div).map(d => [d[0], d[2]]);
const upazilasOf = dis => geo.upazilas.filter(u => u[1] === dis).map(u => [u[0], u[2]]);

async function loadUnions(upazilaId, selected) {
  if (!upazilaId) { fill(sel.union, [], 'Select union'); return; }
  try {
    const rows = await api(`/api/geo/${geo.version}/unions/${upazilaId}`);
    fill(sel.union, rows, rows.length ? 'Select union (optional)' : 'No unions listed');
    if (selected) sel.union.value = String(selected);
  } catch { fill(sel.union, [], 'Select union'); }
}

/** Sets the cascade. Upazila may be null (postcode not linked yet, or location detection). */
function applyArea(divisionId, districtId, upazilaId) {
  sel.division.value = String(divisionId);
  fill(sel.district, districtsOf(divisionId), 'Select district');
  sel.district.value = String(districtId);
  fill(sel.upazila, upazilasOf(districtId), 'Select area');
  sel.upazila.value = upazilaId ? String(upazilaId) : '';
  loadUnions(upazilaId);
  areaChanged();
}

function names() {
  const t = s => (s.value ? s.options[s.selectedIndex].text : '');
  return { division: t(sel.division), district: t(sel.district), upazila: sel.upazila.value ? t(sel.upazila) : '' };
}

function say(text, tone = '') { finderMsg.textContent = text; finderMsg.className = `finder-msg ${tone}`; }

// ── 1. Postcode ──
const picker = $('[data-po-picker]');
form.postcode.addEventListener('input', () => {
  form.postcode.value = form.postcode.value.replace(/\D/g, '').slice(0, 4);
  picker.hidden = true;
  if (form.postcode.value.length !== 4 || !geo) { if (form.postcode.value.length < 4) say(''); return; }
  const hits = geo.postcodes[form.postcode.value];
  if (!hits) { say('We don’t know this postcode yet. Please choose your area below.', 'warn'); return; }
  const use = ([office, div, dis, upa]) => {
    applyArea(div, dis, upa);
    const n = names();
    say(`${office} post office · ${n.upazila ? `${n.upazila}, ` : ''}${n.district}, ${n.division} Division${upa ? '' : '. Please choose your area.'}`, upa ? 'ok' : 'warn');
    picker.hidden = true;
  };
  if (hits.length === 1) { use(hits[0]); return; }
  picker.innerHTML = '<p class="small">This postcode covers several post offices. Which is yours?</p>' + hits.map((h, i) => `<button class="btn btn-outline btn-sm" type="button" data-i="${i}">${esc(h[0])}</button>`).join('');
  picker.hidden = false;
  picker.querySelectorAll('button').forEach(b => b.addEventListener('click', () => use(hits[Number(b.dataset.i)])));
});

// ── 2. Use my location (district-level) ──
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inMulti = (lon, lat, coords) => coords.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some(h => inRing(lon, lat, h)));
const km = (a, b, c, d) => { const r = x => (x * Math.PI) / 180; const s = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(s)); };

$('[data-locate]').addEventListener('click', () => {
  if (!('geolocation' in navigator)) { say('Your browser cannot share location. Please type your postcode or choose below.', 'warn'); return; }
  say('Finding your district…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords; // used here only, never sent or stored
    if (lat < 20.3 || lat > 26.8 || lon < 88 || lon > 92.8) { say('That location is outside Bangladesh. Please choose your area below.', 'warn'); return; }
    let districtId = null;
    try {
      const outlines = await (await fetch(`${pd.outlinesBase}/districts.json`)).json();
      districtId = outlines.features.find(f => inMulti(lon, lat, f.geometry.coordinates))?.properties.id ?? null;
    } catch { /* fall back to the nearest district centre */ }
    if (!districtId) districtId = geo.districts.reduce((best, d) => (km(lat, lon, d[3], d[4]) < km(lat, lon, best[3], best[4]) ? d : best))[0];
    const d = geo.districts.find(x => x[0] === districtId);
    applyArea(d[1], d[0], null);
    say(`We’ve set your district: ${d[2]}. Please choose your area.`, 'ok');
    sel.upazila.focus();
  }, err => {
    say(err.code === 1 ? 'Location permission was not given. Type your postcode or choose your area below.' : 'We could not get your location. Please choose your area below.', 'warn');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
});

// ── 3. Manual dropdowns ──
sel.division.addEventListener('change', () => { fill(sel.district, sel.division.value ? districtsOf(Number(sel.division.value)) : [], 'Select district'); fill(sel.upazila, [], 'Select area'); fill(sel.union, [], 'Select union'); areaChanged(); });
sel.district.addEventListener('change', () => { fill(sel.upazila, sel.district.value ? upazilasOf(Number(sel.district.value)) : [], 'Select area'); fill(sel.union, [], 'Select union'); areaChanged(); });
sel.upazila.addEventListener('change', () => { loadUnions(Number(sel.upazila.value) || null); areaChanged(); });

// ── Map card: Leaflet is loaded only after a district is known ──
let leafletReady = null;
let map = null;
let layer = null;
function loadLeaflet() {
  leafletReady ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = '/vendor/leaflet/leaflet.js'; s.onload = () => resolve(window.L); s.onerror = reject;
    document.head.append(s);
  });
  return leafletReady;
}

async function showMap(districtId) {
  const card = $('[data-map-card]');
  if (!districtId) { card.hidden = true; return; }
  const n = names();
  card.hidden = false;
  card.querySelector('[data-map-label]').textContent = [n.upazila, n.district, `${n.division} Division`].filter(Boolean).join(', ');
  try {
    const [L, outline] = await Promise.all([loadLeaflet(), fetch(`${pd.outlinesBase}/outlines/${districtId}.json`).then(r => r.json())]);
    const el = card.querySelector('[data-map]');
    if (!map) {
      map = L.map(el, { zoomControl: false, attributionControl: Boolean(pd.mapTileUrl), dragging: true, scrollWheelZoom: false });
      if (pd.mapTileUrl) L.tileLayer(pd.mapTileUrl, { attribution: pd.mapAttribution, maxZoom: 14 }).addTo(map);
    }
    layer?.remove();
    layer = L.geoJSON(outline, { style: { color: '#B3261E', weight: 2, fillColor: '#F2B705', fillOpacity: 0.25 } }).addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [12, 12] });
  } catch { /* the label still shows the place name */ }
}

// ── Quote, advance and summary ──
let quoteTimer;
function areaChanged() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(refreshQuote, 120);
  showMap(Number(sel.district.value) || null);
  saveDraft();
}

const payment = () => form.querySelector('input[name=paymentMethod]:checked')?.value ?? 'cod';
form.querySelectorAll('input[name=paymentMethod]').forEach(r => r.addEventListener('change', refreshQuote));

async function refreshQuote() {
  if (!lines.length) return;
  try {
    lastQuote = await api('/api/checkout/quote', { lines, districtId: Number(sel.district.value) || null, upazilaId: Number(sel.upazila.value) || null, paymentMethod: payment(), phone: form.phone.value });
  } catch (e) { errorBox.textContent = e.message; return; }
  renderSummary(lastQuote);
}

function renderSummary(q) {
  $('[data-co-lines]').innerHTML = q.lines.map(l => `
    <div class="co-line"><img src="${esc(l.image)}" alt=""><div>${esc(l.name)}<small>${esc(l.variantLabel)}${l.variantLabel ? ' · ' : ''}${l.qty} × ${taka(l.unitPaisa)}</small>${l.problem ? `<small class="problem">${esc(l.problem)}</small>` : ''}</div><strong>${taka(l.lineTotalPaisa)}</strong></div>`).join('');
  $('[data-subtotal]').textContent = taka(q.subtotalPaisa);
  const d = q.delivery;
  $('[data-delivery]').textContent = !d ? 'Choose your area' : d.status === 'to_confirm' ? 'Confirmed by phone' : d.chargePaisa === 0 ? 'Free' : taka(d.chargePaisa) + (q.needsArea ? ' (choose your area)' : '');
  const cod = d?.codFeePaisa > 0;
  $('[data-cod-row]').hidden = !cod; $('[data-cod-fee]').hidden = !cod;
  if (cod) $('[data-cod-fee]').textContent = taka(d.codFeePaisa);
  $('[data-total]').textContent = q.totalPaisa === null ? (d ? `${taka(q.subtotalPaisa)} + delivery` : '—') : taka(q.totalPaisa);
  $('[data-explain]').innerHTML = (d?.explanation ?? (q.subtotalPaisa && pd.freeThresholdPaisa ? [`Free delivery on orders over ${taka(pd.freeThresholdPaisa)} (large items excluded).`] : [])).map(t => `<li>${esc(t)}</li>`).join('');
  $('[data-eta]').textContent = d ? `Delivery to ${d.zoneName}: usually ${d.etaText}` : '';

  const adv = $('[data-advance]');
  adv.hidden = !q.advance.required;
  if (q.advance.required) {
    $('[data-advance-title]').textContent = q.advance.amountPaisa ? `This order needs an advance of ${taka(q.advance.amountPaisa)}` : 'This order needs an advance';
    $('[data-advance-reasons]').innerHTML = q.advance.reasons.map(r => `<li>${esc(r)}</li>`).join('');
    const mobile = form.querySelector('input[value=manual_mobile]');
    if (q.advance.amountPaisa && mobile && !mobile.closest('[hidden]') && payment() !== 'manual_mobile') { mobile.checked = true; refreshQuote(); }
  }
  errorBox.textContent = q.problems.join(' ');
  placeBtn.disabled = q.problems.length > 0 || !q.lines.length;
  placeBtn.textContent = q.hasPreOrder ? 'Place pre-order' : 'Place order';
}

// ── Abandoned-checkout capture (phone first) ──
let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!/^(\+?88)?01[3-9]\d{8}$/.test(form.phone.value.replace(/[\s-]/g, ''))) return;
    const t = token();
    if (!t) return;
    api('/api/checkout/draft', {
      token: t, phone: form.phone.value, name: form.name.value, lines, divisionId: Number(sel.division.value) || null, districtId: Number(sel.district.value) || null,
      upazilaId: Number(sel.upazila.value) || null, postcode: form.postcode.value, addressLine: form.addressLine.value, landmark: form.landmark.value,
    }).catch(() => {});
  }, 1200);
}
['phone', 'name', 'addressLine', 'landmark'].forEach(n => form[n].addEventListener('input', saveDraft));
form.phone.addEventListener('change', refreshQuote);

// ── Submit ──
function invalid(field, message) {
  field.setAttribute('aria-invalid', 'true');
  field.focus();
  errorBox.textContent = message;
  return false;
}

function validate() {
  form.querySelectorAll('[aria-invalid]').forEach(f => f.removeAttribute('aria-invalid'));
  if (!/^(\+?88)?01[3-9]\d{8}$/.test(form.phone.value.replace(/[\s-]/g, ''))) return invalid(form.phone, 'Enter a Bangladeshi mobile number like 01712345678.');
  if (form.name.value.trim().length < 2) return invalid(form.name, 'Enter your name.');
  if (!sel.division.value) return invalid(sel.division, 'Choose your division.');
  if (!sel.district.value) return invalid(sel.district, 'Choose your district.');
  if (!sel.upazila.value) return invalid(sel.upazila, 'Choose your area (upazila or thana).');
  if (form.addressLine.value.trim().length < 5) return invalid(form.addressLine, 'Enter your house, road or village so the courier can find you.');
  if (payment() === 'manual_mobile' && lastQuote?.advance.amountPaisa && !form.advanceTrxId?.value.trim()) return invalid(form.advanceTrxId, 'Enter the transaction ID from your bKash / Nagad / Rocket payment.');
  return true;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!validate()) return;
  placeBtn.disabled = true;
  placeBtn.textContent = 'Placing your order…';
  errorBox.textContent = '';
  let utm = {};
  try { utm = JSON.parse(sessionStorage.getItem('absvai.utm') || '{}'); } catch { /* ignore */ }
  try {
    const r = await api('/api/checkout/place', {
      phone: form.phone.value, name: form.name.value, divisionId: Number(sel.division.value), districtId: Number(sel.district.value), upazilaId: Number(sel.upazila.value),
      unionId: Number(sel.union.value) || null, postcode: form.postcode.value || null, addressLine: form.addressLine.value, landmark: form.landmark.value, note: form.note.value,
      paymentMethod: payment(), advanceTrxId: form.advanceTrxId?.value || null, advanceWallet: form.advanceWallet?.value || null,
      lines, token: token(), utm, source: buyNow ? 'web:order-now' : 'web:cart', turnstileToken: form.querySelector('[name="cf-turnstile-response"]')?.value ?? '',
    });
    if (!buyNow) cart.clear();
    try { localStorage.removeItem('absvai.co.token'); } catch { /* ignore */ }
    location.href = `/order/${encodeURIComponent(r.orderNo)}?t=${encodeURIComponent(r.accessToken)}`;
  } catch (err) {
    errorBox.textContent = err.message;
    placeBtn.disabled = false;
    placeBtn.textContent = 'Place order';
    if (err.status === 409) refreshQuote();
    window.turnstile?.reset?.();
  }
});

// ── Boot: geo data is only fetched on the checkout page, from versioned URLs cached forever ──
async function boot() {
  if (!lines.length) {
    form.innerHTML = '<div class="empty"><h2>Your cart is empty</h2><p>Add something first, then come back here.</p><a class="btn btn-primary" href="/shop">Start shopping</a></div>';
    return;
  }
  refreshQuote();
  try {
    const { version } = await api('/api/geo/version');
    const [h, postcodes] = await Promise.all([api(`/api/geo/${version}/hierarchy.json`), api(`/api/geo/${version}/postcodes.json`)]);
    geo = { version, ...h, postcodes };
    fill(sel.division, h.divisions, 'Select division');
  } catch {
    say('We could not load the area list. Check your connection and reload the page.', 'warn');
  }
}

boot();
