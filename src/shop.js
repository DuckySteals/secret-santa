// Amazon search for the in-app shop: reads the public search results page.
import { UA, unescape } from './preview.js';

const RESULT = 'div[data-component-type="s-search-result"]';

export async function amazon(q) {
  const res = await fetch(`https://www.amazon.com/s?k=${encodeURIComponent(q)}`, {
    signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) return [];
  const out = [];
  let cur, priced;
  await new HTMLRewriter()
    .on(RESULT, { element(e) { const a = e.getAttribute('data-asin'); if (a) out.push(cur = { u: `https://www.amazon.com/dp/${a}`, t: '', img: '', price: '' }), priced = false; } })
    .on(`${RESULT} img.s-image`, { element(e) { if (cur && !cur.img) { cur.img = e.getAttribute('src'); cur.t = unescape(e.getAttribute('alt') || ''); } } })
    .on(`${RESULT} .a-price .a-offscreen`, { text(t) { if (cur && !priced) { cur.price += t.text; if (t.lastInTextNode) priced = true; } } })
    .transform(res).arrayBuffer();
  const seen = new Set();
  return out.filter(r => r.img && r.t && !seen.has(r.u) && seen.add(r.u)).slice(0, 24)
    .map(r => ({ ...r, img: r.img.replace(/\._AC_U[LY]\d+_\./, '._AC_UL480_.'), t: r.t.slice(0, 120) }));
}
