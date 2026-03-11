export const config = { runtime: 'edge' };

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OR_URL   = 'https://openrouter.ai/api/v1/chat/completions';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  const OR_KEY   = process.env.OPENROUTER_API_KEY;

  try {
    const body = await req.json();
    const messages = [
      ...(body.system ? [{ role: 'system', content: body.system }] : []),
      ...body.messages
    ];

    // Check if any message has image content (vision)
    const hasImage = body.messages.some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
    );

    // ── VISION — only OpenRouter free models that actually support images ──
    if (hasImage) {
      if (!OR_KEY) {
        const msg = '❌ Image padhne ke liye OPENROUTER_API_KEY chahiye Vercel mein.';
        return sseText(msg, 'none');
      }

      // Only these two reliably work for vision on OpenRouter free tier
      const visionModels = [
        'meta-llama/llama-3.2-11b-vision-instruct:free',
        'google/gemini-2.0-flash-exp:free',
      ];

      for (const model of visionModels) {
        const res = await fetch(OR_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OR_KEY}`,
            'HTTP-Referer': 'https://chaman.vercel.app',
            'X-Title': 'Chaman AI'
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: body.max_tokens || 1000,
            stream: true,
            temperature: 0.8,
          })
        });

        if (res.ok) return streamResponse(res, `openrouter/${model.split('/')[1]}`);

        const err = await res.text().catch(() => '');
        // if model not valid, try next
        if (res.status === 400 || res.status === 404) continue;
        // if rate limit, also try next
        if (res.status === 429) continue;
      }

      return sseText('❌ Vision models abhi available nahi. Thodi der baad try karo.', 'none');
    }

    // ── TEXT CHAT: Groq (fastest) → OpenRouter fallback ──
    const textProviders = [
      GROQ_KEY && {
        name: 'groq/llama-3.3-70b',
        url: GROQ_URL,
        headers: { 'Authorization': `Bearer ${GROQ_KEY}` },
        body: { model: 'llama-3.3-70b-versatile', messages, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.85 }
      },
      OR_KEY && {
        name: 'openrouter/llama-3.3-70b',
        url: OR_URL,
        headers: {
          'Authorization': `Bearer ${OR_KEY}`,
          'HTTP-Referer': 'https://chaman.vercel.app',
          'X-Title': 'Chaman AI'
        },
        body: { model: 'meta-llama/llama-3.3-70b-instruct:free', messages, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.85 }
      },
      OR_KEY && {
        name: 'openrouter/mistral-7b',
        url: OR_URL,
        headers: {
          'Authorization': `Bearer ${OR_KEY}`,
          'HTTP-Referer': 'https://chaman.vercel.app',
          'X-Title': 'Chaman AI'
        },
        body: { model: 'mistralai/mistral-7b-instruct:free', messages, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.85 }
      },
    ].filter(Boolean);

    if (textProviders.length === 0) {
      return new Response(JSON.stringify({ error: 'Koi API key set nahi! GROQ_API_KEY Vercel mein add karo.' }), {
        status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const errors = [];
    for (const p of textProviders) {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...p.headers },
        body: JSON.stringify(p.body),
      });

      if (res.ok) return streamResponse(res, p.name);

      let e = res.status;
      try { const j = await res.json(); e = j?.error?.message?.slice(0, 60) || res.status; } catch(_) {}
      errors.push(`${p.name}: ${e}`);
      await new Promise(r => setTimeout(r, 300));
    }

    return new Response(JSON.stringify({ error: `Koi model kaam nahi kar raha.\n(${errors.join(' | ')})` }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// Helper: send a single SSE text message (for errors shown in chat)
function sseText(text, model = '') {
  const sse = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\ndata: [DONE]\n\n`;
  return new Response(sse, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*', 'x-active-model': model }
  });
}

// Stream OpenAI-format SSE → Anthropic-format SSE
function streamResponse(res, modelName) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  (async () => {
    const reader = res.body.getReader();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const text = j?.choices?.[0]?.delta?.content;
            if (text) {
              await writer.write(encoder.encode(
                `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`
              ));
            }
          } catch (_) {}
        }
      }
      await writer.write(encoder.encode('data: [DONE]\n\n'));
    } catch (_) {
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*', 'x-active-model': modelName }
  });
}
