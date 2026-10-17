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

const SAMPLE =
  'Dear Residents, there will be no water supply on Saturday, 17 October, from 10 AM to 2 PM due to tank cleaning. Please store enough water in advance. Thank you. - Management Committee';

const $ = (id) => document.getElementById(id);
let live = false;
let lang = LANGS[0];
let audio = null;      // HTMLAudioElement (live mode)
let current = null;    // { text, code, base64 }

// ---------- Step 4: language selection ----------
LANGS.forEach((l, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (i === 0 ? ' on' : '');
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', i === 0);
  b.innerHTML = `${l.name}<small>${l.en}</small>`;
  b.onclick = () => {
    lang = l;
    [...$('chips').children].forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-checked', false); });
    b.classList.add('on');
    b.setAttribute('aria-checked', true);
  };
  $('chips').appendChild(b);
});

// ---------- Step 3: notice input ----------
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
  document.querySelector('.spin').hidden = !on;
  $('goTxt').textContent = on ? 'Translating & generating voice…' : 'Broadcast to Vani-Board';
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

// ---------- Steps 5-6: translate + TTS ----------
$('go').onclick = async () => {
  const text = $('notice').value.trim();
  showError('');
  if (!text) return showError('Please type a notice first (or tap “Use sample notice”).');
  stop();
  busy(true);
  try {
    if (!live) throw new Error('Sarvam API key missing. Add SARVAM_API_KEY to the .env file and restart the server.');
    // Sarvam AI translation, then Sarvam AI text-to-speech
    const translated = (await post('/api/translate', { text, target: lang.code })).translated;
    const base64 = (await post('/api/tts', { text: translated, target: lang.code })).audio;
    current = { text: translated, code: lang.code, base64 };
    render(text, translated);
    play(); // Step 7: auto-play
  } catch (e) {
    showError(e.message);
  } finally {
    busy(false);
  }
};

function render(orig, translated) {
  $('empty').hidden = true;
  $('out').hidden = false;
  $('orig').textContent = orig;
  $('trans').textContent = translated;
  $('trans').lang = lang.code;
  $('trLabel').textContent = `Translated · ${lang.en}`;
  $('langTag').textContent = lang.name;
  $('langTag').hidden = false;
}

// ---------- Step 7: audio playback ----------
function setPlaying(on) {
  $('wave').classList.toggle('on', on);
  $('play').textContent = on ? '■' : '▶';
  $('play').setAttribute('aria-label', on ? 'Stop' : 'Play announcement');
  $('pstate').textContent = on ? 'Playing…' : 'Ready';
}

function stop() {
  if (audio) { audio.pause(); audio = null; }
  setPlaying(false);
}

function play() {
  if (!current || !current.base64) return;
  stop();
  audio = new Audio('data:audio/wav;base64,' + current.base64);
  audio.onended = () => setPlaying(false);
  audio.onerror = () => { setPlaying(false); showError('Could not play audio.'); };
  audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); // autoplay may be blocked; button still works
}

$('play').onclick = () => (audio && !audio.paused ? stop() : play());
