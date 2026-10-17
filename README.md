# Vani-Board · वाणी

Multilingual, voice-enabled community notice board. An admin posts an English notice → **Sarvam AI** translates it into a resident's language → **Sarvam AI** text-to-speech turns it into audio → the board shows the text and plays the voice.

Many residents can't read English notices, or can't read at all. Vani-Board makes every announcement readable and listenable in the resident's own language.

```
Browser (public/)  →  server.js (keeps API key private)  →  Sarvam /translate  →  Sarvam /text-to-speech
```

## Run it

You need [Node.js](https://nodejs.org) 18 or newer and a free Sarvam API key from [dashboard.sarvam.ai](https://dashboard.sarvam.ai).

```bash
git clone https://github.com/srividya-v-rao/project_vs.git
cd project_vs
npm install               # installs dotenv
cp env.example .env       # Windows: copy env.example .env
```

Open `.env` and paste your key after `SARVAM_API_KEY=` (no quotes, no spaces). Then:

```bash
node server.js
```

Open http://localhost:3000, tap **Use sample notice**, pick a language and press **Broadcast to Vani-Board**. The translated text appears and the voice plays automatically.

If the page says "Sarvam API key missing", check that `.env` is in the project folder, has your key, and that you restarted the server after editing it.

## Which Sarvam models are used

| Job | Endpoint | Model |
|---|---|---|
| Translation | `/translate` | `mayura:v1` |
| Text-to-speech | `/text-to-speech` | `bulbul:v3` (voice: `ritu`) |

Both are Sarvam AI models, and no other AI provider is used. You can change them in `.env` with `SARVAM_TRANSLATE_MODEL`, `SARVAM_TTS_MODEL` and `SARVAM_SPEAKER`.

Languages: Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia and English.

## Files

| File | Role |
|---|---|
| `server.js` | Serves the page and proxies `/api/translate` and `/api/tts` to Sarvam, so the key never reaches the browser |
| `public/index.html` | Page, notice box, language chips |
| `public/app.js` | Flow: translate → text-to-speech → play |
| `public/style.css` | Look and feel |
| `env.example` | Template for your `.env` file |

## Phone line (optional, Exotel)

`server.js` also has a `/api/voice` route so a resident can call a phone number and hear the notice read out in Kannada.

1. Run the server and expose it with a tunnel such as ngrok.
2. In Exotel, build a call flow: **Passthru** (pointing at `https://YOUR-TUNNEL/api/voice`) followed by a **Greeting** applet that plays the dynamic greeting.
3. The route must reply with JSON `{"greeting_url": "<wav url>"}` and generate the audio at 8 kHz, because Exotel only plays 8 kHz mono 16-bit WAV files.

## Roadmap

- Send the same audio as WhatsApp voice notes
- accessable in keypad phones
- Schedule notices and keep a notice history
- Remember each resident's preferred language
