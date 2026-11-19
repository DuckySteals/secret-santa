const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
const $ = sel => app.querySelector(sel);

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

// Groups this browser organizes, so the organizer can find them again.
const saved = {
  all() { try { return JSON.parse(localStorage.getItem('santa.groups')) || []; } catch { return []; } },
  add(g) { try { localStorage.setItem('santa.groups', JSON.stringify([g, ...this.all().filter(x => x.id !== g.id)])); } catch {} },
  drop(id) { try { localStorage.setItem('santa.groups', JSON.stringify(this.all().filter(x => x.id !== id))); } catch {} },
};

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

/* ---------- Create a group ---------- */
function home() {
  document.getElementById('sub').textContent = 'Draw names, share wish lists, keep the secret.';
  const mine = saved.all();
  app.innerHTML = `
    ${mine.length ? `<div class="card"><h2>Your groups</h2><ul class="people">${mine.map(g => `
      <li><span class="who">${esc(g.name)}</span><a href="#admin/${g.id}/${g.admin}"><button class="ghost">Manage</button></a></li>`).join('')}</ul></div>` : ''}
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
      saved.add({ id: g.id, admin: g.admin, name });
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
        <h2>Options</h2>
        <div class="row" style="flex-wrap:wrap">
          <button class="ghost" id="redraw">Redraw all names</button>
          <button class="ghost" id="delete">Delete group</button>
        </div>
      </div>`;

    app.querySelectorAll('.people li').forEach(li => {
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
    $('#redraw').onclick = () => confirm('Redraw everyone? Old links still work but show a new person.') && act('/api/admin/redraw', {});
    $('#delete').onclick = async () => {
      if (!confirm(`Delete "${g.name}" for everyone? This can't be undone.`)) return;
      await call('/api/admin/delete', { ...auth, body: {} });
      saved.drop(group);
      location.hash = '';
    };
  };
  const act = async (path, body, reshuffle = true) => {
    try { g = await call(path, { ...auth, body }); render(); toast(reshuffle ? 'Names redrawn' : 'Done'); }
    catch (e) { $('#err').textContent = e.message; }
  };
  try { g = await call('/api/admin', auth); } catch (e) { return oops(e.message); }
  saved.add({ id: group, admin: key, name: g.name });
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

function itemCard(it, mine) {
  const open = it.u ? `href="${esc(it.u)}" target="_blank" rel="noopener"` : '';
  const pic = it.img
    ? `<img src="${esc(it.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'🎁'}))">`
    : '<span>🎁</span>';
  return `<div class="item" data-id="${it.id}">
    <a class="pic" ${open}>${pic}</a>
    <div class="info">
      ${it.u ? `<a class="t" ${open}>${esc(it.t)}</a>` : `<span class="t">${esc(it.t)}</span>`}
      <div class="meta">${[it.u && host(it.u), it.price].filter(Boolean).map(esc).join(' · ')}</div>
      ${it.n ? `<div class="note">${esc(it.n)}</div>` : ''}
      ${mine ? `<div class="acts"><button class="ghost" data-act="photo">${it.img ? 'Change photo' : 'Add photo'}</button><button class="ghost" data-act="del">Remove</button></div>` : ''}
    </div>
  </div>`;
}
const itemList = (items, mine, empty) => items.length
  ? `<div class="items">${items.map(it => itemCard(it, mine)).join('')}</div>`
  : `<p class="muted">${empty}</p>`;

async function me(group, key) {
  const auth = { group, key };
  let d, opened = false, tab;
  const store = (k, v) => { try { v === undefined ? (v = sessionStorage.getItem(k)) : sessionStorage.setItem(k, v); } catch {} return v; };
  const readKey = `santa.read.${group}`;
  const incoming = () => d.toGiftee.filter(m => m.s === 0).length + d.fromSanta.filter(m => m.s === 1).length;
  const unread = () => { let r = 0; try { r = +localStorage.getItem(readKey) || 0; } catch {} return Math.max(0, incoming() - r); };
  const thread = (msgs, mineFlag) => msgs.length
    ? msgs.map(m => `<div class="msg ${m.s === mineFlag ? 'mine' : ''}">${esc(m.x)}</div>`).join('')
    : '<p class="muted">No messages yet.</p>';
  const giftBox = `
    <svg class="gift" id="gift" viewBox="0 0 100 100" role="button" aria-label="Open to reveal">
      <rect x="14" y="44" width="72" height="50" rx="4" fill="#b3262f"/>
      <rect x="45" y="44" width="10" height="50" fill="#c99a3b"/>
      <g class="lid"><rect x="8" y="30" width="84" height="16" rx="3" fill="#8f1d25"/>
      <rect x="45" y="30" width="10" height="16" fill="#c99a3b"/>
      <path d="M50 30 C 34 10, 22 26, 50 30 C 78 26, 66 10, 50 30" fill="none" stroke="#c99a3b" stroke-width="5"/></g>
    </svg>
    <p class="muted">Tap the gift to see who</p>`;

  const pages = {
    person: () => `
      <div class="card reveal">
        <div class="tag">Hi ${esc(d.me.name)}, you're the Secret Santa for</div>
        ${opened ? `<div class="name">${esc(d.giftee.name)}</div>` : giftBox}
        ${facts(d)}
      </div>
      ${opened ? `<div class="card">
        <h2>${esc(d.giftee.name)}'s wish list</h2>
        ${itemList(d.giftee.items, false, `${esc(d.giftee.name)} hasn't added anything yet. Check back, or ask in Messages.`)}
      </div>` : ''}`,
    messages: () => `
      ${opened ? `<div class="card">
        <h2>Ask ${esc(d.giftee.name)}</h2>
        <p class="muted" style="margin-top:0">They'll see it as from "your Secret Santa".</p>
        <div class="msgs">${thread(d.toGiftee, 1)}</div>
        <div class="row"><input id="toGiftee" maxlength="500" placeholder="What size do you wear?"><button id="sendGiftee">Send</button></div>
      </div>` : `<div class="card"><p class="muted">Open your gift on the first tab to message your person.</p></div>`}
      <div class="card">
        <h2>From your Secret Santa</h2>
        <div class="msgs">${thread(d.fromSanta, 0)}</div>
        ${d.fromSanta.length ? `<div class="row"><input id="toSanta" maxlength="500" placeholder="Reply…"><button id="sendSanta">Reply</button></div>` : ''}
      </div>`,
    list: () => `
      <div class="card">
        <h2>Add to your list</h2>
        <p class="muted" style="margin-top:0">Paste a link and the picture and name fill in. Everyone in the group can see your list.</p>
        <label for="addUrl">Link</label>
        <input id="addUrl" type="url" inputmode="url" placeholder="https://www.amazon.com/…">
        <label for="addName">Name <span class="muted">(optional with a link)</span></label>
        <input id="addName" maxlength="120" placeholder="Wool socks">
        <label for="addNote">Note <span class="muted">(size, color…)</span></label>
        <input id="addNote" maxlength="300" placeholder="Size L, any dark color">
        <div class="row" style="margin-top:12px">
          <button class="ghost" id="addPhoto">📷 Add photo</button>
          <span class="muted" id="photoState"></span>
        </div>
        <button class="big" id="addItem" style="margin-top:8px">Add to list</button>
        <p class="err" id="err"></p>
      </div>
      <div class="card">
        <h2>Your list</h2>
        ${itemList(d.me.items, true, 'Nothing yet. Add your first idea above.')}
      </div>`,
    everyone: () => `
      ${d.lists.map(l => `<div class="card">
        <h2>${esc(l.name)}${l.viewer ? ' <span class="muted" style="font-size:15px">(viewer)</span>' : ''}</h2>
        ${itemList(l.items, false, 'Nothing added yet.')}
      </div>`).join('') || '<div class="card"><p class="muted">Nobody else is in this group yet.</p></div>'}`,
  };
  const tabs = d0 => d0.me.viewer
    ? [['list', '📝', 'My list'], ['everyone', '👥', 'Everyone']]
    : [['person', '🎁', 'My person'], ['messages', '💬', 'Messages'], ['list', '📝', 'My list'], ['everyone', '👥', 'Everyone']];

  let photo = null;
  const render = () => {
    document.getElementById('sub').textContent = d.name;
    if (!tabs(d).some(([id]) => id === tab)) tab = tabs(d)[0][0];
    if (tab === 'messages') try { localStorage.setItem(readKey, incoming()); } catch {}
    const n = unread();
    app.innerHTML = `
      <nav class="tabs">${tabs(d).map(([id, icon, label]) =>
        `<button class="${id === tab ? 'on' : ''}" data-tab="${id}"><span class="i">${icon}</span>${label}${id === 'messages' && n ? `<b class="badge">${n}</b>` : ''}</button>`).join('')}</nav>
      ${d.me.viewer && tab === 'list' ? `<div class="card reveal"><div class="tag">Hi ${esc(d.me.name)}</div>
        <p class="muted">You're a viewer: not in the name draw. Share your list and browse everyone else's.</p>${facts(d)}</div>` : ''}
      ${pages[tab]()}`;

    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = store(`santa.tab.${group}`, b.dataset.tab); render(); scrollTo(0, 0); });
    const err = msg => { const e = $('#err'); e ? (e.textContent = msg) : toast(msg); };
    const gift = $('#gift');
    if (gift) gift.onclick = () => {
      gift.classList.add('open');
      setTimeout(() => { opened = true; store(`santa.open.${group}`, 1); render(); }, 450);
    };
    const sender = (input, btn, to) => {
      const el = $(input);
      if (!el) return;
      const send = async () => {
        if (!el.value.trim()) return;
        try { d = await call('/api/me/msg', { ...auth, body: { to, text: el.value } }); render(); toast('Sent'); }
        catch (e) { toast(e.message); }
      };
      $(btn).onclick = send;
      el.onkeydown = e => { if (e.key === 'Enter') send(); };
    };
    sender('#toGiftee', '#sendGiftee', 'giftee');
    sender('#toSanta', '#sendSanta', 'santa');
    app.querySelectorAll('.msgs').forEach(m => { m.scrollTop = m.scrollHeight; });

    if (tab === 'list') {
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
            b.textContent = 'Uploading…';
            d = await call('/api/me/item/photo', { ...auth, body: { id, photo: p } });
          }
          render();
        } catch (e) { err(e.message); }
      });
    }
  };

  opened = !!store(`santa.open.${group}`);
  tab = store(`santa.tab.${group}`);
  try { d = await call('/api/me', auth); } catch (e) { return oops(e.message); }
  render();
  // Pick up new messages and list changes while the page is open, unless the person is typing.
  clearInterval(me.timer);
  me.timer = setInterval(async () => {
    const typing = [...app.querySelectorAll('input')].some(i => i.value) || photo;
    if (document.hidden || typing || !location.hash.startsWith('#me/')) return;
    try {
      const fresh = await call('/api/me', auth);
      if (JSON.stringify(fresh) !== JSON.stringify(d)) { d = fresh; render(); }
    } catch {}
  }, 30000);
}

function oops(msg) {
  app.innerHTML = `<div class="card"><h2>Hmm.</h2><p>${esc(msg)}</p><a href="#"><button class="ghost">Start a new group</button></a></div>`;
}

function route() {
  const [view, group, key] = location.hash.slice(1).split('/');
  window.scrollTo(0, 0);
  if (view === 'admin' && key) admin(group, key);
  else if (view === 'me' && key) me(group, key);
  else home();
}
window.addEventListener('hashchange', route);
route();
