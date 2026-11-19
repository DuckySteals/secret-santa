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
async function me(group, key) {
  const auth = { group, key };
  let d, opened = false;
  const thread = (msgs, mineFlag) => msgs.length
    ? msgs.map(m => `<div class="msg ${m.s === mineFlag ? 'mine' : ''}">${esc(m.x)}</div>`).join('')
    : '<p class="muted">No messages yet.</p>';
  const render = () => {
    document.getElementById('sub').textContent = d.name;
    const keepWish = $('#mywish')?.value;
    const viewer = d.me.viewer;
    const others = d.lists.filter(l => l.name !== d.giftee?.name);
    app.innerHTML = `${viewer ? `
      <div class="card reveal">
        <div class="tag">Hi ${esc(d.me.name)}</div>
        <div class="name" style="font-size:30px">You're a viewer</div>
        <p class="muted">You're not in the name draw. Share your wish list and browse everyone else's.</p>
        ${facts(d)}
      </div>` : `
      <div class="card reveal">
        <div class="tag">Hi ${esc(d.me.name)}, you're the Secret Santa for</div>
        ${opened ? `<div class="name">${esc(d.giftee.name)}</div>` : `
          <svg class="gift" id="gift" viewBox="0 0 100 100" role="button" aria-label="Open to reveal">
            <rect x="14" y="44" width="72" height="50" rx="4" fill="#b3262f"/>
            <rect x="45" y="44" width="10" height="50" fill="#c99a3b"/>
            <g class="lid"><rect x="8" y="30" width="84" height="16" rx="3" fill="#8f1d25"/>
            <rect x="45" y="30" width="10" height="16" fill="#c99a3b"/>
            <path d="M50 30 C 34 10, 22 26, 50 30 C 78 26, 66 10, 50 30" fill="none" stroke="#c99a3b" stroke-width="5"/></g>
          </svg>
          <p class="muted">Tap the gift to see who</p>`}
        ${facts(d)}
      </div>`}
      ${opened && !viewer ? `
      <div class="card">
        <h2>${esc(d.giftee.name)}'s wish list</h2>
        ${d.giftee.wish ? `<p class="wish">${linkify(d.giftee.wish)}</p>` : `<p class="muted">${esc(d.giftee.name)} hasn't written one yet. Check back, or ask below.</p>`}
        <h3>Ask ${esc(d.giftee.name)} a question</h3>
        <p class="muted" style="margin-top:0">They'll see it as from "your Secret Santa".</p>
        <div class="msgs">${thread(d.toGiftee, 1)}</div>
        <div class="row"><input id="toGiftee" maxlength="500" placeholder="What size do you wear?"><button id="sendGiftee">Send</button></div>
      </div>` : ''}
      <div class="card">
        <h2>Your wish list</h2>
        <p class="muted" style="margin-top:0">Everyone in the group can see this. Add ideas, sizes, links.</p>
        <textarea id="mywish" maxlength="2000" placeholder="Wool socks (size L)&#10;A good book&#10;https://…">${esc(keepWish ?? d.me.wish)}</textarea>
        <button id="savewish" style="margin-top:8px">Save wish list</button>
        ${viewer ? '' : `<h3>Messages from your Secret Santa</h3>
        <div class="msgs">${thread(d.fromSanta, 0)}</div>
        ${d.fromSanta.length ? `<div class="row"><input id="toSanta" maxlength="500" placeholder="Reply…"><button id="sendSanta">Reply</button></div>` : ''}`}
        <p class="err" id="err"></p>
      </div>
      <div class="card">
        <h2>Everyone's wish lists</h2>
        ${others.length ? others.map(l => `<h3>${esc(l.name)}${l.viewer ? ' <span class="muted">(viewer)</span>' : ''}</h3><p class="wish">${linkify(l.wish)}</p>`).join('')
          : '<p class="muted">Nobody else has written one yet.</p>'}
      </div>`;

    const gift = $('#gift');
    if (gift) gift.onclick = () => {
      gift.classList.add('open');
      setTimeout(() => { opened = true; try { sessionStorage.setItem(`santa.open.${group}`, 1); } catch {} render(); }, 450);
    };
    $('#savewish').onclick = async () => {
      try { d = await call('/api/me/wish', { ...auth, body: { wish: $('#mywish').value } }); render(); toast('Wish list saved'); }
      catch (e) { $('#err').textContent = e.message; }
    };
    const sender = (input, btn, to) => {
      const el = $(input);
      if (!el) return;
      const send = async () => {
        if (!el.value.trim()) return;
        try { d = await call('/api/me/msg', { ...auth, body: { to, text: el.value } }); render(); toast('Sent'); }
        catch (e) { $('#err').textContent = e.message; }
      };
      $(btn).onclick = send;
      el.onkeydown = e => { if (e.key === 'Enter') send(); };
    };
    sender('#toGiftee', '#sendGiftee', 'giftee');
    sender('#toSanta', '#sendSanta', 'santa');
    app.querySelectorAll('.msgs').forEach(m => { m.scrollTop = m.scrollHeight; });
  };
  try { opened = !!sessionStorage.getItem(`santa.open.${group}`); } catch {}
  try { d = await call('/api/me', auth); } catch (e) { return oops(e.message); }
  render();
  // Pick up new messages while the page is open, unless the person is typing.
  clearInterval(me.timer);
  me.timer = setInterval(async () => {
    const typing = ['toGiftee', 'toSanta'].some(id => document.getElementById(id)?.value);
    if (document.hidden || typing || !location.hash.startsWith('#me/')) return;
    try {
      const fresh = await call('/api/me', auth);
      if (JSON.stringify([fresh.toGiftee, fresh.fromSanta, fresh.giftee, fresh.lists]) !== JSON.stringify([d.toGiftee, d.fromSanta, d.giftee, d.lists])) { d = fresh; render(); }
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
