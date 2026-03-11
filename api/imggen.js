export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ status: 'imggen online — Pollinations.ai' }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const body = await req.json();
    const prompt = (body.prompt || 'a beautiful landscape').trim();
    const seed = Math.floor(Math.random() * 999999);
    const encoded = encodeURIComponent(prompt);

    // Pollinations.ai — completely free, no API key needed, very reliable
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=768&height=768&nologo=true&seed=${seed}&model=flux`;

    const res = await fetch(url);

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Image generation failed: ${res.status}` }), {
        status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let b64 = '';
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    b64 = btoa(b64);

    return new Response(JSON.stringify({ image: b64, mime: contentType }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
