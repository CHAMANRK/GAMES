export const config = { runtime: 'edge' };

const OR_URL  = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CF_IMG_URL = (accountId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

// Hugging Face — FLUX.1-schnell (free tier, good quality)
const HF_IMG_URL = 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell';

const MODELS = {
  chat:   'anthropic/claude-opus-4.6',
  vision: 'anthropic/claude-sonnet-4.5',
  code:   'anthropic/claude-sonnet-4.5',
};

const GROQ_FALLBACK = {
  chat: 'moonshotai/kimi-k2-instruct',
  code: 'qwen/qwen3-32b',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  const OR_KEY   = process.env.OPENROUTER_API_KEY;
  const GROQ_KEY = process.env.GROQ_API_KEY;
  const CF_TOKEN = process.env.CF_API_TOKEN;
  const CF_ACCT  = process.env.CF_ACCOUNT_ID;
  const HF_KEY   = process.env.HUGGINGFACE_API_KEY;

  try {
    const body = await req.json();
    const mode = body.mode || 'chat';

    // IMAGE GENERATION
    if (mode === 'image') {
      const lastMsg = [...body.messages].reverse().find(m => m.role === 'user');
      const rawPrompt = typeof lastMsg?.content === 'string'
        ? lastMsg.content
        : lastMsg?.content?.find?.(c => c.type === 'text')?.text || 'a beautiful scene';

      const prompt = rawPrompt
        .replace(/^(ek\s+)?(image|photo|picture|tasveer|bana|banao|generate|create|draw|bana do|dikha|dikha do|generate karo)[:\s]*/gi, '')
        .trim() || rawPrompt;

      // 1. Cloudflare Flux (if keys present)
      if (CF_TOKEN && CF_ACCT) {
        try {
          const cfRes = await fetch(CF_IMG_URL(CF_ACCT), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, num_steps: 8 }),
          });
          if (cfRes.ok) {
            const imgBuffer = await cfRes.arrayBuffer();
            const b64 = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));
            const imgTag = `<img src="data:image/jpeg;base64,${b64}" style="max-width:100%;border-radius:12px;margin-top:6px"/>`;
            return sseText(imgTag, 'cf/flux-schnell');
          }
          console.error('CF failed:', cfRes.status);
        } catch (e) {
          console.error('CF error:', e.message);
        }
      }

      // 2. Hugging Face FLUX.1-schnell (if key present)
      if (HF_KEY) {
        try {
          const hfRes = await fetch(HF_IMG_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${HF_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ inputs: prompt }),
          });
          if (hfRes.ok) {
            const imgBuffer = await hfRes.arrayBuffer();
            const b64 = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));
            const imgTag = `<img src="data:image/jpeg;base64,${b64}" style="max-width:100%;border-radius:12px;margin-top:6px"/>`;
            return sseText(imgTag, 'hf/flux-schnell');
          }
          console.error('HF failed:', hfRes.status);
        } catch (e) {
          console.error('HF error:', e.message);
        }
      }

      // 3. Pollinations via proxy (CORS safe, last resort)
      const encodedPrompt = encodeURIComponent(prompt);
      const seed = Math.floor(Math.random() * 99999);
      const proxyUrl = `/api/imggen?prompt=${encodedPrompt}&seed=${seed}`;
      const imgTag = `<img src="${proxyUrl}" style="max-width:100%;border-radius:12px;margin-top:6px" loading="lazy" onerror="this.outerHTML='<p style=color:#f66>Image nahi bani. Dobara try karo.</p>'"/>`;
      return sseText(imgTag, 'pollinations/flux');
    }

    // VISION
    const hasImage = body.messages.some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
    );

    const activeMode = hasImage ? 'vision' : mode;
    const chosenModel = MODELS[activeMode] || MODELS.chat;

    let systemPrompt = body.system || '';
    if (activeMode === 'code') {
      systemPrompt = (systemPrompt ? systemPrompt + '\n\n' : '') +
        '[CODE MODE: Always use proper code blocks with language tags. Add comments. Explain briefly after code. If debugging identify root cause first.]';
    }

    const orMsgs = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...body.messages
    ];

    // OpenRouter (primary)
    if (OR_KEY) {
      const res = await fetch(OR_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OR_KEY}`,
          'HTTP-Referer': 'https://chaman.vercel.app',
          'X-Title': 'Chaman AI',
        },
        body: JSON.stringify({
          model: chosenModel,
          messages: orMsgs,
          max_tokens: body.max_tokens || (activeMode === 'code' ? 2000 : 1000),
          stream: true,
          temperature: activeMode === 'code' ? 0.3 : 0.85,
        }),
      });

      if (res.ok) return streamOpenAIResponse(res, chosenModel.split('/').pop());

      if (GROQ_KEY && (activeMode === 'chat' || activeMode === 'code')) {
        const groqModel = GROQ_FALLBACK[activeMode];
        const groqRes = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
          body: JSON.stringify({
            model: groqModel,
            messages: orMsgs,
            max_tokens: body.max_tokens || (activeMode === 'code' ? 2000 : 1000),
            stream: true,
            temperature: activeMode === 'code' ? 0.3 : 0.85,
          }),
        });
        if (groqRes.ok) return streamOpenAIResponse(groqRes, groqModel.split('/').pop());
      }
    }

    // Groq only
    if (GROQ_KEY) {
      const groqModel = activeMode === 'code' ? 'qwen/qwen3-32b' : 'moonshotai/kimi-k2-instruct';
      const groqRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: groqModel,
          messages: orMsgs,
          max_tokens: body.max_tokens || 1000,
          stream: true,
          temperature: activeMode === 'code' ? 0.3 : 0.85,
        }),
      });
      if (groqRes.ok) return streamOpenAIResponse(groqRes, groqModel.split('/').pop());
    }

    return sseText('❌ Koi bhi API available nahi. Keys check karo.');

  } catch (e) {
    return jsonError(e.message, 500);
  }
}

function streamOpenAIResponse(res, modelName) {
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
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
    },
  });
}

function sseText(text, model = '') {
  const sse = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\ndata: [DONE]\n\n`;
  return new Response(sse, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'x-active-model': model,
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonError(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
