/**
 * SUPERCOMPARADOR PROXY — Cloudflare Worker v6
 * =============================================
 * Carrefour → VTEX Intelligent Search
 * Jumbo     → VTEX catalog search
 * Día       → VTEX catalog search (diaonline)
 * Coto      → Constructor.io search + Endeca product detail
 * Uso: ?tienda=carrefour|jumbo|dia|coto&q=EAN
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
    // ── Constructor.io search via Coto BFF ──
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

    // ── Fallback: Endeca product detail ──
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

/**
 * Parsear resultado de Constructor.io search
 * Estructura: response.results[].data { sku_display_name, price[], discounts[], image_url, url, ... }
 */
function parseConstructorResult(result) {
  const d = result.data || {};

  // Precio para sucursal 200 (online)
  const storePrice = (d.price || []).find(p => p.store === COTO_STORE);
  const listPrice = storePrice ? storePrice.listPrice : (d.product_list_price || null);

  // Precio con descuento
  let discountPrice = null;
  let discountText = null;
  if (d.discounts && d.discounts.length > 0) {
    const disc = d.discounts[0];
    discountText = disc.discountText || null;
    // discountPrice viene como "$1360.00" → parsear
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

/**
 * Parsear producto de Endeca JSON (product detail ?format=json)
 * Estructura: contents[0].Main[0].record.attributes
 */
function parseEndecaProduct(data) {
  try {
    const main = data.contents[0].Main[0];
    const attrs = main.record.attributes;

    const nombre = getFirst(attrs['product.displayName']) || getFirst(attrs['product.description']);
    const activePrice = parseFloat(getFirst(attrs['sku.activePrice'])) || null;
    const imagen = getFirst(attrs['product.mediumImage.url']);
    const ean = getFirst(attrs['product.eanPrincipal']);

    // Descuentos desde dtoDescuentos (JSON string)
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

    // URL del producto desde canonicalLink
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
