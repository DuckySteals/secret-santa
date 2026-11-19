// Developer tools: an error/activity log in D1 and a private dashboard at #dev/<DEV_KEY>.
// Logs never hold passwords, messages, links or search words: only what's needed to find bugs.
import { amazon } from './shop.js';
import { preview } from './preview.js';
import { sendMail } from './mail.js';

export async function log(env, kind, msg, detail = '', where = '') {
  try {
    await env.DB.prepare('INSERT INTO logs (t, kind, path, msg, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(Date.now(), kind, String(where).slice(0, 120), String(msg).slice(0, 500), String(detail || '').slice(0, 4000)).run();
    // Keep the newest 5000 rows.
    if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM logs WHERE id <= (SELECT MAX(id) FROM logs) - 5000').run();
  } catch {}
}

const timed = async f => { const t = Date.now(); try { return { ...(await f()), ms: Date.now() - t }; } catch (e) { return { ok: false, note: e.message, ms: Date.now() - t }; } };
const one = async (env, sql) => Object.values(await env.DB.prepare(sql).first() || { n: 0 })[0];

export async function dev(req, env, path, body, json) {
  const key = req.headers.get('x-dev') || '';
  const enc = new TextEncoder();
  if (!env.DEV_KEY || key.length !== env.DEV_KEY.length || !crypto.subtle.timingSafeEqual(enc.encode(key), enc.encode(env.DEV_KEY)))
    return json({ error: 'Wrong developer key.' }, 403);
  const day = Date.now() - 86400000, week = Date.now() - 7 * 86400000;

  if (path === '/api/dev/stats') {
    const { results: kinds } = await env.DB.prepare('SELECT kind, msg, COUNT(*) n FROM logs WHERE t > ? GROUP BY kind, msg ORDER BY n DESC LIMIT 40').bind(week).all();
    return json({
      groups: await one(env, 'SELECT COUNT(*) FROM groups'),
      people: await one(env, "SELECT COALESCE(SUM(json_array_length(data, '$.people')), 0) FROM groups"),
      items: await one(env, "SELECT COUNT(*) FROM groups, json_each(groups.data, '$.people') p, json_each(p.value, '$.items')"),
      photos: await one(env, 'SELECT COUNT(*) FROM images'),
      users: await one(env, 'SELECT COUNT(*) FROM users'),
      errors24h: await one(env, `SELECT COUNT(*) FROM logs WHERE kind IN ('error', 'client') AND t > ${day}`),
      week: kinds,
      email: !!env.SMTP_USER, browser: !!env.BROWSER,
    });
  }
  if (path === '/api/dev/logs') {
    const q = new URL(req.url).searchParams;
    const kind = q.get('kind') || '';
    const { results } = await env.DB.prepare(`SELECT id, t, kind, path, msg, detail FROM logs ${kind ? 'WHERE kind = ?1' : ''} ORDER BY id DESC LIMIT 150`)
      .bind(...(kind ? [kind] : [])).all();
    return json({ logs: results });
  }
  if (path === '/api/dev/check' && req.method === 'POST') {
    return json({ checks: [
      ['Database', await timed(async () => ({ ok: (await env.DB.prepare('SELECT 1 AS x').first()).x === 1 }))],
      ['Amazon search', await timed(async () => { const r = await amazon('wool socks'); return { ok: r.length > 0, note: `${r.length} results` }; })],
      ['Link pictures (Amazon)', await timed(async () => { const p = await preview('https://www.amazon.com/dp/B0CHWRXH8B', env); return { ok: !!p.img, note: p.title }; })],
      ['Link pictures (Target)', await timed(async () => { const p = await preview('https://www.target.com/p/-/A-87450164', env); return { ok: !!p.img, note: p.title }; })],
      ['Reset emails', { ok: !!env.SMTP_USER, note: env.SMTP_USER ? 'set up' : 'SMTP_USER / SMTP_PASS not set' }],
      ['Headless browser', { ok: !!env.BROWSER, note: env.BROWSER ? 'bound' : 'missing' }],
    ] });
  }
  if (path === '/api/dev/mail' && req.method === 'POST') {
    try { await sendMail(env, String(body.to), 'Secret Santa test email', 'This is a test from the Secret Santa developer page. Email is working.'); return json({ ok: true }); }
    catch (e) { return json({ error: e.message }, 502); }
  }
  if (path === '/api/dev/clear' && req.method === 'POST') {
    await env.DB.prepare('DELETE FROM logs').run();
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
