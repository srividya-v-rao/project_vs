// Vani-Board frontend

const LANGS = [
  { code: 'hi-IN', name: 'हिन्दी', en: 'Hindi' },
  { code: 'te-IN', name: 'తెలుగు', en: 'Telugu' },
  { code: 'ta-IN', name: 'தமிழ்', en: 'Tamil' },
  { code: 'kn-IN', name: 'ಕನ್ನಡ', en: 'Kannada' },
  { code: 'ml-IN', name: 'മലയാളം', en: 'Malayalam' },
  { code: 'mr-IN', name: 'मराठी', en: 'Marathi' },
  { code: 'bn-IN', name: 'বাংলা', en: 'Bengali' },
  { code: 'gu-IN', name: 'ગુજરાતી', en: 'Gujarati' },
  { code: 'pa-IN', name: 'ਪੰਜਾਬੀ', en: 'Punjabi' },
  { code: 'od-IN', name: 'ଓଡ଼ିଆ', en: 'Odia' },
  { code: 'en-IN', name: 'English', en: 'English' },
];
const BY_CODE = Object.fromEntries(LANGS.map((l) => [l.code, l]));

const SAMPLE =
  'Dear Residents, there will be no water supply on Saturday, 17 October, from 10 AM to 2 PM due to tank cleaning. Please store enough water in advance. Thank you. - Management Committee';

const $ = (id) => document.getElementById(id);
let live = false;
let user = null;        // logged-in user: { id, name, email, language }
let lang = LANGS[0];    // language chosen for the next broadcast
let audio = null;       // the one audio element that is playing right now
let playingUrl = null;  // audio URL that is playing (board or history)
let current = null;     // notice shown on the board
let history = [];       // saved notices of this user, newest first
const chipEls = {};

const json = { 'Content-Type': 'application/json' };

async function api(url, options) {
  const r = await fetch(url, options);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && user && !url.startsWith('/api/login') && !url.startsWith('/api/signup')) {
    showAuth('Your session has ended. Please log in again.');
  }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

// ---------- Language chips and the user's default language ----------
LANGS.forEach((l) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.setAttribute('role', 'radio');
  b.innerHTML = `${l.name}<small>${l.en}</small>`;
  b.onclick = () => selectLang(l.code);
  chipEls[l.code] = b;
  $('chips').appendChild(b);
});

function selectLang(code) {
  lang = BY_CODE[code] || LANGS[0];
  Object.entries(chipEls).forEach(([c, b]) => {
    b.classList.toggle('on', c === lang.code);
    b.setAttribute('aria-checked', c === lang.code);
  });
  updateDefaultUI();
}

function updateDefaultUI() {
  Object.entries(chipEls).forEach(([c, b]) => b.classList.toggle('def', !!user && user.language === c));
  if (!user) return;
  $('defInfo').textContent = `★ Your default language: ${BY_CODE[user.language].en}`;
  $('setDef').hidden = lang.code === user.language;
  $('setDef').textContent = `Make ${lang.en} my default`;
}

$('setDef').onclick = async () => {
  showError('');
  try {
    const r = await api('/api/me', { method: 'PUT', headers: json, body: JSON.stringify({ language: lang.code }) });
    user = r.user;
    updateDefaultUI();
  } catch (e) { showError(e.message); }
};

// ---------- Notice input ----------
$('notice').addEventListener('input', () => ($('cnt').textContent = $('notice').value.length));
$('sample').onclick = () => { $('notice').value = SAMPLE; $('cnt').textContent = SAMPLE.length; };

fetch('/api/status').then((r) => r.json()).then((s) => {
  live = s.live;
  $('mode').textContent = live ? '● Sarvam AI connected' : '● Sarvam API key missing';
  $('mode').classList.toggle('live', live);
}).catch(() => { $('mode').textContent = '● Offline'; });

function showError(msg) { $('err').textContent = msg; $('err').hidden = !msg; }
function busy(on) {
  $('go').disabled = on;
  $('go').querySelector('.spin').hidden = !on;
  $('goTxt').textContent = on ? 'Translating & generating voice…' : 'Broadcast to Vani-Board';
}

// ---------- Broadcast: server translates, speaks and saves to history ----------
$('go').onclick = async () => {
  const text = $('notice').value.trim();
  showError('');
  if (!text) return showError('Please type a notice first (or tap “Use sample notice”).');
  stop();
  busy(true);
  try {
    if (!live) throw new Error('Sarvam API key missing. Add SARVAM_API_KEY to the .env file and restart the server.');
    const entry = await api('/api/notices', { method: 'POST', headers: json, body: JSON.stringify({ text, target: lang.code }) });
    history.unshift(entry);
    renderHistory();
    showOnBoard(entry);
    play(entry.audio); // auto-play; the button still works if the browser blocks autoplay
  } catch (e) {
    showError(e.message);
  } finally {
    busy(false);
  }
};

function showOnBoard(entry) {
  current = entry;
  const l = BY_CODE[entry.language] || { name: entry.language, en: entry.language };
  $('empty').hidden = true;
  $('out').hidden = false;
  $('orig').textContent = entry.original;
  $('trans').textContent = entry.translated;
  $('trans').lang = entry.language;
  $('trLabel').textContent = `Translated · ${l.en}`;
  $('langTag').textContent = l.name;
  $('langTag').hidden = false;
  refreshPlayers();
}

function clearBoard() {
  current = null;
  $('empty').hidden = false;
  $('out').hidden = true;
  $('langTag').hidden = true;
}

// ---------- Audio playback (one player at a time, shared by board and history) ----------
function play(url) {
  stop();
  const a = new Audio(url);
  audio = a;
  playingUrl = url;
  a.onended = () => { if (audio === a) stop(); };
  a.onerror = () => { if (audio === a) { stop(); showError('Could not play audio.'); } };
  a.play().then(refreshPlayers).catch(() => { if (audio === a) stop(); });
  refreshPlayers();
}

function stop() {
  if (audio) { audio.pause(); audio = null; }
  playingUrl = null;
  refreshPlayers();
}

function refreshPlayers() {
  const boardPlaying = !!current && playingUrl === current.audio;
  $('wave').classList.toggle('on', boardPlaying);
  $('play').textContent = boardPlaying ? '■' : '▶';
  $('play').setAttribute('aria-label', boardPlaying ? 'Stop' : 'Play announcement');
  $('pstate').textContent = boardPlaying ? 'Playing…' : 'Ready';
  document.querySelectorAll('.h-play').forEach((b) => {
    const on = b.dataset.url === playingUrl;
    b.textContent = on ? '■ Stop' : '▶ Play';
    b.classList.toggle('on', on);
  });
}

$('play').onclick = () => {
  if (!current) return;
  playingUrl === current.audio ? stop() : play(current.audio);
};

// ---------- History ----------
function fmtTime(iso) {
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // textContent, never innerHTML: notices are user text
  return e;
}

function renderHistory() {
  const list = $('hlist');
  list.innerHTML = '';
  $('hempty').hidden = history.length > 0;
  $('hcount').textContent = history.length ? `${history.length} saved` : '';
  history.forEach((n) => {
    const l = BY_CODE[n.language] || { name: n.language, en: n.language };
    const li = el('li', 'h-item');

    const meta = el('div', 'h-meta');
    meta.append(el('span', 'h-lang', l.en), el('time', 'h-time', fmtTime(n.createdAt)));

    const trans = el('p', 'h-trans', n.translated);
    trans.lang = n.language;
    const orig = el('p', 'h-orig', n.original);

    const actions = el('div', 'h-actions');
    const playBtn = el('button', 'h-play', '▶ Play');
    playBtn.type = 'button';
    playBtn.dataset.url = n.audio;
    playBtn.onclick = () => (playingUrl === n.audio ? stop() : play(n.audio));

    const showBtn = el('button', 'h-btn', 'Show on board');
    showBtn.type = 'button';
    showBtn.onclick = () => { showOnBoard(n); window.scrollTo({ top: 0, behavior: 'smooth' }); };

    const delBtn = el('button', 'h-btn h-del', 'Delete');
    delBtn.type = 'button';
    delBtn.onclick = async () => {
      if (!confirm('Delete this notice from history?')) return;
      try {
        await api('/api/notices/' + n.id, { method: 'DELETE' });
        if (playingUrl === n.audio) stop();
        history = history.filter((x) => x.id !== n.id);
        renderHistory();
      } catch (e) { showError(e.message); }
    };

    actions.append(playBtn, showBtn, delBtn);
    li.append(meta, trans, orig, actions);
    list.appendChild(li);
  });
  refreshPlayers();
}

// ---------- Login / Sign up ----------
let authMode = 'login';

LANGS.forEach((l) => {
  const o = document.createElement('option');
  o.value = l.code;
  o.textContent = `${l.en} (${l.name})`;
  $('alang').appendChild(o);
});

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  $('tabLogin').classList.toggle('on', !signup);
  $('tabSignup').classList.toggle('on', signup);
  $('tabLogin').setAttribute('aria-selected', !signup);
  $('tabSignup').setAttribute('aria-selected', signup);
  $('nameRow').hidden = !signup;
  $('langRow').hidden = !signup;
  $('authTxt').textContent = signup ? 'Create account' : 'Log in';
  $('apass').autocomplete = signup ? 'new-password' : 'current-password';
  authError('');
}
$('tabLogin').onclick = () => setAuthMode('login');
$('tabSignup').onclick = () => setAuthMode('signup');

function authError(msg) { $('autherr').textContent = msg; $('autherr').hidden = !msg; }

$('authForm').onsubmit = async (e) => {
  e.preventDefault();
  authError('');
  const signup = authMode === 'signup';
  const body = { email: $('aemail').value.trim(), password: $('apass').value };
  if (signup) {
    body.name = $('aname').value.trim();
    body.language = $('alang').value;
    if (!body.name) return authError('Please enter your name.');
  }
  if (!/^\S+@\S+\.\S+$/.test(body.email)) return authError('Please enter a valid email address.');
  if (!body.password) return authError('Please enter your password.');
  if (signup && body.password.length < 8) return authError('Password must be at least 8 characters.');

  $('authBtn').disabled = true;
  $('authBtn').querySelector('.spin').hidden = false;
  try {
    const r = await api(signup ? '/api/signup' : '/api/login', { method: 'POST', headers: json, body: JSON.stringify(body) });
    user = r.user;
    $('apass').value = '';
    enterApp();
  } catch (err) {
    authError(err.message);
  } finally {
    $('authBtn').disabled = false;
    $('authBtn').querySelector('.spin').hidden = true;
  }
};

$('logout').onclick = async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
  showAuth();
};

function enterApp() {
  $('auth').hidden = true;
  $('app').hidden = false;
  $('userbox').hidden = false;
  $('uname').textContent = user.name;
  stop();
  clearBoard();
  showError('');
  $('notice').value = '';
  $('cnt').textContent = '0';
  selectLang(user.language); // the user's saved default language
  history = [];
  renderHistory();
  api('/api/notices').then((list) => { history = list; renderHistory(); }).catch(() => {});
}

function showAuth(message) {
  stop();
  user = null;
  history = [];
  clearBoard();
  updateDefaultUI();
  $('app').hidden = true;
  $('userbox').hidden = true;
  $('auth').hidden = false;
  $('apass').value = '';
  setAuthMode('login');
  if (message) authError(message);
}

// ---------- Start: are we already logged in? ----------
fetch('/api/me')
  .then((r) => r.json())
  .then((j) => { if (j.user) { user = j.user; enterApp(); } else showAuth(); })
  .catch(() => showAuth());
