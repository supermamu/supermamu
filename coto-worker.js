/**
 * SUPERCOMPARADOR PROXY — Cloudflare Worker v7
 * =============================================
 * Carrefour   → VTEX Intelligent Search
 * Jumbo       → VTEX catalog search
 * Día         → VTEX catalog search (diaonline)
 * Vea/Disco   → VTEX catalog search
 * Changomás   → VTEX catalog search (masonline)
 * Coto        → Constructor.io search + Endeca product detail
 * Farmacity   → VTEX Intelligent Search
 * Medicamentos → Scraping preciosdemedicamentos.com.ar
 *
 * Uso: ?tienda=carrefour|jumbo|dia|coto|farmacity|medicamentos&q=QUERY
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url    = new URL(request.url);
    const tienda = url.searchParams.get('tienda');
    const query  = url.searchParams.get('q');

    if (!tienda || !query) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros tienda y q' }), {
        status: 400, headers: corsHeaders()
      });
    }

    try {
      if (tienda === 'coto') {
        return await handleCoto(query);
      }

      if (tienda === 'medicamentos') {
        return await handleMedicamentos(query);
      }

      // ── VTEX stores ──
      let targetUrl;
      if (tienda === 'carrefour') {
        targetUrl = `https://www.carrefour.com.ar/api/io/_v/api/intelligent-search/product_search?query=${encodeURIComponent(query)}&count=3&locale=es-AR`;
      } else if (tienda === 'jumbo') {
        targetUrl = `https://www.jumbo.com.ar/api/io/_v/api/intelligent-search/product_search?query=${encodeURIComponent(query)}&count=3&locale=es-AR`;
      } else if (tienda === 'dia') {
        targetUrl = `https://diaonline.supermercadosdia.com.ar/api/io/_v/api/intelligent-search/product_search?query=${encodeURIComponent(query)}&count=3&locale=es-AR`;
      } else if (tienda === 'vea') {
        targetUrl = `https://www.vea.com.ar/api/io/_v/api/intelligent-search/product_search?query=${encodeURIComponent(query)}&count=3&locale=es-AR`;
      } else if (tienda === 'disco') {
        targetUrl = `https://www.disco.com.ar/api/io/_v/api/intelligent-search/product_search?query=${encodeURIComponent(query)}&count=3&locale=es-AR`;
      } else if (tienda === 'changomas') {
        targetUrl = `https://www.masonline.com.ar/api/io/_v/api/intelligent-search/product_search?query=${encodeURIComponent(query)}&count=3&locale=es-AR`;
      } else if (tienda === 'farmacity') {
        targetUrl = `https://www.farmacity.com/api/io/_v/api/intelligent-search/product_search?query=${encodeURIComponent(query)}&count=15&locale=es-AR`;
      } else {
        return new Response(JSON.stringify({ error: 'Tienda no válida' }), {
          status: 400, headers: corsHeaders()
        });
      }

      const resp = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'application/json',
        },
      });

      const data = await resp.text();
      return new Response(data, {
        status: resp.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: corsHeaders()
      });
    }
  },
};

// ═══════════════════════════════════════════════════════
// COTO — Constructor.io search API
// ═══════════════════════════════════════════════════════

const COTO_STORE = '200';

async function handleCoto(query) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'es-AR,es;q=0.9',
    'Origin': 'https://www.cotodigital.com.ar',
    'Referer': 'https://www.cotodigital.com.ar/',
  };

  try {
    const filter = encodeURIComponent(JSON.stringify({"name":"store_availability","value":"200"}));
    const searchUrl = `https://api.coto.com.ar/api/v1/ms-digital-sitio-bff-web/api/v1/products/search/${encodeURIComponent(query)}?key=key_r6xzz4IAoTWcipni&num_results_per_page=5&pre_filter_expression=${filter}`;

    const searchResp = await fetch(searchUrl, { headers });

    if (searchResp.ok) {
      const searchData = await searchResp.json();

      if (searchData.response && searchData.response.results && searchData.response.results.length > 0) {
        const products = searchData.response.results.slice(0, 5).map(r => parseConstructorResult(r));
        return jsonResponse({ source: 'coto-constructor', products });
      }
    }

    const plu = query.replace(/\D/g, '');
    if (plu.length >= 5 && plu.length <= 8) {
      const paddedPlu = plu.padStart(8, '0');
      const productUrl = `https://www.cotodigital.com.ar/sitios/cdigi/productos/-/_/R-${paddedPlu}-${paddedPlu}-200?format=json`;

      const prodResp = await fetch(productUrl, { headers });
      if (prodResp.ok) {
        const prodData = await prodResp.json();
        const product = parseEndecaProduct(prodData);
        if (product) {
          return jsonResponse({ source: 'coto-endeca', products: [product] });
        }
      }
    }

    return jsonResponse({
      source: 'coto-none',
      products: [],
      debug: { query, searchStatus: searchResp?.status }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Coto: ${err.message}` }), {
      status: 500, headers: corsHeaders()
    });
  }
}

function parseConstructorResult(result) {
  const d = result.data || {};

  const storePrice = (d.price || []).find(p => p.store === COTO_STORE);
  const listPrice = storePrice ? storePrice.listPrice : (d.product_list_price || null);

  let discountPrice = null;
  let discountText = null;
  if (d.discounts && d.discounts.length > 0) {
    const disc = d.discounts[0];
    discountText = disc.discountText || null;
    if (disc.discountPrice) {
      discountPrice = parseFloat(disc.discountPrice.replace(/[^0-9.,]/g, '').replace(',', '.'));
    }
  }

  const precio = discountPrice || listPrice;

  return {
    nombre: d.sku_display_name || d.sku_description || result.value || null,
    precio: precio,
    listPrice: (discountPrice && listPrice && listPrice > discountPrice) ? listPrice : null,
    imagen: d.image_url || d.product_medium_image_url || null,
    link: d.url ? `https://www.cotodigital.com.ar/sitios/cdigi/productos/${d.url}` : null,
    plu: d.sku_plu || null,
    discountText: discountText,
    brand: d.product_brand || null,
  };
}

function parseEndecaProduct(data) {
  try {
    const main = data.contents[0].Main[0];
    const attrs = main.record.attributes;

    const nombre = getFirst(attrs['product.displayName']) || getFirst(attrs['product.description']);
    const activePrice = parseFloat(getFirst(attrs['sku.activePrice'])) || null;
    const imagen = getFirst(attrs['product.mediumImage.url']);
    const ean = getFirst(attrs['product.eanPrincipal']);

    let discountPrice = null;
    let listPrice = activePrice;
    let discountText = null;

    const dtoStr = getFirst(attrs['product.dtoDescuentos']);
    if (dtoStr) {
      try {
        const dtos = JSON.parse(dtoStr);
        if (dtos.length > 0) {
          discountText = dtos[0].textoDescuento || null;
          if (dtos[0].precioDescuento) {
            discountPrice = parseFloat(dtos[0].precioDescuento.replace(/[^0-9.,]/g, '').replace(',', '.'));
          }
        }
      } catch {}
    }

    const precio = discountPrice || activePrice;

    let link = null;
    try {
      const recordState = data.canonicalLink.recordState;
      if (recordState) {
        link = `https://www.cotodigital.com.ar/sitios/cdigi/productos${recordState}`;
      }
    } catch {}

    return {
      nombre,
      precio,
      listPrice: (discountPrice && activePrice && activePrice > discountPrice) ? activePrice : null,
      imagen,
      link,
      plu: getFirst(attrs['product.repositoryId']),
      ean,
      discountText,
      brand: getFirst(attrs['product.brand']) || getFirst(attrs['product.MARCA']),
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// MEDICAMENTOS — Scraping preciosdemedicamentos.com.ar
// ═══════════════════════════════════════════════════════

async function handleMedicamentos(query) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'es-AR,es;q=0.9',
  };

  try {
    // Detect if query is a barcode (EAN) — try Farmacity VTEX first for EAN lookups
    const isEan = /^\d{8,13}$/.test(query.trim());

    if (isEan) {
      // EAN/barcode: try Farmacity VTEX which supports EAN search
      try {
        const vtexUrl = `https://www.farmacity.com/api/io/_v/api/intelligent-search/product_search?query=${encodeURIComponent(query)}&count=5&locale=es-AR`;
        const vtexResp = await fetch(vtexUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            'Accept': 'application/json',
          },
        });
        if (vtexResp.ok) {
          const vtexData = await vtexResp.json();
          if (vtexData.products && vtexData.products.length > 0) {
            // Found by EAN in Farmacity — now search by name in medicamentos
            const productName = vtexData.products[0].productName;
            if (productName) {
              // Extract the core drug name (first 2-3 words)
              const coreName = productName.split(/\s+/).slice(0, 3).join(' ');
              const medResults = await fetchMedicamentosPage(coreName, headers);
              return jsonResponse({
                source: 'preciosdemedicamentos.com.ar',
                query: coreName,
                eanMatch: productName,
                url: `https://preciosdemedicamentos.com.ar/resultados/${encodeURIComponent(coreName)}`,
                productos: medResults,
              });
            }
          }
        }
      } catch {}
    }

    // Standard name search
    const productos = await fetchMedicamentosPage(query, headers);

    return jsonResponse({
      source: 'preciosdemedicamentos.com.ar',
      query,
      url: `https://preciosdemedicamentos.com.ar/resultados/${encodeURIComponent(query)}`,
      productos,
    });
  } catch (err) {
    return jsonResponse({ source: 'medicamentos', error: err.message, productos: [] });
  }
}

async function fetchMedicamentosPage(query, headers) {
  const searchUrl = `https://preciosdemedicamentos.com.ar/resultados/${encodeURIComponent(query)}`;
  const resp = await fetch(searchUrl, { headers });

  if (!resp.ok) return [];

  const html = await resp.text();
  return parseMedicamentosHtml(html);
}

/**
 * Parse medication results from preciosdemedicamentos.com.ar HTML
 * Table columns: Nombre Comercial | Principio Activo | Laboratorio | Precio | PAMI
 */
function parseMedicamentosHtml(html) {
  const productos = [];

  // Extract table rows
  const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRegex) || [];

  for (const row of rows) {
    try {
      // Skip header rows and empty rows
      if (row.includes('<th') || row.includes('thead')) continue;

      // Extract name from medication link
      const nameMatch = row.match(/href="[^"]*\/medicamento\/[^"]*"[^>]*>\s*([^<]+)/i);
      if (!nameMatch) continue;

      const nombre = nameMatch[1].trim();
      if (!nombre || nombre.length < 2) continue;

      // Extract presentation (text in parentheses or common pharma formats)
      let presentacion = null;
      const presenMatch = row.match(/\(([^)]{3,})\)/);
      if (presenMatch) {
        presentacion = presenMatch[1].trim();
      }

      // Extract "Desde $X.XXX" pattern
      const desdeMatch = row.match(/Desde\s*\$\s*([\d.,]+)/i);

      // Extract all dollar amounts
      const allPrices = [];
      const priceRegex = /\$\s*([\d]+(?:\.[\d]{3})*(?:,\d+)?)/g;
      let m;
      while ((m = priceRegex.exec(row)) !== null) {
        const num = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
        if (num > 0) allPrices.push(num);
      }

      // Pharmacy price: prefer "Desde" price, else first price found
      const precioFarmacia = desdeMatch
        ? parseFloat(desdeMatch[1].replace(/\./g, '').replace(',', '.'))
        : (allPrices[0] || null);

      if (!precioFarmacia) continue;

      // PAMI price: look for explicit PAMI indicator
      let precioPami = null;
      const pamiSection = row.match(/PAMI[^<]*<[^>]*>[^$]*\$\s*([\d.,]+)/i);
      if (pamiSection) {
        precioPami = parseFloat(pamiSection[1].replace(/\./g, '').replace(',', '.'));
      } else {
        // Check if PAMI column has a price (usually second unique price, lower than pharmacy)
        const uniquePrices = [...new Set(allPrices)];
        if (uniquePrices.length >= 2) {
          const candidate = uniquePrices[uniquePrices.length - 1];
          if (candidate < precioFarmacia * 0.9) {
            precioPami = candidate;
          }
        }
      }

      // Extract laboratorio
      let laboratorio = null;
      const labMatch = row.match(/\/laboratorio\/([^"]+)"/i);
      if (labMatch) {
        laboratorio = decodeURIComponent(labMatch[1]).replace(/\+/g, ' ').trim();
      } else {
        const labAlt = row.match(/Laboratorio:\s*(?:<[^>]+>)*\s*([^<]+)/i);
        if (labAlt) laboratorio = labAlt[1].trim();
      }

      // Extract principio activo (droga)
      let droga = null;
      const drogaMatch = row.match(/\/para-que-sirve\/([^"]+)"/i);
      if (drogaMatch) {
        droga = decodeURIComponent(drogaMatch[1]).replace(/\+/g, ' ').trim();
      } else {
        const drogaAlt = row.match(/Principio\s*Activo:\s*(?:<[^>]+>)*\s*([^<]+)/i);
        if (drogaAlt) droga = drogaAlt[1].trim();
      }

      // Extract product link
      let link = null;
      const linkMatch = row.match(/href="(\/medicamento\/[^"]+)"/i);
      if (linkMatch) {
        link = 'https://preciosdemedicamentos.com.ar' + linkMatch[1];
      }

      productos.push({
        nombre,
        presentacion,
        droga,
        laboratorio,
        precioFarmacia,
        precioPami,
        link,
      });
    } catch {
      continue;
    }
  }

  // Deduplicate by name (keep first = lowest "Desde" price)
  const seen = new Set();
  const unique = [];
  for (const p of productos) {
    const key = p.nombre.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  return unique.slice(0, 30);
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function getFirst(arr) {
  if (!arr) return null;
  return Array.isArray(arr) ? arr[0] : arr;
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}