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
    const reqUrl = new URL(req.url);
    let prompt = 'a beautiful scene';

    if (req.method === 'GET') {
      prompt = reqUrl.searchParams.get('prompt') || prompt;
    } else if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      prompt = body.prompt || prompt;
    } else {
      return new Response('Method not allowed', { status: 405 });
    }

    const cleanPrompt = decodeURIComponent(prompt)
      .replace(/^(ek\s+)?(image|photo|picture|tasveer|bana|banao|generate|create|draw)[:\s]*/gi, '')
      .trim() || 'a beautiful scene';

    const imgW = reqUrl.searchParams.get('w') || '768';
    const imgH = reqUrl.searchParams.get('h') || '768';
    const seed = reqUrl.searchParams.get('seed') || String(Math.floor(Math.random() * 99999));
    const encodedPrompt = encodeURIComponent(cleanPrompt);

    // 1. Cloudflare Flux
    if (CF_TOKEN && CF_ACCT) {
      try {
        const cfCtrl = new AbortController();
        const cfTimer = setTimeout(() => cfCtrl.abort(), 20000);
        const cfRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CF_ACCT}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: cleanPrompt, num_steps: 8 }),
            signal: cfCtrl.signal,
          }
        );
        clearTimeout(cfTimer);
        if (cfRes.ok) {
          const imgBuffer = await cfRes.arrayBuffer();
          if (imgBuffer.byteLength > 1000) {
            return new Response(imgBuffer, {
              status: 200,
              headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*', 'x-source': 'cloudflare-flux' },
            });
          }
        }
      } catch (e) { console.error('CF error:', e.message); }
    }

    // 2. Pollinations fetch
    const polUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${imgW}&height=${imgH}&seed=${seed}&nologo=true&model=flux`;
    try {
      const polCtrl = new AbortController();
      const polTimer = setTimeout(() => polCtrl.abort(), 25000);
      const polRes = await fetch(polUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120', 'Accept': 'image/*' },
        signal: polCtrl.signal,
      });
      clearTimeout(polTimer);
      if (polRes.ok) {
        const imgBuffer = await polRes.arrayBuffer();
        return new Response(imgBuffer, {
          status: 200,
          headers: { 'Content-Type': polRes.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*', 'x-source': 'pollinations' },
        });
      }
    } catch (e) { console.error('Pollinations error:', e.message); }

    // 3. Direct redirect fallback
    return new Response(null, {
      status: 302,
      headers: { 'Location': `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${imgW}&height=${imgH}&seed=${seed}&nologo=true`, 'Access-Control-Allow-Origin': '*' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
