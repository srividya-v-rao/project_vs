// Vani-Board backend: static files + accounts (signup/login) + Sarvam AI + per-user history + Exotel phone route.
// Needs Node 18+. No packages required (a small built-in loader reads .env).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach((l) => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (_) {}

const PORT = process.env.PORT || 3000;
const KEY = process.env.SARVAM_API_KEY || '';
const TRANSLATE_MODEL = process.env.SARVAM_TRANSLATE_MODEL || 'mayura:v1';
const TTS_MODEL = process.env.SARVAM_TTS_MODEL || 'bulbul:v3';
const SPEAKER = process.env.SARVAM_SPEAKER || 'ritu';
const SARVAM = 'https://api.sarvam.ai';

const LANG_CODES = ['hi-IN', 'te-IN', 'ta-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'bn-IN', 'gu-IN', 'pa-IN', 'od-IN', 'en-IN'];

// ---------- Storage (plain files, no database) ----------
// DATA_DIR can point at a persistent disk when hosting. Default: ./data
//   history.json  notices      audio/<id>.wav  voices
//   users.json    accounts     sessions.json   logged-in sessions (token hashes only)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const MAX_HISTORY_PER_USER = 50; // oldest notices (and their audio) of that user are removed beyond this
fs.mkdirSync(AUDIO_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
const loadHistory = () => readJson(HISTORY_FILE, []);
const saveHistory = (list) => writeJson(HISTORY_FILE, list);
function removeAudio(id) {
  try { fs.unlinkSync(path.join(AUDIO_DIR, `${id}.wav`)); } catch (_) {}
}

let users = readJson(USERS_FILE, []);       // [{ id, name, email, passwordHash, language, createdAt }]
let sessions = readJson(SESSIONS_FILE, {}); // { sha256(token): { userId, expires } }

// ---------- Accounts ----------
const SESSION_DAYS = 30;
const COOKIE = 'vb_session';

const scrypt = (pw, salt) =>
  new Promise((resolve, reject) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? reject(e) : resolve(k))));
const DUMMY_SALT = crypto.randomBytes(16);

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'));
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, language: u.language });

function cookieFlags(req, maxAgeSeconds) {
  const https = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket.encrypted;
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${https ? '; Secure' : ''}`;
}

function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  for (const k of Object.keys(sessions)) if (sessions[k].expires < now) delete sessions[k]; // drop expired
  sessions[sha(token)] = { userId: user.id, expires: now + SESSION_DAYS * 86400000 };
  writeJson(SESSIONS_FILE, sessions);
  return `${COOKIE}=${token}; ${cookieFlags(req, SESSION_DAYS * 86400)}`;
}

function getToken(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

function currentUser(req) {
  const token = getToken(req);
  if (!token) return null;
  const s = sessions[sha(token)];
  if (!s || s.expires < Date.now()) return null;
  return users.find((u) => u.id === s.userId) || null;
}

// Simple brute-force protection: 10 failed logins per email+IP per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function tooManyFailures(key) {
  const now = Date.now();
  if (failures.size > 2000) for (const [k, v] of failures) if (v.start + WINDOW_MS < now) failures.delete(k);
  const f = failures.get(key);
  return !!f && f.start + WINDOW_MS > now && f.count >= 10;
}
function noteFailure(key) {
  const now = Date.now();
  const f = failures.get(key);
  if (!f || f.start + WINDOW_MS < now) failures.set(key, { start: now, count: 1 });
  else f.count += 1;
}

// ---------- Helpers ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (_) {
        const err = new Error('Invalid request body');
        err.status = 400;
        reject(err);
      }
    });
  });
}

function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

async function sarvam(endpoint, payload) {
  const r = await fetch(SARVAM + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-subscription-key': KEY },
    body: JSON.stringify(payload),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error?.message || json.message || `Sarvam error ${r.status}`);
  return json;
}

const stripOwner = ({ userId, ...rest }) => rest;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/api/status') {
      return send(res, 200, { live: !!KEY });
    }

    // ---------- Accounts ----------
    if (req.method === 'POST' && url === '/api/signup') {
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      const language = String(b.language || '');
      if (!name || name.length > 60) return send(res, 400, { error: 'Please enter your name (up to 60 characters).' });
      if (!EMAIL_RE.test(email) || email.length > 254) return send(res, 400, { error: 'Please enter a valid email address.' });
      if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'Password must be at least 8 characters.' });
      if (!LANG_CODES.includes(language)) return send(res, 400, { error: 'Please choose a preferred language.' });
      if (users.some((u) => u.email === email)) return send(res, 409, { error: 'An account with this email already exists. Please log in.' });

      const user = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        email,
        passwordHash: await hashPassword(password),
        language,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      writeJson(USERS_FILE, users);
      return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': startSession(req, res, user) });
    }

    if (req.method === 'POST' && url === '/api/login') {
      const b = await readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      const key = `${clientIp(req)}|${email}`;
      if (tooManyFailures(key)) return send(res, 429, { error: 'Too many attempts. Please try again in a few minutes.' });

      const user = users.find((u) => u.email === email);
      let ok = false;
      if (user) ok = await verifyPassword(password, user.passwordHash);
      else await scrypt(password, DUMMY_SALT); // same work either way, so timing doesn't reveal which emails exist
      if (!ok) {
        noteFailure(key);
        return send(res, 401, { error: 'Incorrect email or password.' });
      }
      failures.delete(key);
      return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': startSession(req, res, user) });
    }

    if (req.method === 'POST' && url === '/api/logout') {
      const token = getToken(req);
      if (token) { delete sessions[sha(token)]; writeJson(SESSIONS_FILE, sessions); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; ${cookieFlags(req, 0)}` });
    }

    // Who am I? Always 200 so the page can decide between the login screen and the board.
    if (req.method === 'GET' && url === '/api/me') {
      const user = currentUser(req);
      return send(res, 200, { user: user ? publicUser(user) : null });
    }

    // Save the preferred (default) language
    if (req.method === 'PUT' && url === '/api/me') {
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'Please log in.' });
      const { language } = await readBody(req);
      if (!LANG_CODES.includes(language)) return send(res, 400, { error: 'Unknown language.' });
      user.language = language;
      writeJson(USERS_FILE, users);
      return send(res, 200, { user: publicUser(user) });
    }

    // Everything below needs a logged-in user (except the Exotel phone route further down).
    const needsLogin =
      url.startsWith('/api/notices') || url.startsWith('/audio/') || url === '/api/translate' || url === '/api/tts';
    const user = needsLogin ? currentUser(req) : null;
    if (needsLogin && !user) return send(res, 401, { error: 'Please log in.' });

    // ---------- Notices with history (per user) ----------
    if (req.method === 'POST' && url === '/api/notices') {
      if (!KEY) return send(res, 503, { error: 'No SARVAM_API_KEY set' });
      const { text, target } = await readBody(req);
      if (!text || !target) return send(res, 400, { error: 'text and target required' });
      if (!LANG_CODES.includes(target)) return send(res, 400, { error: 'Unknown language.' });

      let translated = text;
      if (target !== 'en-IN') {
        const t = await sarvam('/translate', {
          input: text,
          source_language_code: 'en-IN',
          target_language_code: target,
          model: TRANSLATE_MODEL,
          mode: 'formal',
          enable_preprocessing: true,
        });
        translated = t.translated_text;
      }

      const v = await sarvam('/text-to-speech', {
        text: translated.slice(0, 2500),
        language_code: target,
        speaker: SPEAKER,
        model: TTS_MODEL,
        pace: 0.95,
      });

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      fs.writeFileSync(path.join(AUDIO_DIR, `${id}.wav`), Buffer.from(v.audios[0], 'base64'));

      const entry = {
        id,
        userId: user.id,
        createdAt: new Date().toISOString(),
        language: target,
        original: text,
        translated,
        audio: `/audio/${id}.wav`,
      };
      let kept = 0;
      const list = [entry, ...loadHistory()].filter((n) => {
        if (n.userId === user.id && ++kept > MAX_HISTORY_PER_USER) { removeAudio(n.id); return false; }
        return true;
      });
      saveHistory(list);
      return send(res, 200, stripOwner(entry));
    }

    if (req.method === 'GET' && url === '/api/notices') {
      return send(res, 200, loadHistory().filter((n) => n.userId === user.id).map(stripOwner));
    }

    if (req.method === 'DELETE' && url.startsWith('/api/notices/')) {
      const id = url.slice('/api/notices/'.length);
      if (!/^[a-z0-9]+$/.test(id)) return send(res, 400, { error: 'bad id' });
      const list = loadHistory();
      if (!list.some((n) => n.id === id && n.userId === user.id)) return send(res, 404, { error: 'Not found' });
      saveHistory(list.filter((n) => n.id !== id));
      removeAudio(id);
      return send(res, 200, { ok: true });
    }

    // Saved audio: only its owner can fetch it
    if (req.method === 'GET' && url.startsWith('/audio/')) {
      const name = url.slice('/audio/'.length);
      if (!/^[a-z0-9]+\.wav$/.test(name)) { res.writeHead(400); return res.end(); }
      const id = name.slice(0, -4);
      if (!loadHistory().some((n) => n.id === id && n.userId === user.id)) { res.writeHead(404); return res.end('Not found'); }
      return fs.readFile(path.join(AUDIO_DIR, name), (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length });
        res.end(buf);
      });
    }

    // ---------- Older endpoints (now login-protected) ----------
    if (req.method === 'POST' && url === '/api/translate') {
      if (!KEY) return send(res, 503, { error: 'No SARVAM_API_KEY set' });
      const { text, target } = await readBody(req);
      if (!text || !target) return send(res, 400, { error: 'text and target required' });
      if (target === 'en-IN') return send(res, 200, { translated: text });

      const out = await sarvam('/translate', {
        input: text,
        source_language_code: 'en-IN',
        target_language_code: target,
        model: TRANSLATE_MODEL,
        mode: 'formal',
        enable_preprocessing: true,
      });
      return send(res, 200, { translated: out.translated_text });
    }

    if (req.method === 'POST' && url === '/api/tts') {
      if (!KEY) return send(res, 503, { error: 'No SARVAM_API_KEY set' });
      const { text, target } = await readBody(req);
      if (!text || !target) return send(res, 400, { error: 'text and target required' });

      const out = await sarvam('/text-to-speech', {
        text: text.slice(0, 2500),
        language_code: target,
        speaker: SPEAKER,
        model: TTS_MODEL,
        pace: 0.95,
      });
      return send(res, 200, { audio: out.audios && out.audios[0] });
    }

    // ---------- Phone (Exotel) - stays open because the phone network can't log in ----------
    // Exotel calls this from a Passthru applet that sits BEFORE a Greeting applet.
    // We return JSON {"greeting_url": "<wav url>"} and the Greeting applet plays that audio.
    if (req.method === 'GET' && url === '/api/voice') {
      if (!KEY) return send(res, 503, { error: 'No SARVAM_API_KEY set' });

      console.log('Incoming call received from Exotel...');
      const schemeNotice = 'New government update: Free health checkup camps open this Monday at your local primary health centre.';
      const userLang = 'kn-IN'; // Kannada

      const publicDir = path.join(__dirname, 'public');
      fs.mkdirSync(publicDir, { recursive: true });

      const translated = await sarvam('/translate', {
        input: schemeNotice,
        source_language_code: 'en-IN',
        target_language_code: userLang,
        model: TRANSLATE_MODEL,
        mode: 'formal',
        enable_preprocessing: true,
      });

      // Exotel needs 8 kHz mono 16-bit WAV, so ask Sarvam for 8000 Hz.
      const ttsOut = await sarvam('/text-to-speech', {
        text: translated.translated_text.slice(0, 2500),
        language_code: userLang,
        speaker: SPEAKER,
        model: TTS_MODEL,
        pace: 0.95,
        speech_sample_rate: 8000,
      });

      const audioFileName = `call-${Date.now()}.wav`;
      fs.writeFileSync(path.join(publicDir, audioFileName), Buffer.from(ttsOut.audios[0], 'base64'));

      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const audioUrl = `${proto}://${host}/${audioFileName}`;
      console.log(`Generated audio served at: ${audioUrl}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ greeting_url: audioUrl }));
    }

    // Static files (HTML page, CSS, JS, phone .wav files)
    const file = url === '/' ? '/index.html' : url;
    const full = path.join(__dirname, 'public', path.normalize(file));
    if (!full.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }

    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    console.error('Server error:', e.message);
    send(res, e.status || 502, { error: e.message });
  }
});

server.listen(PORT, () =>
  console.log(`Vani-Board running at http://localhost:${PORT}  (${KEY ? 'Sarvam AI connected' : 'WARNING: SARVAM_API_KEY missing'})`)
);
