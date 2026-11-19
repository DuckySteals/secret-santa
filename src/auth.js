// Email + password accounts. An account remembers the private links you've opened,
// so you can log in on any device and find your groups again.
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const token = () => hex(crypto.getRandomValues(new Uint8Array(24)));

async function hash(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256));
}
const same = (a, b) => a.length === b.length && crypto.subtle.timingSafeEqual(enc.encode(a), enc.encode(b));
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

const reply = (body, status = 200, cookie) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(cookie && { 'set-cookie': cookie }) },
});
const YEAR = 31536000;
const cookie = (sid, age = YEAR) => `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const sidOf = req => /(?:^|;\s*)sid=(\w+)/.exec(req.headers.get('cookie') || '')?.[1];

export async function currentUser(req, env) {
  const sid = sidOf(req);
  return sid ? env.DB.prepare('SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.uid WHERE s.token = ?').bind(await sha(sid)).first() : null;
}

async function startSession(env, uid, email) {
  const sid = token();
  await env.DB.prepare('INSERT INTO sessions (token, uid, created) VALUES (?, ?, ?)').bind(await sha(sid), uid, Date.now()).run();
  return reply({ email }, 200, cookie(sid));
}

// check(gid, kind, key) -> display name if the link is real, else null.
export async function auth(req, env, path, body, check) {
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  const pw = String(body.password || '');
  if (path === '/api/auth/signup') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Enter a real email address.' }, 400);
    if (pw.length < 8) return reply({ error: 'Use a password of at least 8 characters.' }, 400);
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first())
      return reply({ error: 'That email already has an account. Log in instead.' }, 400);
    const id = token(), salt = token();
    await env.DB.prepare('INSERT INTO users (id, email, salt, pw, created) VALUES (?, ?, ?, ?, ?)').bind(id, email, salt, await hash(pw, salt), Date.now()).run();
    return startSession(env, id, email);
  }
  if (path === '/api/auth/login') {
    const u = await env.DB.prepare('SELECT id, salt, pw FROM users WHERE email = ?').bind(email).first();
    if (!u || !same(await hash(pw, u.salt), u.pw)) return reply({ error: 'Wrong email or password.' }, 401);
    return startSession(env, u.id, email);
  }
  if (path === '/api/auth/logout') {
    const sid = sidOf(req);
    if (sid) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha(sid)).run();
    return reply({ email: null }, 200, cookie('', 0));
  }
  const user = await currentUser(req, env);
  if (!user) return reply({ email: null });
  if (path === '/api/auth/link' && req.method === 'POST') {
    const kind = body.kind === 'admin' ? 'admin' : 'me';
    const name = await check(String(body.gid), kind, String(body.key));
    if (!name) return reply({ error: 'That link is not valid.' }, 400);
    await env.DB.prepare('INSERT OR REPLACE INTO links (uid, gid, kind, key, name, saved) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, body.gid, kind, body.key, name, Date.now()).run();
  } else if (path === '/api/auth/unlink' && req.method === 'POST') {
    await env.DB.prepare('DELETE FROM links WHERE uid = ? AND gid = ? AND kind = ?').bind(user.id, String(body.gid), String(body.kind)).run();
  }
  const { results } = await env.DB.prepare('SELECT gid, kind, key, name FROM links WHERE uid = ? ORDER BY saved DESC').bind(user.id).all();
  return reply({ email: user.email, links: results });
}
