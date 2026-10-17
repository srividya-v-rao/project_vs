// Vani-Board backend: static file server + thin proxy to Sarvam AI.
// Zero dependencies (Node 18+). The API key stays on the server, never in the browser.
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

// Minimal .env loader
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach((l) => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (_) {}

const PORT = process.env.PORT || 3000;
const KEY = process.env.SARVAM_API_KEY || '';
const TRANSLATE_MODEL = process.env.SARVAM_TRANSLATE_MODEL || 'mayura:v1';
const TTS_MODEL = process.env.SARVAM_TTS_MODEL || 'bulbul:v3';
const SPEAKER = process.env.SARVAM_SPEAKER || 'ritu'; 
const SARVAM = 'https://api.sarvam.ai';

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
    if (req.method === 'GET' && req.url === '/api/status') {
      return send(res, 200, { live: !!KEY });
    }

    // Existing Step 5: Web translation
    if (req.method === 'POST' && req.url === '/api/translate') {
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

    // Existing Step 6: Web text to speech
    if (req.method === 'POST' && req.url === '/api/tts') {
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

    // NEW EXOTEL INBOUND CALL ROUTE
    if (req.method === 'GET' && req.url.startsWith('/api/voice')) {
      if (!KEY) return send(res, 503, { error: 'No SARVAM_API_KEY set' });

      console.log('Incoming call received from Exotel...');
      const schemeNotice = "New government update: Free health checkup camps open this Monday at your local primary health centre.";
      const userLang = "kn-IN"; // Kannada

      // Ensure the public directory exists before writing to it
      const publicDir = path.join(__dirname, 'public');
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }

      // 1. Translate the notice using Sarvam
      const translated = await sarvam('/translate', {
        input: schemeNotice,
        source_language_code: 'en-IN',
        target_language_code: userLang,
        model: TRANSLATE_MODEL,
        mode: 'formal',
        enable_preprocessing: true,
      });

      // 2. Generate voice audio using Sarvam TTS (Bulbul v3)
      const ttsOut = await sarvam('/text-to-speech', {
        text: translated.translated_text.slice(0, 2500),
        language_code: userLang,
        speaker: SPEAKER, // Uses 'ritu' or your .env setting. All 37 Sarvam speakers support all 11 languages.
        model: TTS_MODEL,
        pace: 0.95, // Keep near 1.0 for natural delivery
      });

      // 3. Save the base64 audio as a .wav file in the public folder
      const audioFileName = `call-${Date.now()}.wav`;
      const audioFilePath = path.join(publicDir, audioFileName);
      fs.writeFileSync(audioFilePath, Buffer.from(ttsOut.audios[0], 'base64'));

      // 4. Build the public ngrok URL for the generated audio file
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const audioUrl = `${proto}://${host}/${audioFileName}`;

      console.log(`Generated audio served at: ${audioUrl}`);

      // 5. Exotel strictly requires a plain text response containing ONLY the audio URL
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(audioUrl);
    }

    // Static files router (handles both your HTML and the generated .wav files)
    const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const full = path.join(__dirname, 'public', path.normalize(file));
    if (!full.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
    
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(buf);
    });

  } catch (e) {
    console.error('Server error:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () =>
  console.log(`Vani-Board running at http://localhost:${PORT}  (${KEY ? 'Sarvam AI connected' : 'WARNING: SARVAM_API_KEY missing'})`)
);