// api/imggen.js — Vercel Edge Function (Image Proxy)
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  const CF_TOKEN = process.env.CF_API_TOKEN;
  const CF_ACCT  = process.env.CF_ACCOUNT_ID;

  try {
    let prompt = 'a beautiful scene';

    if (req.method === 'GET') {
      // GET: /api/imggen?prompt=...&seed=...
      const url = new URL(req.url);
      prompt = url.searchParams.get('prompt') || prompt;
    } else if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      prompt = body.prompt || prompt;
    } else {
      return new Response('Method not allowed', { status: 405 });
    }

    // Clean prompt
    const cleanPrompt = decodeURIComponent(prompt)
      .replace(/^(ek\s+)?(image|photo|picture|tasveer|bana|banao|generate|create|draw)[:\s]*/gi, '')
      .trim() || prompt;

    // 1. Cloudflare Flux (fast, free with your account)
    if (CF_TOKEN && CF_ACCT) {
      try {
        const cfRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CF_ACCT}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${CF_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: cleanPrompt, num_steps: 8 }),
          }
        );
        if (cfRes.ok) {
          const imgBuffer = await cfRes.arrayBuffer();
          return new Response(imgBuffer, {
            status: 200,
            headers: {
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'public, max-age=3600',
              'Access-Control-Allow-Origin': '*',
              'x-source': 'cloudflare-flux',
            },
          });
        }
        console.error('CF failed:', cfRes.status);
      } catch (e) {
        console.error('CF error:', e.message);
      }
    }

    // 2. Pollinations proxy — server side se fetch, CORS issue nahi
    const reqUrl = new URL(req.url);
    const imgW = reqUrl.searchParams.get('w') || 768;
    const imgH = reqUrl.searchParams.get('h') || 768;
    const encodedPrompt = encodeURIComponent(cleanPrompt);
    const seed = Math.floor(Math.random() * 99999);
    const polUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${imgW}&height=${imgH}&seed=${seed}&nologo=true&model=flux`;

    const polRes = await fetch(polUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' },
    });

    if (!polRes.ok) throw new Error(`Pollinations: ${polRes.status}`);

    const imgBuffer = await polRes.arrayBuffer();
    const contentType = polRes.headers.get('content-type') || 'image/jpeg';

    return new Response(imgBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'x-source': 'pollinations',
      },
    });

  } catch (e) {
    // Error pe 1x1 transparent pixel nahi — proper JSON error
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
