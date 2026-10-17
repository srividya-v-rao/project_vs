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




