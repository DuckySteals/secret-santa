// Link previews for wish-list items: picture, title and price.
// Tries the cheapest way first: read the page's tags, then a preview service,
// then a real headless browser for shops that block plain requests.
import puppeteer from '@cloudflare/puppeteer';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const BLOCKED = /robot or human|access denied|captcha|attention required|just a moment|error page|page not found|^\d+\.p$/i;

const tidy = t => unescape(t || '').replace(/\s+/g, ' ').replace(/^Amazon\.com:\s*/, '')
  .replace(/\s*[:|–-]\s*(Target|Walmart\.com|Amazon\.com.*|Best Buy|The Home Depot|Etsy|eBay)$/i, '').trim().slice(0, 120);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const unescape = s => s && s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
const money = p => p && (/^\d/.test(String(p)) ? `$${p}` : String(p)).slice(0, 20);

// Pull the best image/title/price out of a page's HTML stream.
async function fromHtml(res) {
  const meta = {}, ld = [];
  let title = '', script = '';
  await new HTMLRewriter()
    .on('meta', { element(e) { const k = (e.getAttribute('property') || e.getAttribute('name') || e.getAttribute('itemprop') || '').toLowerCase(); if (k && !meta[k]) meta[k] = e.getAttribute('content'); } })
    .on('link[rel="image_src"]', { element(e) { meta.image_src ||= e.getAttribute('href'); } })
    .on('#landingImage, #imgBlkFront', { element(e) { meta.amazon ||= e.getAttribute('data-old-hires') || e.getAttribute('src'); } })
    .on('title', { text(t) { title += t.text; } })
    .on('script[type="application/ld+json"]', { text(t) { script += t.text; if (t.lastInTextNode) { ld.push(script); script = ''; } } })
    .transform(res).arrayBuffer();
  // Product structured data (schema.org) often has the image even when meta tags don't.
  let product = {};
  for (const s of ld) {
    try {
      const found = [JSON.parse(s)].flat().flatMap(x => x['@graph'] || [x]).find(x => /product/i.test(x['@type']));
      if (found) { product = found; break; }
    } catch {}
  }
  const ldImg = [product.image].flat()[0];
  const img = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || meta.amazon || meta.image_src || (ldImg?.url ?? ldImg) || meta.image;
  const offer = [product.offers].flat()[0] || {};
  return {
    img: img && new URL(unescape(img), res.url).href,
    title: tidy(meta['og:title'] || product.name || title),
    price: money(meta['product:price:amount'] || meta['og:price:amount'] || offer.price || offer.lowPrice),
  };
}

async function direct(url) {
  const res = await fetch(url, {
    redirect: 'follow', signal: AbortSignal.timeout(7000),
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
  });
  if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return {};
  return fromHtml(res);
}

async function service(url) {
  const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
  const { status, data } = await res.json();
  if (status !== 'success' || BLOCKED.test(data.title || '')) return {};
  return { img: data.image?.url, title: tidy(data.title) };
}

async function browser(url, env) {
  if (!env.BROWSER) return {};
  const b = await puppeteer.launch(env.BROWSER);
  try {
    const page = await b.newPage();
    await page.setUserAgent(UA);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));
    return await page.evaluate(() => {
      const m = k => document.querySelector(`meta[property="${k}"],meta[name="${k}"]`)?.content;
      // No tag? Use the biggest picture on the page, which is nearly always the product.
      const big = [...document.images].filter(i => i.naturalWidth >= 200 && i.naturalHeight >= 200)
        .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
      return { img: m('og:image') || m('twitter:image') || big?.currentSrc, title: m('og:title') || document.title };
    }).then(d => ({ img: d.img, title: tidy(d.title) }));
  } finally {
    await b.close();
  }
}

function fromSlug(url) {
  const words = new URL(url).pathname.split('/').filter(s => /[a-z]-[a-z]/i.test(s)).sort((a, b) => b.length - a.length)[0];
  return words ? tidy(decodeURIComponent(words).replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : '';
}

export async function preview(url, env) {
  let best = {};
  for (const step of [direct, service, browser]) {
    try {
      const got = await step(url, env);
      if (BLOCKED.test(got.title || '')) got.title = '';
      best = { img: best.img || got.img, title: best.title || got.title, price: best.price || got.price };
      if (best.img && best.title) break;
    } catch {}
  }
  // Blocked shop: guess the name from the link, e.g. /hydro-flask-32-oz-bottle/ -> "Hydro Flask 32 Oz Bottle".
  best.title ||= fromSlug(url);
  return best;
}
