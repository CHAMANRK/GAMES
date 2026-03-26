// api/game-proxy.js — Vercel Serverless Proxy
// Groq API ko securely call karta hai — API key kabhi frontend par expose nahi hoti

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, temperature = 0.85, max_tokens = 400, responseFormat } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    const body = {
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature,
      max_tokens,
    };

    // JSON mode sirf question fetch ke liye (hint ke liye nahi)
    if (responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = data?.error?.message || `Groq error ${response.status}`;
      return res.status(response.status).json({ error: msg });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('game-proxy error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
