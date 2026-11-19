import { preview } from '../src/preview.js';
import { amazon } from '../src/shop.js';
import { auth } from '../src/auth.js';
// Secret Santa: organizers create a group, the worker draws names, and each
// person opens a private link to see who they're buying for.
const MAX_PEOPLE = 100;

const rand = (n = 12) => {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]);
};
const clip = (s, n = 80) => String(s ?? '').trim().slice(0, n);
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const fail = (msg, status = 400) => json({ error: msg }, status);

const load = async (env, id) => {
  const row = await env.DB.prepare('SELECT data FROM groups WHERE id = ?').bind(id).first();
  return row && JSON.parse(row.data);
};
const save = (env, g) => env.DB.prepare('INSERT OR REPLACE INTO groups (id, data, created) VALUES (?, ?, ?)')
  .bind(g.id, JSON.stringify(g), g.created).run();

// Random assignment: nobody draws themselves or someone in their "no-match" pairs.
// Pairs the organizer chose by hand (fixed) are kept; everyone else is shuffled.
const banned = (g, a, b) => g.exclude.some(p => p.includes(a) && p.includes(b));
function draw(people, g) {
  const ids = people.map(p => p.id);
  const pinned = Object.entries(g.fixed || {}).filter(([a, b]) => ids.includes(a) && ids.includes(b));
  const givers = ids.filter(id => !pinned.some(([a]) => a === id));
  const pool = ids.filter(id => !pinned.some(([, b]) => b === id));
  for (let attempt = 0; attempt < 2000; attempt++) {
    const order = [...pool];
    for (let i = order.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (givers.every((id, i) => id !== order[i] && !banned(g, id, order[i])))
      return Object.fromEntries([...pinned, ...givers.map((id, i) => [id, order[i]])]);
  }
  return null;
}

// Viewers write and read wish lists but aren't in the draw.
function redraw(g) {
  const drawn = g.people.filter(p => !p.viewer);
  if (drawn.length < 3) return 'You need at least 3 people in the draw.';
  const match = draw(drawn, g);
  if (!match) return "Those no-match pairs and chosen pairs make a draw impossible. Remove one and try again.";
  g.match = match;
  g.msgs = {};
  return null;
}

// A photo someone added themselves: a small JPEG/PNG/WebP sent as a data URL.
async function savePhoto(env, gid, photo) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(photo || '');
  if (!m || m[2].length > 400000) return null;
  const id = rand(12);
  await env.DB.prepare('INSERT INTO images (id, gid, type, data) VALUES (?, ?, ?, ?)').bind(id, gid, m[1], m[2]).run();
  return `/api/img/${id}`;
}
const dropPhoto = (env, img) => img?.startsWith('/api/img/') &&
  env.DB.prepare('DELETE FROM images WHERE id = ?').bind(img.slice(9)).run();

// Wish lists were plain text before they became item cards.
const items = p => p.items || (p.items = (p.wish || '').split('\n').map(t => t.trim()).filter(Boolean).map(t => ({ id: rand(4), t })));
const pub = p => ({ name: p.name, viewer: !!p.viewer, items: items(p) });

const info = g => ({ name: g.name, budget: g.budget, date: g.date, note: g.note, count: g.people.filter(p => !p.viewer).length, viewers: g.people.filter(p => p.viewer).length });

async function api(req, env, path) {
  const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
  const gid = req.headers.get('x-group');
  const key = req.headers.get('x-key') || '';

  if (path === '/api/groups' && req.method === 'POST') {
    const people = (body.people || []).map(p => ({ id: rand(4), key: rand(), name: clip(p.name, 40), viewer: !!p.viewer, items: [], seen: 0 }));
    if (people.some(p => !p.name)) return fail('Every person needs a name.');
    if (new Set(people.map(p => p.name.toLowerCase())).size !== people.length) return fail('Two people have the same name.');
    if (people.length > MAX_PEOPLE) return fail(`Up to ${MAX_PEOPLE} people.`);
    const exclude = (body.exclude || [])
      .map(([a, b]) => [people[a]?.id, people[b]?.id])
      .filter(([a, b]) => a && b && a !== b);
    const g = {
      id: rand(6), admin: rand(), created: Date.now(), people, exclude,
      name: clip(body.name) || 'Secret Santa', budget: clip(body.budget, 20), date: clip(body.date, 20), note: clip(body.note, 500),
    };
    const err = redraw(g);
    if (err) return fail(err);
    await save(env, g);
    return json({ id: g.id, admin: g.admin });
  }

  if (path.startsWith('/api/auth/')) return auth(req, env, path, body, async (id, kind, k) => {
    const grp = await load(env, id);
    if (!grp) return null;
    if (kind === 'admin') return grp.admin === k ? grp.name : null;
    const p = grp.people.find(x => `${x.id}.${x.key}` === k);
    return p ? `${grp.name} · ${p.name}` : null;
  });

  if (path.startsWith('/api/img/')) {
    const row = await env.DB.prepare('SELECT type, data FROM images WHERE id = ?').bind(path.slice(9)).first();
    if (!row) return fail('Not found', 404);
    return new Response(Uint8Array.from(atob(row.data), c => c.charCodeAt(0)), {
      headers: { 'content-type': row.type, 'cache-control': 'public, max-age=31536000, immutable' },
    });
  }

  const g = gid && await load(env, gid);
  if (!g) return fail('This group no longer exists.', 404);

  if (path.startsWith('/api/admin')) {
    if (key !== g.admin) return fail('Wrong organizer link.', 403);
    let reshuffle = true;
    if (path === '/api/admin/add' && req.method === 'POST') {
      const name = clip(body.name, 40);
      if (!name || g.people.some(p => p.name.toLowerCase() === name.toLowerCase())) return fail('Enter a new, unique name.');
      if (g.people.length >= MAX_PEOPLE) return fail(`Up to ${MAX_PEOPLE} people.`);
      g.people.push({ id: rand(4), key: rand(), name, viewer: !!body.viewer, items: [], seen: 0 });
      reshuffle = !body.viewer;
    } else if (path === '/api/admin/remove' && req.method === 'POST') {
      reshuffle = !g.people.find(p => p.id === body.id)?.viewer;
      g.people = g.people.filter(p => p.id !== body.id);
      g.exclude = g.exclude.filter(pair => !pair.includes(body.id));
      for (const [a, b] of Object.entries(g.fixed || {})) if (a === body.id || b === body.id) delete g.fixed[a];
    } else if (path === '/api/admin/fix' && req.method === 'POST') {
      // The organizer picks who someone gets. Only this giver and one other person swap,
      // so nobody else's match changes and nobody is told.
      g.fixed ||= {};
      const inDraw = id => g.people.some(p => p.id === id && !p.viewer);
      const nameOf = id => g.people.find(p => p.id === id)?.name;
      const a = body.giver, b = body.receiver;
      if (!inDraw(a)) return fail('Choose who gives.');
      reshuffle = false;
      if (!b) delete g.fixed[a];
      else {
        if (!inDraw(b) || a === b) return fail('Choose someone else for them to get.');
        const taken = Object.keys(g.fixed).find(x => g.fixed[x] === b && x !== a);
        if (taken) return fail(`${nameOf(b)} is already chosen for ${nameOf(taken)}.`);
        if (banned(g, a, b)) return fail(`${nameOf(a)} and ${nameOf(b)} are a no-match pair.`);
        g.fixed[a] = b;
        const c = Object.keys(g.match).find(id => g.match[id] === b), x = g.match[a];
        if (c !== a) {
          if (c !== x && !banned(g, c, x) && !g.fixed[c]) {
            g.match[a] = b; g.match[c] = x;
            delete g.msgs?.[a]; delete g.msgs?.[c];
          } else reshuffle = true;
        }
      }
    } else if (path === '/api/admin/redraw' && req.method === 'POST') {
      // fall through to redraw below
    } else if (path === '/api/admin/delete' && req.method === 'POST') {
      await env.DB.batch([env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(g.id), env.DB.prepare('DELETE FROM images WHERE gid = ?').bind(g.id)]);
      return json({ ok: true });
    } else if (req.method !== 'GET') return fail('Not found', 404);
    if (req.method === 'POST') {
      if (reshuffle) {
        const err = redraw(g);
        if (err) return fail(err);
        g.people.forEach(p => { p.seen = 0; });
      }
      await save(env, g);
    }
    // The organizer sees links and who has looked, never who drew whom.
    return json({
      ...info(g), redrawn: req.method === 'POST' && reshuffle, fixed: Object.entries(g.fixed || {}),
      people: g.people.map(p => ({ id: p.id, key: p.key, name: p.name, seen: p.seen, viewer: !!p.viewer, hasWish: items(p).length > 0 })),
    });
  }

  const [pid, secret] = key.split('.');
  const me = g.people.find(p => p.id === pid && p.key === secret);
  if (!me) return fail('This link has expired. Ask your organizer for a new one.', 403);
  const giftee = !me.viewer && g.people.find(p => p.id === g.match[me.id]);
  const santaId = Object.keys(g.match).find(id => g.match[id] === me.id);
  g.msgs ||= {};

  if (path === '/api/me/shop') {
    const q = clip(new URL(req.url).searchParams.get('q'), 100);
    return json({ results: q ? await amazon(q).catch(() => []) : [] });
  }
  if (path === '/api/me/item' && req.method === 'POST') {
    let url = clip(body.u, 1000);
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (url && !URL.canParse(url)) return fail("That link doesn't look right.");
    if (!url && !clip(body.t)) return fail('Add a name or a link.');
    if (items(me).length >= 50) return fail('Up to 50 items.');
    const photo = body.photo && await savePhoto(env, g.id, body.photo);
    // Picked from the Amazon search: picture and price came with it.
    const picked = /^https:\/\/m\.media-amazon\.com\/images\//.test(body.img || '') && clip(body.t) && { img: body.img, price: clip(body.price, 20) };
    const p = picked || (url ? await preview(url, env) : {});
    me.items.push({ id: rand(4), t: clip(body.t, 120) || p.title || new URL(url).hostname.replace(/^www\./, ''), u: url, img: photo || p.img, price: clip(body.price, 20) || p.price, n: clip(body.n, 300) });
  } else if (path === '/api/me/item/photo' && req.method === 'POST') {
    const item = items(me).find(i => i.id === body.id);
    const photo = item && await savePhoto(env, g.id, body.photo);
    if (!photo) return fail("Couldn't use that photo. Try another.");
    await dropPhoto(env, item.img);
    item.img = photo;
  } else if (path === '/api/me/item/remove' && req.method === 'POST') {
    await dropPhoto(env, items(me).find(i => i.id === body.id)?.img);
    me.items = items(me).filter(i => i.id !== body.id);
  } else if (path === '/api/me/msg' && req.method === 'POST') {
    if (me.viewer) return fail('Viewers are not in the draw.');
    const text = clip(body.text, 500);
    if (!text) return fail('Write a message first.');
    // A thread is keyed by the Santa's id: s=1 from the Santa, s=0 from the giftee.
    const [thread, s] = body.to === 'giftee' ? [me.id, 1] : [santaId, 0];
    (g.msgs[thread] ||= []).push({ s, x: text, t: Date.now() });
    if (g.msgs[thread].length > 200) g.msgs[thread].shift();
  } else if (req.method !== 'GET') return fail('Not found', 404);
  if (req.method === 'POST' || !me.seen) {
    me.seen ||= Date.now();
    await save(env, g);
  }
  return json({
    ...info(g),
    me: pub(me),
    giftee: giftee && pub(giftee),
    toGiftee: g.msgs[me.id] || [],
    fromSanta: g.msgs[santaId] || [],
    // Everyone's lists (never who drew whom), so viewers and shoppers can browse.
    lists: g.people.filter(p => p !== me).map(pub),
  });
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/')) {
      try { return await api(req, env, path); } catch (e) { return fail('Something went wrong.', 500); }
    }
    return env.ASSETS.fetch(req);
  },
};
