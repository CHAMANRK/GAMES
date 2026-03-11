export const config = { runtime: 'edge' };

// Provider configs
const PROVIDERS = [
  {
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    extraHeaders: {
      'HTTP-Referer': 'https://chaman.vercel.app',
      'X-Title': 'Chaman AI',
    },
    fallbackModels: [
      'meta-llama/llama-3.1-8b-instruct:free',
      'mistralai/mistral-7b-instruct:free',
    ]
  },
  {
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    extraHeaders: {},
    fallbackModels: ['llama-3.1-8b-instant']
  },
];

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

    let successResponse = null;
    const errors = [];

    // Try each provider, then its fallback models
    for (const provider of PROVIDERS) {
      const apiKey = process.env[provider.envKey];
      if (!apiKey) {
        errors.push(`${provider.name}: API key not set`);
        continue;
      }

      const modelsToTry = [provider.model, ...provider.fallbackModels];

      for (const model of modelsToTry) {
        const res = await fetch(provider.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...provider.extraHeaders,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: body.max_tokens || 1000,
            stream: true,
            temperature: 0.8,
          }),
        });

        if (res.status === 429) {
          errors.push(`${provider.name}/${model}: rate limited`);
          await new Promise(r => setTimeout(r, 800));
          continue;
        }

        if (!res.ok) {
          const err = await res.text();
          errors.push(`${provider.name}/${model}: ${err.slice(0, 80)}`);
          continue;
        }

        successResponse = res;
        break;
      }

      if (successResponse) break;
    }

    if (!successResponse) {
      return new Response(JSON.stringify({
        error: `Dono providers busy hain! Thodi der baad try karo.\nDetails: ${errors.join(' | ')}`
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Convert OpenAI SSE → Anthropic SSE (what HTML expects)
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
