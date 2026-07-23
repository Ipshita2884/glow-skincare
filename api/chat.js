// Serverless API Endpoint Handler (Vercel / Netlify / Node.js)
// Securely processes Gemini AI requests using process.env.GEMINI_API_KEY

const SYSTEM_PROMPT = `You are Glow AI, a warm, encouraging, expert luxury skincare consultant.
Guidelines:
- Answer skincare, beauty, ingredient, and daily routine questions.
- Never diagnose medical diseases or skin conditions.
- Never prescribe prescription medicines.
- Recommend consulting a certified dermatologist when appropriate.
- Keep responses concise, friendly, and structured using bullet points and emojis.`;

const MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
];

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Server GEMINI_API_KEY environment variable is missing.' });
    }

    try {
        const { contents, prompt } = req.body || {};
        
        // Input validation & length check
        if (!prompt && (!contents || !contents.length)) {
            return res.status(400).json({ error: 'Prompt or contents array is required.' });
        }

        if (prompt && prompt.length > 1000) {
            return res.status(400).json({ error: 'Prompt exceeds maximum length of 1000 characters.' });
        }

        // Format conversation turns
        let apiContents = contents || [];
        if (!apiContents.length && prompt) {
            apiContents = [{ role: 'user', parts: [{ text: prompt }] }];
        }

        // Prepend system prompt to initial user turn
        const requestPayload = {
            contents: [
                { role: 'user', parts: [{ text: `[System Instruction: ${SYSTEM_PROMPT}]` }] },
                { role: 'model', parts: [{ text: "Understood! I am Glow AI, your expert skincare consultant. How can I help you today? ✨" }] },
                ...apiContents
            ]
        };

        // Model Fallback Cascade
        let lastError = null;
        for (const modelName of MODELS) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
                const apiRes = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestPayload)
                });

                const data = await apiRes.json();
                
                if (apiRes.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                    return res.status(200).json({
                        reply: data.candidates[0].content.parts[0].text,
                        model: modelName
                    });
                }

                // If non-recoverable auth error, break early
                if (apiRes.status === 401 || apiRes.status === 403) {
                    return res.status(apiRes.status).json({ error: data.error?.message || 'Unauthorized API Key' });
                }

                lastError = data.error?.message || `HTTP ${apiRes.status}`;
            } catch (err) {
                lastError = err.message;
            }
        }

        return res.status(502).json({ error: `All Gemini AI models failed. Last error: ${lastError}` });
    } catch (err) {
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
}
