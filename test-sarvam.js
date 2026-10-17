require('dotenv').config();

async function makeCall() {
    if (!process.env.SARVAM_API_KEY) {
        console.error("Error: SARVAM_API_KEY is not set in the environment.");
        return;
    }

    try {
        const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-subscription-key': process.env.SARVAM_API_KEY
            },
            body: JSON.stringify({
                model: "sarvam-105b-conversations",
                messages: [{ role: "user", content: "Say hello in one sentence." }]
            })
        });
        
        const data = await response.json();
        console.log(data);
    } catch (error) {
        console.error("API Call Failed:", error);
    }
}

makeCall();