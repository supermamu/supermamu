/**
 * SUPERMAMU — OpenRouter Proxy Worker
 * ====================================
 * Proxies requests to OpenRouter API keeping the API key secret.
 * 
 * Deploy:
 *   npx wrangler deploy openrouter-worker.js --name supermamu-ai
 * 
 * Then set the secret:
 *   npx wrangler secret put OPENROUTER_API_KEY
 *   (paste your key when prompted)
 */

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: corsHeaders()
      });
    }

    try {
      const body = await request.text();

      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://supermamu.pages.dev',
          'X-Title': 'SuperMamu',
        },
        body: body,
      });

      const data = await resp.text();
      return new Response(data, {
        status: resp.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: corsHeaders(),
      });
    }
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
