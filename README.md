# Vani-Board · वाणी

Multilingual, voice-enabled community notice board. An admin posts an English notice → **Sarvam AI** translates it into a resident's language → **Sarvam AI** text-to-speech turns it into audio → the board shows the text and plays the voice.

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

## History

Every broadcast notice is saved with its original text, its translation and its voice. The **History** section under the board lists them newest first. Each one can be played again, shown on the board, or deleted. History is kept in the `data/` folder (`history.json` plus one `.wav` per notice), so it survives restarts. The latest 100 notices are kept, and `data/` is not uploaded to GitHub.

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
| `server.js` | Serves the page, calls Sarvam for translation and voice (the key never reaches the browser), and stores the history |
| `public/index.html` | Page, notice box, language chips, history section |
| `public/app.js` | Flow: translate → text-to-speech → play, plus the history list |
| `public/style.css` | Look and feel |
| `env.example` | Template for your `.env` file |

## Phone line (optional, Exotel)

`server.js` also has a `/api/voice` route so a resident can call a phone number and hear the notice read out in Kannada.

1. Run the server and expose it with a tunnel such as ngrok.
2. In Exotel, build a call flow: **Passthru** (pointing at `https://YOUR-TUNNEL/api/voice`) followed by a **Greeting** applet that plays the dynamic greeting.
3. The route must reply with JSON `{"greeting_url": "<wav url>"}` and generate the audio at 8 kHz, because Exotel only plays 8 kHz mono 16-bit WAV files.

## 3-minute demo script

1. **Problem (30s):** "Our apartment notices are in English on a wall. Many residents can't read them, or read a different language."
2. **Post (30s):** Click *Use sample notice*, pick **Telugu**, press *Broadcast*.
3. **Wow moment (60s):** The translated text appears and the voice starts automatically. Replay it. Switch to **Hindi**, then **Tamil**, and broadcast again.
4. **Why it matters (30s):** "It reads for people who can't read, and speaks for people who can't read the language."
5. **Roadmap (30s):** The same audio goes to WhatsApp voice notes, phone calls and IoT loudspeakers in the lobby. Next: a scheduler, notice history and per-resident language preferences.

## Demo-day checklist

- Test with your real key on the venue Wi-Fi beforehand and keep a phone hotspot ready.
- Pre-run one notice and keep that tab open, so you can replay its audio if the network fails.
- Turn the volume up and click the page once before presenting, because browsers can block autoplay.
- Never commit `.env`. It is already listed in `.gitignore`.
