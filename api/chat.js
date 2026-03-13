export const config = { runtime: 'edge' };

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const OR_URL     = 'https://openrouter.ai/api/v1/chat/completions';

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

  const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
  const GROQ_KEY   = process.env.GROQ_API_KEY;
  const OR_KEY     = process.env.OPENROUTER_API_KEY;

  try {
    const body = await req.json();

    // Check if any message has image content
    const hasImage = body.messages.some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
    );

    // ── VISION ──
    // Claude natively supports vision — try it first
    if (hasImage) {
      if (CLAUDE_KEY) {
        // Convert image_url format → Claude's base64 format
        const claudeMsgs = body.messages.map(m => {
          if (!Array.isArray(m.content)) return m;
          return {
            role: m.role,
            content: m.content.map(c => {
              if (c.type === 'image_url') {
                // data:mime;base64,xxxx → extract mime + data
                const dataUrl = c.image_url?.url || '';
                const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
                }
              }
              return c;
            })
          };
        });

        const res = await fetch(CLAUDE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: body.max_tokens || 1000,
            system: body.system || '',
            messages: claudeMsgs,
            stream: true
          })
        });

        if (res.ok) return streamClaudeResponse(res, 'claude/sonnet-4');
      }

      // Fallback to OpenRouter vision models
      if (OR_KEY) {
        const visionModels = [
          'meta-llama/llama-3.2-11b-vision-instruct:free',
          'google/gemini-2.0-flash-exp:free',
        ];
        const orMsgs = [
          ...(body.system ? [{ role: 'system', content: body.system }] : []),
          ...body.messages
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
            body: JSON.stringify({ model, messages: orMsgs, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.8 })
          });
          if (res.ok) return streamOpenAIResponse(res, `openrouter/${model.split('/')[1]}`);
          if (res.status === 400 || res.status === 404 || res.status === 429) continue;
        }
      }

      return sseText('❌ Vision models abhi available nahi. Thodi der baad try karo.', 'none');
    }

    // ── TEXT CHAT: Claude (primary) → Groq → OpenRouter ──
    const messages = [
      ...(body.system ? [{ role: 'system', content: body.system }] : []),
      ...body.messages
    ];

    // 1. Try Claude first
    if (CLAUDE_KEY) {
      const res = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', // Fast + cheap for public chat
          max_tokens: body.max_tokens || 1000,
          system: body.system || '',
          messages: body.messages, // Claude takes system separately
          stream: true
        })
      });
      if (res.ok) return streamClaudeResponse(res, 'claude/haiku-4');
    }

    // 2. Groq fallback (fastest open source)
    if (GROQ_KEY) {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          max_tokens: body.max_tokens || 1000,
          stream: true,
          temperature: 0.85
        })
      });
      if (res.ok) return streamOpenAIResponse(res, 'groq/llama-3.3-70b');
    }

    // 3. OpenRouter fallbacks
    if (OR_KEY) {
      const orModels = [
        'meta-llama/llama-3.3-70b-instruct:free',
        'mistralai/mistral-7b-instruct:free'
      ];
      for (const model of orModels) {
        const res = await fetch(OR_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OR_KEY}`,
            'HTTP-Referer': 'https://chaman.vercel.app',
            'X-Title': 'Chaman AI'
          },
          body: JSON.stringify({ model, messages, max_tokens: body.max_tokens || 1000, stream: true, temperature: 0.85 })
        });
        if (res.ok) return streamOpenAIResponse(res, `openrouter/${model.split('/')[1]}`);
      }
    }

    return new Response(JSON.stringify({ error: 'Koi bhi API key set nahi! Vercel mein ANTHROPIC_API_KEY add karo.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// ── Stream Claude (Anthropic SSE format) → frontend format ──
function streamClaudeResponse(res, modelName) {
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
            // Claude SSE: content_block_delta → text_delta
            if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
              await writer.write(encoder.encode(
                `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: j.delta.text } })}\n\n`
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
      'x-active-model': modelName
    }
  });
}

// ── Stream OpenAI-format SSE (Groq/OpenRouter) → frontend format ──
function streamOpenAIResponse(res, modelName) {
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
      'x-active-model': modelName
    }
  });
}

// Helper: single SSE text message (for errors shown in chat)
function sseText(text, model = '') {
  const sse = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\ndata: [DONE]\n\n`;
  return new Response(sse, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*', 'x-active-model': model }
  });
}
