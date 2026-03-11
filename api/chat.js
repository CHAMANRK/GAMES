export const config = { runtime: 'edge' };

// Converts Anthropic-format messages to Gemini format
function toGeminiMessages(messages) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
}

// Converts a Gemini SSE chunk to Anthropic SSE format
function toAnthropicChunk(geminiChunk) {
  try {
    const j = JSON.parse(geminiChunk);
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text }
    });
  } catch { return null; }
}

export default async function handler(req) {
  // CORS preflight
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

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not set in environment' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    // Parse incoming Anthropic-format body from HTML
    const body = await req.json();
    const { system, messages, max_tokens } = body;

    // Build Gemini request
    const geminiBody = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: toGeminiMessages(messages),
      generationConfig: {
        maxOutputTokens: max_tokens || 1000,
        temperature: 0.8,
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return new Response(err, {
        status: geminiRes.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Transform Gemini SSE stream → Anthropic SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    (async () => {
      const reader = geminiRes.body.getReader();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line in buffer
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;
            const converted = toAnthropicChunk(data);
            if (converted) {
              await writer.write(encoder.encode(`data: ${converted}\n\n`));
            }
          }
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch(e) {
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
