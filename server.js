// Vani-Board backend: static file server + Sarvam AI proxy + notice history + Exotel phone route.
// Needs Node 18+. No packages required (a small built-in loader reads .env).
const http = require('http');
const fs = require('fs');
const path = require('path');

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

// ---------- History storage (plain files, no database) ----------
// data/history.json holds the list of notices, data/audio/<id>.wav holds each voice.
const DATA_DIR = path.join(__dirname, 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MAX_HISTORY = 100; // oldest notices (and their audio) are removed beyond this
fs.mkdirSync(AUDIO_DIR, { recursive: true });

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (_) { return []; }
}
function saveHistory(list) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2));
}
function removeAudio(id) {
  try { fs.unlinkSync(path.join(AUDIO_DIR, `${id}.wav`)); } catch (_) {}
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
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

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/api/status') {
      return send(res, 200, { live: !!KEY });
    }

    // ---------- NEW: notices with history ----------
    // Create: translate (Sarvam) + speak (Sarvam) + save to history, return the saved notice.
    if (req.method === 'POST' && url === '/api/notices') {
      if (!KEY) return send(res, 503, { error: 'No SARVAM_API_KEY set' });
      const { text, target } = await readBody(req);
      if (!text || !target) return send(res, 400, { error: 'text and target required' });

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
        createdAt: new Date().toISOString(),
        language: target,
        original: text,
        translated,
        audio: `/audio/${id}.wav`,
      };
      const list = loadHistory();
      list.unshift(entry); // newest first
      list.splice(MAX_HISTORY).forEach((old) => removeAudio(old.id));
      saveHistory(list);
      return send(res, 200, entry);
    }

    // List all saved notices (newest first)
    if (req.method === 'GET' && url === '/api/notices') {
      return send(res, 200, loadHistory());
    }

    // Delete one notice and its audio
    if (req.method === 'DELETE' && url.startsWith('/api/notices/')) {
      const id = url.slice('/api/notices/'.length);
      if (!/^[a-z0-9]+$/.test(id)) return send(res, 400, { error: 'bad id' });
      saveHistory(loadHistory().filter((n) => n.id !== id));
      removeAudio(id);
      return send(res, 200, { ok: true });
    }

    // Serve saved audio
    if (req.method === 'GET' && url.startsWith('/audio/')) {
      const name = url.slice('/audio/'.length);
      if (!/^[a-z0-9]+\.wav$/.test(name)) { res.writeHead(400); return res.end(); }
      return fs.readFile(path.join(AUDIO_DIR, name), (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length });
        res.end(buf);
      });
    }

    // ---------- Older endpoints (still available) ----------
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

    // Phone: Exotel calls this from a Passthru applet that sits BEFORE a Greeting applet.
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
    send(res, 502, { error: e.message });
  }
});

server.listen(PORT, () =>
  console.log(`Vani-Board running at http://localhost:${PORT}  (${KEY ? 'Sarvam AI connected' : 'WARNING: SARVAM_API_KEY missing'})`)
);
