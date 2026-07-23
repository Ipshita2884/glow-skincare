// Production-Ready Serverless Backend API Route (/api/chat)
// Handles dynamic model discovery, multi-model fallback cascade, rate-limit backoff, and zero-leak API Key security.

const SYSTEM_PROMPT = `You are Glow AI, a warm, encouraging, expert luxury skincare consultant.
Guidelines:
- Answer skincare, beauty, ingredient, and daily routine questions.
- Never diagnose medical diseases or skin conditions.
- Never prescribe prescription medicines.
- Recommend consulting a certified dermatologist when appropriate.
- Keep responses concise, friendly, and structured using bullet points and emojis.`;

const PREFERRED_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
];

let cachedActiveModel = null;
let lastModelScanTime = 0;

// Dynamic Model Discovery: Scans Gemini API for supported generateContent models
async function discoverBestModel(apiKey) {
    const NOW = Date.now();
    // Cache discovered model for 10 minutes
    if (cachedActiveModel && (NOW - lastModelScanTime < 600000)) {
        return [cachedActiveModel, ...PREFERRED_MODELS.filter(m => m !== cachedActiveModel)];
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data.models && Array.isArray(data.models)) {
                const supportedNames = data.models
                    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''));
                
                // Pick highest priority supported model
                for (const pref of PREFERRED_MODELS) {
                    if (supportedNames.includes(pref)) {
                        cachedActiveModel = pref;
                        lastModelScanTime = NOW;
                        return [pref, ...PREFERRED_MODELS.filter(m => m !== pref)];
                    }
                }
            }
        }
    } catch(e) {
        console.error("Dynamic model discovery error:", e.message);
    }

    return PREFERRED_MODELS;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Server GEMINI_API_KEY environment variable is not configured.' });
    }

    try {
        const { contents, prompt } = req.body || {};
        if (!prompt && (!contents || !contents.length)) {
            return res.status(400).json({ error: 'Prompt or contents array is required.' });
        }

        if (prompt && prompt.length > 1000) {
            return res.status(400).json({ error: 'Prompt exceeds maximum length of 1000 characters.' });
        }

        let apiContents = contents || [];
        if (!apiContents.length && prompt) {
            apiContents = [{ role: 'user', parts: [{ text: prompt }] }];
        }

        const requestPayload = {
            contents: [
                { role: 'user', parts: [{ text: `[System Instruction: ${SYSTEM_PROMPT}]` }] },
                { role: 'model', parts: [{ text: "Understood! I am Glow AI, your expert luxury skincare consultant. How can I help you today? ✨" }] },
                ...apiContents
            ]
        };

        const modelCascade = await discoverBestModel(apiKey);
        let lastError = null;

        for (const modelName of modelCascade) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
                let attempts = 0;
                let apiRes;

                // Handle 429 Rate Limits with exponential backoff (up to 2 retries)
                while (attempts < 2) {
                    attempts++;
                    apiRes = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestPayload)
                    });

                    if (apiRes.status === 429) {
                        await new Promise(r => setTimeout(r, attempts * 1000));
                        continue;
                    }
                    break;
                }

                const data = await apiRes.json();

                if (apiRes.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                    cachedActiveModel = modelName;
                    return res.status(200).json({
                        reply: data.candidates[0].content.parts[0].text,
                        model: modelName
                    });
                }

                if (apiRes.status === 401 || apiRes.status === 403) {
                    return res.status(apiRes.status).json({ error: 'Unauthorized API Key configuration' });
                }

                lastError = data.error?.message || `HTTP ${apiRes.status}`;
            } catch(err) {
                lastError = err.message;
            }
        }

        return res.status(502).json({ error: `All Gemini AI models busy (${lastError}). Please retry!` });
    } catch(err) {
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
}
