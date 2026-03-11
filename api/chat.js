export const config = { runtime: 'edge' };

// Model chain — tries in order until one  works
const MODELS = [
  'google/gemini-2.0-flash-exp:free',      // Best quality, fast
  'deepseek/deepseek-r1:free',              // Strong reasoning fallback
  'deepseek/deepseek-chat:free',            // Lighter deepseek
  'meta-llama/llama-3.3-70b-instruct:free', // Last resort
];

// Groq as final fallback if OpenRouter all fail
const GROQ_MODEL = 'llama-3.3-70b-versatile';

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

  try {
    const body = await req.json();
    const messages = [
      ...(body.system ? [{ role: 'system', content: body.system }] : []),
      ...body.messages
    ];

    const OR_KEY = process.env.OPENROUTER_API_KEY;
    const GROQ_KEY = process.env.GROQ_API_KEY;
    const errors = [];
    let successResponse = null;

    // ── Try OpenRouter models ──
    if (OR_KEY) {
      for (const model of MODELS) {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OR_KEY}`,
            'HTTP-Referer': 'https://chaman.vercel.app',
            'X-Title': 'Chaman AI',
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: body.max_tokens || 1000,
            stream: true,
            temperature: 0.85,
          }),
        });

        if (res.status === 429 || res.status === 503) {
          errors.push(`OR/${model.split('/')[1]}: busy`);
          await new Promise(r => setTimeout(r, 600));
          continue;
        }
        if (!res.ok) {
          const e = await res.text();
          errors.push(`OR/${model.split('/')[1]}: ${e.slice(0,60)}`);
          continue;
        }

        successResponse = res;
        break;
      }
    }

    // ── Fallback: Groq ──
    if (!successResponse && GROQ_KEY) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          max_tokens: body.max_tokens || 1000,
          stream: true,
          temperature: 0.85,
        }),
      });

      if (res.ok) {
        successResponse = res;
      } else {
        errors.push(`Groq: ${res.status}`);
      }
    }

    if (!successResponse) {
      return new Response(JSON.stringify({
        error: `Sab models busy hain. Thodi der baad try karo.\n(${errors.join(' | ')})`
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── Stream: OpenAI SSE → Anthropic SSE ──
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    (async () => {
      const reader = successResponse.body.getReader();
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
                const converted = JSON.stringify({
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text }
                });
                await writer.write(encoder.encode(`data: ${converted}\n\n`));
              }
            } catch (_) {}
          }
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch (e) {
        // stream ended
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
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
