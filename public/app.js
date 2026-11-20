const C = window.YVO;
const sb = window.supabase?.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
const DIVS = ['cch', 'fs', 'vfx', 'gfx', 'staff'];
const ROLES = ['member', 'staff', 'admin', 'co-owner', 'owner'];
const GROUPS = ['owner', 'co-owner', 'admin', ...DIVS];
const rank = role => ({ member: 1, staff: 2, admin: 3, 'co-owner': 4, owner: 5 })[role] || 0;
const label = value => ({ owner: 'Owner', 'co-owner': 'Co-Owner', admin: 'Admin', staff: 'Staff', member: 'Member' })[value] || String(value).toUpperCase();
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safe = value => /^https?:\/\//i.test(value || '') ? esc(value) : '#';
const initials = value => esc((value || 'YV').slice(0, 2).toUpperCase());
const identity = () => import('https://esm.sh/@netlify/identity@2.0.1?bundle');
let me = null, authMode = localStorage.getItem('yvo-auth-provider') || 'identity';
let cleanPane = () => {}, routeId = 0, toastTimer, currentAdmin, publicMembers = [];
const avatar = (p, name = p.displayName || p.username) => `<div class="av">${p.avatarUrl ? `<img src="${safe(p.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : initials(name)}</div>`;
const empty = (title, description = '') => `<div class="empty"><div class="empty-icon" aria-hidden="true">//</div><h3>${esc(title)}</h3><p>${esc(description)}</p></div>`;
const pageHead = (eyebrow, title, description = '', action = '') => `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>${action}</div>`;
const checkboxes = (selected = []) => `<fieldset><legend>Divisions</legend>${DIVS.map(d => `<label class="lbl"><input type="checkbox" name="division" value="${d}" ${selected.includes(d) ? 'checked' : ''}>${label(d)}</label>`).join('')}</fieldset>`;
const options = (values, selected) => values.map(v => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label(v)}</option>`).join('');
const selectedDivisions = form => [...form.querySelectorAll('[name=division]:checked')].map(el => el.value);
const formData = form => Object.fromEntries(new FormData(form));
function notify(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200);
}
async function request(path, payload) {
  const headers = {};
  if (authMode === 'legacy' && sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) { headers.Authorization = 'Bearer ' + session.access_token; headers['X-YVO-Auth'] = 'legacy'; }
  }
  if (payload) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api/' + path, { method: payload ? 'POST' : 'GET', headers, credentials: 'same-origin', ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Could not connect. Please try again.');
  return data;
}
const api = (action, payload = {}) => request('action', { ...payload, action });
function renderNav() {
  const page = location.hash.split('/')[1] || '';
  $('#nav').innerHTML = `<a class="logo" href="#/" aria-label="Team YVO home"><img src="/assets/yvo-mark.png" alt=""><span>TEAM <b>YVO</b></span></a>
    <a href="#/" ${!page ? 'class="active" aria-current="page"' : ''}>Home</a>
    <a href="#/roster" ${page === 'roster' ? 'class="active" aria-current="page"' : ''}>Roster</a>
    ${me ? `<a href="#/hub" ${page === 'hub' ? 'class="active" aria-current="page"' : ''}>Hub</a>${rank(me.role) >= 3 ? `<a href="#/admin" ${page === 'admin' ? 'class="active" aria-current="page"' : ''}>Manage</a>` : ''}` : ''}
    <span class="nav-divider" aria-hidden="true"></span>${me ? `<button class="ghost small" id="logout">Log out</button>` : '<a class="btn" href="#/login">Team login <span aria-hidden="true">↗</span></a>'}`;
  if ($('#logout')) $('#logout').onclick = async () => {
    try {
      if (authMode === 'legacy') await sb?.auth.signOut();
      else await (await identity()).logout();
      me = null; localStorage.removeItem('yvo-auth-provider'); authMode = 'identity';
      renderNav(); if (location.hash === '#/') route(); else location.hash = '#/';
    } catch { notify('Could not log out. Please try again.'); }
  };
}
async function loadMe() {
  try { ({ me } = await request('me')); }
  catch { me = null; }
  renderNav();
}
function tiktokFeed() {
  return `<div class="tiktok-shell"><div class="feed-label"><span><i class="live-dot"></i>From the team</span><span>TikTok / @teamyvo</span></div>
    <blockquote class="tiktok-embed" cite="https://www.tiktok.com/@teamyvo" data-unique-id="teamyvo" data-embed-type="creator"><section>
      <a class="handle" href="https://www.tiktok.com/@teamyvo" target="_blank" rel="noopener noreferrer">@teamyvo ↗</a><p>Freestyles, clips, and the people behind Team YVO.</p><a class="ghost small" href="https://www.tiktok.com/@teamyvo" target="_blank" rel="noopener noreferrer">Watch the latest posts</a>
    </section></blockquote><p class="feed-fallback">Feed not loading? <a href="https://www.tiktok.com/@teamyvo" target="_blank" rel="noopener noreferrer">Watch the latest on TikTok ↗</a></p></div>`;
}
function mountTikTok() {
  document.querySelector('script[data-tiktok]')?.remove();
  const script = document.createElement('script'); script.src = 'https://www.tiktok.com/embed.js'; script.async = true; script.dataset.tiktok = 'true';
  document.body.append(script);
}
function postTiles(posts) {
  return posts.length ? `<div class="posts-grid">${posts.map(p => `<a class="tile" href="${safe(p.shareUrl)}" target="_blank" rel="noopener noreferrer">${p.coverUrl ? `<img src="${safe(p.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span>${esc(p.title || 'Watch on TikTok')} ↗</span></a>`).join('')}</div>` : '';
}
async function home() {
  $('#app').innerHTML = `<section class="hero"><div class="hero-copy"><div class="eyebrow">Rocket League. Creative culture.</div>
    <h1>BUILT FOR<br>THE <em>GAME.</em><br>MADE TO<br>BE SEEN.</h1><p>${esc(C.STORY[0])} From the first touch to the final frame. This is Team YVO.</p>
    <div class="hero-actions"><a class="btn" href="#/roster">Meet the roster <span aria-hidden="true">↗</span></a><a class="ghost" href="https://www.tiktok.com/@teamyvo" target="_blank" rel="noopener noreferrer">Watch the clips <span aria-hidden="true">▷</span></a></div></div>
    <div class="hero-visual" aria-label="Team YVO Rocket League arena graphic"><span class="visual-corner top">YVO // EST. TO CREATE</span><div class="speed-lines"></div><div class="orbital"></div>
    <svg class="arena" viewBox="0 0 400 220" fill="none" aria-hidden="true"><path d="M60 35H340L390 190H10L60 35Z M200 35V190 M36 110H364 M85 35L65 82H125L135 35 M265 35L275 82H335L315 35" stroke="currentColor"/><ellipse cx="200" cy="110" rx="53" ry="27" stroke="currentColor"/><path d="M160 35V17H240V35M145 190V210H255V190" stroke="currentColor"/></svg>
    <img class="hero-mark" src="/assets/yvo-mark.png" alt="Team YVO logo" fetchpriority="high"><span class="visual-corner bottom">ALL BOOST. NO BRAKES. ↗</span></div></section>
    <div class="division-strip"><span>One team. Every angle.</span>${DIVS.map(d => `<a href="#/roster/${d}">${label(d)} <span aria-hidden="true">↗</span></a>`).join('')}</div>
    <section aria-labelledby="tiktok-title"><div class="section-heading"><div><div class="eyebrow">The latest from YVO</div><h2 id="tiktok-title">Straight from the feed.</h2></div><a href="https://www.tiktok.com/@teamyvo" target="_blank" rel="noopener noreferrer">Follow @teamyvo ↗</a></div>
    <div class="feed-layout"><div class="feed-intro"><h3>Good plays.<br>Better replays.</h3><p>The shots, edits, and moments worth running back. Catch the latest posts from the team.</p><a class="handle" href="https://www.tiktok.com/@teamyvo" target="_blank" rel="noopener noreferrer">@teamyvo ↗</a></div>${tiktokFeed()}</div><div id="home-posts"></div></section>`;
  mountTikTok();
  try { const { posts } = await request('public'); if ($('#home-posts')) $('#home-posts').innerHTML = postTiles(posts); } catch { /* The live feed and direct account link remain available. */ }
}
function personCard(person, type = 'profile') {
  const profile = type === 'profile', name = person.displayName || person.username;
  return `<article class="card person">${rank(me?.role) >= 3 ? `<button class="ghost small edit-card" data-edit="${profile ? 'profile' : 'roster'}" data-id="${esc(person.id)}" aria-label="Edit ${esc(name)}">Edit ↗</button>` : ''}
    ${avatar(person, name)}<div class="role-label">${label(profile ? person.role : person.division)}</div><h3>${esc(name)}</h3>
    ${profile ? `<div class="muted small">@${esc(person.username)}</div>` : ''}${person.title ? `<div class="muted small">${esc(person.title)}</div>` : ''}
    ${profile ? `<div class="badges">${person.divisions.map(d => `<span class="badge">${label(d)}</span>`).join('')}</div>` : ''}${person.bio ? `<p class="bio">${esc(person.bio)}</p>` : ''}</article>`;
}
async function roster(arg) {
  const generation = routeId;
  $('#app').innerHTML = pageHead('The people behind YVO', 'The roster.', 'On the field. Behind the edit. Part of the same team.') + '<div class="skeleton"></div>';
  const data = await request('public'); if (generation !== routeId) return;
  publicMembers = data.members;
  let tab = GROUPS.includes(arg) ? arg : 'cch';
  const membersFor = group => data.members.filter(m => ['owner', 'co-owner', 'admin'].includes(group) ? m.role === group : m.divisions.includes(group));
  const draw = () => {
    const members = membersFor(tab), entries = data.roster.filter(r => r.division === tab);
    $('#app').innerHTML = pageHead('The people behind YVO', 'The roster.', 'On the field. Behind the edit. Part of the same team.', rank(me?.role) >= 3 ? '<button class="ghost" id="add-roster">Add to roster ↗</button>' : '') +
      `<div class="tabs" aria-label="Roster groups">${GROUPS.map(g => `<button class="pill ${tab === g ? 'on' : ''}" data-group="${g}" aria-pressed="${tab === g}">${label(g)}<span class="count">${membersFor(g).length + data.roster.filter(r => r.division === g).length}</span></button>`).join('')}</div>
      ${members.length + entries.length ? `<div class="grid">${members.map(m => personCard(m)).join('')}${entries.map(r => personCard(r, 'roster')).join('')}</div>` : empty('Room for the next name.', `The ${label(tab)} roster is getting ready. Check back for the lineup.`)}`;
    document.querySelectorAll('[data-group]').forEach(b => b.onclick = () => { tab = b.dataset.group; history.replaceState(null, '', '#/roster/' + tab); draw(); });
    $('#add-roster')?.addEventListener('click', () => editRoster({ division: tab }, () => roster(tab)));
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => b.dataset.edit === 'profile' ? editProfile(data.members.find(m => m.id === b.dataset.id), () => roster(tab)) : editRoster(data.roster.find(r => r.id === b.dataset.id), () => roster(tab)));
  }; draw();
}
function modal(title, content, onSubmit) {
  const dialog = $('#modal');
  dialog.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="close" type="button" aria-label="Close">×</button></div><form id="modal-form">${content}<p id="modal-error" class="err" role="alert"></p><div class="row"><button class="btn" type="submit">Save changes</button><button class="ghost" type="button" data-cancel>Cancel</button></div></form>`;
  dialog.querySelectorAll('.close,[data-cancel]').forEach(b => b.onclick = () => dialog.close());
  $('#modal-form').onsubmit = async e => {
    e.preventDefault(); const button = e.target.querySelector('[type=submit]'); button.disabled = true;
    try { await onSubmit(e.target); dialog.close(); }
    catch (error) { $('#modal-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  dialog.showModal();
}
function editProfile(person, done) {
  modal('Edit ' + person.username, `<div class="stack"><label>Display name<input name="displayName" maxlength="50" value="${esc(person.displayName || person.username)}" required></label>
    <label>Card title<input name="title" maxlength="80" value="${esc(person.title)}" placeholder="Player, editor, designer…"></label><label>Bio<textarea name="bio" maxlength="500">${esc(person.bio)}</textarea></label>
    <label>Avatar URL<input name="avatarUrl" type="url" value="${esc(person.avatarUrl)}" placeholder="https://…"></label>
    <label>Website role<select name="role" ${me.role !== 'owner' ? 'disabled' : ''}>${options(ROLES, person.role)}</select></label></div>${checkboxes(person.divisions)}<p class="muted small">Uncheck a division to remove it from this card and its chat access. Only owners can change website roles.</p>`, async form => {
    await api('updateProfile', { ...formData(form), id: person.id, role: me.role === 'owner' ? form.elements.namedItem('role').value : person.role, divisions: selectedDivisions(form) });
    await loadMe(); await done(); notify('Card updated.');
  });
}
function editRoster(entry = {}, done) {
  modal(entry.id ? 'Edit roster entry' : 'Add to roster', `<div class="stack"><label>Display name<input name="displayName" maxlength="50" value="${esc(entry.displayName)}" required></label>
    <label>Title<input name="title" maxlength="80" value="${esc(entry.title)}" placeholder="Player, editor, designer…"></label>
    <label>Roster group<select name="division">${options(GROUPS, entry.division || 'cch')}</select></label>
    <label>Avatar URL<input name="avatarUrl" type="url" value="${esc(entry.avatarUrl)}" placeholder="https://…"></label><label>Display order<input name="sort" type="number" min="-9999" max="9999" value="${Number(entry.sort) || 0}"></label></div>`, async form => {
    await api(entry.id ? 'updateRoster' : 'addRoster', { ...formData(form), id: entry.id }); await done(); notify('Roster saved.');
  });
}
function login(activate = false) {
  if (me) { location.hash = '#/hub'; return; }
  $('#app').innerHTML = `<section class="login"><div class="eyebrow">Your team. Your space.</div><h1>${activate ? 'Join the lineup.' : 'Welcome back.'}</h1><p>${activate ? 'Use the activation token shared by an owner to create your account.' : 'Log in to the team hub, chat, and your player card.'}</p>
    <div class="card"><form id="login-form" class="stack">${activate ? '<label>Activation token<input name="token" placeholder="YVO-…" autocomplete="off" maxlength="100" required></label>' : '<label>Username<input name="username" placeholder="Your username" autocomplete="username" required></label>'}
    <label>${activate ? 'Choose a password' : 'Password'}<input name="password" type="password" autocomplete="${activate ? 'new-password' : 'current-password'}" minlength="8" ${activate ? 'placeholder="At least 8 characters"' : ''} required></label>
    ${activate ? '<label>Repeat password<input name="repeat" type="password" autocomplete="new-password" minlength="8" required></label>' : ''}<p class="err" id="login-error" role="alert"></p><button class="btn">${activate ? 'Activate account' : 'Enter the hub'} <span aria-hidden="true">↗</span></button></form></div>
    <p class="small">${activate ? 'Already on the team?' : 'Got an activation token?'} <button class="text-button" id="switch-login">${activate ? 'Log in' : 'Activate your account'}</button></p></section>`;
  $('#switch-login').onclick = () => login(!activate);
  $('#login-form').onsubmit = async e => {
    e.preventDefault(); const form = e.target, values = formData(form), button = form.querySelector('button'); button.disabled = true; $('#login-error').textContent = '';
    try {
      const auth = await identity();
      if (activate) {
        if (values.password !== values.repeat) throw new Error('Passwords do not match.');
        const invite = await request('prepare-claim', { token: values.token });
        const user = await auth.signup(invite.username + '@members.yvo.team', values.password, { activation_token: values.token });
        if (!user.emailVerified) throw new Error('Activation is still completing. Try logging in in a moment.');
        authMode = 'identity';
      } else {
        const email = values.username.trim().toLowerCase() + '@members.yvo.team';
        try { await auth.login(email, values.password); authMode = 'identity'; }
        catch {
          if (!sb) throw new Error('Login is unavailable. Please refresh and try again.');
          const { error } = await sb.auth.signInWithPassword({ email, password: values.password });
          if (error) throw new Error('Wrong username or password.');
          authMode = 'legacy';
        }
      }
      localStorage.setItem('yvo-auth-provider', authMode);
      await loadMe(); if (!me) throw new Error('This account does not have website access. Contact an owner.');
      location.hash = '#/hub';
    } catch (error) { $('#login-error').textContent = error.message || 'Could not log in. Please try again.'; }
    finally { if (button.isConnected) button.disabled = false; }
  };
}
async function hub() {
  if (!me) { location.hash = '#/login'; return; }
  const generation = routeId;
  const data = await api('hubData'); if (generation !== routeId) return;
  me = data.me;
  $('#app').innerHTML = pageHead('Team members only', 'The team hub.', 'Keep the conversation going. Share the next great play.') + data.announcements.map(a => `<div class="ann">${esc(a.body)}</div>`).join('') +
    `<div class="tabs"><button class="pill on" data-pane="chat">Team chat</button><button class="pill" data-pane="vault">Vault</button><button class="pill" data-pane="card">My card</button>${rank(me.role) >= 2 ? '<button class="pill" data-pane="moderation">Moderation</button>' : ''}</div><div id="pane"></div>`;
  const show = pane => {
    cleanPane(); cleanPane = () => {};
    document.querySelectorAll('[data-pane]').forEach(b => b.classList.toggle('on', b.dataset.pane === pane));
    if (pane === 'vault') $('#pane').innerHTML = data.resources.length ? `<div class="grid">${data.resources.map(r => `<a class="card" href="${safe(r.url)}" target="_blank" rel="noopener noreferrer"><span class="eyebrow">${r.division ? label(r.division) : 'Team resource'}</span><h3>${esc(r.title)} ↗</h3><span class="muted small">Open resource</span></a>`).join('')}</div>` : empty('The vault is quiet.', 'Shared team links appear here when an admin adds them.');
    else if (pane === 'card') {
      $('#pane').innerHTML = `<div class="member-profile">${personCard(me)}<p class="muted small">Joined ${new Date(me.createdAt).toLocaleDateString()}. Contact an admin or owner to update your card.</p></div>`;
      $('[data-edit]')?.addEventListener('click', () => editProfile(me, () => show('card')));
    } else if (pane === 'moderation') renderModeration();
    else showChat('general');
  };
  document.querySelectorAll('[data-pane]').forEach(b => b.onclick = () => show(b.dataset.pane));
  show('chat');
}
const canTimeout = target => rank(me?.role) >= 2 && target && target.id !== me.id && target.role !== 'owner' && rank(target.role) < rank(me.role);
function timeoutDialog(person, done) {
  modal('Timeout ' + person.username, `<p class="muted small">A timeout stops this member from sending messages in every chat. They can still read the conversations.</p><label>Duration<select name="minutes"><option value="10">10 minutes</option><option value="5">5 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option><option value="10080">7 days</option><option value="0">Remove timeout</option></select></label>`, async form => {
    await api('timeoutMember', { id: person.id, minutes: Number(form.elements.namedItem('minutes').value) }); await done(); notify('Chat permissions updated.');
  });
}
async function renderModeration() {
  try {
    const { moderationMembers = [] } = await api('hubData');
    if (!$('#pane')) return;
    $('#pane').innerHTML = `<div class="card"><h2>Chat moderation</h2><p class="muted small">Timeouts apply across all channels. Staff can moderate members below their own website role.</p>${moderationMembers.length ? moderationMembers.map(p => `<div class="li"><div><b>${esc(p.username)}</b><small>${label(p.role)}${p.timeoutUntil && new Date(p.timeoutUntil) > new Date() ? ` · Timed out until ${esc(new Date(p.timeoutUntil).toLocaleString())}` : ' · Can chat'}</small></div>${canTimeout(p) ? `<button class="ghost small" data-timeout="${esc(p.id)}">Manage timeout</button>` : ''}</div>`).join('') : '<p class="muted">No team members yet.</p>'}</div>`;
    document.querySelectorAll('[data-timeout]').forEach(b => b.onclick = () => timeoutDialog(moderationMembers.find(p => p.id === b.dataset.timeout), renderModeration));
  } catch (error) { notify(error.message); }
}
async function showChat(channel) {
  cleanPane();
  let alive = true, timer, busy = false, lastMessages = '', knownMembers = [];
  cleanPane = () => { alive = false; clearTimeout(timer); };
  const channels = ['general', 'tiktok', ...(rank(me.role) >= 2 ? DIVS : me.divisions)];
  $('#pane').innerHTML = `<div class="hub-layout"><aside class="channels" aria-label="Chat channels"><div class="eyebrow">Team channels</div>${channels.map(c => `<button class="pill ${c === channel ? 'on' : ''}" data-channel="${c}"># ${c}</button>`).join('')}</aside><section class="card chat-card"><div class="chat-heading"><h3># ${channel}</h3><span>${channel === 'tiktok' ? 'Team YVO / live TikTok feed' : 'The conversation starts here'}</span></div>
    ${channel === 'tiktok' ? `<div style="padding:20px">${tiktokFeed()}</div>` : ''}<div id="chat" role="log" aria-label="Chat messages"><div class="loading-state">Loading messages…</div></div><div class="composer"><form id="chat-form" class="row"><label class="sr-only" for="chat-input">Message #${channel}</label><input id="chat-input" placeholder="Message #${channel}" maxlength="2000" autocomplete="off" required><button class="btn">Send ↗</button></form><p class="err" id="chat-error" role="alert"></p><p class="muted small" id="timeout-notice" role="status"></p></div></section></div>`;
  if (channel === 'tiktok') mountTikTok();
  document.querySelectorAll('[data-channel]').forEach(b => b.onclick = () => showChat(b.dataset.channel));
  if (rank(me.role) >= 2) { try { knownMembers = (await request('public')).members; } catch { /* Message removal remains available. */ } if (!alive) return; }
  async function refresh() {
    if (!alive || busy) return;
    busy = true;
    try {
      const { messages, timeoutUntil } = await api('messages', { channel });
      if (!alive) return;
      const box = $('#chat'), signature = JSON.stringify(messages);
      if (signature !== lastMessages) {
        const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90 || !lastMessages;
        lastMessages = signature;
        box.innerHTML = messages.length ? messages.map(m => {
          const person = knownMembers.find(p => p.id === m.userId);
          return `<article class="msg"><div class="msg-meta"><b>${esc(m.username)}</b><time datetime="${esc(m.createdAt)}" title="${esc(new Date(m.createdAt).toLocaleString())}">${esc(new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</time>${rank(me.role) >= 2 ? `<div class="msg-actions"><button type="button" data-delete-message="${esc(m.id)}" aria-label="Remove message by ${esc(m.username)}">Remove</button>${canTimeout(person) ? `<button type="button" data-timeout="${esc(person.id)}">Timeout</button>` : ''}</div>` : ''}</div><div class="msg-body">${esc(m.body)}</div></article>`;
        }).join('') : '<div class="loading-state">No messages yet. Make the first touch.</div>';
        if (nearBottom) box.scrollTop = box.scrollHeight;
        box.querySelectorAll('[data-delete-message]').forEach(b => b.onclick = async () => {
          if (!confirm('Remove this message from the chat?')) return;
          try { b.disabled = true; await api('deleteMessage', { id: b.dataset.deleteMessage }); await refresh(); }
          catch (error) { notify(error.message); b.disabled = false; }
        });
        box.querySelectorAll('[data-timeout]').forEach(b => b.onclick = () => timeoutDialog(knownMembers.find(p => p.id === b.dataset.timeout), async () => { await refresh(); }));
      }
      const timedOut = timeoutUntil && new Date(timeoutUntil) > new Date();
      $('#chat-input').disabled = !!timedOut; $('#chat-form button').disabled = !!timedOut;
      $('#timeout-notice').textContent = timedOut ? 'You can send messages again at ' + new Date(timeoutUntil).toLocaleString() + '.' : '';
    } catch (error) { if (alive) $('#chat-error').textContent = error.message; }
    finally { busy = false; }
  }
  const poll = async () => { if (!alive) return; if (!document.hidden) await refresh(); if (alive) timer = setTimeout(poll, 4000); };
  $('#chat-form').onsubmit = async e => {
    e.preventDefault(); const input = $('#chat-input'), button = e.target.querySelector('button'), body = input.value.trim();
    if (!body) return; button.disabled = true; $('#chat-error').textContent = '';
    try { await api('sendMessage', { channel, body }); if (alive) { input.value = ''; await refresh(); input.focus(); } }
    catch (error) { if (alive) $('#chat-error').textContent = error.message; }
    finally { if (alive && !input.disabled) button.disabled = false; }
  };
  await poll();
}
async function admin(newToken = null) {
  if (rank(me?.role) < 3) { location.hash = '#/'; return; }
  const generation = routeId, data = await api('adminData'); if (generation !== routeId) return;
  currentAdmin = data;
  const li = (items, render, action) => items.map(item => `<div class="li"><div>${render(item)}</div><div class="actions"><button class="danger small" data-delete="${action}" data-id="${esc(item.id)}">Remove</button></div></div>`).join('');
  $('#app').innerHTML = pageHead('Behind the scenes', 'Team management.', 'Keep the lineup, cards, and team space up to date.') + `<p id="admin-error" class="err" role="alert"></p><div class="admin-grid">
    ${me.role === 'owner' ? `<section class="card"><h2>Invite a teammate</h2><p class="muted small">Only owners can generate activation tokens. Tokens expire after 7 days.</p><form data-action="createInvite"><div class="f"><label>Username<input name="username" pattern="[a-z0-9_]{3,20}" placeholder="username" minlength="3" maxlength="20" required></label><label>Website role<select name="role">${options(ROLES, 'member')}</select></label><button class="btn">Generate token ↗</button></div>${checkboxes()}</form>
      ${newToken ? `<div class="tok"><p class="small">Activation token for <b>${esc(newToken.username)}</b>. Copy it now; it is shown only once.</p><code id="new-token">${esc(newToken.token)}</code><div class="row"><button class="ghost small" id="copy-token">Copy token</button><button class="ghost small" id="dismiss-token">Dismiss</button></div></div>` : ''}
      <h3 style="margin-top:26px">Pending invitations</h3>${data.invites.length ? li(data.invites, i => `<b>${esc(i.username)}</b><small>${label(i.role)} · Expires ${new Date(i.expiresAt).toLocaleDateString()}</small>`, 'deleteInvite') : '<p class="muted small">No pending invitations.</p>'}</section>` : ''}
    <section class="card"><h2>Member cards</h2><p class="muted small">Edit a card to update its display name, bio, image, or division roles. Owners can also manage website roles and remove accounts.</p>
    ${data.members.map(p => `<div class="li"><div><b>${esc(p.displayName || p.username)}</b><small>@${esc(p.username)} · ${label(p.role)} · ${p.divisions.map(label).join(', ') || 'No divisions'}</small></div><div class="actions"><button class="ghost small" data-profile="${esc(p.id)}">Edit card</button>${me.role === 'owner' && p.id !== me.id ? `<button class="danger small" data-delete="deleteMember" data-id="${esc(p.id)}">Remove account</button>` : ''}</div></div>`).join('')}</section>
    <section class="card"><div class="section-heading"><h2>Public roster</h2><button class="ghost small" id="new-roster">Add entry ↗</button></div><p class="muted small">Member cards appear automatically in their roster groups. Use entries for additional public roster members.</p>
    ${data.roster.map(r => `<div class="li"><div><b>${esc(r.displayName)}</b><small>${label(r.division)} · ${esc(r.title)}</small></div><div class="actions"><button class="ghost small" data-roster="${esc(r.id)}">Edit</button><button class="danger small" data-delete="deleteRoster" data-id="${esc(r.id)}">Remove</button></div></div>`).join('') || '<p class="muted small">No additional roster entries.</p>'}</section>
    <section class="card"><h2>Announcements</h2><form data-action="announce" class="row"><label class="sr-only" for="announcement">Announcement</label><input id="announcement" name="body" maxlength="2000" placeholder="Share an update with the team…" required><button class="btn">Post update</button></form>${li(data.announcements, a => esc(a.body), 'deleteAnnouncement')}</section>
    <section class="card"><h2>Team vault</h2><form data-action="addResource" class="f"><label>Title<input name="title" required maxlength="200" placeholder="Resource name"></label><label>Link<input name="url" type="url" placeholder="https://…" required></label><label>Minimum website role<select name="minRole">${options(ROLES, 'member')}</select></label><label>Division<select name="division"><option value="">Everyone</option>${options(DIVS)}</select></label><button class="btn">Add resource</button></form>${li(data.resources, r => `${esc(r.title)}<small>${label(r.minRole)} · ${r.division ? label(r.division) : 'Everyone'}</small>`, 'deleteResource')}</section>
    <section class="card"><h2>TikTok / @teamyvo</h2><p class="muted small">The live @teamyvo profile feed appears on the home page and in #tiktok. TikTok controls the posts shown in its embed. You can also pin individual team videos below.</p><a class="ghost small" href="#/hub" id="view-tiktok">Open TikTok channel ↗</a><form data-action="addTikTok" class="row"><label class="sr-only" for="tiktok-url">Team TikTok video URL</label><input id="tiktok-url" name="url" type="url" placeholder="https://www.tiktok.com/@teamyvo/video/…" required><button class="btn">Pin video</button></form>${li(data.posts, p => esc(p.title || 'Team video'), 'deleteTikTok')}</section></div>`;
  $('#copy-token')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(newToken.token); notify('Token copied.'); } catch { notify('Select the token and copy it manually.'); } });
  $('#dismiss-token')?.addEventListener('click', () => admin());
  $('#new-roster').onclick = () => editRoster({}, admin);
  document.querySelectorAll('[data-profile]').forEach(b => b.onclick = () => editProfile(data.members.find(p => p.id === b.dataset.profile), admin));
  document.querySelectorAll('[data-roster]').forEach(b => b.onclick = () => editRoster(data.roster.find(p => p.id === b.dataset.roster), admin));
  $('#view-tiktok').onclick = () => sessionStorage.setItem('yvo-hub-channel', 'tiktok');
  document.querySelectorAll('[data-action]').forEach(form => form.onsubmit = async e => {
    e.preventDefault(); const button = form.querySelector('button'); button.disabled = true; $('#admin-error').textContent = '';
    try {
      const payload = formData(form); if (form.dataset.action === 'createInvite') payload.divisions = selectedDivisions(form);
      const result = await api(form.dataset.action, payload); await admin(result.token ? result : null); if (!result.token) notify('Saved.');
    } catch (error) { $('#admin-error').textContent = error.message; $('#admin-error').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    finally { if (button.isConnected) button.disabled = false; }
  });
  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => {
    const account = b.dataset.delete === 'deleteMember';
    if (!confirm(account ? 'Remove this account from the website? Its chat messages will also be removed and its sessions will lose access.' : 'Remove this item?')) return;
    b.disabled = true;
    try { await api(b.dataset.delete, { id: b.dataset.id }); await admin(); notify(account ? 'Account removed.' : 'Removed.'); }
    catch (error) { $('#admin-error').textContent = error.message; b.disabled = false; }
  });
}
async function route() {
  const generation = ++routeId; cleanPane(); cleanPane = () => {}; $('#modal').close();
  const [, page = '', arg] = location.hash.slice(1).split('/');
  renderNav(); window.scrollTo({ top: 0, behavior: 'instant' });
  document.title = `${({ roster: 'Roster', login: 'Team login', hub: 'Team hub', admin: 'Management' })[page] || 'Built for the game'} — Team YVO`;
  $('#app').innerHTML = '<div class="loading-state" role="status">Loading…</div>';
  try { await ({ roster, login: () => login(false), hub, admin }[page] || home)(arg); }
  catch (error) { if (generation === routeId) $('#app').innerHTML = pageHead('Connection interrupted', 'One more try.') + `<div class="card"><p class="err">${esc(error.message)}</p><button class="btn" id="retry-page">Try again ↗</button></div>`; $('#retry-page')?.addEventListener('click', route); }
  if (page === 'hub' && sessionStorage.getItem('yvo-hub-channel') === 'tiktok' && $('#pane')) { sessionStorage.removeItem('yvo-hub-channel'); showChat('tiktok'); }
}
window.addEventListener('hashchange', route);
// Hydrate Identity only when a previous Identity session exists, so public pages load immediately.
if (authMode === 'identity' && document.cookie.includes('nf_jwt=')) {
  try { await (await identity()).getUser(); } catch { /* The API rejects invalid sessions. */ }
}
await loadMe();
await route();
