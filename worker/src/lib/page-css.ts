/**
 * The storefront stylesheet goes inside every page instead of a separate /css/app.css request: the first paint then
 * waits for one download, not two, which saves a whole round trip on a slow phone connection (about 0.3 s on 4G).
 * It is ~7 KB compressed. Read once per isolate from the static assets (minified at build); if that fails, the page
 * links the file as before.
 */
let css: string | null = null;
let loading: Promise<string | null> | null = null;

export function pageCss(assets: Fetcher | undefined): Promise<string | null> {
  if (css) return Promise.resolve(css);
  if (!assets) return Promise.resolve(null);
  loading ??= assets.fetch('https://assets.local/css/app.css')
    .then(r => (r.ok ? r.text() : null))
    .catch(() => null)
    .then(text => {
      loading = null;
      // A stylesheet never contains "</style", but make sure it can't end the <style> element early.
      if (text) css = text.replace(/<\/style/gi, '<\\/style');
      return css;
    });
  return loading;
}

/** For tests: forget the cached stylesheet. */
export const resetPageCss = () => { css = null; loading = null; };
