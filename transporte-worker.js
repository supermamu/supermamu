/**
 * SUPERMAMU — Transporte Proxy Worker
 * ====================================
 * Proxies requests to Buenos Aires Transport API and fuel price sources.
 * Keeps API credentials secret.
 *
 * Endpoints:
 *   ?tipo=subte-alertas       → Subte service alerts
 *   ?tipo=trenes-alertas      → Train service alerts  
 *   ?tipo=colectivos-alertas  → Bus service alerts
 *   ?tipo=subte-forecast      → Subte real-time forecast
 *   ?tipo=nafta                → Fuel prices (YPF reference CABA)
 *
 * Deploy:
 *   npx wrangler deploy transporte-worker.js --name supermamu-transporte
 *
 * Environment variables (set via wrangler secret):
 *   BA_TRANSPORT_CLIENT_ID
 *   BA_TRANSPORT_CLIENT_SECRET
 */

const BA_API_BASE = 'https://apitransporte.buenosaires.gob.ar';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const tipo = url.searchParams.get('tipo');

    if (!tipo) {
      return jsonResponse({ error: 'Falta parámetro tipo' }, 400);
    }

    const clientId = env.BA_TRANSPORT_CLIENT_ID;
    const clientSecret = env.BA_TRANSPORT_CLIENT_SECRET;

    try {
      switch (tipo) {
        case 'subte-alertas':
          return await proxyBATransport(`${BA_API_BASE}/subtes/serviceAlerts`, clientId, clientSecret);

        case 'trenes-alertas':
          return await proxyBATransport(`${BA_API_BASE}/trenes/serviceAlerts`, clientId, clientSecret);

        case 'colectivos-alertas':
          return await proxyBATransport(`${BA_API_BASE}/colectivos/serviceAlerts`, clientId, clientSecret);

        case 'subte-forecast':
          return await proxyBATransport(`${BA_API_BASE}/subtes/forecastGTFS`, clientId, clientSecret);

        case 'nafta':
          return await handleNafta();

        case 'tarifas':
          return await handleTarifas();

        default:
          return jsonResponse({ error: 'Tipo no válido' }, 400);
      }
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

/**
 * Proxy a request to the BA Transport API, adding credentials
 */
async function proxyBATransport(baseUrl, clientId, clientSecret) {
  const url = `${baseUrl}?client_id=${clientId}&client_secret=${clientSecret}&json=1`;

  const resp = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'SuperMamu/1.0',
    },
  });

  const data = await resp.text();

  return new Response(data, {
    status: resp.status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

/**
 * Fetch fuel prices — scrape from preciosensurtidor or fallback to known data
 */
async function handleNafta() {
  try {
    // Try fetching from the government's preciosensurtidor API
    // The mobile app uses this endpoint pattern
    const searchUrl = 'https://preciosensurtidor.energia.gob.ar/api/1/buscar_eess';

    const resp = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
        'Origin': 'https://preciosensurtidor.energia.gob.ar',
        'Referer': 'https://preciosensurtidor.energia.gob.ar/',
      },
      body: JSON.stringify({
        lat: -34.6037,
        lng: -58.3816,
        dist: 5,
        precio: 'nafta_super',
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && (data.estaciones || data.results || Array.isArray(data))) {
        return jsonResponse({ source: 'preciosensurtidor', data });
      }
    }
  } catch (e) {
    // Fallback below
  }

  // Alternative: try scraping surtidores.com.ar/precios
  try {
    const resp = await fetch('https://surtidores.com.ar/precios/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });

    if (resp.ok) {
      const html = await resp.text();
      const precios = parseSurtidoresHtml(html);
      if (precios.length > 0) {
        return jsonResponse({ source: 'surtidores', precios });
      }
    }
  } catch (e) {
    // Fallback below
  }

  // Final fallback: return reference prices (updated manually or via scheduled worker)
  return jsonResponse({
    source: 'referencia',
    nota: 'Precios de referencia YPF CABA. Pueden variar según estación.',
    actualizacion: '2026-03-28',
    precios: [
      { empresa: 'YPF', producto: 'Nafta Súper', precio: 1920 },
      { empresa: 'YPF', producto: 'Nafta Premium (Infinia)', precio: 2250 },
      { empresa: 'YPF', producto: 'Gasoil', precio: 1850 },
      { empresa: 'YPF', producto: 'Gasoil Premium (Infinia Diesel)', precio: 2180 },
      { empresa: 'Shell', producto: 'Nafta Súper (V-Power)', precio: 1980 },
      { empresa: 'Shell', producto: 'Nafta Premium (V-Power Nitro+)', precio: 2320 },
      { empresa: 'Shell', producto: 'Gasoil (V-Power Diesel)', precio: 1910 },
      { empresa: 'Axion', producto: 'Nafta Súper', precio: 1950 },
      { empresa: 'Axion', producto: 'Nafta Premium (Quantium)', precio: 2280 },
      { empresa: 'Axion', producto: 'Gasoil', precio: 1870 },
      { empresa: 'Puma', producto: 'Nafta Súper', precio: 1890 },
      { empresa: 'Puma', producto: 'Nafta Premium', precio: 2200 },
    ],
  });
}

/**
 * Parse fuel prices from surtidores.com.ar HTML (best-effort)
 */
function parseSurtidoresHtml(html) {
  const precios = [];
  // Look for price patterns like "$1,920.00" near fuel type names
  const patterns = [
    { regex: /Nafta\s*S[uú]per[^$]*\$\s*([\d.,]+)/gi, producto: 'Nafta Súper' },
    { regex: /Nafta\s*Premium[^$]*\$\s*([\d.,]+)/gi, producto: 'Nafta Premium' },
    { regex: /Gasoil(?:\s*Grado\s*2)?[^$]*\$\s*([\d.,]+)/gi, producto: 'Gasoil' },
    { regex: /Infinia(?:\s*Diesel)?[^$]*\$\s*([\d.,]+)/gi, producto: 'Infinia' },
  ];

  for (const { regex, producto } of patterns) {
    const match = regex.exec(html);
    if (match) {
      const precio = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
      if (precio > 0) {
        precios.push({ empresa: 'YPF', producto, precio });
      }
    }
  }

  return precios;
}

/**
 * Current transport fares for AMBA
 */
async function handleTarifas() {
  return jsonResponse({
    source: 'argentina.gob.ar',
    actualizacion: '2026-03-16',
    nota: 'Tarifas vigentes desde 16/03/2026 para AMBA',
    tarifas: {
      subte: {
        nombre: 'Subte (CABA)',
        precio: 1206,
        nota: 'Tarifa con SUBE registrada. Se actualiza mensualmente (IPC + 1%)',
      },
      colectivo_caba: {
        nombre: 'Colectivo CABA',
        tramos: [
          { distancia: '0-3 km', precio: 681.85, tarifa_social: 306.83 },
          { distancia: '3-6 km', precio: 757.64, tarifa_social: 340.93 },
          { distancia: '6-12 km', precio: 833.38, tarifa_social: 375.02 },
          { distancia: '12-27 km', precio: 909.17, tarifa_social: 409.13 },
          { distancia: '+27 km', precio: 984.97, tarifa_social: 443.24 },
        ],
        nota: 'Con SUBE registrada. Sin registrar +59%',
      },
      tren: {
        nombre: 'Tren (AMBA)',
        tramos: [
          { distancia: '0-12 km', precio: 300 },
          { distancia: '12-24 km', precio: 370 },
          { distancia: '+24 km', precio: 450 },
        ],
        nota: 'Valores de referencia. Tarifas congeladas desde sep 2024',
      },
      saldo_negativo: {
        monto: -1500,
        nota: 'Permite hasta 2 viajes sin saldo',
      },
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=300',
  };
}
