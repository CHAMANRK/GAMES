export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') {
    const CF_ID=process.env.CF_ACCOUNT_ID, CF_TOKEN=process.env.CF_API_TOKEN;
    return new Response(JSON.stringify({
      status:'imggen online',
      CF_ID_set:!!CF_ID, CF_ID_len:CF_ID?.length,
      CF_TOKEN_set:!!CF_TOKEN, CF_TOKEN_len:CF_TOKEN?.length,
      CF_TOKEN_prefix:CF_TOKEN?.slice(0,8),
    }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const CF_ID    = process.env.CF_ACCOUNT_ID;
  const CF_TOKEN = process.env.CF_API_TOKEN;

  if (!CF_ID || !CF_TOKEN) {
    return new Response(JSON.stringify({ error: `Env missing — CF_ID:${!!CF_ID} CF_TOKEN:${!!CF_TOKEN}` }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    const body = await req.json();
    const prompt = body.prompt || 'a beautiful cat';

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, num_steps: 4 }),
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      console.error('CF failed, trying Pollinations fallback:', res.status, txt.slice(0,100));
      // Fallback to Pollinations.ai (no key needed)
      const encodedPrompt = encodeURIComponent(prompt);
      const pollRes = await fetch(`https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&nologo=true&seed=${Math.floor(Math.random()*99999)}`, {
        headers: { 'User-Agent': 'ChamanAI/1.0' }
      });
      if (!pollRes.ok) {
        return new Response(JSON.stringify({ error: `CF ${res.status}: ${txt.slice(0,100)} | Pollinations also failed: ${pollRes.status}` }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      const pollBuf = await pollRes.arrayBuffer();
      const pollBytes = new Uint8Array(pollBuf);
      let pollB64 = '';
      for (let i = 0; i < pollBytes.length; i += 8192) { pollB64 += String.fromCharCode(...pollBytes.subarray(i, i + 8192)); }
      return new Response(JSON.stringify({ image: btoa(pollB64), source: 'pollinations' }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // Cloudflare returns raw image bytes
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let b64 = '';
    // chunk to avoid stack overflow on large images
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    b64 = btoa(b64);

    return new Response(JSON.stringify({ image: b64 }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
