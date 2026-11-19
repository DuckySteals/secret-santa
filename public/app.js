const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
const $ = sel => app.querySelector(sel);

// Send browser errors to the developer log (page name only, never private links). Five per visit at most.
let reported = 0;
function report(msg, detail) {
  if (reported++ >= 5) return;
  const body = JSON.stringify({ msg: String(msg), detail: String(detail || ''), page: location.hash.split('/')[0] || '#home', ua: navigator.userAgent });
  navigator.sendBeacon?.('/api/log', body) || fetch('/api/log', { method: 'POST', body, keepalive: true }).catch(() => {});
}
addEventListener('error', e => report(e.message, `${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack || ''}`));
addEventListener('unhandledrejection', e => report(e.reason?.message || e.reason, e.reason?.stack));

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function call(path, { group, key, body } = {}) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-group': group || '', 'x-key': key || '' },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: 'Network problem. Try again.' }));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// Links this browser has opened ({gid, kind: 'admin'|'me', key, name}), so people can find them again.
const same = (a, b) => a.gid === b.gid && a.kind === b.kind;
const saved = {
  all() {
    try { return (JSON.parse(localStorage.getItem('santa.groups')) || []).map(l => l.admin ? { gid: l.id, kind: 'admin', key: l.admin, name: l.name } : l); }
    catch { return []; }
  },
  set(list) { try { localStorage.setItem('santa.groups', JSON.stringify(list)); } catch {} },
  add(l) { this.set([l, ...this.all().filter(x => !same(x, l))]); },
  drop(l) { this.set(this.all().filter(x => !same(x, l))); },
};
// The logged-in account, if any: {email, links}.
let account = { email: null, links: [] };
const showAccount = () => { document.getElementById('acct').textContent = account.email ? '👤 Account' : 'Log in'; };
async function loadAccount() {
  try { account = await call('/api/auth/me'); } catch {}
  account.links ||= [];
  showAccount();
}
function remember(l) {
  saved.add(l);
  if (account.email) call('/api/auth/link', { body: l }).then(a => { account = a; }).catch(() => {});
}
function forget(l) {
  saved.drop(l);
  if (account.email) call('/api/auth/unlink', { body: l }).catch(() => {});
}
const allLinks = () => [...account.links, ...saved.all()].filter((l, i, a) => a.findIndex(x => same(x, l)) === i);
const groupsCard = list => list.length ? `<div class="card"><h2>Your groups</h2><ul class="people">${list.map(l => `
  <li><span class="who">${esc(l.name)}<small>${l.kind === 'admin' ? 'Organizer' : 'Your page'}</small></span>
  <a href="#${l.kind}/${l.gid}/${l.key}"><button class="ghost">${l.kind === 'admin' ? 'Manage' : 'Open'}</button></a></li>`).join('')}</ul></div>` : '';

const facts = g => `<ul class="facts">${[
  g.budget && `Budget: ${esc(g.budget)}`,
  g.date && `Exchange: ${esc(new Date(g.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' }))}`,
  g.count && `${g.count} in the draw`,
  g.viewers && `${g.viewers} viewer${g.viewers > 1 ? 's' : ''}`,
].filter(Boolean).map(f => `<li>${f}</li>`).join('')}</ul>${g.note ? `<p class="wish" style="margin-top:12px">${linkify(g.note)}</p>` : ''}`;

async function share(url, text) {
  if (navigator.share) {
    try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  await copy(`${text} ${url}`);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { prompt('Copy this:', text); }
}

/* ---------- Install as an app (Android, iPhone, computer) ---------- */
const install = {
  prompt: null,
  card() {
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
    const how = this.prompt ? '<button id="install">📲 Install the app</button>'
      : /iphone|ipad|ipod/i.test(navigator.userAgent) ? '<p class="muted">In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</p>'
      : '<p class="muted">Open the browser menu (⋮) and tap <b>Install app</b> or <b>Add to Home screen</b>.</p>';
    return `<div class="card"><h2>Get the app</h2><p class="muted" style="margin-top:0">Put Secret Santa on your home screen. It opens full screen, like any app.</p>${how}</div>`;
  },
  bind() {
    const b = $('#install');
    if (b) b.onclick = async () => { this.prompt.prompt(); await this.prompt.userChoice; this.prompt = null; route(); };
  },
};
addEventListener('beforeinstallprompt', e => { e.preventDefault(); install.prompt = e; if (!location.hash) route(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

/* ---------- Create a group ---------- */
function home() {
  document.getElementById('sub').textContent = 'Draw names, share wish lists, keep the secret.';
  app.innerHTML = `
    ${groupsCard(allLinks())}
    ${install.card()}
    <div class="card">
      <h2>Start a gift exchange</h2>
      <ol class="steps muted">
        <li>Add everyone, including yourself. Tick <b>Viewer</b> for anyone who should share and see wish lists without being in the draw.</li>
        <li>Names are drawn the moment you create the group.</li>
        <li>Text each person their private link. They see who they're buying for, and their wish list.</li>
      </ol>
      <label for="name">Group name</label>
      <input id="name" placeholder="Family Christmas 2026" maxlength="80">
      <div class="grid">
        <div><label for="budget">Budget</label><input id="budget" placeholder="$30" maxlength="20"></div>
        <div><label for="date">Exchange date</label><input id="date" type="date"></div>
      </div>
      <label for="note">Note for everyone (optional)</label>
      <input id="note" placeholder="Christmas Eve at Grandma's, 6pm" maxlength="500">
      <h3>People</h3>
      <div id="names"></div>
      <button class="ghost" id="more">+ Add person</button>
      <h3>Couples / no-match pairs</h3>
      <p class="muted" style="margin-top:0">Pairs who shouldn't draw each other, like spouses.</p>
      <div id="pairs"></div>
      <button class="ghost" id="pair">+ Add pair</button>
      <p class="err" id="err"></p>
      <button class="big" id="go">Create &amp; draw names</button>
    </div>`;

  install.bind();
  const names = $('#names'), pairs = $('#pairs');
  const list = () => [...names.querySelectorAll('input:not([type])')].map(i => i.value.trim());
  const addName = (v = '', ph = 'Name') => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<input maxlength="40" placeholder="${ph}" value="${esc(v)}"><label class="check"><input type="checkbox"> Viewer</label><button class="x" title="Remove">✕</button>`;
    row.querySelector('button').onclick = () => { row.remove(); refreshPairs(); };
    row.querySelector('input').oninput = refreshPairs;
    row.querySelector('[type=checkbox]').onchange = refreshPairs;
    names.append(row);
    return row.querySelector('input');
  };
  const options = sel => {
    const keep = sel.value;
    const viewer = [...names.querySelectorAll('[type=checkbox]')].map(c => c.checked);
    sel.innerHTML = '<option value="">Choose…</option>' + list().map((n, i) => n && !viewer[i] && `<option value="${i}">${esc(n)}</option>`).join('');
    sel.value = keep;
  };
  function refreshPairs() { pairs.querySelectorAll('select').forEach(options); }
  const addPair = () => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<select></select><span class="muted">&amp;</span><select></select><button class="x" title="Remove">✕</button>`;
    row.querySelector('button').onclick = () => row.remove();
    pairs.append(row);
    refreshPairs();
  };

  addName('', 'Your name');
  for (let i = 0; i < 3; i++) addName();
  $('#more').onclick = () => addName().focus();
  $('#pair').onclick = addPair;
  $('#go').onclick = async () => {
    const all = list();
    const viewer = [...names.querySelectorAll('[type=checkbox]')].map(c => c.checked);
    const people = all.map((name, i) => ({ name, viewer: viewer[i] })).filter(p => p.name);
    const index = all.map((n, i) => n ? all.slice(0, i).filter(Boolean).length : -1);
    const exclude = [...pairs.querySelectorAll('.row')]
      .map(r => [...r.querySelectorAll('select')].map(s => s.value === '' ? -1 : index[s.value]))
      .filter(([a, b]) => a >= 0 && b >= 0);
    $('#err').textContent = '';
    if (people.filter(p => !p.viewer).length < 3) return ($('#err').textContent = 'Put at least 3 people in the draw.');
    $('#go').disabled = true;
    try {
      const name = $('#name').value.trim() || 'Secret Santa';
      const g = await call('/api/groups', { body: { name, people, exclude, budget: $('#budget').value, date: $('#date').value, note: $('#note').value } });
      remember({ gid: g.id, kind: 'admin', key: g.admin, name });
      location.hash = `admin/${g.id}/${g.admin}`;
    } catch (e) {
      $('#err').textContent = e.message;
      $('#go').disabled = false;
    }
  };
}

/* ---------- Organizer page ---------- */
async function admin(group, key) {
  const auth = { group, key };
  let g;
  const render = () => {
    document.getElementById('sub').textContent = g.name;
    const base = `${location.origin}/`;
    const linkFor = p => `${base}#me/${group}/${p.id}.${p.key}`;
    const opened = g.people.filter(p => p.seen).length;
    const nameOf = id => g.people.find(p => p.id === id)?.name || '?';
    const pick = label => `<option value="">${label}</option>` + g.people.filter(p => !p.viewer).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    app.innerHTML = `
      <div class="card">
        <h2>Names are drawn 🎉</h2>
        ${facts(g)}
        <p class="muted">Send each person their own link. Only they see who they drew; this page never shows the matches. <strong>${opened} of ${g.people.length}</strong> have opened theirs.</p>
        <p class="muted">Bookmark this page: it's your organizer link.</p>
      </div>
      <div class="card">
        <h2>Send links</h2>
        <ul class="people">${g.people.map(p => `
          <li data-id="${p.id}">
            <span class="who">${esc(p.name)}<small>${p.viewer ? 'Viewer · ' : ''}${p.seen ? '✓ Opened' : 'Not opened yet'}${p.hasWish ? ' · has a wish list' : ''}</small></span>
            <button data-act="share">Send</button>
            <button class="ghost" data-act="copy">Copy</button>
            <button class="x" data-act="remove" title="Remove">✕</button>
          </li>`).join('')}</ul>
        <h3>Add someone</h3>
        <div class="row"><input id="add" maxlength="40" placeholder="Name"><label class="check"><input type="checkbox" id="addviewer"> Viewer</label><button id="addbtn">Add</button></div>
        <p class="muted">Adding or removing someone in the draw redraws every name, so send everyone their link again. Viewers don't change the draw.</p>
        <p class="err" id="err"></p>
      </div>
      <div class="card">
        <h2>Choose for someone</h2>
        <p class="muted" style="margin-top:0">Pick who someone gets. Only they and one other person swap, nobody else's match changes, and nobody is told it was chosen.</p>
        <div class="row"><select id="fixA">${pick('Who gives…')}</select><span class="muted">gets</span><select id="fixB">${pick('Who gets…')}</select></div>
        <button id="fixbtn">Set</button>
        ${g.fixed.length ? `<ul class="people" style="margin-top:12px">${g.fixed.map(([a, b]) => `
          <li><span class="who">${esc(nameOf(a))} → ${esc(nameOf(b))}<small>Chosen by you</small></span><button class="x" data-unfix="${a}" title="Remove">✕</button></li>`).join('')}</ul>` : ''}
      </div>
      <div class="card">
        <h2>Options</h2>
        <div class="row" style="flex-wrap:wrap">
          <button class="ghost" id="redraw">Redraw all names</button>
          <button class="ghost" id="delete">Delete group</button>
        </div>
      </div>`;

    app.querySelectorAll('.people li[data-id]').forEach(li => {
      const p = g.people.find(x => x.id === li.dataset.id);
      const text = `Hi ${p.name}! Here's your private Secret Santa link for ${g.name}. Don't share it:`;
      li.querySelector('[data-act=share]').onclick = () => share(linkFor(p), text);
      li.querySelector('[data-act=copy]').onclick = () => copy(linkFor(p));
      li.querySelector('[data-act=remove]').onclick = () =>
        confirm(`Remove ${p.name}?${p.viewer ? '' : " Everyone's names will be redrawn."}`) && act('/api/admin/remove', { id: p.id }, !p.viewer);
    });
    $('#addbtn').onclick = () => {
      const name = $('#add').value.trim(), viewer = $('#addviewer').checked;
      if (name && (viewer || confirm(`Add ${name}? Everyone's names will be redrawn.`))) act('/api/admin/add', { name, viewer }, !viewer);
    };
    $('#fixbtn').onclick = () => {
      const giver = $('#fixA').value, receiver = $('#fixB').value;
      if (!giver || !receiver) return toast('Choose both people.');
      act('/api/admin/fix', { giver, receiver });
    };
    app.querySelectorAll('[data-unfix]').forEach(b => b.onclick = () => act('/api/admin/fix', { giver: b.dataset.unfix }));
    $('#redraw').onclick = () => confirm('Redraw everyone? Old links still work but show a new person.') && act('/api/admin/redraw', {});
    $('#delete').onclick = async () => {
      if (!confirm(`Delete "${g.name}" for everyone? This can't be undone.`)) return;
      await call('/api/admin/delete', { ...auth, body: {} });
      forget({ gid: group, kind: 'admin' });
      location.hash = '';
    };
  };
  const act = async (path, body) => {
    try { g = await call(path, { ...auth, body }); render(); toast(g.redrawn ? 'Names redrawn: send everyone their link again' : 'Done'); }
    catch (e) { toast(e.message); }
  };
  try { g = await call('/api/admin', auth); } catch (e) { return oops(e.message); }
  remember({ gid: group, kind: 'admin', key, name: g.name });
  render();
}

/* ---------- A participant's private page ---------- */
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Shrink a phone photo to a small JPEG before uploading.
async function shrink(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 600 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
const pickPhoto = () => new Promise(resolve => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  input.onchange = () => resolve(input.files[0] ? shrink(input.files[0]) : null);
  input.click();
});

// One picture card. kind: 'mine' (edit), 'theirs' (shop), 'add' (Amazon result to add).
function itemCard(it, kind, i) {
  const open = it.u ? `href="${esc(it.u)}" target="_blank" rel="noopener"` : '';
  const pic = it.img
    ? `<img src="${esc(it.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'🎁'}))">`
    : '<span>🎁</span>';
  const site = host(it.u);
  return `<div class="item" data-id="${it.id || ''}">
    <a class="pic" ${open}>${pic}</a>
    <div class="info">
      ${it.u ? `<a class="t" ${open}>${esc(it.t)}</a>` : `<span class="t">${esc(it.t)}</span>`}
      ${it.price ? `<div class="price">${esc(it.price)}</div>` : ''}
      ${it.n ? `<div class="note">${esc(it.n)}</div>` : ''}
    </div>
    ${kind === 'mine' ? `<div class="acts"><button class="ghost" data-act="photo" aria-label="${it.img ? 'Change' : 'Add'} photo">📷</button><button class="ghost" data-act="del">Remove</button></div>`
      : kind === 'add' ? `<button class="add" data-add="${i}">+ Add to list</button>`
      : it.u ? `<a class="buy" ${open}>${site === 'amazon.com' ? 'View on Amazon' : `View at ${esc(site)}`}</a>` : ''}
  </div>`;
}
const itemList = (items, kind, empty) => items.length
  ? `<div class="items">${items.map((it, i) => itemCard(it, kind, i)).join('')}</div>`
  : `<p class="muted">${empty}</p>`;

async function me(group, key) {
  const auth = { group, key };
  let d, opened = false, showing = false, tab, who = 0, photo = null, paste = null;
  const shop = { list: { q: '', results: null }, person: { q: '', results: null } };
  const store = (k, v) => { try { v === undefined ? (v = sessionStorage.getItem(k)) : sessionStorage.setItem(k, v); } catch {} return v; };
  // Two private chats. Each shows only after you tap it, and closes when you leave.
  const chats = {
    giftee: { title: 'Your person', icon: '🎁', note: 'They see you as "your Secret Santa".', msgs: () => d.toGiftee, mine: 1, hint: 'What size do you wear?' },
    santa: { title: 'Your Secret Santa', icon: '🎅', note: "You'll find out who they are at the gift exchange.", msgs: () => d.fromSanta, mine: 0, hint: 'Write a message…' },
  };
  const readKey = c => `santa.read.${group}.${c}`;
  const incoming = c => chats[c].msgs().filter(m => m.s !== chats[c].mine).length;
  const unread = c => { if (!c) return unread('giftee') + unread('santa'); let r = 0; try { r = +localStorage.getItem(readKey(c)) || 0; } catch {} return Math.max(0, incoming(c) - r); };
  let chat = null;
  const thread = (msgs, mineFlag) => msgs.length
    ? msgs.map(m => `<div class="msg ${m.s === mineFlag ? 'mine' : ''}">${esc(m.x)}</div>`).join('')
    : '<p class="muted">No messages yet.</p>';
  const giftBox = label => `
    <svg class="gift" id="gift" viewBox="0 0 100 100" role="button" aria-label="Open to reveal">
      <rect x="14" y="44" width="72" height="50" rx="4" fill="#b3262f"/>
      <rect x="45" y="44" width="10" height="50" fill="#c99a3b"/>
      <g class="lid"><rect x="8" y="30" width="84" height="16" rx="3" fill="#8f1d25"/>
      <rect x="45" y="30" width="10" height="16" fill="#c99a3b"/>
      <path d="M50 30 C 34 10, 22 26, 50 30 C 78 26, 66 10, 50 30" fill="none" stroke="#c99a3b" stroke-width="5"/></g>
    </svg>
    <p class="muted">${label}</p>`;
  // Amazon search box. On My list results get "+ Add"; on My person they link to the shop.
  const search = (where, title, hint) => {
    const s = shop[where];
    return `<div class="card">
      <h2>${title}</h2>
      <form class="search" data-shop="${where}"><input type="search" name="q" value="${esc(s.q)}" placeholder="${hint}" enterkeyhint="search"><button aria-label="Search Amazon">🔍</button></form>
      ${s.results === 'busy' ? '<p class="muted">Searching Amazon…</p>'
        : s.results ? itemList(s.results, where === 'list' ? 'add' : 'theirs', "Amazon didn't send results this time.") : ''}
      ${s.q && s.results !== 'busy' ? `<a class="more" href="https://www.amazon.com/s?k=${encodeURIComponent(s.q)}" target="_blank" rel="noopener">See results on Amazon ↗</a>
        ${where === 'list' ? '<p class="muted" style="margin:6px 0 0">Found something there? Copy its link and paste it below.</p>' : ''}` : ''}
    </div>`;
  };
  const initial = n => esc([...n.trim()][0] || '?').toUpperCase();

  const pages = {
    person: () => `
      <div class="card reveal">
        ${showing ? `<div class="tag">You're the Secret Santa for</div>
          <div class="name">${esc(d.giftee.name)}</div>
          <button class="ghost" id="hide">Close the present</button>
          <p class="muted">It closes by itself in a few seconds.</p>`
        : `<div class="tag">Hi ${esc(d.me.name)}, ${opened ? 'your person is in the present' : "you're a Secret Santa"}</div>
          ${giftBox(opened ? 'Tap to peek again' : 'Tap the gift to see who')}`}
        ${facts(d)}
      </div>
      ${opened ? `<div class="card">
        <h2>Your person's wish list</h2>
        ${itemList(d.giftee.items, 'theirs', "They haven't added anything yet. Check back, or ask in Messages.")}
      </div>
      ${search('person', 'Find a gift', 'Search Amazon for gift ideas')}` : ''}
      ${install.card()}`,
    messages: () => {
      if (chat) {
        const c = chats[chat];
        return `<div class="chat">
          <div class="chat-top"><button class="ghost" id="back">← Back</button><b>${c.icon} ${c.title}</b></div>
          <p class="muted chat-note">${c.note}</p>
          <div class="msgs">${thread(c.msgs(), c.mine)}</div>
          <form class="chat-send" id="send"><input name="t" maxlength="500" placeholder="${c.hint}" autocomplete="off"><button>Send</button></form>
        </div>`;
      }
      return `<div class="card">
        <h2>Messages</h2>
        <p class="muted" style="margin-top:0">Chats stay closed until you tap one, so nobody glancing at your phone sees them.</p>
        <div class="convos">${Object.entries(chats).map(([id, c]) => {
          const locked = id === 'giftee' && !opened, n = unread(id);
          return `<button class="convo" data-chat="${id}" ${locked ? 'disabled' : ''}>
            <span class="av">${c.icon}</span>
            <span class="cv"><b>${c.title}</b><small>${locked ? 'Open your present first' : n ? `${n} new message${n > 1 ? 's' : ''}` : 'Tap to open'}</small></span>
            ${n ? `<b class="dot">${n}</b>` : '<span class="muted">›</span>'}
          </button>`;
        }).join('')}</div>
      </div>`;
    },
    list: () => `
      <div class="card">
        <h2>My wish list${d.me.items.length ? ` <span class="count">${d.me.items.length}</span>` : ''}</h2>
        ${itemList(d.me.items, 'mine', 'Nothing yet. Search Amazon or paste a link below.')}
      </div>
      ${search('list', 'Add gifts', 'Search Amazon')}
      <div class="card">
        <details${paste ?? !shop.list.results ? ' open' : ''}>
          <summary>Paste a link or write your own</summary>
          <label for="addUrl">Link from any shop</label>
          <input id="addUrl" type="url" inputmode="url" placeholder="https://…">
          <label for="addName">Name <span class="muted">(optional with a link)</span></label>
          <input id="addName" maxlength="120" placeholder="Wool socks">
          <label for="addNote">Note <span class="muted">(size, color…)</span></label>
          <input id="addNote" maxlength="300" placeholder="Size L, any dark color">
          <div class="row" style="margin-top:12px">
            <button class="ghost" id="addPhoto">📷 Add photo</button>
            <span class="muted" id="photoState">${photo ? '✓ Photo added' : ''}</span>
          </div>
          <button class="big" id="addItem" style="margin-top:8px">Add to list</button>
          <p class="err" id="err"></p>
        </details>
      </div>`,
    everyone: () => {
      if (!d.lists.length) return '<div class="card"><p class="muted">Nobody else is in this group yet.</p></div>';
      const l = d.lists[who] || d.lists[(who = 0)];
      return `<div class="who">${d.lists.map((p, i) => `<button class="${i === who ? 'on' : ''}" data-who="${i}">
          <span class="av">${initial(p.name)}</span><span class="nm">${esc(p.name)}</span><small>${p.viewer ? 'viewer' : `${p.items.length} item${p.items.length === 1 ? '' : 's'}`}</small></button>`).join('')}</div>
        <div class="card">
          <h2>${esc(l.name)}'s wish list</h2>
          ${itemList(l.items, 'theirs', 'Nothing added yet.')}
        </div>`;
    },
  };
  const tabs = d0 => d0.me.viewer
    ? [['list', '📝', 'My list'], ['everyone', '👥', 'Everyone']]
    : [['person', '🎁', 'My person'], ['messages', '💬', 'Messages'], ['list', '📝', 'My list'], ['everyone', '👥', 'Everyone']];

  const render = () => {
    document.getElementById('sub').textContent = d.name;
    if (!tabs(d).some(([id]) => id === tab)) tab = tabs(d)[0][0];
    if (tab !== 'messages') chat = null;
    if (chat) try { localStorage.setItem(readKey(chat), incoming(chat)); } catch {}
    const n = unread();
    app.innerHTML = `
      ${d.me.viewer && tab === 'list' ? `<div class="card reveal"><div class="tag">Hi ${esc(d.me.name)}</div>
        <p class="muted">You're a viewer: not in the name draw. Share your list and browse everyone else's.</p>${facts(d)}</div>` : ''}
      ${d.me.viewer && tab === 'list' ? install.card() : ''}
      ${pages[tab]()}
      <nav class="tabs">${tabs(d).map(([id, icon, label]) =>
        `<button class="${id === tab ? 'on' : ''}" data-tab="${id}"><span class="i">${icon}</span>${label}${id === 'messages' && n ? `<b class="badge">${n}</b>` : ''}</button>`).join('')}</nav>`;

    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = store(`santa.tab.${group}`, b.dataset.tab); showing = false; render(); scrollTo(0, 0); });
    install.bind();
    app.querySelectorAll('[data-who]').forEach(b => b.onclick = () => { who = +b.dataset.who; render(); });
    const err = msg => { const e = $('#err'); e ? (e.textContent = msg) : toast(msg); };
    const gift = $('#gift');
    if (gift) gift.onclick = () => {
      gift.classList.add('open');
      setTimeout(() => {
        opened = showing = true; store(`santa.open.${group}`, 1); render();
        clearTimeout(me.close);
        me.close = setTimeout(() => { if (showing) { showing = false; render(); } }, 10000);
      }, 450);
    };
    const hide = $('#hide');
    if (hide) hide.onclick = () => { showing = false; render(); };
    app.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => { chat = b.dataset.chat; render(); });
    const back = $('#back');
    if (back) back.onclick = () => { chat = null; render(); };
    const send = $('#send');
    if (send) send.onsubmit = async e => {
      e.preventDefault();
      const text = send.t.value.trim();
      if (!text) return;
      try { d = await call('/api/me/msg', { ...auth, body: { to: chat, text } }); render(); $('#send').t.focus(); }
      catch (e) { toast(e.message); }
    };
    app.querySelectorAll('.msgs').forEach(m => { m.scrollTop = m.scrollHeight; });

    app.querySelectorAll('[data-shop]').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const s = shop[f.dataset.shop];
      s.q = f.q.value.trim();
      if (!s.q) return;
      f.q.blur();
      s.results = 'busy'; render();
      try { s.results = (await call(`/api/me/shop?q=${encodeURIComponent(s.q)}`, auth)).results; }
      catch (e) { s.results = null; toast(e.message); }
      render();
    });
    app.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => {
      const r = shop.list.results[b.dataset.add];
      b.disabled = true; b.textContent = 'Adding…';
      try { d = await call('/api/me/item', { ...auth, body: r }); r.added = true; toast('Added to your list'); }
      catch (e) { toast(e.message); }
      render();
    });
    shop.list.results?.forEach?.((r, i) => { if (r.added) { const b = app.querySelector(`[data-add="${i}"]`); if (b) { b.disabled = true; b.textContent = '✓ Added'; } } });

    if (tab === 'list') {
      $('summary').onclick = () => { paste = !$('details').open; };
      $('#addPhoto').onclick = async () => {
        photo = await pickPhoto().catch(() => null);
        $('#photoState').textContent = photo ? '✓ Photo added' : '';
      };
      $('#addItem').onclick = async () => {
        const body = { u: $('#addUrl').value.trim(), t: $('#addName').value.trim(), n: $('#addNote').value.trim(), photo };
        if (!body.u && !body.t) return err('Paste a link or type a name.');
        const btn = $('#addItem');
        btn.disabled = true;
        btn.textContent = body.u ? 'Getting the picture…' : 'Adding…';
        try { d = await call('/api/me/item', { ...auth, body }); photo = null; render(); toast('Added'); }
        catch (e) { btn.disabled = false; btn.textContent = 'Add to list'; err(e.message); }
      };
      app.querySelectorAll('.item [data-act]').forEach(b => b.onclick = async () => {
        const id = b.closest('.item').dataset.id;
        try {
          if (b.dataset.act === 'del') {
            if (!confirm('Remove this from your list?')) return;
            d = await call('/api/me/item/remove', { ...auth, body: { id } });
          } else {
            const p = await pickPhoto();
            if (!p) return;
            b.textContent = '…';
            d = await call('/api/me/item/photo', { ...auth, body: { id, photo: p } });
          }
          render();
        } catch (e) { err(e.message); }
      });
    }
  };

  document.onvisibilitychange = () => { if (document.hidden && (chat || showing)) { chat = null; showing = false; render(); } };
  opened = !!store(`santa.open.${group}`);
  tab = store(`santa.tab.${group}`);
  try { d = await call('/api/me', auth); } catch (e) { return oops(e.message); }
  remember({ gid: group, kind: 'me', key, name: `${d.name} · ${d.me.name}` });
  render();
  // Pick up new messages and list changes while the page is open, unless the person is typing.
  clearInterval(me.timer);
  me.ticks = 0;
  me.timer = setInterval(async () => {
    const typing = [...app.querySelectorAll('input')].some(i => i.value) || photo;
    // Every 5 s while a chat is open, otherwise every 30 s.
    if (document.hidden || typing || !location.hash.startsWith('#me/') || (!chat && ++me.ticks % 6)) return;
    try {
      const fresh = await call('/api/me', auth);
      if (JSON.stringify(fresh) !== JSON.stringify(d)) { d = fresh; render(); }
    } catch {}
  }, 5000);
}

/* ---------- Account: email + password ---------- */
function accountPage(mode = 'login') {
  document.getElementById('sub').textContent = 'Your account';
  if (account.email) {
    app.innerHTML = `
      <div class="card"><h2>Signed in</h2><p>${esc(account.email)}</p>
        <p class="muted">Every group you create or link you open while signed in is saved here, on any phone or computer.</p>
        <button class="ghost" id="out">Log out</button></div>
      ${groupsCard(account.links) || '<div class="card"><p class="muted">No groups yet. Open your private link or create a group and it shows up here.</p></div>'}`;
    $('#out').onclick = async () => { account = await call('/api/auth/logout', { body: {} }); account.links = []; showAccount(); location.hash = ''; };
    return;
  }
  if (mode === 'forgot') return forgotPage();
  const signup = mode === 'signup';
  app.innerHTML = `
    <div class="card">
      <h2>${signup ? 'Create an account' : 'Log in'}</h2>
      <p class="muted" style="margin-top:0">An account keeps your groups and private links, so you can open them on any phone or computer.</p>
      <form id="f">
        <label for="email">Email</label><input id="email" type="email" autocomplete="email" required>
        <label for="pw">Password</label><input id="pw" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" ${signup ? 'minlength="8" placeholder="At least 8 characters"' : ''} required>
        <p class="err" id="err"></p>
        <button class="big" style="margin-top:4px">${signup ? 'Create account' : 'Log in'}</button>
      </form>
      <p class="muted" style="text-align:center">${signup ? 'Have an account? <a href="#account">Log in</a>' : 'New here? <a href="#account/signup">Create an account</a><br><a href="#account/forgot">Forgot password?</a>'}</p>
    </div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    try {
      await call(`/api/auth/${signup ? 'signup' : 'login'}`, { body: { email: $('#email').value, password: $('#pw').value } });
      await loadAccount();
      // Bring along the links this device already knew about.
      for (const l of saved.all()) if (!account.links.some(x => same(x, l))) account = await call('/api/auth/link', { body: l }).catch(() => account);
      accountPage();
      toast(signup ? 'Account created' : 'Logged in');
    } catch (err) { $('#err').textContent = err.message; }
  };
}

function forgotPage() {
  app.innerHTML = `
    <div class="card">
      <h2>Forgot password</h2>
      <p class="muted" style="margin-top:0">Enter your account email and we'll send a link to choose a new password.</p>
      <form id="f">
        <label for="email">Email</label><input id="email" type="email" autocomplete="email" required>
        <p class="err" id="err"></p>
        <button class="big" style="margin-top:4px">Send reset link</button>
      </form>
      <p class="muted" style="text-align:center"><a href="#account">Back to log in</a></p>
    </div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#f button');
    btn.disabled = true;
    try {
      await call('/api/auth/forgot', { body: { email: $('#email').value } });
      $('#f').innerHTML = `<p>If <b>${esc($('#email').value)}</b> has an account, a reset link is on its way. It works for one hour. Check your spam folder too.</p>`;
    } catch (err) { $('#err').textContent = err.message; btn.disabled = false; }
  };
}

function resetPage(token) {
  document.getElementById('sub').textContent = 'Your account';
  app.innerHTML = `
    <div class="card">
      <h2>Choose a new password</h2>
      <form id="f">
        <label for="pw">New password</label><input id="pw" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required>
        <p class="err" id="err"></p>
        <button class="big" style="margin-top:4px">Save password</button>
      </form>
    </div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    try {
      await call('/api/auth/reset', { body: { token, password: $('#pw').value } });
      await loadAccount();
      toast('Password changed');
      location.hash = 'account';
    } catch (err) { $('#err').textContent = err.message; }
  };
}

/* ---------- Developer page: #dev/<key> ---------- */
async function devPage(key) {
  document.getElementById('sub').textContent = 'Developer tools';
  const h = { 'x-dev': key };
  const get = async path => { const res = await fetch(path, { headers: h }); const d = await res.json(); if (!res.ok) throw new Error(d.error); return d; };
  const post = async (path, body = {}) => { const res = await fetch(path, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) }); const d = await res.json(); if (!res.ok) throw new Error(d.error); return d; };
  let kind = '', open = new Set(), stats, logs;
  const when = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const tile = (n, label) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`;
  const render = () => {
    app.innerHTML = `
      <div class="card">
        <h2>Overview</h2>
        <div class="tiles">${tile(stats.groups, 'groups')}${tile(stats.people, 'people')}${tile(stats.items, 'wish items')}${tile(stats.photos, 'photos')}${tile(stats.users, 'accounts')}${tile(stats.errors24h, 'errors (24h)')}</div>
        <h3>Last 7 days</h3>
        <ul class="people">${stats.week.map(w => `<li><span class="who"><span class="lk ${w.kind}">${w.kind}</span> ${esc(w.msg)}</span><b>${w.n}</b></li>`).join('') || '<li class="muted">Nothing logged yet.</li>'}</ul>
      </div>
      <div class="card">
        <h2>Health check</h2>
        <p class="muted" style="margin-top:0">Runs each part of the app for real: database, Amazon search, link pictures, email.</p>
        <button id="check">Run checks</button>
        <div id="checks"></div>
        <h3>Test email</h3>
        <form class="search" id="mail"><input name="to" type="email" placeholder="you@example.com" required><button>Send</button></form>
      </div>
      <div class="card">
        <h2>Log</h2>
        <div class="row" style="flex-wrap:wrap">${[['', 'All'], ['error', 'Server errors'], ['client', 'Browser errors'], ['warn', 'Warnings'], ['event', 'Activity']].map(([k, l]) =>
          `<button class="${k === kind ? '' : 'ghost'}" data-kind="${k}">${l}</button>`).join('')}</div>
        <div class="row"><button class="ghost" id="refresh">↻ Refresh</button><button class="ghost" id="clear">Clear log</button></div>
        <div class="logs">${logs.map(l => `<div class="log" data-id="${l.id}">
          <div><span class="lk ${l.kind}">${l.kind}</span> <b>${esc(l.msg)}</b></div>
          <small>${when(l.t)} · ${esc(l.path)}</small>
          ${open.has(l.id) && l.detail ? `<pre>${esc(l.detail)}</pre>` : ''}
        </div>`).join('') || '<p class="muted">Nothing here.</p>'}</div>
      </div>`;
    app.querySelectorAll('[data-kind]').forEach(b => b.onclick = async () => { kind = b.dataset.kind; await load(); });
    app.querySelectorAll('.log').forEach(el => el.onclick = () => { const id = +el.dataset.id; open.has(id) ? open.delete(id) : open.add(id); render(); });
    $('#refresh').onclick = load;
    $('#clear').onclick = async () => { if (confirm('Delete every log entry?')) { await post('/api/dev/clear'); await load(); } };
    $('#check').onclick = async () => {
      $('#check').disabled = true; $('#checks').innerHTML = '<p class="muted">Checking… (up to 30 s)</p>';
      try {
        const { checks } = await post('/api/dev/check');
        $('#checks').innerHTML = `<ul class="people">${checks.map(([name, c]) => `<li><span class="who">${c.ok ? '✅' : '❌'} ${name}<small>${esc(c.note || '')}</small></span>${c.ms != null ? `<span class="muted">${c.ms} ms</span>` : ''}</li>`).join('')}</ul>`;
      } catch (e) { $('#checks').textContent = e.message; }
      $('#check').disabled = false;
    };
    $('#mail').onsubmit = async e => {
      e.preventDefault();
      try { await post('/api/dev/mail', { to: e.target.to.value }); toast('Test email sent'); } catch (err) { toast(err.message); }
    };
  };
  const load = async () => {
    try { [stats, logs] = await Promise.all([get('/api/dev/stats'), get(`/api/dev/logs?kind=${kind}`).then(d => d.logs)]); render(); }
    catch (e) { oops(e.message); }
  };
  await load();
}

function oops(msg) {
  app.innerHTML = `<div class="card"><h2>Hmm.</h2><p>${esc(msg)}</p><a href="#"><button class="ghost">Start a new group</button></a></div>`;
}

function route() {
  const [view, group, key] = location.hash.slice(1).split('/');
  window.scrollTo(0, 0);
  if (view === 'account') accountPage(group);
  else if (view === 'reset' && group) resetPage(group);
  else if (view === 'dev' && group) devPage(group);
  else if (view === 'admin' && key) admin(group, key);
  else if (view === 'me' && key) me(group, key);
  else home();
}
window.addEventListener('hashchange', route);
loadAccount().finally(route);
