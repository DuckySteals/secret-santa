// Secret Santa: organizers create a group, the worker draws names, and each
// person opens a private link to see who they're buying for.
const MAX_PEOPLE = 100;
const MAX_TEXT = 2000;

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
function draw(people, exclude) {
  const banned = new Set(exclude.flatMap(([a, b]) => [`${a}>${b}`, `${b}>${a}`]));
  const ids = people.map(p => p.id);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (ids.every((id, i) => id !== order[i] && !banned.has(`${id}>${order[i]}`)))
      return Object.fromEntries(ids.map((id, i) => [id, order[i]]));
  }
  return null;
}

// Viewers write and read wish lists but aren't in the draw.
function redraw(g) {
  const drawn = g.people.filter(p => !p.viewer);
  if (drawn.length < 3) return 'You need at least 3 people in the draw.';
  const match = draw(drawn, g.exclude);
  if (!match) return "Those no-match pairs make a draw impossible. Remove one and try again.";
  g.match = match;
  g.msgs = {};
  return null;
}

const info = g => ({ name: g.name, budget: g.budget, date: g.date, note: g.note, count: g.people.filter(p => !p.viewer).length, viewers: g.people.filter(p => p.viewer).length });

async function api(req, env, path) {
  const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
  const gid = req.headers.get('x-group');
  const key = req.headers.get('x-key') || '';

  if (path === '/api/groups' && req.method === 'POST') {
    const people = (body.people || []).map(p => ({ id: rand(4), key: rand(), name: clip(p.name, 40), viewer: !!p.viewer, wish: '', seen: 0 }));
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

  const g = gid && await load(env, gid);
  if (!g) return fail('This group no longer exists.', 404);

  if (path.startsWith('/api/admin')) {
    if (key !== g.admin) return fail('Wrong organizer link.', 403);
    let reshuffle = true;
    if (path === '/api/admin/add' && req.method === 'POST') {
      const name = clip(body.name, 40);
      if (!name || g.people.some(p => p.name.toLowerCase() === name.toLowerCase())) return fail('Enter a new, unique name.');
      if (g.people.length >= MAX_PEOPLE) return fail(`Up to ${MAX_PEOPLE} people.`);
      g.people.push({ id: rand(4), key: rand(), name, viewer: !!body.viewer, wish: '', seen: 0 });
      reshuffle = !body.viewer;
    } else if (path === '/api/admin/remove' && req.method === 'POST') {
      reshuffle = !g.people.find(p => p.id === body.id)?.viewer;
      g.people = g.people.filter(p => p.id !== body.id);
      g.exclude = g.exclude.filter(pair => !pair.includes(body.id));
    } else if (path === '/api/admin/redraw' && req.method === 'POST') {
      // fall through to redraw below
    } else if (path === '/api/admin/delete' && req.method === 'POST') {
      await env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(g.id).run();
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
    return json({ ...info(g), people: g.people.map(({ id, key, name, seen, wish, viewer }) => ({ id, key, name, seen, viewer: !!viewer, hasWish: !!wish })) });
  }

  const [pid, secret] = key.split('.');
  const me = g.people.find(p => p.id === pid && p.key === secret);
  if (!me) return fail('This link has expired. Ask your organizer for a new one.', 403);
  const giftee = !me.viewer && g.people.find(p => p.id === g.match[me.id]);
  const santaId = Object.keys(g.match).find(id => g.match[id] === me.id);
  g.msgs ||= {};

  if (path === '/api/me/wish' && req.method === 'POST') {
    me.wish = clip(body.wish, MAX_TEXT);
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
    me: { name: me.name, wish: me.wish, viewer: !!me.viewer },
    giftee: giftee && { name: giftee.name, wish: giftee.wish },
    toGiftee: g.msgs[me.id] || [],
    fromSanta: g.msgs[santaId] || [],
    // Everyone's lists (never who drew whom), so viewers and shoppers can browse.
    lists: g.people.filter(p => p !== me && p.wish).map(p => ({ name: p.name, wish: p.wish, viewer: !!p.viewer })),
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
