// ╔═══════════════════════════════════════════════════╗
// ║  Nassau Golf — Cloudflare Worker (API Proxy)      ║
// ║  Keeps your Anthropic API key off the client      ║
// ╚═══════════════════════════════════════════════════╝
//
// SETUP INSTRUCTIONS:
// 1. Log in at dash.cloudflare.com → Workers & Pages → Create Worker
// 2. Replace the default code with this entire file
// 3. Click "Save and Deploy"
// 4. Go to your Worker → Settings → Variables → Secrets
//    Add secret: Name = ANTHROPIC_API_KEY  Value = your key from console.anthropic.com
// 5. Copy your Worker URL (shown at top of editor)
//    Looks like: https://nassau-proxy.YOUR-NAME.workers.dev
// 6. Paste that URL into index.html where it says REPLACE_WITH_YOUR_WORKER_URL

export default {
  async fetch(request, env) {

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    let anthropicRes;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Anthropic unreachable', detail: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await anthropicRes.json();
    return new Response(JSON.stringify(data), {
      status: anthropicRes.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
