export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
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
      return new Response(JSON.stringify({ error: `CF ${res.status}: ${txt.slice(0,200)}` }), { status: res.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
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
