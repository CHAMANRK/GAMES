export const config = { runtime: 'edge' };

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

  const OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not set in Vercel env' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const body = await req.json();
    const messages = [
      ...(body.system ? [{ role: 'system', content: body.system }] : []),
      ...body.messages
    ];

    // openrouter/free = auto-picks best available free model
    // models array = fallback chain if primary fails (OpenRouter native fallback feature)
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OR_KEY}`,
        'HTTP-Referer': 'https://chaman.vercel.app',
        'X-Title': 'Chaman AI',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        // Native OR fallback chain — if free router fails, try these
        models: [
          'openrouter/free',
          'meta-llama/llama-3.3-70b-instruct:free',
          'mistralai/mistral-7b-instruct:free',
        ],
        route: 'fallback',
        messages,
        max_tokens: body.max_tokens || 1000,
        stream: true,
        temperature: 0.85,
      }),
    });

    if (!res.ok) {
      let errMsg = 'API Error ' + res.status;
      try {
        const j = await res.json();
        errMsg = j?.error?.message || errMsg;
      } catch(_) {}
      return new Response(JSON.stringify({ error: errMsg }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // OpenAI SSE → Anthropic SSE
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let activeModel = 'openrouter/free';

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
              // Capture which model was actually used
              if (j?.model && j.model !== 'openrouter/free') activeModel = j.model;
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
        'x-active-model': activeModel,
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
  
