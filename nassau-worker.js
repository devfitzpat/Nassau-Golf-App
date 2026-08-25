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
// 6. Paste that URL into nassau-index.html's WORKER_URL constant
//
// This Worker is a CLOSED proxy — it only accepts {imageBase64, courseName,
// coursePar} and builds the full Anthropic request itself. The client can
// no longer choose the model, token budget, or prompt.

const ALLOWED_ORIGIN = 'https://devfitzpat.github.io'; // your GitHub Pages origin — change if you move hosts
const MAX_BODY_BYTES = 3000000;

const PLAYERS_SCHEMA = {
  type: 'object',
  properties: {
    players: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          hcp: { type: 'string', description: "GHIN index as printed, keep a leading + for plus handicaps, '0' if absent" },
          scores: { type: 'array', items: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, description: 'exactly 18 entries, holes 1-18 in order, null when illegible or blank' }
        },
        required: ['name', 'hcp', 'scores'],
        additionalProperties: false
      }
    }
  },
  required: ['players'],
  additionalProperties: false
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    if (origin && origin !== ALLOWED_ORIGIN) {
      return json({ error: 'Origin not allowed' }, 403, origin);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ error: 'Request body too large' }, 413, origin);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid JSON' }, 400, origin);
    }

    const { imageBase64, courseName, coursePar } = body || {};
    if (typeof imageBase64 !== 'string' || imageBase64.length < 100 || !/^[A-Za-z0-9+/=\s]+$/.test(imageBase64)) {
      return json({ error: 'imageBase64 missing or invalid' }, 400, origin);
    }

    const safeCourseName = String(courseName ?? 'the course').replace(/[<>{}]/g, '').slice(0, 60);
    const parNum = Number(coursePar);
    const safePar = Number.isFinite(parNum) && parNum >= 60 && parNum <= 80 ? parNum : 72;

    const prompt = `You are reading a golf scorecard from ${safeCourseName} at Fair Oaks Ranch, TX (Par ${safePar}).

Extract every player on this scorecard. Return ONLY valid JSON, no other text, no markdown fences:
{"players":[{"name":"Player Name","hcp":"8.4","scores":[4,3,5,4,4,5,3,4,5,5,4,3,4,4,4,3,5,4]}]}

Rules:
- scores is always an array of exactly 18 integers (holes 1-18 in order)
- Use null for any illegible or missing score
- hcp is the player's GHIN handicap index as printed next to their name (keep a leading + for plus handicaps)
- Include every player row you can find`;

    const anthropicBody = {
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: PLAYERS_SCHEMA }
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: prompt }
        ]
      }]
    };

    let anthropicRes;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody),
      });
    } catch (err) {
      return json({ error: 'Anthropic unreachable', detail: err.message }, 502, origin);
    }

    const upstreamRaw = await anthropicRes.text();
    let data;
    try {
      data = JSON.parse(upstreamRaw);
    } catch {
      return json({ error: 'Anthropic returned a non-JSON response', status: anthropicRes.status }, 502, origin);
    }

    return json(data, anthropicRes.status, origin);
  }
};
