// Production Zero-Fail Multi-Tier Serverless API Route (/api/chat)
// Fallback Cascade: Gemini API -> Pollinations Free AI -> Ollama Local AI

const SYSTEM_PROMPT = `You are Glow AI, a warm, encouraging, expert luxury skincare consultant.
Guidelines:
- Answer skincare, beauty, ingredient, and daily routine questions.
- Never diagnose medical diseases or skin conditions.
- Never prescribe prescription medicines.
- Recommend consulting a certified dermatologist when appropriate.
- Keep responses concise, friendly, and structured using bullet points and emojis.`;

const GEMINI_MODELS = [
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
];

async function fetchPollinationsAi(prompt, systemInstruction) {
    try {
        const fullPrompt = `${systemInstruction}\n\nUser Question: ${prompt}`;
        const url = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`;
        const res = await fetch(url);
        if (res.ok) {
            const text = await res.text();
            if (text && text.trim().length > 5) {
                return { reply: text.trim(), model: 'pollinations-openai' };
            }
        }
    } catch(e) {
        console.error("Pollinations AI error:", e.message);
    }
    return null;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { contents, prompt } = req.body || {};
        const userPrompt = prompt || (contents && contents.length ? contents[contents.length - 1]?.parts?.[0]?.text : '');

        if (!userPrompt) {
            return res.status(400).json({ error: 'Prompt is required.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;

        // Tier 1: Gemini API
        if (apiKey) {
            let apiContents = contents || [{ role: 'user', parts: [{ text: userPrompt }] }];
            const requestPayload = {
                contents: [
                    { role: 'user', parts: [{ text: `[System Instruction: ${SYSTEM_PROMPT}]` }] },
                    { role: 'model', parts: [{ text: "Understood! I am Glow AI, your expert luxury skincare consultant. How can I help you today? ✨" }] },
                    ...apiContents
                ]
            };

            for (const modelName of GEMINI_MODELS) {
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
                } catch(err) {}
            }
        }

        // Tier 2: Pollinations Free Open AI Engine (Zero rate-limits, zero API keys)
        const pollinationsResult = await fetchPollinationsAi(userPrompt, SYSTEM_PROMPT);
        if (pollinationsResult) {
            return res.status(200).json(pollinationsResult);
        }

        return res.status(502).json({ error: 'AI Assistant unavailable. Please try again!' });
    } catch(err) {
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
}
