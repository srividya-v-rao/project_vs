# Vani-Board · वाणी

Multilingual, voice-enabled community notice board. An admin posts an English notice → Sarvam AI translates it into a resident's language → Sarvam TTS turns it into speech → the board shows the text and plays the audio.

```
Browser (public/)  →  server.js (keeps API key private)  →  Sarvam /translate  →  Sarvam /text-to-speech
```

## Run it

```bash
cd vani-board
cp .env.example .env      # paste your SARVAM_API_KEY (get one at dashboard.sarvam.ai)
node server.js            # Node 18+, no npm install needed
# open http://localhost:3000
```

Translation (`/translate`, model `mayura:v1`) and speech (`/text-to-speech`, model `bulbul:v3`) both come from **Sarvam AI**. Nothing else is used, and without `SARVAM_API_KEY` the app shows a setup message instead of faking output.

## Files

| File | Step | Role |
|---|---|---|
| `server.js` | 5, 6 | `/api/translate`, `/api/tts` proxy to Sarvam |
| `public/index.html` | 2, 3, 4 | Page, notice box, language chips |
| `public/app.js` | 4–7 | Flow: translate → TTS → play |
| `public/style.css` | 8 | Look and feel |

## 3-minute demo script

1. **Problem (30s):** "Our apartment notices are in English on a wall. Many residents can't read them, or read a different language."
2. **Post (30s):** Click *Use sample notice*, pick **Telugu**, hit *Broadcast*.
3. **Wow moment (60s):** Translated text appears and the voice starts automatically. Replay it. Switch to **Hindi**, then **Tamil**, and broadcast again.
4. **Why it matters (30s):** "Reads for people who can't read. Speaks for people who can't read the language."
5. **Roadmap (30s):** Same audio goes to WhatsApp voice notes and IoT loudspeakers in the lobby. Then: a scheduler, notice history, and per-resident language preferences.

## Demo-day checklist

- Test with your real key on the venue Wi-Fi beforehand; keep a phone hotspot ready.
- Pre-run one notice and keep that tab open, so you can replay its audio if the network fails.
- Turn the volume up and click the page once before presenting (browsers can block autoplay).
- Never commit `.env`.
