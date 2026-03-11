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

  const CF_ID    = process.env.CF_ACCOUNT_ID;
  const CF_TOKEN = process.env.CF_API_TOKEN;

  // Debug — return env status (remove after fixing)
  if (!CF_ID || !CF_TOKEN) {
    return new Response(JSON.stringify({
      error: 'Missing env vars',
      CF_ID_set: !!CF_ID,
      CF_TOKEN_set: !!CF_TOKEN,
      CF_ID_length: CF_ID?.length || 0,
      CF_TOKEN_length: CF_TOKEN?.length || 0,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const { prompt } = await req.json();

    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: prompt || 'a cat', num_steps: 4 }),
    });

    const rawText = await res.text();

    if (!res.ok) {
      return new Response(JSON.stringify({
        error: 'CF API error',
        status: res.status,
        url_used: url.replace(CF_ID, 'CF_ID_HIDDEN'),
        response: rawText.slice(0, 300),
      }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Success — rawText is binary, re-fetch as arrayBuffer
    const res2 = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: prompt || 'a cat', num_steps: 4 }),
    });

    const imgBuffer = await res2.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));

    return new Response(JSON.stringify({ image: b64 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
