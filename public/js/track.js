// Ad and analytics tags, loaded only when the owner has entered a valid ID in Settings → Tracking (Section 19).
// Hard rule (Section 2.3): a prerendered page that is never opened must not send a PageView or any event.
// Purchase is never sent from the browser: it is sent server-side for real confirmed orders only (Conversions API).
(() => {
  const el = document.getElementById('tracking-config');
  if (!el) return;
  let cfg;
  try { cfg = JSON.parse(el.textContent); } catch { return; }

  function load(src) {
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    document.head.append(s);
  }

  function start() {
    if (cfg.pixelId) {
      // The standard Meta Pixel bootstrap, as a file instead of an inline script (strict CSP).
      const f = window.fbq = function (...args) { f.callMethod ? f.callMethod(...args) : f.queue.push(args); };
      if (!window._fbq) window._fbq = f;
      f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
      load('https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', cfg.pixelId);
      window.fbq('track', 'PageView');
    }
    if (cfg.ga4Id) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', cfg.ga4Id);
      load(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.ga4Id)}`);
    }
    if (cfg.gtmId) {
      // Not present on cart, checkout or account pages: the server leaves gtmId out there.
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      load(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(cfg.gtmId)}`);
    }
    if (cfg.clarityId) {
      const c = window.clarity = window.clarity || function (...a) { (c.q = c.q || []).push(a); };
      load(`https://www.clarity.ms/tag/${encodeURIComponent(cfg.clarityId)}`);
    }
    const send = ({ name, data }) => {
      if (window.fbq && ['ViewContent', 'AddToCart', 'InitiateCheckout'].includes(name)) window.fbq('track', name, data.productId ? { content_ids: [String(data.productId)], content_type: 'product' } : {});
      if (window.gtag) window.gtag('event', { ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout' }[name] ?? name, data);
    };
    (window.__absvaiq || []).splice(0).forEach(send);
    addEventListener('absvai:track', e => send(e.detail));
  }

  if (document.prerendering) document.addEventListener('prerenderingchange', start, { once: true });
  else start();
})();
