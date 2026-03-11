export const config = { runtime: 'edge' };

// ── Provider configs ──
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const OR_URL     = 'https://openrouter.ai/api/v1/chat/completions';

// Image generation — Cloudflare Workers AI (Flux)
const CF_IMG_URL = (accountId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

// Detect image generation request
function isImageRequest(messages) {
  const last = messages[messages.length - 1]?.content || '';
  const text = typeof last === 'string' ? last : last.map?.(c => c.text || '').join(' ') || '';
  return /\b(image banao|image bana|generate image|create image|draw|photo banao|picture bana|tasveer bana)\b/i.test(text);
}

function extractImagePrompt(messages) {
  const last = messages[messages.length - 1]?.content || '';
  const text = typeof last === 'string' ? last : last.map?.(c => c.text || '').join(' ') || '';
  return text.replace(/\b(image banao|image bana|generate image|create image|draw|photo banao|picture bana|tasveer bana)[:\s]*/i, '').trim();
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const GROQ_KEY  = process.env.GROQ_API_KEY;
  const NV_KEY    = process.env.NVIDIA_API_KEY;
  const OR_KEY    = process.env.OPENROUTER_API_KEY;
  const CF_ID     = process.env.CF_ACCOUNT_ID;
  const CF_TOKEN  = process.env.CF_API_TOKEN;

  try {
    const body = await req.json();
    const messages = [
      ...(body.system ? [{ role: 'system', content: body.system }] : []),
      ...body.messages
    ];

    // ── IMAGE GENERATION ──
    if ((body.imageGen || isImageRequest(body.messages)) && CF_ID && CF_TOKEN) {
      const prompt = body.prompt || extractImagePrompt(body.messages);
      const cfRes = await fetch(CF_IMG_URL(CF_ID), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CF_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, num_steps: 4 }),
      });

      if (cfRes.ok) {
        const imgData = await cfRes.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(imgData)));
        // Return as SSE with image tag so HTML can render it
        const imgMsg = `<img src="data:image/jpeg;base64,${b64}" style="max-width:100%;border-radius:12px;margin-top:8px"/>`;
        const sse = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: imgMsg } })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
            'x-active-model': 'cloudflare/flux-1-schnell',
          }
        });
      }
    }

    // Detect if any message contains image content
    const hasImage = body.messages.some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
    );

    // ── CHAT: Groq (fastest) → NVIDIA (powerful) → OpenRouter (fallback) ──
    const providers = [
      // Groq — skip if image (no vision support)
      !hasImage && GROQ_KEY && {
        name: 'groq/llama-3.3-70b',
        url: GROQ_URL,
        key: GROQ_KEY,
        body: { model: 'llama-3.3-70b-versatile', messages, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.85 }
      },
      // NVIDIA — text models
      !hasImage && NV_KEY && {
        name: 'nvidia/qwen3.5-397b',
        url: NVIDIA_URL,
        key: NV_KEY,
        body: { model: 'qwen/qwen3.5-397b-a17b', messages, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.85 }
      },
      !hasImage && NV_KEY && {
        name: 'nvidia/qwen3.5-122b',
        url: NVIDIA_URL,
        key: NV_KEY,
        body: { model: 'qwen/qwen3.5-122b-a10b', messages, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.85 }
      },
      // OpenRouter — handles both text and vision
      OR_KEY && {
        name: 'openrouter/vision',
        url: OR_URL,
        key: OR_KEY,
        extraHeaders: { 'HTTP-Referer': 'https://chaman.vercel.app', 'X-Title': 'Chaman AI' },
        body: hasImage ? {
          // Vision model for images
          model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
          models: ['meta-llama/llama-3.2-11b-vision-instruct:free', 'google/gemini-2.0-flash-exp:free', 'openrouter/free'],
          route: 'fallback',
          messages, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.85
        } : {
          model: 'openrouter/free',
          models: ['openrouter/free', 'meta-llama/llama-3.3-70b-instruct:free', 'mistralai/mistral-7b-instruct:free'],
          route: 'fallback',
          messages, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.85
        }
      },
    ].filter(Boolean);

    let successRes = null;
    let activeModel = '';
    const errors = [];

    for (const p of providers) {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${p.key}`,
          ...(p.extraHeaders || {}),
        },
        body: JSON.stringify(p.body),
      });

      if (res.ok) {
        successRes = res;
        activeModel = p.name;
        break;
      }

      let e = res.status;
      try { const j = await res.json(); e = j?.error?.message?.slice(0, 50) || res.status; } catch(_) {}
      errors.push(`${p.name}: ${e}`);
      if (res.status !== 429 && res.status !== 503 && res.status !== 500) continue;
      await new Promise(r => setTimeout(r, 400));
    }

    if (!successRes) {
      return new Response(JSON.stringify({
        error: `Koi model available nahi. Thodi der baad try karo.\n(${errors.join(' | ')})`
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return streamResponse(successRes, activeModel);

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

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
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'x-active-model': modelName,
    }
  });
}
  
