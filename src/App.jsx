import { useState, useEffect, useRef, useCallback } from "react";

const PROXY = "https://coto-proxy.supermamuuu.workers.dev";
const AI_PROXY = "https://supermamu-ai.supermamuuu.workers.dev";
const TRANSPORTE_PROXY = "https://supermamu-transporte.supermamuuu.workers.dev";

/* ═══════ SUPERMERCADO CONFIG ═══════ */
const TIENDAS = [
  { id: "carrefour", label: "Carrefour", color: "#003087", mapsQuery: "Carrefour" },
  { id: "changomas", label: "Changomás", color: "#f7941d", mapsQuery: "Changomas" },
  { id: "coto", label: "Coto", color: "#e4002b", mapsQuery: "Coto supermercado" },
  { id: "dia", label: "Día", color: "#e30613", mapsQuery: "Supermercados Dia" },
  { id: "disco", label: "Disco", color: "#d4213d", mapsQuery: "Disco supermercado" },
  { id: "jumbo", label: "Jumbo", color: "#00843d", mapsQuery: "Jumbo supermercado" },
  { id: "vea", label: "Vea", color: "#1a1a8e", mapsQuery: "Vea supermercado" },
];
const VTEX_TIENDAS = TIENDAS.filter((t) => t.id !== "coto");
const fmt = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ═══════ CATEGORIES ═══════ */
const CATEGORIES = [
  { id: "super", label: "Super", icon: "\uD83D\uDED2", color: "#ea580c" },
  { id: "meli", label: "MeLi", icon: "\uD83D\uDFE1", color: "#3483fa" },
  { id: "transporte", label: "Transporte", icon: "\uD83D\uDE8C", color: "#2563eb" },
  { id: "dolar", label: "Dólar", icon: "\uD83D\uDCB5", color: "#16a34a" },
  { id: "farmacia", label: "Farmacia", icon: "\uD83D\uDC8A", color: "#9333ea" },
  { id: "servicios", label: "Servicios", icon: "\uD83D\uDCCD", color: "#0891b2" },
  { id: "clima", label: "Clima", icon: "\u2600\uFE0F", color: "#f59e0b" },
  { id: "descuentos", label: "Descuentos", icon: "\uD83C\uDF81", color: "#e11d48" },
];

const MELI_CLIENT_ID = "782955723270657";
const MELI_REDIRECT_URI = "https://supermamu.com.ar/callback";

/* ═══════ VTEX PRODUCT PARSER ═══════ */
function parseVtexProduct(producto) {
  try {
    const nombre = producto.productName || null;
    if (!nombre) return null;
    let ean = null;
    try { ean = producto.items?.[0]?.ean || producto.items?.[0]?.referenceId?.[0]?.Value || null; } catch {}
    let precio = null, listPrice = null, hasOffer = false;
    try {
      const offer = producto.items[0].sellers[0].commertialOffer;
      const spotPrice = offer.spotPrice || offer.Installments?.[0]?.Value || null;
      const basePrice = offer.Price || null;
      listPrice = offer.ListPrice || null;
      precio = spotPrice && basePrice ? Math.min(spotPrice, basePrice) : basePrice || spotPrice;
      if (listPrice && precio && Math.abs(listPrice - precio) < 0.01 && basePrice > spotPrice) listPrice = basePrice;
      if (listPrice && precio && listPrice > precio * 2.5) listPrice = null;
      if (listPrice && precio && listPrice <= precio) listPrice = null;
      hasOffer = (listPrice && listPrice > precio) || offer.discountHighlights?.length > 0;
    } catch {}
    let imagen = null;
    try { imagen = producto.items?.[0]?.images?.[0]?.imageUrl?.replace("http:", "https:"); } catch {}
    const marca = producto.brand || null;
    const link = producto.link || null;
    return { nombre, ean, precio, listPrice, hasOffer, imagen, marca, link };
  } catch { return null; }
}

function parseCotoProduct(prod) {
  const precio = prod.precio || null;
  const listPrice = prod.listPrice || null;
  return { nombre: prod.nombre, precio, listPrice, hasOffer: !!(listPrice && listPrice > precio), imagen: prod.imagen, link: prod.link };
}

/* ═══════ STEP 1: Get product OPTIONS ═══════ */
async function fetchProductOptions(query) {
  const storesToSearch = VTEX_TIENDAS.map((t) => t.id);
  const allProducts = [];
  const responses = await Promise.all(
    storesToSearch.map(async (tiendaId) => {
      try {
        const resp = await fetch(PROXY + "?tienda=" + tiendaId + "&q=" + encodeURIComponent(query));
        if (!resp.ok) return [];
        const data = await resp.json();
        if (!data.products?.length) return [];
        return data.products.slice(0, 15).map((p) => parseVtexProduct(p)).filter(Boolean);
      } catch { return []; }
    })
  );
  responses.forEach((prods) => allProducts.push(...prods));
  const seen = new Set();
  const unique = [];
  for (const p of allProducts) {
    const key = p.ean || p.nombre;
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  }
  return unique;
}

/* ═══════ STEP 2: Compare ONE product across ALL stores ═══════ */
async function comparePrices(ean, exactName) {
  const searchQuery = ean || exactName;
  const vtexResults = await Promise.all(
    VTEX_TIENDAS.map(async (t) => {
      const empty = { ...t, nombre: null, precio: null, listPrice: null, link: null, hasOffer: false, imagen: null };
      try {
        const resp = await fetch(PROXY + "?tienda=" + t.id + "&q=" + encodeURIComponent(searchQuery));
        if (!resp.ok) return empty;
        const data = await resp.json();
        if (!data.products?.length) return empty;
        let producto;
        if (ean) {
          producto = data.products.find((p) =>
            p.items?.some((i) => i.ean === ean || (i.referenceId || []).some((r) => r.Value === ean))
          ) || data.products[0];
        } else {
          producto = data.products[0];
        }
        const parsed = parseVtexProduct(producto);
        if (!parsed) return empty;
        return { ...t, ...parsed };
      } catch { return empty; }
    })
  );
  const cotoConfig = TIENDAS.find((t) => t.id === "coto");
  let cotoResult = { ...cotoConfig, nombre: null, precio: null, listPrice: null, link: null, hasOffer: false, imagen: null };
  const cotoSearchName = exactName || vtexResults.find((r) => r.nombre)?.nombre;
  if (cotoSearchName) {
    try {
      const resp = await fetch(PROXY + "?tienda=coto&q=" + encodeURIComponent(cotoSearchName));
      if (resp.ok) {
        const data = await resp.json();
        if (data.products?.length) { cotoResult = { ...cotoConfig, ...parseCotoProduct(data.products[0]) }; }
      }
    } catch {}
  }
  return [...vtexResults, cotoResult].sort((a, b) => a.label.localeCompare(b.label, "es"));
}

/* ═══════ PRODUCT OPTIONS LIST ═══════ */
function ProductOptionsList({ options, onSelect, onBack }) {
  return (
    <div style={{ animation: "slideUp 0.25s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button style={S.btnBack} onClick={onBack}>{"\u2190"} Volver</button>
        <span style={{ fontSize: 14, color: "#78716c" }}>{options.length} producto{options.length !== 1 ? "s" : ""}</span>
      </div>
      <div style={{ fontSize: 13, color: "#57534e", marginBottom: 10 }}>Elegí el producto exacto para comparar precios:</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((opt, i) => (
          <button key={i} style={S.optionCard} onClick={() => onSelect(opt)}>
            {opt.imagen ? <img src={opt.imagen} alt="" style={S.optionImg} onError={(e) => (e.target.style.display = "none")} /> : <div style={S.optionImgPlaceholder}>{"\uD83D\uDCE6"}</div>}
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div style={S.optionName}>{opt.nombre}</div>
              {opt.marca && <div style={S.optionBrand}>{opt.marca}</div>}
              {opt.ean && <div style={S.optionEan}>EAN: {opt.ean}</div>}
            </div>
            {opt.precio && <div style={S.optionPrice}>${fmt(opt.precio)}</div>}
            <div style={{ color: "#a3a3a3", fontSize: 18, flexShrink: 0 }}>{"\u203A"}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════ IMAGE MODAL ═══════ */
function ImageModal({ src, alt, onClose }) {
  if (!src) return null;
  return (
    <div style={S.modalOverlay} onClick={onClose}>
      <div style={S.modalContent} onClick={(e) => e.stopPropagation()}>
        <button style={S.modalClose} onClick={onClose}>{"\u2715"}</button>
        <img src={src} alt={alt || ""} style={S.modalImage} />
      </div>
    </div>
  );
}

/* ═══════ PRICE COMPARISON CARD ═══════ */
function PriceCard({ result, productName, productImage, onAddToCart, onAddToLista, onBack }) {
  const [showImageModal, setShowImageModal] = useState(false);
  const withPrice = result.filter((r) => r.precio);
  const minPrice = withPrice.length ? Math.min(...withPrice.map((r) => r.precio)) : 0;
  const nombre = productName || result.find((r) => r.nombre)?.nombre || "Producto";
  const imagen = productImage || result.find((r) => r.imagen)?.imagen;
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        {imagen ? <img src={imagen} alt="" style={S.cardImg} onClick={() => setShowImageModal(true)} onError={(e) => (e.target.style.display = "none")} /> : <div style={S.cardImgPlaceholder}>{"\uD83D\uDED2"}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.cardName}>{nombre}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {onBack && <button style={{ ...S.btnBack, fontSize: 12 }} onClick={onBack}>{"\u2190"} Elegir otro</button>}
            {onAddToLista && <button style={{ ...S.btnBack, fontSize: 12, color: "#ea580c", borderColor: "#fed7aa" }} onClick={() => onAddToLista(nombre)}>{"\uD83D\uDCDD"} A la lista</button>}
          </div>
        </div>
      </div>
      {showImageModal && <ImageModal src={imagen} alt={nombre} onClose={() => setShowImageModal(false)} />}
      <div>
        {result.map((r, i) => {
          const isBest = r.precio && r.precio === minPrice;
          const hasDisc = r.listPrice && r.listPrice > r.precio;
          const pct = hasDisc ? Math.round((1 - r.precio / r.listPrice) * 100) : 0;
          const mapsUrl = "https://www.google.com/maps/search/" + encodeURIComponent(r.mapsQuery + " cerca de mi ubicación");
          return (
            <div key={i} style={{ ...S.priceRow, background: isBest ? "#f0fdf4" : "transparent" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: isBest ? "#15803d" : r.color }}>{r.label}</span>
                  {isBest && <span style={S.bestTag}>{"\u2713"} Mejor precio</span>}
                  {hasDisc && <span style={S.offerTag}>{"\u2212"}{pct}%</span>}
                </div>
                {r.precio ? <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={S.mapsLink}>{"\uD83D\uDCCD"} Ir al más cercano</a> : null}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ textAlign: "right" }}>
                  {r.precio ? (<>{hasDisc && <div style={S.listPrice}>${fmt(r.listPrice)}</div>}<div style={{ ...S.priceAmount, color: isBest ? "#15803d" : "#171717" }}>${fmt(r.precio)}</div></>) : <span style={{ color: "#a3a3a3", fontSize: 13 }}>No disponible</span>}
                </div>
                {r.precio && (
                  <button style={S.addStoreBtn} onClick={() => {
                    onAddToCart({ nombre, precios: { [r.label]: r.precio }, precioMin: r.precio, tiendaMin: r.label, imagen });
                  }} title={"Agregar de " + r.label}>+</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <a href={"https://listado.mercadolibre.com.ar/" + encodeURIComponent(nombre).replace(/%20/g, "-") + "#D[A:" + encodeURIComponent(nombre) + "]"} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid #f5f5f4", color: "#3483fa", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
        <span style={{ fontSize: 16 }}>{"\uD83D\uDFE1"}</span> Ver en MercadoLibre {"\u203A"}
      </a>
    </div>
  );
}

/* ═══════ CART VIEW ═══════ */
function CartView({ cart, setCart }) {
  if (!cart.length) return <div style={S.emptyState}><div style={{ fontSize: 56, marginBottom: 12 }}>{"\uD83D\uDED2"}</div><div>Tu carrito está vacío</div><div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4 }}>Buscá un producto para empezar</div></div>;
  let totalMin = 0, totalUnits = 0;
  const totalesPorTienda = {};
  cart.forEach((item) => { totalMin += item.precioMin * item.qty; totalUnits += item.qty; Object.entries(item.precios).forEach(([t, p]) => { totalesPorTienda[t] = (totalesPorTienda[t] || 0) + p * item.qty; }); });
  const ranking = Object.entries(totalesPorTienda).sort((a, b) => a[1] - b[1]);
  return (
    <div>
      <div style={S.cartSummary}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#78716c" }}>Total estimado (mejor precio por producto)</div>
        <div style={S.totalAmount}>${fmt(totalMin)}</div>
        <div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 2 }}>{cart.length} productos {"\u00B7"} {totalUnits} unidades</div>
        {ranking.length >= 2 && <div style={S.cheapestInfo}><div>{"\uD83C\uDFC6"} Todo en <strong>{ranking[0][0]}</strong>: ${fmt(ranking[0][1])}</div><div style={{ fontSize: 11, color: "#78716c", marginTop: 4 }}>{ranking.map(([t, v]) => t + " $" + fmt(v)).join(" \u00B7 ")}</div></div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {cart.map((item, i) => (
          <div key={i} style={S.cartItem}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.cartItemName}>{item.nombre}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                {Object.entries(item.precios).map(([t, p]) => <span key={t} style={{ ...S.cartChip, ...(t === item.tiendaMin ? S.cartChipBest : {}) }}>{t} ${fmt(p)}</span>)}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button style={S.qtyBtn} onClick={() => setCart(cart.map((c, j) => j === i ? { ...c, qty: c.qty - 1 } : c).filter((c) => c.qty > 0))}>{"\u2212"}</button>
              <span style={{ fontWeight: 700, minWidth: 20, textAlign: "center" }}>{item.qty}</span>
              <button style={S.qtyBtn} onClick={() => setCart(cart.map((c, j) => j === i ? { ...c, qty: c.qty + 1 } : c))}>+</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════ AI MENU ═══════ */
function MenuIA({ setTab, onSearchProduct, menuStep, setMenuStep, menuResult, setMenuResult, onAddToLista, onAddAllToLista }) {
  const [personas, setPersonas] = useState("4");
  const [restricciones, setRestricciones] = useState("");
  const [presupuesto, setPresupuesto] = useState("moderado");
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("menu"); // "menu" or "recetas"
  const [recetaQuery, setRecetaQuery] = useState("");
  const [recetaResult, setRecetaResult] = useState(null);
  const [recetaLoading, setRecetaLoading] = useState(false);

  const generateReceta = async (q) => {
    const trimmed = (q || recetaQuery || "").trim();
    if (!trimmed) return;
    setRecetaLoading(true); setError(null); setRecetaResult(null);
    try {
      const prompt = "Sos un chef argentino experto en cocina casera. Generá una receta completa para: " + trimmed + ".\n\nReglas:\n- Receta práctica, con ingredientes que se consiguen en cualquier supermercado argentino\n- Cantidades para 4 personas\n- Pasos claros y numerados\n- Ingredientes con cantidades exactas\n- Nombres de productos argentinos cuando sea posible\n\nRespondé ÚNICAMENTE con JSON válido:\n{\"nombre\":\"nombre del plato\",\"porciones\":4,\"tiempo\":\"tiempo de preparación\",\"dificultad\":\"Fácil|Media|Difícil\",\"ingredientes\":[\"ingrediente con cantidad\"],\"pasos\":[\"paso 1\",\"paso 2\"],\"tip\":\"un consejo útil\"}";
      const resp = await fetch(AI_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "arcee-ai/trinity-large-preview:free", messages: [{ role: "system", content: "Respondés ÚNICAMENTE con JSON válido. Sin texto, sin markdown, solo JSON." }, { role: "user", content: prompt }], max_tokens: 2048, temperature: 0.7 }),
      });
      if (!resp.ok) throw new Error("Error " + resp.status);
      const rawText = await resp.text();
      let data; try { data = JSON.parse(rawText); } catch { throw new Error("Respuesta inválida."); }
      let content = data.choices?.[0]?.message?.content || "";
      if (!content?.trim()) throw new Error("Sin contenido.");
      content = content.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      const js = content.indexOf("{"), je = content.lastIndexOf("}");
      if (js === -1 || je === -1) throw new Error("JSON inválido.");
      content = content.slice(js, je + 1);
      let parsed; try { parsed = JSON.parse(content); } catch { try { parsed = JSON.parse(content.replace(/,\s*([}\]])/g, "$1")); } catch { throw new Error("JSON incompleto."); } }
      if (!parsed.nombre || !parsed.ingredientes) throw new Error("Receta inválida.");
      setRecetaResult(parsed);
    } catch (e) { setError(e.message); }
    setRecetaLoading(false);
  };

  const generateMenu = async () => {
    setMenuStep("loading"); setError(null);
    try {
      const prompt = "Sos un nutricionista argentino experto en cocina familiar y en hacer compras inteligentes. Generá un menú semanal (lunes a domingo) para " + personas + " personas.\n" + (restricciones ? "Restricciones alimentarias: " + restricciones : "Sin restricciones alimentarias especiales.") + "\nPresupuesto: " + presupuesto + ".\n\nIMPORTANTE SOBRE LOS INGREDIENTES:\n- La lista debe contener ÚNICAMENTE productos reales que se compran en un supermercado.\n- NUNCA repitas un producto. Si un ingrediente se usa en varios platos, listalo UNA SOLA VEZ con la cantidad total.\n- Usá nombres comerciales argentinos cuando sea posible.\n- Incluí cantidades aproximadas para " + personas + " personas durante una semana.\n\nRespondé ÚNICAMENTE con JSON válido, sin texto adicional:\n{\"menu\":[{\"dia\":\"Lunes\",\"almuerzo\":\"nombre del plato\",\"cena\":\"nombre del plato\"}],\"ingredientes\":[\"producto con cantidad\"],\"tips\":\"consejo breve\"}";
      const resp = await fetch(AI_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "arcee-ai/trinity-large-preview:free", messages: [{ role: "system", content: "Respondés ÚNICAMENTE con JSON válido. Sin texto, sin markdown, solo JSON." }, { role: "user", content: prompt }], max_tokens: 4096, temperature: 0.7 }),
      });
      if (!resp.ok) throw new Error("Error " + resp.status);
      const rawText = await resp.text();
      if (!rawText?.trim()) throw new Error("Respuesta vacía. Intentá de nuevo.");
      let data; try { data = JSON.parse(rawText); } catch { throw new Error("Respuesta inválida."); }
      let content = data.choices?.[0]?.message?.content || "";
      if (!content?.trim()) throw new Error("Sin contenido. Intentá de nuevo.");
      content = content.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      const js = content.indexOf("{"), je = content.lastIndexOf("}");
      if (js === -1 || je === -1) throw new Error("JSON inválido.");
      content = content.slice(js, je + 1);
      let parsed; try { parsed = JSON.parse(content); } catch { try { parsed = JSON.parse(content.replace(/,\s*([}\]])/g, "$1")); } catch { throw new Error("JSON incompleto."); } }
      if (!parsed.menu) throw new Error("Menú inválido.");
      if (!parsed.ingredientes) {
        parsed.ingredientes = [...(parsed.supermercado || []), ...(parsed.verduleria || []), ...(parsed.carniceria || [])];
      }
      if (parsed.ingredientes) {
        const seen = new Set();
        parsed.ingredientes = parsed.ingredientes.filter((ing) => { const k = ing.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
      }
      setMenuResult(parsed); setMenuStep("result");
      try { localStorage.setItem("supermamu_menu", JSON.stringify(parsed)); } catch {}
    } catch (e) { setError(e.message); setMenuStep("config"); }
  };

  const handleIngredientClick = (ing) => {
    const searchTerm = ing.split("(")[0].replace(/\d+\s*(kg|g|l|ml|unidad|un|lt|cc)\b/gi, "").trim();
    onSearchProduct(searchTerm);
  };

  if (menuStep === "loading") return <div style={S.emptyState}><div style={S.spinner} /><div style={{ marginTop: 16, fontWeight: 600 }}>Generando tu menú semanal...</div></div>;

  if (menuStep === "result" && menuResult) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif" }}>{"\uD83C\uDF7D\uFE0F"} Tu Menú Semanal</h3>
          <button style={S.btnSmall} onClick={() => { setMenuStep("config"); setMenuResult(null); try { localStorage.removeItem("supermamu_menu"); } catch {} }}>{"\u2728"} Nuevo</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {menuResult.menu?.map((day, i) => <div key={i} style={S.menuDay}><div style={S.menuDayLabel}>{day.dia}</div><div style={{ flex: 1 }}><div style={{ fontSize: 13 }}>{"\uD83C\uDF24\uFE0F"} {day.almuerzo}</div><div style={{ fontSize: 13, marginTop: 2 }}>{"\uD83C\uDF19"} {day.cena}</div></div></div>)}
        </div>
        {menuResult.tips && <div style={S.tipBox}>{"\uD83D\uDCA1"} <strong>Tip:</strong> {menuResult.tips}</div>}
        <h3 style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", marginBottom: 4, marginTop: 20 }}>{"\uD83D\uDECD\uFE0F"} Lista de Compras</h3>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#78716c" }}>Tocá un producto para buscarlo</div>
          {onAddAllToLista && menuResult.ingredientes?.length > 0 && (
            <button style={{ ...S.btnSmall, color: "#ea580c", fontWeight: 600, fontSize: 12 }} onClick={() => onAddAllToLista(menuResult.ingredientes)}>{"\uD83D\uDCDD"} Agregar todo a la lista</button>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {menuResult.ingredientes?.map((ing, i) => (
            <div key={i} style={{ display: "flex", gap: 4 }}>
              <button style={{ ...S.ingredientBtn, flex: 1 }} onClick={() => handleIngredientClick(ing)}>
                <span style={{ flex: 1, textAlign: "left" }}>{ing}</span>
                <span style={{ color: "#ea580c", fontSize: 13, flexShrink: 0 }}>{"\uD83D\uDD0D"}</span>
              </button>
              {onAddToLista && (
                <button style={{ ...S.addStoreBtn, borderColor: "#ea580c", width: 36, height: "auto" }} onClick={() => onAddToLista(ing)} title="Agregar a la lista">{"\uD83D\uDCDD"}</button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={{ ...S.chipBtn, flex: 1, ...(mode === "menu" ? S.chipBtnActive : {}) }} onClick={() => setMode("menu")}>{"\uD83E\uDD16"} Menú Semanal</button>
        <button style={{ ...S.chipBtn, flex: 1, ...(mode === "recetas" ? S.chipBtnActive : {}) }} onClick={() => setMode("recetas")}>{"\uD83C\uDF7D\uFE0F"} Recetas</button>
      </div>

      {mode === "menu" && (
        <div>
          <div style={S.aiHero}><div style={{ fontSize: 48, marginBottom: 8 }}>{"\uD83E\uDD16"}</div><h3 style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", marginBottom: 4 }}>Menú Semanal con IA</h3><p style={{ fontSize: 13, color: "#78716c", maxWidth: 280, margin: "0 auto" }}>Generá un menú personalizado y buscá los mejores precios</p></div>
          {error && mode === "menu" && <div style={S.errorBox}>{error}</div>}
          <div style={S.formGroup}><label style={S.formLabel}>{"\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66"} ¿Para cuántas personas?</label><div style={{ display: "flex", gap: 8 }}>{["1","2","3","4","5","6"].map((n) => <button key={n} style={{ ...S.chipBtn, ...(personas === n ? S.chipBtnActive : {}) }} onClick={() => setPersonas(n)}>{n}</button>)}</div></div>
          <div style={S.formGroup}><label style={S.formLabel}>{"\uD83D\uDCB0"} Presupuesto</label><div style={{ display: "flex", gap: 8 }}>{[["económico","Económico"],["moderado","Moderado"],["sin límite","Sin límite"]].map(([v,l]) => <button key={v} style={{ ...S.chipBtn, flex: 1, ...(presupuesto === v ? S.chipBtnActive : {}) }} onClick={() => setPresupuesto(v)}>{l}</button>)}</div></div>
          <div style={S.formGroup}><label style={S.formLabel}>{"\uD83E\uDD57"} Restricciones (opcional)</label><input style={S.input} value={restricciones} onChange={(e) => setRestricciones(e.target.value)} placeholder="Ej: sin gluten, vegetariano..." /></div>
          <button style={{ ...S.btnPrimary, width: "100%", padding: "16px 24px", fontSize: 16, marginTop: 8 }} onClick={generateMenu}>{"\u2728"} Generar mi menú semanal</button>
        </div>
      )}

      {mode === "recetas" && (
        <div>
          {!recetaResult && !recetaLoading && (
            <div>
              <div style={S.aiHero}><div style={{ fontSize: 48, marginBottom: 8 }}>{"\uD83C\uDF7D\uFE0F"}</div><h3 style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", marginBottom: 4 }}>Recetas con IA</h3><p style={{ fontSize: 13, color: "#78716c", maxWidth: 280, margin: "0 auto" }}>Buscá una receta y agregá los ingredientes a tu lista</p></div>
              {error && mode === "recetas" && <div style={S.errorBox}>{error}</div>}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <input style={{ ...S.searchInput, paddingRight: 36, width: "100%" }} value={recetaQuery} onChange={(e) => setRecetaQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generateReceta()} placeholder='Ej: "milanesas napolitanas"' />
                  {recetaQuery && <button style={S.clearBtn} onClick={() => setRecetaQuery("")} type="button">{"\u2715"}</button>}
                </div>
                <button style={S.searchBtn} onClick={() => generateReceta()}>{"\uD83C\uDF7D\uFE0F"}</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                {["milanesas napolitanas","empanadas de carne","ñoquis con tuco","tarta de zapallitos","pollo al horno","fideos con salsa blanca","guiso de lentejas","pizza casera","tortilla de papa","ensalada César"].map((r) => (
                  <button key={r} style={S.suggestionChip} onClick={() => { setRecetaQuery(r); generateReceta(r); }}>{r}</button>
                ))}
              </div>
            </div>
          )}

          {recetaLoading && (
            <div style={S.emptyState}><div style={S.spinner} /><div style={{ marginTop: 16, fontWeight: 600 }}>Cocinando tu receta...</div><div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4 }}>La IA está preparando los ingredientes y pasos</div></div>
          )}

          {recetaResult && (
            <div style={{ animation: "slideUp 0.25s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>{"\uD83C\uDF7D\uFE0F"} {recetaResult.nombre}</h3>
                <button style={S.btnSmall} onClick={() => { setRecetaResult(null); setError(null); }}>{"\u2190"} Otra</button>
              </div>

              {/* Meta info */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {recetaResult.porciones && <span style={{ ...S.cartChip, padding: "4px 10px" }}>{"\uD83D\uDC65"} {recetaResult.porciones} porciones</span>}
                {recetaResult.tiempo && <span style={{ ...S.cartChip, padding: "4px 10px" }}>{"\u23F1\uFE0F"} {recetaResult.tiempo}</span>}
                {recetaResult.dificultad && <span style={{ ...S.cartChip, padding: "4px 10px" }}>{recetaResult.dificultad === "Fácil" ? "\uD83D\uDFE2" : recetaResult.dificultad === "Media" ? "\uD83D\uDFE1" : "\uD83D\uDD34"} {recetaResult.dificultad}</span>}
              </div>

              {/* Ingredients */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>{"\uD83E\uDD66"} Ingredientes</h4>
                  {onAddAllToLista && recetaResult.ingredientes?.length > 0 && (
                    <button style={{ ...S.btnSmall, color: "#ea580c", fontWeight: 600, fontSize: 12 }} onClick={() => onAddAllToLista(recetaResult.ingredientes)}>{"\uD83D\uDCDD"} Agregar todo</button>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {recetaResult.ingredientes?.map((ing, i) => (
                    <div key={i} style={{ display: "flex", gap: 4 }}>
                      <button style={{ ...S.ingredientBtn, flex: 1 }} onClick={() => { const s = ing.split("(")[0].replace(/\d+\s*(kg|g|l|ml|unidad|un|lt|cc)\b/gi, "").trim(); onSearchProduct(s); }}>
                        <span style={{ flex: 1, textAlign: "left" }}>{ing}</span>
                        <span style={{ color: "#ea580c", fontSize: 13, flexShrink: 0 }}>{"\uD83D\uDD0D"}</span>
                      </button>
                      {onAddToLista && (
                        <button style={{ ...S.addStoreBtn, borderColor: "#ea580c", width: 36, height: "auto" }} onClick={() => onAddToLista(ing)}>{"\uD83D\uDCDD"}</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Steps */}
              {recetaResult.pasos && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", marginBottom: 8 }}>{"\uD83D\uDC68\u200D\uD83C\uDF73"} Preparación</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {recetaResult.pasos.map((paso, i) => (
                      <div key={i} style={{ ...S.card, padding: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#ea580c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0, fontFamily: "'Fredoka', sans-serif" }}>{i + 1}</span>
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: "#57534e" }}>{paso}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {recetaResult.tip && <div style={S.tipBox}>{"\uD83D\uDCA1"} <strong>Tip:</strong> {recetaResult.tip}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════ LISTA DE COMPRAS VIEW ═══════ */
const LISTA_PRESETS = [
  { id: "cumple", icon: "\uD83C\uDF82", label: "Cumpleaños", prompt: "lista de compras para un cumpleaños en casa para 15-20 personas, incluyendo bebidas, snacks, decoración y descartables" },
  { id: "picada", icon: "\uD83E\uDDC0", label: "Picada", prompt: "lista de compras para armar una picada completa para 6-8 personas, con fiambres, quesos, pan, aceitunas, frutos secos y acompañamientos" },
  { id: "asado", icon: "\uD83E\uDD69", label: "Asado", prompt: "lista de compras para un asado completo para 10 personas, incluyendo carnes, carbón, chimichurri, ensaladas, pan y bebidas" },
  { id: "limpieza", icon: "\uD83E\uDDF9", label: "Limpieza", prompt: "lista completa de productos de limpieza para el hogar: cocina, baño, pisos, ropa, vidrios y desinfección" },
  { id: "baño", icon: "\uD83D\uDEC1", label: "Baño", prompt: "lista de productos de higiene y baño para una familia: shampoo, jabón, pasta dental, papel higiénico, toallas y accesorios" },
  { id: "utiles", icon: "\u270F\uFE0F", label: "Útiles escolares", prompt: "lista de útiles escolares completa para un estudiante de primaria/secundaria en Argentina" },
  { id: "bebe", icon: "\uD83D\uDC76", label: "Bebé", prompt: "lista de productos esenciales para un bebé: pañales, toallitas, cremas, leche, mamaderas y artículos de higiene" },
  { id: "mudanza", icon: "\uD83D\uDCE6", label: "Mudanza", prompt: "lista de cosas que necesitás comprar para una mudanza y primera instalación en un departamento nuevo" },
];

function ListaView({ listas, setListas, activeListaId, setActiveListaId, lista, setLista, onSearchProduct }) {
  const [newItem, setNewItem] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [aiError, setAiError] = useState(null);
  const [showListManager, setShowListManager] = useState(false);
  const [editingName, setEditingName] = useState(null);
  const [editNameValue, setEditNameValue] = useState("");

  const activeLista = listas.find((l) => l.id === activeListaId);

  const createNewList = (name) => {
    const newId = "list_" + Date.now();
    const newName = name || "Lista " + (listas.length + 1);
    setListas((prev) => [...prev, { id: newId, name: newName, items: [] }]);
    setActiveListaId(newId);
    setShowListManager(false);
  };

  const deleteList = (id) => {
    if (listas.length <= 1) return;
    setListas((prev) => prev.filter((l) => l.id !== id));
    if (activeListaId === id) setActiveListaId(listas.find((l) => l.id !== id)?.id || "default");
  };

  const renameList = (id, newName) => {
    if (!newName.trim()) return;
    setListas((prev) => prev.map((l) => l.id === id ? { ...l, name: newName.trim() } : l));
    setEditingName(null);
  };

  const toggleCheck = (id) => {
    setLista((prev) => prev.map((item) => item.id === id ? { ...item, checked: !item.checked } : item));
  };

  const removeItem = (id) => {
    setLista((prev) => prev.filter((item) => item.id !== id));
  };

  const addManualItem = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    if (lista.some((l) => l.text.toLowerCase() === trimmed.toLowerCase())) return;
    setLista((prev) => [...prev, { id: Date.now() + Math.random(), text: trimmed, checked: false }]);
    setNewItem("");
  };

  const clearChecked = () => {
    setLista((prev) => prev.filter((item) => !item.checked));
  };

  const shareWhatsApp = () => {
    const listName = activeLista?.name || "Lista";
    const pending = lista.filter((l) => !l.checked);
    const done = lista.filter((l) => l.checked);
    let text = "\uD83D\uDCDD *" + listName + "* (SuperMamu)\n\n";
    if (pending.length) { text += pending.map((l) => "\u2B1C " + l.text).join("\n") + "\n"; }
    if (done.length) { text += "\n" + done.map((l) => "\u2705 ~" + l.text + "~").join("\n") + "\n"; }
    text += "\n\uD83D\uDED2 supermamu.com.ar";
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
  };

  const handleSearchItem = (text) => {
    const searchTerm = text.split("(")[0].replace(/\d+\s*(kg|g|l|ml|unidad|un|lt|cc|pares?|packs?|rollos?|cajas?|sobres?|metros?|cm|mm|u\.?)\b/gi, "").replace(/x\s*\d+/gi, "").trim();
    if (searchTerm && onSearchProduct) onSearchProduct(searchTerm);
  };

  const generateAIList = async (promptText) => {
    setAiLoading(true); setAiError(null); setShowPresets(false);
    try {
      const resp = await fetch(AI_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "arcee-ai/trinity-large-preview:free",
          messages: [
            { role: "system", content: "Sos un asistente de compras argentino. Respondés ÚNICAMENTE con JSON válido. Sin texto, sin markdown, sin backticks, solo JSON." },
            { role: "user", content: "Generá una " + promptText + ".\n\nReglas:\n- Productos REALES que se compran en supermercado/comercio argentino\n- Nombres comerciales argentinos cuando sea posible (ej: \"Lavandina Ayudín 1L\")\n- Incluí cantidades aproximadas\n- NO repitas productos\n- Entre 10 y 25 productos\n\nRespondé ÚNICAMENTE con JSON:\n{\"titulo\":\"nombre de la lista\",\"items\":[\"producto 1 con cantidad\",\"producto 2 con cantidad\"]}" }
          ],
          max_tokens: 2048,
          temperature: 0.7,
        }),
      });
      if (!resp.ok) throw new Error("Error " + resp.status);
      const rawText = await resp.text();
      if (!rawText?.trim()) throw new Error("Respuesta vacía.");
      let data; try { data = JSON.parse(rawText); } catch { throw new Error("Respuesta inválida."); }
      let content = data.choices?.[0]?.message?.content || "";
      if (!content?.trim()) throw new Error("Sin contenido.");
      content = content.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      const js = content.indexOf("{"), je = content.lastIndexOf("}");
      if (js === -1 || je === -1) throw new Error("JSON inválido.");
      content = content.slice(js, je + 1);
      let parsed;
      try { parsed = JSON.parse(content); } catch { try { parsed = JSON.parse(content.replace(/,\s*([}\]])/g, "$1")); } catch { throw new Error("JSON incompleto."); } }
      const items = parsed.items || parsed.productos || parsed.ingredientes || [];
      if (!items.length) throw new Error("Lista vacía.");
      // Add items avoiding duplicates
      const existing = new Set(lista.map((l) => l.text.toLowerCase()));
      const newItems = [];
      for (const item of items) {
        const t = item.trim();
        if (t && !existing.has(t.toLowerCase())) {
          newItems.push({ id: Date.now() + Math.random() + newItems.length, text: t, checked: false });
          existing.add(t.toLowerCase());
        }
      }
      if (newItems.length > 0) {
        setLista((prev) => [...prev, ...newItems]);
      }
    } catch (e) {
      setAiError(e.message || "Error generando la lista");
    }
    setAiLoading(false);
  };

  const checkedCount = lista.filter((l) => l.checked).length;
  const uncheckedCount = lista.length - checkedCount;

  // ── List selector bar (shown in all states) ──
  const listSelector = (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, alignItems: "center" }}>
        {listas.map((l) => (
          <button key={l.id} style={{
            ...S.chipBtn, whiteSpace: "nowrap", fontSize: 13, padding: "7px 14px",
            ...(l.id === activeListaId ? S.chipBtnActive : {}),
          }} onClick={() => setActiveListaId(l.id)}>
            {l.name}
            {l.items.filter((i) => !i.checked).length > 0 && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({l.items.filter((i) => !i.checked).length})</span>}
          </button>
        ))}
        <button style={{ ...S.chipBtn, padding: "7px 12px", fontSize: 16, color: "#ea580c", flexShrink: 0 }} onClick={() => setShowListManager(true)} title="Gestionar listas">+</button>
      </div>
    </div>
  );

  // ── List manager panel ──
  if (showListManager) {
    return (
      <div style={{ animation: "slideUp 0.25s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button style={S.btnBack} onClick={() => setShowListManager(false)}>{"\u2190"} Volver</button>
          <h3 style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>{"\uD83D\uDCCB"} Mis Listas</h3>
        </div>

        <button style={{ ...S.btnPrimary, width: "100%", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }} onClick={() => createNewList()}>
          + Nueva Lista
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {listas.map((l) => (
            <div key={l.id} style={{ ...S.card, padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
              {editingName === l.id ? (
                <div style={{ flex: 1, display: "flex", gap: 6 }}>
                  <input style={{ ...S.searchInput, padding: "8px 12px", fontSize: 14 }} value={editNameValue} onChange={(e) => setEditNameValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && renameList(l.id, editNameValue)} autoFocus />
                  <button style={{ ...S.btnSmall, color: "#15803d", fontSize: 12 }} onClick={() => renameList(l.id, editNameValue)}>{"\u2713"}</button>
                  <button style={{ ...S.btnSmall, fontSize: 12 }} onClick={() => setEditingName(null)}>{"\u2715"}</button>
                </div>
              ) : (
                <>
                  <div style={{ flex: 1, cursor: "pointer" }} onClick={() => { setActiveListaId(l.id); setShowListManager(false); }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: "#78716c" }}>
                      {l.items.length} producto{l.items.length !== 1 ? "s" : ""}
                      {l.items.filter((i) => i.checked).length > 0 && ` · ${l.items.filter((i) => i.checked).length} listo${l.items.filter((i) => i.checked).length !== 1 ? "s" : ""}`}
                    </div>
                  </div>
                  <button style={{ ...S.btnSmall, fontSize: 11, padding: "5px 10px" }} onClick={() => { setEditingName(l.id); setEditNameValue(l.name); }}>{"\u270F\uFE0F"}</button>
                  {listas.length > 1 && (
                    <button style={{ ...S.btnSmall, fontSize: 11, padding: "5px 10px", color: "#dc2626" }} onClick={() => deleteList(l.id)}>{"\uD83D\uDDD1\uFE0F"}</button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── AI Loading state ──
  if (aiLoading) {
    return (
      <div>
        {listSelector}
        <div style={S.emptyState}>
          <div style={S.spinner} />
          <div style={{ marginTop: 16, fontWeight: 600 }}>Generando lista con IA...</div>
          <div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4 }}>Esto puede tardar unos segundos</div>
        </div>
      </div>
    );
  }

  // ── Presets panel ──
  if (showPresets) {
    return (
      <div style={{ animation: "slideUp 0.25s ease" }}>
        {listSelector}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button style={S.btnBack} onClick={() => setShowPresets(false)}>{"\u2190"} Volver</button>
          <h3 style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>{"\u2728"} Generar lista con IA</h3>
        </div>

        {aiError && <div style={S.errorBox}>{aiError}</div>}

        <div style={{ fontSize: 13, color: "#57534e", marginBottom: 12 }}>Elegí un tipo de lista o escribí tu propia:</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {LISTA_PRESETS.map((preset) => (
            <button key={preset.id} style={S.presetBtn} onClick={() => generateAIList(preset.prompt)}>
              <span style={{ fontSize: 24 }}>{preset.icon}</span>
              <span style={{ flex: 1, textAlign: "left", fontWeight: 600, fontSize: 14 }}>{preset.label}</span>
              <span style={{ color: "#ea580c", fontSize: 14 }}>{"\u2728"}</span>
            </button>
          ))}
        </div>

        <div style={{ borderTop: "1px solid #e7e5e4", paddingTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, fontFamily: "'Fredoka', sans-serif" }}>{"\uD83D\uDCAC"} O describí tu lista</div>
          <input
            style={S.input}
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && customPrompt.trim() && generateAIList("lista de compras para: " + customPrompt.trim())}
            placeholder='Ej: "merienda para 30 chicos", "camping 3 días"...'
          />
          <button
            style={{ ...S.btnPrimary, width: "100%", marginTop: 10, opacity: customPrompt.trim() ? 1 : 0.5 }}
            onClick={() => customPrompt.trim() && generateAIList("lista de compras para: " + customPrompt.trim())}
            disabled={!customPrompt.trim()}
          >{"\u2728"} Generar lista personalizada</button>
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (!lista.length) {
    return (
      <div>
        {listSelector}
        <div style={S.emptyState}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>{"\uD83D\uDCDD"}</div>
          <div style={{ fontWeight: 600 }}>Tu lista está vacía</div>
          <div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4, maxWidth: 280, margin: "4px auto 0", lineHeight: 1.5 }}>
            Agregá productos manualmente, desde la búsqueda, o generá una lista con IA
          </div>
        </div>

        <button style={{ ...S.btnPrimary, width: "100%", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }} onClick={() => setShowPresets(true)}>
          <span>{"\u2728"}</span> Generar lista con IA
        </button>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={S.searchInput}
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addManualItem()}
            placeholder="O agregá un producto..."
          />
          <button style={S.searchBtn} onClick={addManualItem}>+</button>
        </div>
      </div>
    );
  }

  // ── Main list view ──
  return (
    <div>
      {listSelector}
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>{"\uD83D\uDCDD"} {activeLista?.name || "Lista"}</h3>
          <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>
            {uncheckedCount} pendiente{uncheckedCount !== 1 ? "s" : ""}
            {checkedCount > 0 && ` \u00B7 ${checkedCount} listo${checkedCount !== 1 ? "s" : ""}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={{ ...S.btnSmall, fontSize: 12 }} onClick={() => setShowPresets(true)}>{"\u2728"} IA</button>
          {lista.length > 0 && <button style={{ ...S.btnSmall, fontSize: 12, color: "#25d366" }} onClick={shareWhatsApp}>{"\uD83D\uDCE4"}</button>}
          {checkedCount > 0 && (
            <button style={{ ...S.btnSmall, color: "#dc2626", fontSize: 12 }} onClick={clearChecked}>
              {"\uD83D\uDDD1\uFE0F"} ({checkedCount})
            </button>
          )}
        </div>
      </div>

      {aiError && <div style={S.errorBox}>{aiError}</div>}

      {/* Add item */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          style={S.searchInput}
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManualItem()}
          placeholder="Agregar producto..."
        />
        <button style={S.searchBtn} onClick={addManualItem}>+</button>
      </div>

      {/* Unchecked items */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {lista.filter((l) => !l.checked).map((item) => (
          <div key={item.id} style={S.listaItem}>
            <button style={S.listaCheck} onClick={() => toggleCheck(item.id)}>
              <span style={{ width: 22, height: 22, borderRadius: 6, border: "2px solid #d6d3d1", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }} />
            </button>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{item.text}</span>
            <button style={S.listaSearchBtn} onClick={() => handleSearchItem(item.text)} title="Buscar en supermercados">{"\uD83D\uDD0D"}</button>
            <button style={S.listaRemove} onClick={() => removeItem(item.id)}>{"\u2715"}</button>
          </div>
        ))}
      </div>

      {/* Checked items */}
      {checkedCount > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: "#a3a3a3", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            {"\u2705"} Ya agarrados
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {lista.filter((l) => l.checked).map((item) => (
              <div key={item.id} style={{ ...S.listaItem, opacity: 0.6, background: "#f5f5f4" }}>
                <button style={S.listaCheck} onClick={() => toggleCheck(item.id)}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, border: "2px solid #15803d", display: "flex", alignItems: "center", justifyContent: "center", background: "#dcfce7", color: "#15803d", fontSize: 14, fontWeight: 700 }}>{"\u2713"}</span>
                </button>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500, textDecoration: "line-through", color: "#a3a3a3" }}>{item.text}</span>
                <button style={S.listaRemove} onClick={() => removeItem(item.id)}>{"\u2715"}</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TRANSPORTE SECTION
   ═══════════════════════════════════════════════════ */

const NAFTA_EMPRESAS = {
  YPF: { color: "#0033a1", icon: "\u26FD" },
  Shell: { color: "#fbce07", textColor: "#d4210d", icon: "\u26FD" },
  Axion: { color: "#00529b", icon: "\u26FD" },
  Puma: { color: "#c8102e", icon: "\u26FD" },
};

/* ═══════ NAFTA VIEW ═══════ */
function NaftaView() {
  const [precios, setPrecios] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("todos");

  useEffect(() => {
    fetchNafta();
  }, []);

  const fetchNafta = async () => {
    setLoading(true); setError(null);
    try {
      const resp = await fetch(TRANSPORTE_PROXY + "?tipo=nafta");
      if (!resp.ok) throw new Error("Error " + resp.status);
      const data = await resp.json();
      setPrecios(data);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  if (loading) return <div style={S.emptyState}><div style={S.spinnerBlue} /><div style={{ marginTop: 16 }}>Consultando precios de nafta...</div></div>;
  if (error) return <div style={S.emptyState}><div style={{ fontSize: 48, marginBottom: 12 }}>{"\u26FD"}</div><div style={S.errorBox}>{error}</div><button style={S.btnBlue} onClick={fetchNafta}>Reintentar</button></div>;

  const lista = precios?.precios || [];
  const empresas = [...new Set(lista.map((p) => p.empresa))];
  const filtered = filtro === "todos" ? lista : lista.filter((p) => p.empresa === filtro);

  // Group by empresa
  const grouped = {};
  filtered.forEach((p) => {
    if (!grouped[p.empresa]) grouped[p.empresa] = [];
    grouped[p.empresa].push(p);
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{"\u26FD"}</span>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>Precios de Nafta</h3>
          <div style={{ fontSize: 12, color: "#78716c" }}>{precios?.nota || "CABA — Referencia"}</div>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <button style={{ ...S.chipBtn, ...(filtro === "todos" ? S.chipBtnBlueActive : {}) }} onClick={() => setFiltro("todos")}>Todas</button>
        {empresas.map((e) => (
          <button key={e} style={{ ...S.chipBtn, ...(filtro === e ? S.chipBtnBlueActive : {}) }} onClick={() => setFiltro(e)}>{e}</button>
        ))}
      </div>

      {Object.entries(grouped).map(([empresa, prods]) => {
        const cfg = NAFTA_EMPRESAS[empresa] || { color: "#374151", icon: "\u26FD" };
        return (
          <div key={empresa} style={{ ...S.card, marginBottom: 12 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f5f5f4", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: cfg.color, display: "flex", alignItems: "center", justifyContent: "center", color: cfg.textColor || "#fff", fontWeight: 700, fontSize: 14 }}>{empresa.slice(0, 2)}</div>
              <span style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 16 }}>{empresa}</span>
            </div>
            {prods.map((p, i) => {
              const isSuper = /s[uú]per/i.test(p.producto);
              return (
                <div key={i} style={{ ...S.priceRow, borderBottom: i < prods.length - 1 ? "1px solid #f5f5f4" : "none" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{p.producto}</div>
                  </div>
                  <div style={{ ...S.priceAmount, color: isSuper ? "#2563eb" : "#171717", fontSize: 17 }}>
                    ${fmt(p.precio)}
                    <span style={{ fontSize: 11, color: "#a3a3a3", fontWeight: 400 }}>/L</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {precios?.actualizacion && (
        <div style={{ textAlign: "center", fontSize: 11, color: "#a3a3a3", marginTop: 8 }}>
          Última actualización: {precios.actualizacion} · Fuente: {precios.source}
        </div>
      )}
    </div>
  );
}

/* ═══════ ESTADO SERVICIO VIEW ═══════ */
function EstadoServicioView() {
  const [alertas, setAlertas] = useState({ subte: null, trenes: null, colectivos: null });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("subte");

  useEffect(() => {
    fetchAlertas();
  }, []);

  const fetchAlertas = async () => {
    setLoading(true);
    const results = { subte: null, trenes: null, colectivos: null };
    try {
      const [subteResp, trenesResp, colectivosResp] = await Promise.all([
        fetch(TRANSPORTE_PROXY + "?tipo=subte-alertas").then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(TRANSPORTE_PROXY + "?tipo=trenes-alertas").then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(TRANSPORTE_PROXY + "?tipo=colectivos-alertas").then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      results.subte = subteResp;
      results.trenes = trenesResp;
      results.colectivos = colectivosResp;
    } catch {}
    setAlertas(results);
    setLoading(false);
  };

  const SUBTE_LINES = [
    { id: "A", color: "#18cccc" }, { id: "B", color: "#eb0909" },
    { id: "C", color: "#233aa8" }, { id: "D", color: "#007a53" },
    { id: "E", color: "#6d217d" }, { id: "H", color: "#ffdd00", textColor: "#333" },
  ];

  const parseAlerts = (data) => {
    if (!data) return [];
    // GTFS-RT ServiceAlerts format
    const entity = data?.entity || data?.header?.entity || [];
    if (Array.isArray(entity)) {
      return entity.map((e) => {
        const alert = e.alert || e;
        return {
          id: e.id,
          header: alert.header_text?.translation?.[0]?.text || alert.headerText || "",
          description: alert.description_text?.translation?.[0]?.text || alert.descriptionText || "",
          route: alert.informed_entity?.[0]?.route_id || alert.informedEntity?.[0]?.routeId || "",
          effect: alert.effect || "UNKNOWN",
        };
      }).filter((a) => a.header || a.description);
    }
    // If it's a different format, try to extract what we can
    if (typeof data === "object") {
      return Object.entries(data).filter(([k]) => k !== "header").map(([k, v]) => ({
        id: k, header: typeof v === "string" ? v : JSON.stringify(v), description: "", route: k, effect: "UNKNOWN"
      }));
    }
    return [];
  };

  if (loading) return <div style={S.emptyState}><div style={S.spinnerBlue} /><div style={{ marginTop: 16 }}>Consultando estado del servicio...</div></div>;

  const subteAlerts = parseAlerts(alertas.subte);
  const trenAlerts = parseAlerts(alertas.trenes);
  const coleAlerts = parseAlerts(alertas.colectivos);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{"\uD83D\uDE87"}</span>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>Estado del Servicio</h3>
          <div style={{ fontSize: 12, color: "#78716c" }}>Tiempo real — CABA</div>
        </div>
        <button style={{ ...S.btnSmall, marginLeft: "auto" }} onClick={fetchAlertas}>{"\uD83D\uDD04"}</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[["subte", "\uD83D\uDE87 Subte"], ["trenes", "\uD83D\uDE86 Trenes"], ["colectivos", "\uD83D\uDE8C Colectivos"]].map(([id, label]) => (
          <button key={id} style={{ ...S.chipBtn, flex: 1, fontSize: 13, padding: "8px 10px", ...(activeTab === id ? S.chipBtnBlueActive : {}) }} onClick={() => setActiveTab(id)}>{label}</button>
        ))}
      </div>

      {activeTab === "subte" && (
        <div>
          {/* Subte line status indicators */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, justifyContent: "center" }}>
            {SUBTE_LINES.map((line) => {
              const hasAlert = subteAlerts.some((a) => a.route?.toUpperCase().includes(line.id) || a.header?.toUpperCase().includes("LÍNEA " + line.id));
              return (
                <div key={line.id} style={{
                  width: 44, height: 44, borderRadius: 12, background: line.color, color: line.textColor || "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18,
                  fontFamily: "'Fredoka', sans-serif", position: "relative",
                  border: hasAlert ? "3px solid #dc2626" : "3px solid transparent",
                  boxShadow: hasAlert ? "0 0 8px rgba(220,38,38,0.4)" : "0 2px 6px rgba(0,0,0,0.1)",
                }}>
                  {line.id}
                  {hasAlert && <span style={{ position: "absolute", top: -4, right: -4, width: 12, height: 12, borderRadius: "50%", background: "#dc2626", border: "2px solid #fff" }} />}
                </div>
              );
            })}
          </div>

          {subteAlerts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {subteAlerts.map((a, i) => (
                <div key={i} style={{ ...S.card, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{a.effect === "NO_SERVICE" ? "\u26D4" : a.effect === "REDUCED_SERVICE" ? "\u26A0\uFE0F" : "\u2139\uFE0F"}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{a.header}</div>
                      {a.description && <div style={{ fontSize: 13, color: "#57534e", lineHeight: 1.5 }}>{a.description}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ ...S.card, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{"\u2705"}</div>
              <div style={{ fontWeight: 600, color: "#15803d" }}>Todas las líneas funcionando con normalidad</div>
              <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>Sin alertas de servicio activas</div>
            </div>
          )}
        </div>
      )}

      {activeTab === "trenes" && (
        <div>
          {trenAlerts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {trenAlerts.map((a, i) => (
                <div key={i} style={{ ...S.card, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{a.effect === "NO_SERVICE" ? "\u26D4" : "\u26A0\uFE0F"}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{a.header}</div>
                      {a.description && <div style={{ fontSize: 13, color: "#57534e", lineHeight: 1.5 }}>{a.description}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ ...S.card, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{"\u2705"}</div>
              <div style={{ fontWeight: 600, color: "#15803d" }}>Sin alertas de servicio activas</div>
            </div>
          )}
        </div>
      )}

      {activeTab === "colectivos" && (
        <div>
          {coleAlerts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {coleAlerts.map((a, i) => (
                <div key={i} style={{ ...S.card, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{a.effect === "NO_SERVICE" ? "\u26D4" : a.effect === "REDUCED_SERVICE" ? "\u26A0\uFE0F" : "\u2139\uFE0F"}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{a.header}</div>
                      {a.route && <div style={{ fontSize: 12, color: "#2563eb", marginBottom: 4 }}>Línea {a.route}</div>}
                      {a.description && <div style={{ fontSize: 13, color: "#57534e", lineHeight: 1.5 }}>{a.description}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ ...S.card, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{"\u2705"}</div>
              <div style={{ fontWeight: 600, color: "#15803d" }}>Sin alertas de colectivos activas</div>
              <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>Todas las líneas funcionando con normalidad</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════ TARIFAS VIEW ═══════ */
function TarifasView() {
  const [tarifas, setTarifas] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(TRANSPORTE_PROXY + "?tipo=tarifas")
      .then((r) => r.json())
      .then(setTarifas)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={S.emptyState}><div style={S.spinnerBlue} /></div>;

  const t = tarifas?.tarifas;
  if (!t) return <div style={S.emptyState}>No se pudieron cargar las tarifas</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{"\uD83D\uDCB3"}</span>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>Tarifas de Transporte</h3>
          <div style={{ fontSize: 12, color: "#78716c" }}>AMBA — Vigentes desde {tarifas?.actualizacion}</div>
        </div>
      </div>

      {/* Subte */}
      <div style={{ ...S.card, marginBottom: 12, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 24 }}>{"\uD83D\uDE87"}</span>
          <span style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 16 }}>{t.subte.nombre}</span>
          <span style={{ marginLeft: "auto", fontFamily: "'Fredoka', sans-serif", fontWeight: 800, fontSize: 22, color: "#2563eb" }}>${fmt(t.subte.precio)}</span>
        </div>
        <div style={{ fontSize: 12, color: "#78716c" }}>{t.subte.nota}</div>
      </div>

      {/* Colectivo */}
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f5f5f4", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>{"\uD83D\uDE8C"}</span>
          <span style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 16 }}>{t.colectivo_caba.nombre}</span>
        </div>
        {t.colectivo_caba.tramos.map((tr, i) => (
          <div key={i} style={{ ...S.priceRow, borderBottom: i < t.colectivo_caba.tramos.length - 1 ? "1px solid #f5f5f4" : "none" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{tr.distancia}</div>
              {tr.tarifa_social && <div style={{ fontSize: 11, color: "#15803d" }}>Tarifa social: ${fmt(tr.tarifa_social)}</div>}
            </div>
            <div style={{ ...S.priceAmount, fontSize: 16 }}>${fmt(tr.precio)}</div>
          </div>
        ))}
        <div style={{ padding: "8px 16px", fontSize: 11, color: "#78716c" }}>{t.colectivo_caba.nota}</div>
      </div>

      {/* Tren */}
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f5f5f4", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>{"\uD83D\uDE86"}</span>
          <span style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 16 }}>{t.tren.nombre}</span>
        </div>
        {t.tren.tramos.map((tr, i) => (
          <div key={i} style={{ ...S.priceRow, borderBottom: i < t.tren.tramos.length - 1 ? "1px solid #f5f5f4" : "none" }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 500 }}>{tr.distancia}</div></div>
            <div style={{ ...S.priceAmount, fontSize: 16 }}>${fmt(tr.precio)}</div>
          </div>
        ))}
        <div style={{ padding: "8px 16px", fontSize: 11, color: "#78716c" }}>{t.tren.nota}</div>
      </div>

      {/* Saldo negativo */}
      <div style={{ ...S.tipBox, background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" }}>
        {"\u2139\uFE0F"} <strong>Saldo negativo SUBE:</strong> Hasta ${Math.abs(t.saldo_negativo.monto)} — {t.saldo_negativo.nota}
      </div>
    </div>
  );
}

/* ═══════ SUBE VIEW ═══════ */
function SUBEView() {
  return (
    <div>
      <div style={S.aiHero}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>{"\uD83D\uDCB3"}</div>
        <h3 style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", marginBottom: 4 }}>Tu SUBE</h3>
        <p style={{ fontSize: 13, color: "#78716c", maxWidth: 280, margin: "0 auto" }}>Consultá tu saldo y gestioná tu tarjeta</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <a href="https://tarjetasube.sube.gob.ar/" target="_blank" rel="noopener noreferrer" style={S.subeLink}>
          <span style={{ fontSize: 24 }}>{"\uD83C\uDF10"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Mi SUBE (web)</div>
            <div style={{ fontSize: 12, color: "#78716c" }}>Consultá saldo, movimientos y beneficios</div>
          </div>
          <span style={{ color: "#2563eb" }}>{"\u203A"}</span>
        </a>

        <a href="https://wa.me/5491166777823?text=Hola" target="_blank" rel="noopener noreferrer" style={S.subeLink}>
          <span style={{ fontSize: 24 }}>{"\uD83D\uDCAC"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>WhatsApp "Subi"</div>
            <div style={{ fontSize: 12, color: "#78716c" }}>Chatbot oficial para consultar saldo</div>
          </div>
          <span style={{ color: "#2563eb" }}>{"\u203A"}</span>
        </a>

        <a href="tel:08007777823" style={S.subeLink}>
          <span style={{ fontSize: 24 }}>{"\uD83D\uDCDE"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>0800-777-SUBE (7823)</div>
            <div style={{ fontSize: 12, color: "#78716c" }}>Llamá para consultar saldo por teléfono</div>
          </div>
          <span style={{ color: "#2563eb" }}>{"\u203A"}</span>
        </a>

        <a href="https://play.google.com/store/apps/details?id=com.sube.app" target="_blank" rel="noopener noreferrer" style={S.subeLink}>
          <span style={{ fontSize: 24 }}>{"\uD83D\uDCF1"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>App SUBE</div>
            <div style={{ fontSize: 12, color: "#78716c" }}>Cargá saldo y consultá con NFC</div>
          </div>
          <span style={{ color: "#2563eb" }}>{"\u203A"}</span>
        </a>
      </div>

      <div style={{ ...S.tipBox, background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8", marginTop: 16 }}>
        {"\uD83D\uDCA1"} <strong>Tip:</strong> Con la SUBE virtual podés pagar directo desde el celular (Android con NFC). Activala desde la app SUBE.
      </div>
    </div>
  );
}

/* ═══════ TRANSPORTE MAIN ═══════ */
function TransporteView() {
  const [subTab, setSubTab] = useState("nafta");

  return (
    <div>
      {/* Sub-navigation for Transporte */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
        {[
          ["nafta", "\u26FD", "Nafta"],
          ["estado", "\uD83D\uDE87", "Estado"],
          ["tarifas", "\uD83D\uDCB3", "Tarifas"],
          ["sube", "\uD83D\uDCB3", "SUBE"],
        ].map(([id, icon, label]) => (
          <button key={id} style={{
            ...S.chipBtn,
            whiteSpace: "nowrap",
            ...(subTab === id ? S.chipBtnBlueActive : {}),
          }} onClick={() => setSubTab(id)}>
            {icon} {label}
          </button>
        ))}
      </div>

      {subTab === "nafta" && <NaftaView />}
      {subTab === "estado" && <EstadoServicioView />}
      {subTab === "tarifas" && <TarifasView />}
      {subTab === "sube" && <SUBEView />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   DÓLAR SECTION
   ═══════════════════════════════════════════════════ */

const DOLAR_API = "https://dolarapi.com/v1/dolares";
const DOLAR_CASAS = {
  oficial: { nombre: "Oficial", color: "#6b7280", icon: "\uD83C\uDFE6" },
  blue: { nombre: "Blue", color: "#3b82f6", icon: "\uD83D\uDCB5" },
  bolsa: { nombre: "MEP (Bolsa)", color: "#6366f1", icon: "\uD83D\uDCC8" },
  contadoconliqui: { nombre: "CCL", color: "#22c55e", icon: "\uD83D\uDCCA" },
  tarjeta: { nombre: "Tarjeta", color: "#f97316", icon: "\uD83D\uDCB3" },
  cripto: { nombre: "Cripto", color: "#eab308", icon: "\u20BF" },
  mayorista: { nombre: "Mayorista", color: "#ec4899", icon: "\uD83C\uDFED" },
};

function DolarView() {
  const [dolares, setDolares] = useState(null);
  const [loading, setLoading] = useState(true);
  const [conversorAmount, setConversorAmount] = useState("");
  const [conversorDir, setConversorDir] = useState("usd_to_ars"); // or ars_to_usd

  useEffect(() => { fetchDolares(); }, []);

  const fetchDolares = async () => {
    setLoading(true);
    try {
      const resp = await fetch(DOLAR_API);
      if (!resp.ok) throw new Error("Error");
      const data = await resp.json();
      setDolares(data);
    } catch {}
    setLoading(false);
  };

  if (loading) return <div style={S.emptyState}><div style={{ ...S.spinner, borderTopColor: "#16a34a" }} /><div style={{ marginTop: 16 }}>Consultando cotizaciones...</div></div>;
  if (!dolares) return <div style={S.emptyState}><div style={{ fontSize: 48 }}>{"\uD83D\uDCB5"}</div><div>No se pudieron cargar las cotizaciones</div><button style={{ ...S.btnBlue, background: "#16a34a", marginTop: 12 }} onClick={fetchDolares}>Reintentar</button></div>;

  const oficial = dolares.find((d) => d.casa === "oficial");
  const blue = dolares.find((d) => d.casa === "blue");
  const blueRef = blue?.venta || 0;

  // Conversor
  const selectedRate = blue?.venta || oficial?.venta || 1;
  const converted = conversorAmount ? (conversorDir === "usd_to_ars" ? (parseFloat(conversorAmount) * selectedRate) : (parseFloat(conversorAmount) / selectedRate)) : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 28 }}>{"\uD83D\uDCB5"}</span>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>Cotizaciones</h3>
            <div style={{ fontSize: 12, color: "#78716c" }}>Dólar en Argentina</div>
          </div>
        </div>
        <button style={S.btnSmall} onClick={fetchDolares}>{"\uD83D\uDD04"}</button>
      </div>

      {/* Main quotes grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {dolares.filter((d) => ["oficial", "blue", "bolsa", "contadoconliqui", "tarjeta", "cripto"].includes(d.casa)).map((d) => {
          const cfg = DOLAR_CASAS[d.casa] || { nombre: d.nombre, color: "#666", icon: "$" };
          const brecha = d.casa !== "oficial" && oficial ? Math.round(((d.venta - oficial.venta) / oficial.venta) * 100) : null;
          return (
            <div key={d.casa} style={{ ...S.card, padding: 14, borderLeft: "4px solid " + cfg.color }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{cfg.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: cfg.color }}>{cfg.nombre}</span>
                {brecha !== null && brecha > 0 && <span style={{ fontSize: 10, color: "#78716c", marginLeft: "auto" }}>+{brecha}%</span>}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div><div style={{ fontSize: 10, color: "#a3a3a3", textTransform: "uppercase" }}>Compra</div><div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 17, color: "#171717" }}>${d.compra ? fmt(d.compra) : "—"}</div></div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#a3a3a3", textTransform: "uppercase" }}>Venta</div><div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 17, color: cfg.color }}>${fmt(d.venta)}</div></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mayorista */}
      {dolares.find((d) => d.casa === "mayorista") && (
        <div style={{ ...S.card, padding: 12, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span>{"\uD83C\uDFED"}</span><span style={{ fontWeight: 600, fontSize: 13 }}>Mayorista</span></div>
          <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>${fmt(dolares.find((d) => d.casa === "mayorista").venta)}</div>
        </div>
      )}

      {/* Conversor */}
      <div style={{ ...S.card, padding: 16 }}>
        <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{"\uD83D\uDD04"} Conversor (Blue)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <button style={{ ...S.chipBtn, flex: 1, ...(conversorDir === "usd_to_ars" ? { background: "#16a34a", color: "#fff", borderColor: "#16a34a" } : {}) }} onClick={() => setConversorDir("usd_to_ars")}>USD → ARS</button>
          <button style={{ ...S.chipBtn, flex: 1, ...(conversorDir === "ars_to_usd" ? { background: "#16a34a", color: "#fff", borderColor: "#16a34a" } : {}) }} onClick={() => setConversorDir("ars_to_usd")}>ARS → USD</button>
        </div>
        <input style={S.input} type="number" inputMode="decimal" value={conversorAmount} onChange={(e) => setConversorAmount(e.target.value)} placeholder={conversorDir === "usd_to_ars" ? "Monto en USD" : "Monto en ARS"} />
        {converted !== null && !isNaN(converted) && (
          <div style={{ marginTop: 12, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#78716c" }}>{conversorDir === "usd_to_ars" ? "Equivale a" : "Equivale a"}</div>
            <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 800, fontSize: 28, color: "#16a34a" }}>
              {conversorDir === "usd_to_ars" ? "$" + fmt(converted) : "US$ " + fmt(converted)}
            </div>
          </div>
        )}
      </div>

      {dolares[0]?.fechaActualizacion && (
        <div style={{ textAlign: "center", fontSize: 11, color: "#a3a3a3", marginTop: 12 }}>
          Actualizado: {new Date(dolares[0].fechaActualizacion).toLocaleString("es-AR")} · Fuente: dolarapi.com
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   FARMACIA SECTION
   ═══════════════════════════════════════════════════ */

function FarmaciaView() {
  const [subTab, setSubTab] = useState("medicamentos");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const searchMedicamentos = async (q) => {
    const trimmed = (q || "").trim();
    if (!trimmed) return;
    setLoading(true); setError(null); setResults(null);
    try {
      const resp = await fetch(PROXY + "?tienda=medicamentos&q=" + encodeURIComponent(trimmed));
      if (!resp.ok) throw new Error("Error " + resp.status);
      const data = await resp.json();
      setResults({ type: "medicamentos", items: data.productos || [], url: data.url });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const searchFarmacity = async (q) => {
    const trimmed = (q || "").trim();
    if (!trimmed) return;
    setLoading(true); setError(null); setResults(null);
    try {
      const resp = await fetch(PROXY + "?tienda=farmacity&q=" + encodeURIComponent(trimmed));
      if (!resp.ok) throw new Error("Error " + resp.status);
      const data = await resp.json();
      const products = (data.products || []).slice(0, 15).map((p) => {
        try {
          const nombre = p.productName || null;
          if (!nombre) return null;
          let precio = null, listPrice = null;
          try {
            const offer = p.items[0].sellers[0].commertialOffer;
            precio = offer.spotPrice || offer.Price || null;
            listPrice = offer.ListPrice || null;
            if (listPrice && precio && listPrice <= precio) listPrice = null;
          } catch {}
          let imagen = null;
          try { imagen = p.items?.[0]?.images?.[0]?.imageUrl?.replace("http:", "https:"); } catch {}
          return { nombre, precio, listPrice, imagen, marca: p.brand, link: p.link ? "https://www.farmacity.com" + p.link : null };
        } catch { return null; }
      }).filter(Boolean);
      setResults({ type: "farmacity", items: products });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const doSearch = () => {
    if (subTab === "medicamentos") searchMedicamentos(query);
    else searchFarmacity(query);
  };

  const handleTabChange = (t) => {
    setSubTab(t);
    setResults(null);
    setError(null);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{"\uD83D\uDC8A"}</span>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>Farmacia</h3>
          <div style={{ fontSize: 12, color: "#78716c" }}>Medicamentos y productos de farmacia</div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[["medicamentos", "\uD83D\uDC8A", "Medicamentos"], ["productos", "\uD83D\uDED2", "Productos"]].map(([id, icon, label]) => (
          <button key={id} style={{ ...S.chipBtn, flex: 1, ...(subTab === id ? { background: "#9333ea", color: "#fff", borderColor: "#9333ea" } : {}) }} onClick={() => handleTabChange(id)}>
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input style={{ ...S.searchInput, paddingRight: 36, width: "100%" }} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} placeholder={subTab === "medicamentos" ? 'Ej: "ibuprofeno", "omeprazol"' : 'Ej: "protector solar", "shampoo"'} />
          {query && <button style={S.clearBtn} onClick={() => { setQuery(""); setResults(null); setError(null); }} type="button">{"\u2715"}</button>}
        </div>
        <button style={{ ...S.searchBtn, background: "#9333ea" }} onClick={doSearch} disabled={loading}>{loading ? "..." : "\uD83D\uDD0D"}</button>
      </div>

      {/* Quick searches */}
      {!loading && !results && (
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20, justifyContent: "center" }}>
            {(subTab === "medicamentos"
              ? ["ibuprofeno", "paracetamol", "amoxicilina", "omeprazol", "loratadina", "diclofenac"]
              : ["protector solar", "shampoo", "pasta dental", "pañales", "vitamina C", "alcohol en gel"]
            ).map((s) => (
              <button key={s} style={S.suggestionChip} onClick={() => { setQuery(s); subTab === "medicamentos" ? searchMedicamentos(s) : searchFarmacity(s); }}>{s}</button>
            ))}
          </div>

          {/* Links */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <a href="https://www.argentina.gob.ar/precios-de-medicamentos" target="_blank" rel="noopener noreferrer" style={{ ...S.subeLink, borderColor: "#e9d5ff" }}>
              <span style={{ fontSize: 24 }}>{"\uD83C\uDFDB\uFE0F"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Buscador Nacional de Medicamentos</div>
                <div style={{ fontSize: 12, color: "#78716c" }}>Precios oficiales + descuentos PAMI</div>
              </div>
              <span style={{ color: "#9333ea" }}>{"\u203A"}</span>
            </a>
            <a href="https://www.google.com/maps/search/farmacia+cerca+de+mi+ubicaci%C3%B3n" target="_blank" rel="noopener noreferrer" style={{ ...S.subeLink, borderColor: "#e9d5ff" }}>
              <span style={{ fontSize: 24 }}>{"\uD83D\uDCCD"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Farmacias cercanas</div>
                <div style={{ fontSize: 12, color: "#78716c" }}>Buscar en Google Maps</div>
              </div>
              <span style={{ color: "#9333ea" }}>{"\u203A"}</span>
            </a>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && <div style={S.emptyState}><div style={{ ...S.spinner, borderTopColor: "#9333ea" }} /><div style={{ marginTop: 16 }}>{subTab === "medicamentos" ? "Buscando medicamentos..." : "Buscando en Farmacity..."}</div></div>}

      {/* Error */}
      {error && <div style={S.errorBox}>{error}</div>}

      {/* Medicamentos results */}
      {results?.type === "medicamentos" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: "#78716c" }}>{results.items.length} resultado{results.items.length !== 1 ? "s" : ""}</span>
            {results.url && <a href={results.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#9333ea", textDecoration: "none", fontWeight: 600 }}>Ver en sitio original {"\u203A"}</a>}
          </div>
          {results.items.length === 0 && <div style={S.emptyState}><div style={{ fontSize: 48 }}>{"\uD83D\uDE45"}</div><div>No se encontraron medicamentos</div></div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.items.map((med, i) => (
              <div key={i} style={{ ...S.card, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 14, color: "#171717" }}>{med.nombre}</div>
                    {med.presentacion && <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>{med.presentacion}</div>}
                    {med.laboratorio && <div style={{ fontSize: 11, color: "#a3a3a3", marginTop: 1 }}>{med.laboratorio}</div>}
                    {med.droga && <div style={{ fontSize: 11, color: "#9333ea", marginTop: 2 }}>Droga: {med.droga}</div>}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {med.precioFarmacia && (
                      <div>
                        <div style={{ fontSize: 10, color: "#78716c", textTransform: "uppercase" }}>Farmacia</div>
                        <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 17, color: "#171717" }}>${fmt(med.precioFarmacia)}</div>
                      </div>
                    )}
                    {med.precioPami && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: "#15803d", textTransform: "uppercase" }}>PAMI</div>
                        <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 15, color: "#15803d" }}>${fmt(med.precioPami)}</div>
                      </div>
                    )}
                  </div>
                </div>
                {med.link && <a href={med.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#9333ea", textDecoration: "none", display: "inline-block", marginTop: 6 }}>Ver detalle {"\u203A"}</a>}
              </div>
            ))}
          </div>
          <div style={{ ...S.tipBox, background: "#f5f3ff", borderColor: "#ddd6fe", color: "#7c3aed", marginTop: 16 }}>
            {"\uD83C\uDFDB\uFE0F"} Verificá precios en el <a href="https://www.argentina.gob.ar/precios-de-medicamentos" target="_blank" rel="noopener noreferrer" style={{ color: "#7c3aed", fontWeight: 700 }}>Buscador Nacional de Medicamentos</a> para datos oficiales.
          </div>
        </div>
      )}

      {/* Farmacity results */}
      {results?.type === "farmacity" && (
        <div>
          <div style={{ fontSize: 13, color: "#78716c", marginBottom: 10 }}>{results.items.length} resultado{results.items.length !== 1 ? "s" : ""} en Farmacity</div>
          {results.items.length === 0 && <div style={S.emptyState}><div style={{ fontSize: 48 }}>{"\uD83D\uDE45"}</div><div>No se encontraron productos</div></div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.items.map((p, i) => (
              <a key={i} href={p.link || "#"} target="_blank" rel="noopener noreferrer" style={{ ...S.optionCard, textDecoration: "none", color: "#171717" }}>
                {p.imagen ? <img src={p.imagen} alt="" style={S.optionImg} onError={(e) => (e.target.style.display = "none")} /> : <div style={S.optionImgPlaceholder}>{"\uD83D\uDC8A"}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.optionName}>{p.nombre}</div>
                  {p.marca && <div style={S.optionBrand}>{p.marca}</div>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {p.listPrice && p.listPrice > p.precio && <div style={S.listPrice}>${fmt(p.listPrice)}</div>}
                  {p.precio && <div style={{ ...S.optionPrice, color: "#9333ea" }}>${fmt(p.precio)}</div>}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MERCADOLIBRE SECTION
   ═══════════════════════════════════════════════════ */

function MercadoLibreView() {
  const [subTab, setSubTab] = useState("compras");
  const [meliToken, setMeliToken] = useState(null);
  const [meliUser, setMeliUser] = useState(null);
  const [purchases, setPurchases] = useState(null);
  const [shipments, setShipments] = useState(null);
  const [loadingData, setLoadingData] = useState(false);

  const logout = () => {
    setMeliToken(null); setMeliUser(null); setPurchases(null); setShipments(null);
    localStorage.removeItem("supermamu_meli");
    setSubTab("cuenta");
  };

  // Load saved token
  useEffect(() => {
    try {
      const saved = localStorage.getItem("supermamu_meli");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.access_token) {
          setMeliToken(parsed);
          fetchMeliUser(parsed.access_token, parsed);
        }
      }
    } catch {}
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code && !meliToken) {
      exchangeToken(code);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const exchangeToken = async (code) => {
    setLoadingData(true);
    try {
      const resp = await fetch(PROXY + "?tienda=meli-token&code=" + encodeURIComponent(code));
      const data = await resp.json();
      if (data.access_token) {
        const tokenData = { ...data, saved_at: Date.now() };
        setMeliToken(tokenData);
        localStorage.setItem("supermamu_meli", JSON.stringify(tokenData));
        fetchMeliUser(data.access_token, tokenData);
      }
    } catch {}
    setLoadingData(false);
  };

  const refreshTokenFlow = async (currentToken) => {
    const rt = currentToken?.refresh_token || meliToken?.refresh_token;
    if (!rt) { logout(); return null; }
    try {
      const resp = await fetch(PROXY + "?tienda=meli-refresh&refresh_token=" + encodeURIComponent(rt));
      const data = await resp.json();
      if (data.access_token) {
        const tokenData = { ...data, saved_at: Date.now() };
        setMeliToken(tokenData);
        localStorage.setItem("supermamu_meli", JSON.stringify(tokenData));
        return tokenData;
      }
    } catch {}
    logout();
    return null;
  };

  const getValidToken = async () => {
    if (!meliToken) return null;
    const elapsed = (Date.now() - (meliToken.saved_at || 0)) / 1000;
    if (elapsed > (meliToken.expires_in || 21600) - 300) {
      const refreshed = await refreshTokenFlow(meliToken);
      return refreshed?.access_token || null;
    }
    return meliToken.access_token;
  };

  const meliApi = async (path, token) => {
    let resp = await fetch(PROXY + "?tienda=meli-api&path=" + encodeURIComponent(path) + (token ? "&access_token=" + encodeURIComponent(token) : ""));
    const data = await resp.json();
    // If unauthorized, try refreshing
    if (resp.status === 401 || data?.status === 401 || data?.message === "unauthorized") {
      const refreshed = await refreshTokenFlow(meliToken);
      if (!refreshed) return null;
      resp = await fetch(PROXY + "?tienda=meli-api&path=" + encodeURIComponent(path) + "&access_token=" + encodeURIComponent(refreshed.access_token));
      if (!resp.ok) return null;
      return await resp.json();
    }
    if (!resp.ok) return null;
    return data;
  };

  const fetchMeliUser = async (token, tokenObj) => {
    try {
      const data = await meliApi("/users/me", token);
      if (data && data.id) {
        setMeliUser(data);
        // Update user_id in token if missing
        if (tokenObj && !tokenObj.user_id) {
          const updated = { ...tokenObj, user_id: data.id };
          setMeliToken(updated);
          localStorage.setItem("supermamu_meli", JSON.stringify(updated));
        }
      } else {
        // Token invalid
        logout();
      }
    } catch { logout(); }
  };

  const fetchPurchases = async () => {
    setLoadingData(true);
    const token = await getValidToken();
    if (!token) { setLoadingData(false); return; }
    try {
      const userId = meliToken.user_id || meliUser?.id;
      const data = await meliApi("/orders/search?buyer=" + userId + "&sort=date_desc&limit=15", token);
      if (data && data.results) {
        setPurchases(data.results);
        // Extract shipment IDs for tracking
        const shipIds = data.results.filter((o) => o.shipping?.id).map((o) => ({ shipId: o.shipping.id, item: o.order_items?.[0]?.item?.title || "Producto", date: o.date_created }));
        if (shipIds.length > 0) fetchShipments(shipIds, token);
      }
    } catch {}
    setLoadingData(false);
  };

  const fetchShipments = async (shipIds, token) => {
    const results = [];
    for (const s of shipIds.slice(0, 10)) {
      try {
        const data = await meliApi("/shipments/" + s.shipId, token);
        if (data && data.id) {
          results.push({
            id: data.id,
            item: s.item,
            status: data.status,
            substatus: data.substatus || "",
            trackingNumber: data.tracking_number || null,
            trackingMethod: data.tracking_method || null,
            dateCreated: s.date,
            receiverCity: data.receiver_address?.city?.name || "",
            estimatedDelivery: data.estimated_delivery_time?.date || null,
          });
        }
      } catch {}
    }
    setShipments(results);
  };

  const statusLabel = (status) => {
    const map = { pending: "Pendiente", handling: "Preparando", ready_to_ship: "Listo para enviar", shipped: "En camino", delivered: "Entregado", not_delivered: "No entregado", cancelled: "Cancelado" };
    return map[status] || status;
  };
  const statusColor = (status) => {
    if (status === "delivered") return "#16a34a";
    if (status === "shipped" || status === "ready_to_ship") return "#2563eb";
    if (status === "cancelled" || status === "not_delivered") return "#dc2626";
    return "#78716c";
  };

  const loginUrl = "https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=" + MELI_CLIENT_ID + "&redirect_uri=" + encodeURIComponent(MELI_REDIRECT_URI);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{"\uD83D\uDFE1"}</span>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>MercadoLibre</h3>
          <div style={{ fontSize: 12, color: "#78716c" }}>{meliUser ? "Hola, " + meliUser.first_name : "Vinculá tu cuenta"}</div>
        </div>
      </div>

      {!meliToken && !loadingData && (
        <div>
          <div style={S.emptyState}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>{"\uD83D\uDFE1"}</div>
            <div style={{ fontWeight: 600 }}>Vinculá tu cuenta de MercadoLibre</div>
            <div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4, maxWidth: 280, margin: "4px auto 0", lineHeight: 1.5 }}>
              Accedé a tus compras recientes y seguí tus envíos desde SuperMamu
            </div>
          </div>
          <a href={loginUrl} style={{ ...S.btnPrimary, background: "#3483fa", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none", textAlign: "center", padding: "16px 24px", fontSize: 16 }}>
            {"\uD83D\uDFE1"} Vincular MercadoLibre
          </a>
        </div>
      )}

      {loadingData && !meliToken && (
        <div style={S.emptyState}><div style={{ ...S.spinner, borderTopColor: "#3483fa" }} /><div style={{ marginTop: 16 }}>Conectando con MercadoLibre...</div></div>
      )}

      {meliToken && (
        <div>
          {/* Sub-tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
            {[["compras", "\uD83D\uDED2", "Compras"], ["envios", "\uD83D\uDCE6", "Envíos"], ["cuenta", "\uD83D\uDC64", "Cuenta"]].map(([id, icon, label]) => (
              <button key={id} style={{ ...S.chipBtn, whiteSpace: "nowrap", fontSize: 13, padding: "7px 14px", flex: 1, ...(subTab === id ? { background: "#3483fa", color: "#fff", borderColor: "#3483fa" } : {}) }} onClick={() => {
                setSubTab(id);
                if (id === "compras" && !purchases) fetchPurchases();
                if (id === "envios" && !shipments) fetchPurchases();
              }}>{icon} {label}</button>
            ))}
          </div>

          {/* ── COMPRAS ── */}
          {subTab === "compras" && (
            <div>
              {!purchases && !loadingData && <div style={{ textAlign: "center" }}><button style={{ ...S.btnPrimary, background: "#3483fa" }} onClick={fetchPurchases}>Cargar compras</button></div>}
              {loadingData && <div style={S.emptyState}><div style={{ ...S.spinner, borderTopColor: "#3483fa" }} /><div style={{ marginTop: 16 }}>Cargando compras...</div></div>}
              {purchases && purchases.length === 0 && <div style={S.emptyState}><div style={{ fontSize: 48 }}>{"\uD83D\uDED2"}</div><div>No se encontraron compras recientes</div></div>}
              {purchases && purchases.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {purchases.map((order, i) => {
                    const item = order.order_items?.[0]?.item;
                    return (
                      <a key={i} href={item?.permalink || "#"} target="_blank" rel="noopener noreferrer" style={{ ...S.card, padding: 14, textDecoration: "none", color: "#171717", display: "block" }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{item?.title || "Compra"}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                          <span style={{ fontSize: 12, color: "#78716c" }}>{new Date(order.date_created).toLocaleDateString("es-AR")}</span>
                          <span style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: "#3483fa" }}>${fmt(order.total_amount || 0)}</span>
                        </div>
                        {order.shipping?.id && (
                          <div style={{ fontSize: 11, color: statusColor(order.shipping?.status || ""), marginTop: 4 }}>
                            {"\uD83D\uDCE6"} {statusLabel(order.shipping?.status || "pending")}
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── ENVÍOS ── */}
          {subTab === "envios" && (
            <div>
              {!shipments && !loadingData && <div style={{ textAlign: "center" }}><button style={{ ...S.btnPrimary, background: "#3483fa" }} onClick={fetchPurchases}>Cargar envíos</button></div>}
              {loadingData && <div style={S.emptyState}><div style={{ ...S.spinner, borderTopColor: "#3483fa" }} /><div style={{ marginTop: 16 }}>Cargando envíos...</div></div>}
              {shipments && shipments.length === 0 && <div style={S.emptyState}><div style={{ fontSize: 48 }}>{"\uD83D\uDCE6"}</div><div>No hay envíos recientes</div></div>}
              {shipments && shipments.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {shipments.map((s, i) => (
                    <div key={i} style={{ ...S.card, padding: 14, borderLeft: "4px solid " + statusColor(s.status) }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{s.item}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: statusColor(s.status) }}>
                          {statusLabel(s.status)}
                        </span>
                        <span style={{ fontSize: 12, color: "#78716c" }}>{new Date(s.dateCreated).toLocaleDateString("es-AR")}</span>
                      </div>
                      {s.receiverCity && <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>{"\uD83D\uDCCD"} {s.receiverCity}</div>}
                      {s.estimatedDelivery && <div style={{ fontSize: 12, color: "#2563eb", marginTop: 2 }}>{"\uD83D\uDCC5"} Estimado: {new Date(s.estimatedDelivery).toLocaleDateString("es-AR")}</div>}
                      {s.trackingNumber && (
                        <div style={{ fontSize: 11, color: "#a3a3a3", marginTop: 4 }}>
                          Tracking: {s.trackingNumber} {s.trackingMethod ? "(" + s.trackingMethod + ")" : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CUENTA ── */}
          {subTab === "cuenta" && (
            <div>
              {meliUser && (
                <div style={{ ...S.card, padding: 20, textAlign: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>{"\uD83D\uDC64"}</div>
                  <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 18 }}>{meliUser.first_name} {meliUser.last_name}</div>
                  <div style={{ fontSize: 13, color: "#78716c", marginTop: 4 }}>{meliUser.nickname}</div>
                  {meliUser.email && <div style={{ fontSize: 12, color: "#a3a3a3", marginTop: 2 }}>{meliUser.email}</div>}
                </div>
              )}
              {!meliUser && (
                <div style={{ ...S.card, padding: 20, textAlign: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>{"\uD83D\uDFE1"}</div>
                  <div style={{ fontSize: 13, color: "#78716c" }}>Sesión activa</div>
                </div>
              )}
              <button style={{ width: "100%", padding: 14, borderRadius: 12, border: "1.5px solid #fecaca", background: "#fff1f2", color: "#dc2626", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14 }} onClick={logout}>
                Desvincular cuenta
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SERVICIOS CERCANOS
   ═══════════════════════════════════════════════════ */

const SERVICIOS_LISTA = [
  { icon: "\uD83D\uDD27", label: "Ferreterías", query: "ferretería" },
  { icon: "\uD83D\uDC3E", label: "Veterinarias", query: "veterinaria" },
  { icon: "\uD83D\uDD10", label: "Cerrajerías", query: "cerrajería" },
  { icon: "\uD83D\uDEBF", label: "Plomerías", query: "plomero" },
  { icon: "\u26A1", label: "Electricistas", query: "electricista" },
  { icon: "\uD83E\uDDF9", label: "Limpieza", query: "servicio de limpieza" },
  { icon: "\uD83D\uDE97", label: "Mecánicos", query: "mecánico automotor" },
  { icon: "\uD83D\uDC55", label: "Tintorerías", query: "tintorería lavandería" },
  { icon: "\uD83C\uDFE5", label: "Hospitales", query: "hospital" },
  { icon: "\uD83D\uDC8A", label: "Farmacias", query: "farmacia" },
  { icon: "\uD83C\uDFEB", label: "Escuelas", query: "escuela colegio" },
  { icon: "\uD83C\uDFAA", label: "Gimnasios", query: "gimnasio" },
  { icon: "\uD83D\uDCEE", label: "Correo", query: "correo argentino OCA" },
  { icon: "\uD83C\uDFE6", label: "Bancos/Cajeros", query: "cajero automático banco" },
  { icon: "\u26FD", label: "Estaciones de servicio", query: "estación de servicio" },
  { icon: "\uD83D\uDED2", label: "Supermercados", query: "supermercado" },
];

function ServiciosCercanosView() {
  const openMaps = (query) => {
    window.open("https://www.google.com/maps/search/" + encodeURIComponent(query + " cerca de mi ubicación"), "_blank");
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{"\uD83D\uDCCD"}</span>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>Servicios Cercanos</h3>
          <div style={{ fontSize: 12, color: "#78716c" }}>Encontrá lo que necesitás cerca tuyo</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {SERVICIOS_LISTA.map((s) => (
          <button key={s.label} onClick={() => openMaps(s.query)} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
            background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14,
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13,
            fontWeight: 500, color: "#171717", textAlign: "left",
          }}>
            <span style={{ fontSize: 22 }}>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   CLIMA
   ═══════════════════════════════════════════════════ */

function ClimaView({ userProfile }) {
  const [clima, setClima] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ubicacion, setUbicacion] = useState(null);
  const [recomendacion, setRecomendacion] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState(null);
  const [searchingCity, setSearchingCity] = useState(false);
  const [savedCities, setSavedCities] = useState([]);

  // Load saved cities
  useEffect(() => {
    try { const sc = localStorage.getItem("supermamu_ciudades"); if (sc) setSavedCities(JSON.parse(sc)); } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("supermamu_ciudades", JSON.stringify(savedCities)); } catch {} }, [savedCities]);

  const searchCity = async () => {
    const q = cityQuery.trim();
    if (!q) return;
    setSearchingCity(true); setCityResults(null);
    try {
      const resp = await fetch(TRANSPORTE_PROXY + "?tipo=geo&q=" + encodeURIComponent(q));
      if (resp.ok) { const data = await resp.json(); setCityResults(Array.isArray(data) ? data : []); }
    } catch {}
    setSearchingCity(false);
  };

  const selectCity = (city) => {
    const loc = { lat: city.lat, lon: city.lon, name: city.name + (city.state ? ", " + city.state : "") };
    setUbicacion(loc); setCityResults(null); setCityQuery("");
    fetchClima(city.lat, city.lon);
  };

  const saveCity = (city) => {
    const key = city.lat + "," + city.lon;
    if (savedCities.some((c) => c.lat + "," + c.lon === key)) return;
    setSavedCities((prev) => [...prev, { name: city.name + (city.state ? ", " + city.state : ""), lat: city.lat, lon: city.lon }]);
  };

  const removeCity = (idx) => setSavedCities((prev) => prev.filter((_, i) => i !== idx));

  const loadSavedCity = (city) => {
    setUbicacion({ lat: city.lat, lon: city.lon, name: city.name });
    fetchClima(city.lat, city.lon);
  };

  const fetchClima = async (lat, lon) => {
    setLoading(true); setError(null); setRecomendacion(null);
    try {
      const resp = await fetch(TRANSPORTE_PROXY + "?tipo=clima&lat=" + lat + "&lon=" + lon);
      if (!resp.ok) throw new Error("Error " + resp.status);
      const data = await resp.json();
      setClima(data);
      if (data.current) fetchRecomendacion(data);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const fetchRecomendacion = async (climaData) => {
    setLoadingRec(true);
    try {
      const hijos = userProfile?.hijos?.length ? "Hijos: " + userProfile.hijos.map((h) => h.edad + " años").join(", ") + ". " : "";
      const mascotas = userProfile?.mascotas?.length ? "Mascotas: " + userProfile.mascotas.map((m) => m.tipo).join(", ") + ". " : "";

      const prompt = hijos + mascotas + "Clima en " + (climaData.city || "CABA") + ": " + Math.round(climaData.current.temp) + "°C (ST " + Math.round(climaData.current.feels_like) + "°C), " + climaData.current.description + ", humedad " + climaData.current.humidity + "%, viento " + Math.round(climaData.current.wind) + " km/h." + (climaData.rain_alert ? " Lluvia esperada." : "") + " Recomendá vestimenta para adulto" + (hijos ? ", para los chicos según edad" : "") + (mascotas ? ", cuidado de mascotas" : "") + " y un tip del día. Argentino, con emojis, 80 palabras max. JSON: {\"vestimenta\":\"...\",\"hijos\":\"...o null\",\"mascotas\":\"...o null\",\"consejo\":\"...\"}";

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const resp = await fetch(AI_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "arcee-ai/trinity-large-preview:free", messages: [{ role: "system", content: "JSON válido únicamente. Asistente argentino." }, { role: "user", content: prompt }], max_tokens: 256, temperature: 0.7 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const raw = await resp.text();
        let data; try { data = JSON.parse(raw); } catch { return; }
        let content = data.choices?.[0]?.message?.content || "";
        content = content.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
        const js = content.indexOf("{"), je = content.lastIndexOf("}");
        if (js !== -1 && je !== -1) {
          try { setRecomendacion(JSON.parse(content.slice(js, je + 1))); } catch {}
        }
      }
    } catch {}
    setLoadingRec(false);
  };

  const shareClimaWhatsApp = () => {
    const c = clima?.current;
    if (!c) return;
    let text = "\u2600\uFE0F *Clima en " + (clima.city || "mi zona") + "* (SuperMamu)\n\n";
    text += "\uD83C\uDF21\uFE0F " + Math.round(c.temp) + "°C (ST " + Math.round(c.feels_like) + "°C)\n";
    text += "\uD83D\uDCA7 Humedad: " + c.humidity + "% · \uD83C\uDF2C\uFE0F Viento: " + Math.round(c.wind) + " km/h\n";
    text += "\u2601\uFE0F " + c.description + "\n";
    if (clima.rain_alert) text += "\n\u2614 " + clima.rain_alert + "\n";
    if (recomendacion) {
      text += "\n\uD83D\uDC55 *Vestimenta:* " + recomendacion.vestimenta + "\n";
      if (recomendacion.hijos) text += "\uD83D\uDC76 *Chicos:* " + recomendacion.hijos + "\n";
      if (recomendacion.mascotas) text += "\uD83D\uDC3E *Mascotas:* " + recomendacion.mascotas + "\n";
      text += "\n\uD83D\uDCA1 " + recomendacion.consejo;
    }
    text += "\n\n\uD83D\uDCF1 supermamu.com.ar";
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
  };

  const getLocation = () => {
    if (!navigator.geolocation) { setError("Tu navegador no soporta geolocalización"); return; }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUbicacion({ lat: pos.coords.latitude, lon: pos.coords.longitude }); fetchClima(pos.coords.latitude, pos.coords.longitude); },
      () => { setError("No se pudo obtener tu ubicación. Permití el acceso en tu navegador."); setLoading(false); },
      { timeout: 10000 }
    );
  };

  const weatherIcon = (code) => {
    if (!code) return "\u2601\uFE0F";
    const c = String(code);
    if (c.startsWith("01")) return "\u2600\uFE0F";
    if (c.startsWith("02")) return "\u26C5";
    if (c.startsWith("03") || c.startsWith("04")) return "\u2601\uFE0F";
    if (c.startsWith("09") || c.startsWith("10")) return "\uD83C\uDF27\uFE0F";
    if (c.startsWith("11")) return "\u26C8\uFE0F";
    if (c.startsWith("13")) return "\u2744\uFE0F";
    if (c.startsWith("50")) return "\uD83C\uDF2B\uFE0F";
    return "\u2601\uFE0F";
  };

  if (!ubicacion && !loading && !error) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 28 }}>{"\u2600\uFE0F"}</span>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>Clima</h3>
        </div>

        {/* City search */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input style={{ ...S.searchInput, paddingRight: 36, width: "100%" }} value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchCity()} placeholder='Buscar localidad: ej "Quilmes"' />
            {cityQuery && <button style={S.clearBtn} onClick={() => { setCityQuery(""); setCityResults(null); }}>{"\u2715"}</button>}
          </div>
          <button style={{ ...S.searchBtn, background: "#f59e0b" }} onClick={searchCity} disabled={searchingCity}>{searchingCity ? "..." : "\uD83D\uDD0D"}</button>
        </div>

        {/* City search results */}
        {cityResults && cityResults.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
            {cityResults.map((c, i) => (
              <div key={i} style={{ ...S.card, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 14 }} onClick={() => selectCity(c)}>
                  {"\uD83D\uDCCD"} {c.name}{c.state ? ", " + c.state : ""} <span style={{ fontSize: 11, color: "#a3a3a3" }}>({c.country})</span>
                </button>
                <button style={{ ...S.btnSmall, fontSize: 16, padding: "2px 8px" }} onClick={() => saveCity(c)} title="Guardar">{"\u2606"}</button>
              </div>
            ))}
          </div>
        )}
        {cityResults && cityResults.length === 0 && <div style={{ fontSize: 13, color: "#a3a3a3", marginBottom: 12, textAlign: "center" }}>No se encontraron localidades</div>}

        {/* Saved cities */}
        {savedCities.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#78716c" }}>{"\u2B50"} Mis localidades</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {savedCities.map((c, i) => (
                <div key={i} style={{ ...S.card, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <button style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#171717" }} onClick={() => loadSavedCity(c)}>
                    {"\uD83D\uDCCD"} {c.name}
                  </button>
                  <button style={{ border: "none", background: "transparent", color: "#a3a3a3", cursor: "pointer", fontSize: 14 }} onClick={() => removeCity(i)}>{"\u2715"}</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* GPS button */}
        <button style={{ ...S.btnPrimary, width: "100%", background: "#f59e0b" }} onClick={getLocation}>{"\uD83D\uDCCD"} Usar mi ubicación actual</button>
      </div>
    );
  }

  if (loading) return <div style={S.emptyState}><div style={{ ...S.spinner, borderTopColor: "#f59e0b" }} /><div style={{ marginTop: 16 }}>Consultando el clima...</div></div>;
  if (error) return <div style={S.emptyState}><div style={{ fontSize: 48 }}>{"\u2601\uFE0F"}</div><div style={S.errorBox}>{error}</div><button style={{ ...S.btnPrimary, background: "#f59e0b", marginTop: 8 }} onClick={getLocation}>Reintentar</button></div>;

  if (clima?.error === "NO_API_KEY") {
    return (
      <div style={S.emptyState}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>{"\u2600\uFE0F"}</div>
        <div style={{ fontWeight: 600 }}>Clima - Próximamente</div>
        <div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 8, lineHeight: 1.5 }}>
          Esta función estará disponible pronto.
        </div>
      </div>
    );
  }

  if (!clima?.current) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{"\u2600\uFE0F"}</span>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>Clima</h3>
          <div style={{ fontSize: 12, color: "#78716c" }}>{clima.city || ubicacion?.name || "Tu ubicación"}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button style={{ ...S.btnSmall, fontSize: 12 }} onClick={() => { if (clima.city) saveCity({ name: clima.city, state: "", lat: ubicacion?.lat, lon: ubicacion?.lon }); }} title="Guardar localidad">{"\u2B50"}</button>
          <button style={{ ...S.btnSmall, color: "#25d366", fontSize: 12 }} onClick={shareClimaWhatsApp}>{"\uD83D\uDCE4"}</button>
          <button style={S.btnSmall} onClick={() => fetchClima(ubicacion.lat, ubicacion.lon)}>{"\uD83D\uDD04"}</button>
          <button style={{ ...S.btnSmall, fontSize: 12 }} onClick={() => { setUbicacion(null); setClima(null); setRecomendacion(null); }}>{"\u2190"}</button>
        </div>
      </div>

      {/* Current weather */}
      <div style={{ ...S.card, padding: 20, marginBottom: 12, textAlign: "center" }}>
        <div style={{ fontSize: 56 }}>{weatherIcon(clima.current.icon)}</div>
        <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 800, fontSize: 42, color: "#f59e0b" }}>{Math.round(clima.current.temp)}°</div>
        <div style={{ fontSize: 14, color: "#78716c", textTransform: "capitalize" }}>{clima.current.description}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 12, fontSize: 13, color: "#57534e" }}>
          <span>{"\uD83C\uDF21\uFE0F"} ST {Math.round(clima.current.feels_like)}°</span>
          <span>{"\uD83D\uDCA7"} {clima.current.humidity}%</span>
          <span>{"\uD83C\uDF2C\uFE0F"} {Math.round(clima.current.wind)} km/h</span>
        </div>
      </div>

      {/* AI Recommendations */}
      {loadingRec && (
        <div style={{ ...S.card, padding: 16, marginBottom: 12, textAlign: "center" }}>
          <div style={{ ...S.spinner, borderTopColor: "#f59e0b", width: 24, height: 24, borderWidth: 2 }} />
          <div style={{ fontSize: 12, color: "#78716c", marginTop: 8 }}>La IA analiza el clima...</div>
        </div>
      )}

      {recomendacion && (
        <div style={{ ...S.card, marginBottom: 12, overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", background: "#fef3c7", borderBottom: "1px solid #fde68a", fontWeight: 700, fontSize: 13, color: "#92400e" }}>{"\uD83E\uDD16"} Recomendación del día</div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 20 }}>{"\uD83D\uDC55"}</span>
              <div><div style={{ fontSize: 12, fontWeight: 700, color: "#78716c", marginBottom: 2 }}>Vestimenta</div><div style={{ fontSize: 13, lineHeight: 1.5 }}>{recomendacion.vestimenta}</div></div>
            </div>
            {recomendacion.hijos && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 20 }}>{"\uD83D\uDC76"}</span>
                <div><div style={{ fontSize: 12, fontWeight: 700, color: "#78716c", marginBottom: 2 }}>Los chicos</div><div style={{ fontSize: 13, lineHeight: 1.5 }}>{recomendacion.hijos}</div></div>
              </div>
            )}
            {recomendacion.mascotas && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 20 }}>{"\uD83D\uDC3E"}</span>
                <div><div style={{ fontSize: 12, fontWeight: 700, color: "#78716c", marginBottom: 2 }}>Mascotas</div><div style={{ fontSize: 13, lineHeight: 1.5 }}>{recomendacion.mascotas}</div></div>
              </div>
            )}
            <div style={{ ...S.tipBox, margin: 0 }}>{"\uD83D\uDCA1"} {recomendacion.consejo}</div>
          </div>
        </div>
      )}

      {/* Forecast */}
      {clima.forecast && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
          {clima.forecast.map((day, i) => (
            <div key={i} style={{ ...S.card, padding: "12px 14px", textAlign: "center", minWidth: 80, flexShrink: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#78716c" }}>{day.day}</div>
              <div style={{ fontSize: 24, margin: "6px 0" }}>{weatherIcon(day.icon)}</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{Math.round(day.max)}°</div>
              <div style={{ fontSize: 12, color: "#a3a3a3" }}>{Math.round(day.min)}°</div>
            </div>
          ))}
        </div>
      )}

      {clima.rain_alert && (
        <div style={{ ...S.tipBox, background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8", marginTop: 12 }}>
          {"\u2614"} <strong>Alerta:</strong> {clima.rain_alert}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   DESCUENTOS BANCARIOS
   ═══════════════════════════════════════════════════ */

const DESCUENTOS_DATA = [
  { dia: "Lunes", lugar: "Jumbo / Disco / Vea", banco: "Banco Galicia", descuento: "25%", tope: "$15.000", detalle: "Con tarjetas Galicia" },
  { dia: "Lunes", lugar: "Carrefour", banco: "BBVA", descuento: "15%", tope: "$12.000", detalle: "Con tarjetas BBVA" },
  { dia: "Martes", lugar: "Coto", banco: "Banco Nación", descuento: "20%", tope: "$10.000", detalle: "Con tarjetas BNA" },
  { dia: "Martes", lugar: "Farmacity", banco: "Banco Ciudad", descuento: "25%", tope: "$8.000", detalle: "Con tarjetas Ciudad" },
  { dia: "Miércoles", lugar: "Jumbo / Disco / Vea", banco: "Banco Nación", descuento: "25%", tope: "$15.000", detalle: "Con tarjetas BNA" },
  { dia: "Miércoles", lugar: "Carrefour", banco: "Banco Provincia", descuento: "15%", tope: "$10.000", detalle: "Con tarjetas Bapro" },
  { dia: "Miércoles", lugar: "Changomás", banco: "Mercado Pago", descuento: "15%", tope: "$5.000", detalle: "Pagando con QR" },
  { dia: "Jueves", lugar: "Coto", banco: "Banco Galicia", descuento: "15%", tope: "$10.000", detalle: "Con tarjetas Galicia" },
  { dia: "Jueves", lugar: "Carrefour", banco: "Banco Santander", descuento: "20%", tope: "$12.000", detalle: "Con tarjetas Santander" },
  { dia: "Viernes", lugar: "Día", banco: "Banco Provincia", descuento: "20%", tope: "$8.000", detalle: "Con tarjetas Bapro" },
  { dia: "Viernes", lugar: "Jumbo / Disco / Vea", banco: "HSBC", descuento: "15%", tope: "$10.000", detalle: "Con tarjetas HSBC" },
  { dia: "Sábado", lugar: "Carrefour", banco: "Banco Nación", descuento: "20%", tope: "$15.000", detalle: "Con tarjetas BNA" },
  { dia: "Sábado", lugar: "Coto", banco: "Banco Provincia", descuento: "15%", tope: "$8.000", detalle: "Con tarjetas Bapro" },
  { dia: "Domingo", lugar: "Jumbo / Disco / Vea", banco: "Banco Macro", descuento: "15%", tope: "$10.000", detalle: "Con tarjetas Macro" },
  { dia: "Todos los días", lugar: "MercadoLibre", banco: "Mercado Pago", descuento: "Cuotas sin interés", tope: "", detalle: "Hasta 12 cuotas en productos seleccionados" },
  { dia: "Todos los días", lugar: "Farmacity", banco: "Naranja X", descuento: "10%", tope: "$5.000", detalle: "Con tarjeta Naranja" },
];

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function DescuentosView({ userProfile }) {
  const [filtro, setFiltro] = useState("hoy");
  const hoy = DIAS_SEMANA[new Date().getDay()];

  const misBancos = userProfile?.bancos || [];
  const hasBancos = misBancos.length > 0;

  let filtered;
  if (filtro === "hoy") {
    filtered = DESCUENTOS_DATA.filter((d) => d.dia === hoy || d.dia === "Todos los días");
  } else if (filtro === "mis-bancos") {
    filtered = DESCUENTOS_DATA.filter((d) => misBancos.some((b) => d.banco.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(d.banco.split(" ").pop().toLowerCase())));
  } else {
    filtered = DESCUENTOS_DATA;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{"\uD83C\uDF81"}</span>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>Descuentos</h3>
          <div style={{ fontSize: 12, color: "#78716c" }}>Hoy es {hoy}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button style={{ ...S.chipBtn, flex: 1, fontSize: 13, ...(filtro === "hoy" ? { background: "#e11d48", color: "#fff", borderColor: "#e11d48" } : {}) }} onClick={() => setFiltro("hoy")}>{"\uD83D\uDCC5"} Hoy</button>
        {hasBancos && <button style={{ ...S.chipBtn, flex: 1, fontSize: 13, ...(filtro === "mis-bancos" ? { background: "#e11d48", color: "#fff", borderColor: "#e11d48" } : {}) }} onClick={() => setFiltro("mis-bancos")}>{"\uD83C\uDFE6"} Mis bancos</button>}
        <button style={{ ...S.chipBtn, flex: 1, fontSize: 13, ...(filtro === "todos" ? { background: "#e11d48", color: "#fff", borderColor: "#e11d48" } : {}) }} onClick={() => setFiltro("todos")}>{"\uD83D\uDCCB"} Todos</button>
      </div>

      {!hasBancos && (
        <div style={{ ...S.tipBox, background: "#fff1f2", borderColor: "#fecdd3", color: "#be123c", marginBottom: 16 }}>
          {"\uD83C\uDFE6"} Configurá tus bancos en <strong>⚙️ Config</strong> para ver descuentos personalizados.
        </div>
      )}

      {filtered.length === 0 && (
        <div style={S.emptyState}><div style={{ fontSize: 48 }}>{"\uD83D\uDE45"}</div><div>No se encontraron descuentos</div></div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((d, i) => {
          const isMiBanco = misBancos.some((b) => d.banco.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(d.banco.split(" ").pop().toLowerCase()));
          return (
            <div key={i} style={{ ...S.card, padding: 14, borderLeft: isMiBanco ? "4px solid #e11d48" : "4px solid transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{d.lugar}</div>
                  <div style={{ fontSize: 13, color: "#78716c", marginTop: 2 }}>{d.banco}</div>
                  <div style={{ fontSize: 12, color: "#a3a3a3", marginTop: 2 }}>{d.detalle}</div>
                  {filtro !== "hoy" && <div style={{ fontSize: 11, color: "#e11d48", marginTop: 3 }}>{d.dia}</div>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 800, fontSize: 22, color: "#e11d48" }}>{d.descuento}</div>
                  {d.tope && <div style={{ fontSize: 11, color: "#a3a3a3" }}>Tope {d.tope}</div>}
                </div>
              </div>
              {isMiBanco && <span style={{ fontSize: 10, background: "#e11d48", color: "#fff", padding: "1px 8px", borderRadius: 6, fontWeight: 600, display: "inline-block", marginTop: 6 }}>{"\u2B50"} Tu banco</span>}
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: "center", fontSize: 11, color: "#a3a3a3", marginTop: 16, lineHeight: 1.5 }}>
        Los descuentos pueden variar. Verificá en cada supermercado las condiciones vigentes.
      </div>
    </div>
  );
}

/* ═══════ CONFIG VIEW ═══════ */
const BANCOS_ARGENTINA = [
  "Banco Nación", "Banco Provincia", "Banco Ciudad", "Banco Galicia", "Banco Santander",
  "BBVA", "HSBC", "Banco Macro", "Banco Patagonia", "Banco Hipotecario",
  "Banco Credicoop", "Banco Comafi", "Banco ICBC", "Banco Supervielle", "Banco Itaú",
  "Brubank", "Ualá", "Mercado Pago", "Naranja X", "Personal Pay", "MODO",
];

function ConfigView({ darkMode, setDarkMode, userProfile, setUserProfile }) {
  const [newHijoEdad, setNewHijoEdad] = useState("");
  const [newMascota, setNewMascota] = useState("");
  const [showBancos, setShowBancos] = useState(false);

  const addHijo = () => {
    const edad = parseInt(newHijoEdad);
    if (isNaN(edad) || edad < 0 || edad > 18) return;
    setUserProfile((p) => ({ ...p, hijos: [...p.hijos, { id: Date.now(), edad }] }));
    setNewHijoEdad("");
  };

  const removeHijo = (id) => setUserProfile((p) => ({ ...p, hijos: p.hijos.filter((h) => h.id !== id) }));

  const addMascota = () => {
    if (!newMascota.trim()) return;
    setUserProfile((p) => ({ ...p, mascotas: [...p.mascotas, { id: Date.now(), tipo: newMascota.trim() }] }));
    setNewMascota("");
  };

  const removeMascota = (id) => setUserProfile((p) => ({ ...p, mascotas: p.mascotas.filter((m) => m.id !== id) }));

  const toggleBanco = (banco) => {
    setUserProfile((p) => ({
      ...p,
      bancos: p.bancos.includes(banco) ? p.bancos.filter((b) => b !== banco) : [...p.bancos, banco],
    }));
  };

  return (
    <div>
      <div style={S.aiHero}><div style={{ fontSize: 48, marginBottom: 8 }}>{"\u2699\uFE0F"}</div><h3 style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Fredoka', sans-serif" }}>Configuración</h3></div>

      {/* Dark mode toggle */}
      <div style={{ ...S.card, padding: 16, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>{darkMode ? "\uD83C\uDF19" : "\u2600\uFE0F"}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Modo oscuro</div>
            <div style={{ fontSize: 12, color: "#78716c" }}>{darkMode ? "Activado" : "Desactivado"}</div>
          </div>
        </div>
        <button onClick={() => setDarkMode(!darkMode)} style={{
          width: 52, height: 28, borderRadius: 14, border: "none", cursor: "pointer",
          background: darkMode ? "#ea580c" : "#d6d3d1", position: "relative", transition: "background 0.3s",
        }}>
          <span style={{ position: "absolute", top: 3, left: darkMode ? 27 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left 0.3s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
        </button>
      </div>

      {/* Nombre */}
      <div style={{ ...S.card, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{"\uD83D\uDC64"} Tu nombre</div>
        <input style={S.input} value={userProfile.nombre || ""} onChange={(e) => setUserProfile((p) => ({ ...p, nombre: e.target.value }))} placeholder="¿Cómo te llamás?" />
      </div>

      {/* Hijos */}
      <div style={{ ...S.card, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{"\uD83D\uDC76"} Hijos</div>
        {userProfile.hijos.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {userProfile.hijos.map((h) => (
              <span key={h.id} style={{ ...S.cartChip, padding: "4px 10px", display: "flex", alignItems: "center", gap: 4 }}>
                {h.edad} año{h.edad !== 1 ? "s" : ""}
                <button style={{ border: "none", background: "transparent", color: "#a3a3a3", cursor: "pointer", fontSize: 12, padding: 0 }} onClick={() => removeHijo(h.id)}>{"\u2715"}</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...S.input, flex: 1 }} type="number" inputMode="numeric" min="0" max="18" value={newHijoEdad} onChange={(e) => setNewHijoEdad(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addHijo()} placeholder="Edad del hijo/a" />
          <button style={{ ...S.searchBtn, fontSize: 14 }} onClick={addHijo}>+</button>
        </div>
      </div>

      {/* Mascotas */}
      <div style={{ ...S.card, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{"\uD83D\uDC3E"} Mascotas</div>
        {userProfile.mascotas.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {userProfile.mascotas.map((m) => (
              <span key={m.id} style={{ ...S.cartChip, padding: "4px 10px", display: "flex", alignItems: "center", gap: 4 }}>
                {m.tipo}
                <button style={{ border: "none", background: "transparent", color: "#a3a3a3", cursor: "pointer", fontSize: 12, padding: 0 }} onClick={() => removeMascota(m.id)}>{"\u2715"}</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...S.input, flex: 1 }} value={newMascota} onChange={(e) => setNewMascota(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMascota()} placeholder="Ej: perro, gato..." />
          <button style={{ ...S.searchBtn, fontSize: 14 }} onClick={addMascota}>+</button>
        </div>
      </div>

      {/* Bancos */}
      <div style={{ ...S.card, padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{"\uD83C\uDFE6"} Mis bancos y billeteras</div>
          <button style={{ ...S.btnSmall, fontSize: 12 }} onClick={() => setShowBancos(!showBancos)}>{showBancos ? "Listo" : "Editar"}</button>
        </div>
        {userProfile.bancos.length > 0 && !showBancos && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {userProfile.bancos.map((b) => (
              <span key={b} style={{ ...S.cartChip, ...S.cartChipBest, padding: "4px 10px" }}>{b}</span>
            ))}
          </div>
        )}
        {userProfile.bancos.length === 0 && !showBancos && (
          <div style={{ fontSize: 13, color: "#a3a3a3" }}>Agregá tus bancos para ver descuentos personalizados</div>
        )}
        {showBancos && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {BANCOS_ARGENTINA.map((b) => (
              <button key={b} style={{ ...S.chipBtn, fontSize: 12, padding: "6px 12px", ...(userProfile.bancos.includes(b) ? { background: "#16a34a", color: "#fff", borderColor: "#16a34a" } : {}) }} onClick={() => toggleBanco(b)}>{b}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...S.card, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{"\uD83D\uDCF1"} Sobre SuperMamu</div>
        <p style={{ fontSize: 13, color: "#78716c", lineHeight: 1.6 }}>Tu gestor del hogar: compará precios de supermercados, MercadoLibre, consultá nafta, transporte, medicamentos, dólar, clima, descuentos bancarios y más.</p>
        <div style={{ fontSize: 12, color: "#a3a3a3", marginTop: 12 }}>supermamu.com.ar · v3.0</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════ */
export default function SuperMamu() {
  const [category, setCategory] = useState("super");
  const [darkMode, setDarkMode] = useState(false);
  const [userProfile, setUserProfile] = useState({ nombre: "", hijos: [], mascotas: [], bancos: [] });
  const [tab, setTab] = useState("buscar");
  const [transporteTab, setTransporteTab] = useState("transporte");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState([]);
  const [toast, setToast] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [searchStep, setSearchStep] = useState("idle");
  const [productOptions, setProductOptions] = useState([]);
  const [menuStep, setMenuStep] = useState("config");
  const [menuResult, setMenuResult] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [listas, setListas] = useState([{ id: "default", name: "Mi Lista", items: [] }]);
  const [activeListaId, setActiveListaId] = useState("default");
  const inputRef = useRef(null);
  const scannerObjRef = useRef(null);
  const lastScannedRef = useRef(null);
  const searchingRef = useRef(false);

  useEffect(() => {
    try { const m = localStorage.getItem("supermamu_menu"); if (m) { const parsed = JSON.parse(m); setMenuResult(parsed); setMenuStep("result"); } } catch {}
    try { const c = localStorage.getItem("supermamu_cart"); if (c) setCart(JSON.parse(c)); } catch {}
    try {
      const l = localStorage.getItem("supermamu_listas_v2");
      if (l) {
        const parsed = JSON.parse(l);
        if (parsed.lists?.length) { setListas(parsed.lists); setActiveListaId(parsed.activeId || parsed.lists[0].id); }
      } else {
        // Migrate from old single-list format
        const old = localStorage.getItem("supermamu_lista");
        if (old) { const items = JSON.parse(old); if (items.length) setListas([{ id: "default", name: "Mi Lista", items }]); }
      }
    } catch {}
    if (!document.getElementById("html5qr-script")) { const s = document.createElement("script"); s.id = "html5qr-script"; s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"; s.async = true; document.head.appendChild(s); }
    try { if (localStorage.getItem("supermamu_dark") === "1") setDarkMode(true); } catch {}
    try { const up = localStorage.getItem("supermamu_profile"); if (up) setUserProfile(JSON.parse(up)); } catch {}
  }, []);

  useEffect(() => { if (tab !== "buscar" && scannerActive) stopScanner(); }, [tab, scannerActive]);
  useEffect(() => { try { localStorage.setItem("supermamu_cart", JSON.stringify(cart)); } catch {} }, [cart]);
  useEffect(() => { try { localStorage.setItem("supermamu_dark", darkMode ? "1" : "0"); document.body.style.background = darkMode ? "#1a1a1a" : "#faf9f6"; } catch {} }, [darkMode]);
  useEffect(() => { try { localStorage.setItem("supermamu_profile", JSON.stringify(userProfile)); } catch {} }, [userProfile]);
  useEffect(() => { try { localStorage.setItem("supermamu_listas_v2", JSON.stringify({ activeId: activeListaId, lists: listas })); } catch {} }, [listas, activeListaId]);

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); }, []);

  const startScanner = async () => {
    if (!window.Html5Qrcode) { showToast("Cargando escáner..."); return; }
    if (scannerObjRef.current) await stopScanner();
    setScannerActive(true);
    await new Promise((r) => setTimeout(r, 150));
    try {
      const html5Qr = new window.Html5Qrcode("mamu-scanner-region");
      scannerObjRef.current = html5Qr;
      await html5Qr.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 80 }, aspectRatio: 4.0, disableFlip: false }, (decoded) => {
        if (decoded !== lastScannedRef.current && !searchingRef.current) {
          lastScannedRef.current = decoded;
          if (navigator.vibrate) navigator.vibrate(60);
          const ean = String(decoded).replace(/\D/g, "").trim();
          if (ean.length >= 8) { doCompareByEAN(ean); stopScanner(); }
          setTimeout(() => { lastScannedRef.current = null; }, 3000);
        }
      }, () => {});
    } catch { showToast("No se pudo acceder a la cámara"); setScannerActive(false); }
  };

  const stopScanner = async () => {
    if (scannerObjRef.current) { try { await scannerObjRef.current.stop(); } catch {} scannerObjRef.current = null; }
    setScannerActive(false);
    const el = document.getElementById("mamu-scanner-region"); if (el) el.innerHTML = "";
  };

  const doSearchOptions = async (q) => {
    const trimmed = (q || "").trim();
    if (!trimmed || searchingRef.current) return;
    setQuery(trimmed); setSearching(true); searchingRef.current = true;
    setSearchStep("idle"); setProductOptions([]); setComparisonResult(null); setSelectedProduct(null);
    try {
      if (/^\d{8,13}$/.test(trimmed)) { await doCompareByEAN(trimmed); return; }
      const options = await fetchProductOptions(trimmed);
      if (!options.length) { showToast("No se encontraron productos"); setSearchStep("idle"); }
      else if (options.length === 1) { await selectProduct(options[0]); return; }
      else { setProductOptions(options); setSearchStep("options"); }
    } catch { showToast("Error al buscar"); }
    setSearching(false); searchingRef.current = false;
  };

  const selectProduct = async (product) => {
    setSelectedProduct(product); setSearching(true); searchingRef.current = true; setSearchStep("comparing");
    try { const results = await comparePrices(product.ean, product.nombre); setComparisonResult(results); } catch { showToast("Error al comparar precios"); }
    setSearching(false); searchingRef.current = false;
  };

  const doCompareByEAN = async (ean) => {
    setQuery(ean); setSearching(true); searchingRef.current = true;
    setSearchStep("comparing"); setProductOptions([]);
    try {
      const results = await comparePrices(ean, null);
      const nombre = results.find((r) => r.nombre)?.nombre;
      const imagen = results.find((r) => r.imagen)?.imagen;
      setSelectedProduct({ ean, nombre: nombre || "EAN " + ean, imagen });
      setComparisonResult(results);
      if (!results.some((r) => r.precio)) showToast("Producto no encontrado");
    } catch { showToast("Error al buscar"); }
    setSearching(false); searchingRef.current = false;
  };

  const resetSearch = () => { setSearchStep("idle"); setProductOptions([]); setComparisonResult(null); setSelectedProduct(null); };
  const goBackToOptions = () => { setSearchStep("options"); setComparisonResult(null); setSelectedProduct(null); };
  const handleSearch = () => doSearchOptions(query);
  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.nombre === item.nombre && c.tiendaMin === item.tiendaMin);
      if (existing) return prev.map((c) => (c.nombre === item.nombre && c.tiendaMin === item.tiendaMin) ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { ...item, qty: 1 }];
    });
    showToast("Agregado de " + item.tiendaMin + " \u2713");
  };
  // Helper: get/set active list items
  const activeListaItems = listas.find((l) => l.id === activeListaId)?.items || [];
  const setActiveListaItems = (updater) => {
    setListas((prev) => prev.map((l) => l.id === activeListaId ? { ...l, items: typeof updater === "function" ? updater(l.items) : updater } : l));
  };

  const addToLista = (text) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    if (activeListaItems.some((l) => l.text.toLowerCase() === trimmed.toLowerCase())) {
      showToast("Ya está en la lista");
      return;
    }
    setActiveListaItems((prev) => [...prev, { id: Date.now() + Math.random(), text: trimmed, checked: false }]);
    showToast("Agregado a la lista \u2713");
  };
  const addAllIngredientsToLista = (ingredientes) => {
    let added = 0;
    const existing = new Set(activeListaItems.map((l) => l.text.toLowerCase()));
    const newItems = [];
    for (const ing of ingredientes) {
      const t = ing.trim();
      if (t && !existing.has(t.toLowerCase())) {
        newItems.push({ id: Date.now() + Math.random() + added, text: t, checked: false });
        existing.add(t.toLowerCase());
        added++;
      }
    }
    if (newItems.length > 0) {
      setActiveListaItems((prev) => [...prev, ...newItems]);
      showToast(added + " producto" + (added > 1 ? "s" : "") + " agregado" + (added > 1 ? "s" : "") + " \u2713");
    } else {
      showToast("Ya están todos en la lista");
    }
  };
  const totalItems = cart.reduce((a, c) => a + c.qty, 0);

  const accentColor = category === "super" ? "#ea580c" : "#2563eb";

  return (
    <div style={{ ...S.app, ...(darkMode ? S.appDark : {}) }} className={darkMode ? "dark" : ""}>
      <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* ═══ HEADER ═══ */}
      <div style={{ ...S.header, ...(darkMode ? { background: "#1a1a1a", borderColor: "#333" } : {}) }}>
        <div style={S.logo}>
          <img src="/logo-header.png" alt="SuperMamu" style={{ height: 40, width: 40, borderRadius: 20, marginRight: 8, verticalAlign: "middle" }} />
          <span style={{ color: "#ea580c" }}>Super</span><span style={{ color: darkMode ? "#e5e5e5" : "#171717" }}>Mamu</span>
        </div>
        {category === "super" && (
          <button style={S.cartHeaderBtn} onClick={() => setTab("carrito")}>{"\uD83D\uDED2"} {totalItems > 0 && <span style={S.cartBadge}>{totalItems}</span>}</button>
        )}
      </div>

      {/* ═══ CATEGORY SELECTOR ═══ */}
      <div style={S.categoryBar}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            style={{
              ...S.categoryBtn,
              ...(category === cat.id ? { background: cat.color, color: "#fff", borderColor: cat.color } : {}),
            }}
            onClick={() => setCategory(cat.id)}
          >
            <span style={{ fontSize: 16 }}>{cat.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* ═══ TAB BAR — Supermercado ═══ */}
      {category === "super" && (
        <div style={S.tabBar}>
          {[["buscar","\uD83D\uDD0D","Buscar"],["menu","\uD83E\uDD16","Menú IA"],["lista","\uD83D\uDCDD","Lista"],["config","\u2699\uFE0F","Config"]].map(([id,icon,label]) => (
            <button key={id} style={{ ...S.tabItem, ...(tab === id ? { color: "#ea580c" } : {}), position: "relative" }} onClick={() => setTab(id)}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              {id === "lista" && activeListaItems.filter((l) => !l.checked).length > 0 && <span style={{ ...S.cartBadge, position: "absolute", top: 4, right: "calc(50% - 18px)", fontSize: 9, padding: "0px 5px", minWidth: 16 }}>{activeListaItems.filter((l) => !l.checked).length}</span>}
              <span style={{ fontSize: 10, marginTop: 2 }}>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ═══ TAB BAR — Transporte ═══ */}
      {category === "transporte" && (
        <div style={S.tabBar}>
          {[["transporte","\uD83D\uDE8C","Transporte"],["config","\u2699\uFE0F","Config"]].map(([id,icon,label]) => (
            <button key={id} style={{ ...S.tabItem, ...(transporteTab === id ? { color: "#2563eb" } : {}) }} onClick={() => setTransporteTab(id)}>
              <span style={{ fontSize: 18 }}>{icon}</span><span style={{ fontSize: 10, marginTop: 2 }}>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ═══ CONTENT ═══ */}
      <div style={S.content}>
        {/* SUPERMERCADO CONTENT */}
        {category === "super" && tab === "buscar" && (
          <div>
            <div style={S.searchBox}>
              <div style={{ flex: 1, position: "relative" }}>
                <input ref={inputRef} style={{ ...S.searchInput, paddingRight: 36, width: "100%" }} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder='Buscá: "agua benedictino"' />
                {query && <button style={S.clearBtn} onClick={() => { setQuery(""); resetSearch(); }} type="button">{"\u2715"}</button>}
              </div>
              <button style={S.searchBtn} onClick={handleSearch} disabled={searching}>{searching ? "..." : "\uD83D\uDD0D"}</button>
              <button style={{ ...S.scanBtn, background: scannerActive ? "#dc2626" : "#d6d3d1", color: scannerActive ? "#fff" : "#57534e" }} onClick={() => scannerActive ? stopScanner() : startScanner()}>{scannerActive ? "\u2715" : "\uD83D\uDCF7"}</button>
            </div>
            {scannerActive && <div style={S.scannerWrap}><div id="mamu-scanner-region" style={S.scannerRegion} /><div style={S.scannerHint}><span style={S.scannerDot} /> Apuntá al código de barras</div></div>}
            {!scannerActive && <div id="mamu-scanner-region" style={{ display: "none" }} />}
            {!scannerActive && !searching && searchStep === "idle" && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, justifyContent: "center" }}>{["leche entera","aceite girasol","arroz largo","fideos spaghetti","harina 000"].map((s) => <button key={s} style={S.suggestionChip} onClick={() => doSearchOptions(s)}>{s}</button>)}</div>}
            {searching && <div style={S.emptyState}><div style={S.spinner} /><div style={{ marginTop: 16, fontSize: 14, color: "#78716c" }}>{searchStep === "comparing" ? "Comparando precios en 7 supermercados..." : "Buscando productos..."}</div></div>}
            {!searching && searchStep === "options" && productOptions.length > 0 && <ProductOptionsList options={productOptions} onSelect={selectProduct} onBack={resetSearch} />}
            {!searching && searchStep === "comparing" && comparisonResult && <PriceCard result={comparisonResult} productName={selectedProduct?.nombre} productImage={selectedProduct?.imagen} onAddToCart={addToCart} onAddToLista={addToLista} onBack={productOptions.length > 1 ? goBackToOptions : resetSearch} />}
            {!searching && searchStep === "idle" && !scannerActive && <div style={S.emptyState}><div style={{ fontSize: 56, marginBottom: 12 }}>{"\uD83D\uDD0D"}</div><div style={{ fontWeight: 600 }}>Buscá o escaneá un producto</div><div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4, maxWidth: 260, lineHeight: 1.5, margin: "4px auto 0" }}>Escribí el nombre, un código EAN, o tocá {"\uD83D\uDCF7"} para escanear</div></div>}
          </div>
        )}
        {category === "super" && tab === "menu" && <MenuIA setTab={setTab} onSearchProduct={(q) => { setQuery(q); setTab("buscar"); setTimeout(() => doSearchOptions(q), 100); }} menuStep={menuStep} setMenuStep={setMenuStep} menuResult={menuResult} setMenuResult={setMenuResult} onAddToLista={addToLista} onAddAllToLista={addAllIngredientsToLista} />}
        {category === "super" && tab === "lista" && <ListaView listas={listas} setListas={setListas} activeListaId={activeListaId} setActiveListaId={setActiveListaId} lista={activeListaItems} setLista={setActiveListaItems} onSearchProduct={(q) => { setQuery(q); setTab("buscar"); setTimeout(() => doSearchOptions(q), 100); }} />}
        {category === "super" && tab === "carrito" && <CartView cart={cart} setCart={setCart} />}
        {category === "super" && tab === "config" && <ConfigView darkMode={darkMode} setDarkMode={setDarkMode} userProfile={userProfile} setUserProfile={setUserProfile} />}

        {/* TRANSPORTE CONTENT */}
        {category === "transporte" && transporteTab === "transporte" && <TransporteView />}
        {category === "transporte" && transporteTab === "config" && <ConfigView darkMode={darkMode} setDarkMode={setDarkMode} userProfile={userProfile} setUserProfile={setUserProfile} />}

        {/* DOLAR CONTENT */}
        {category === "dolar" && <DolarView />}

        {/* FARMACIA CONTENT */}
        {category === "farmacia" && <FarmaciaView />}

        {/* MERCADOLIBRE CONTENT */}
        {category === "meli" && <MercadoLibreView />}

        {/* SERVICIOS CERCANOS CONTENT */}
        {category === "servicios" && <ServiciosCercanosView />}

        {/* CLIMA CONTENT */}
        {category === "clima" && <ClimaView userProfile={userProfile} />}

        {/* DESCUENTOS CONTENT */}
        {category === "descuentos" && <DescuentosView userProfile={userProfile} />}
      </div>

      {toast && <div style={S.toast}>{toast}</div>}
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes toastIn{0%{transform:translateX(-50%) translateY(80px);opacity:0}100%{transform:translateX(-50%) translateY(0);opacity:1}}
        @keyframes scanPulse{0%,100%{box-shadow:0 0 0 0 rgba(234,88,12,0.4)}50%{box-shadow:0 0 0 6px rgba(234,88,12,0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        input:focus{outline:none;border-color:#ea580c!important}
        button:active{transform:scale(0.97)}
        ::-webkit-scrollbar{height:0;width:0}
        *{scrollbar-width:none}
        #mamu-scanner-region video{border-radius:10px!important;object-fit:cover!important;max-height:130px!important}
        #mamu-scanner-region{border-radius:10px!important;overflow:hidden!important;max-height:130px!important}
        .dark{background:#1a1a1a!important;color:#e5e5e5}
        .dark div[style*="background: rgb(250"]{background:#1a1a1a!important}
        .dark div[style*="border-bottom: 1px"]{border-color:#333!important}
        .dark div[style*="border-top: 1px"]{border-color:#333!important}
        .dark div[style*="border: 1px solid rgb(231"]{border-color:#333!important;background:#252525!important}
        .dark div[style*="border: 1.5px solid rgb(231"]{border-color:#444!important;background:#252525!important}
        .dark div[style*="background: rgb(255, 255, 255)"]{background:#252525!important}
        .dark div[style*="background: rgb(245, 245, 244)"]{background:#2a2a2a!important}
        .dark input{background:#252525!important;color:#e5e5e5!important;border-color:#444!important}
        .dark input::placeholder{color:#666!important}
        .dark a[style*="background: rgb(255"]{background:#252525!important;border-color:#333!important}
        .dark span[style*="color: rgb(23, 23, 23)"]{color:#e5e5e5!important}
        .dark div[style*="color: rgb(23, 23, 23)"]{color:#e5e5e5!important}
        .dark span[style*="color: rgb(120, 113, 108)"]{color:#888!important}
        .dark div[style*="color: rgb(120, 113, 108)"]{color:#888!important}
        .dark span[style*="color: rgb(87, 83, 78)"]{color:#999!important}
        .dark div[style*="color: rgb(87, 83, 78)"]{color:#999!important}
        .dark button[style*="background: rgb(245"]{background:#333!important;border-color:#444!important;color:#ccc!important}
        .dark button[style*="background: rgb(255, 255, 255)"]{background:#252525!important;border-color:#444!important;color:#ccc!important}
      `}</style>
    </div>
  );
}

/* ═══════ STYLES ═══════ */
const S = {
  app: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#faf9f6", fontFamily: "'DM Sans', system-ui, sans-serif", position: "relative", paddingBottom: 80 },
  appDark: { background: "#1a1a1a", color: "#e5e5e5" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", background: "#faf9f6", borderBottom: "1px solid #e7e5e4", position: "sticky", top: 0, zIndex: 100 },
  logo: { fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: -0.5, display: "flex", alignItems: "center" },
  cartHeaderBtn: { background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 12, padding: "8px 14px", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  cartBadge: { background: "#ea580c", color: "#fff", fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 20, minWidth: 20, textAlign: "center" },

  // Category bar
  categoryBar: { display: "flex", gap: 8, padding: "10px 20px", background: "#faf9f6", borderBottom: "1px solid #e7e5e4", position: "sticky", top: 61, zIndex: 99, overflowX: "auto", WebkitOverflowScrolling: "touch" },
  categoryBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 12, border: "1.5px solid #e7e5e4", background: "#fff", color: "#78716c", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", justifyContent: "center", transition: "all 0.2s", whiteSpace: "nowrap", flexShrink: 0 },

  tabBar: { display: "flex", position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#faf9f6", borderTop: "1px solid #e7e5e4", zIndex: 100, padding: "6px 0 env(safe-area-inset-bottom, 8px) 0" },
  tabItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 4px", border: "none", background: "transparent", color: "#a3a3a3", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  content: { padding: 20, animation: "fadeIn 0.2s ease" },

  // Search
  searchBox: { display: "flex", gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, padding: "14px 16px", borderRadius: 14, border: "1.5px solid #e7e5e4", background: "#fff", fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: "#171717", minWidth: 0 },
  searchBtn: { padding: "14px 16px", borderRadius: 14, border: "none", background: "#ea580c", color: "#fff", fontSize: 18, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  scanBtn: { padding: "14px 15px", borderRadius: 14, border: "none", fontSize: 16, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  clearBtn: { position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", background: "#e7e5e4", color: "#78716c", width: 22, height: 22, borderRadius: "50%", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1 },
  suggestionChip: { padding: "6px 12px", borderRadius: 20, border: "1px solid #e7e5e4", background: "#fff", color: "#78716c", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  scannerWrap: { marginBottom: 14, borderRadius: 14, border: "2px solid #ea580c", overflow: "hidden", background: "#e7e5e4", animation: "scanPulse 2s ease infinite" },
  scannerRegion: { width: "100%", maxHeight: 130, overflow: "hidden" },
  scannerHint: { textAlign: "center", color: "#57534e", fontSize: 12, padding: "5px 0", background: "#d6d3d1", letterSpacing: 0.3, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  scannerDot: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "blink 1.2s ease infinite" },

  // Product options
  optionCard: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, cursor: "pointer", width: "100%", fontFamily: "'DM Sans', sans-serif" },
  optionImg: { width: 64, height: 64, objectFit: "contain", borderRadius: 10, border: "1px solid #f5f5f4", background: "#fff", flexShrink: 0 },
  optionImgPlaceholder: { width: 64, height: 64, borderRadius: 10, border: "1px solid #f5f5f4", background: "#f5f5f4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 },
  optionName: { fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: "#171717" },
  optionBrand: { fontSize: 12, color: "#78716c", marginTop: 1 },
  optionEan: { fontSize: 11, color: "#a3a3a3", marginTop: 1 },
  optionPrice: { fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 16, color: "#ea580c", flexShrink: 0 },
  btnBack: { padding: "6px 12px", borderRadius: 8, border: "1px solid #e7e5e4", background: "#fff", color: "#78716c", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },

  // Cards
  card: { background: "#fff", border: "1px solid #e7e5e4", borderRadius: 16, overflow: "hidden", animation: "slideUp 0.25s ease" },
  cardHeader: { padding: "16px 18px", borderBottom: "1px solid #f5f5f4", display: "flex", gap: 14, alignItems: "flex-start" },
  cardImg: { width: 120, height: 120, objectFit: "contain", borderRadius: 12, border: "1px solid #f5f5f4", background: "#fff", flexShrink: 0, cursor: "pointer" },
  cardImgPlaceholder: { width: 120, height: 120, borderRadius: 12, border: "1px solid #f5f5f4", background: "#f5f5f4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5rem", flexShrink: 0 },

  // Image modal
  modalOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "fadeIn 0.2s ease" },
  modalContent: { position: "relative", maxWidth: 400, width: "100%", background: "#fff", borderRadius: 20, padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },
  modalClose: { position: "absolute", top: -12, right: -12, width: 36, height: 36, borderRadius: "50%", border: "none", background: "#171717", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.3)", zIndex: 1 },
  modalImage: { width: "100%", height: "auto", maxHeight: "70vh", objectFit: "contain", borderRadius: 12 },
  cardName: { fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 16, lineHeight: 1.3 },
  priceRow: { display: "flex", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid #f5f5f4", gap: 12 },
  bestTag: { fontSize: 10, background: "#15803d", color: "#fff", padding: "2px 8px", borderRadius: 10, fontWeight: 700 },
  offerTag: { fontSize: 10, background: "#dc2626", color: "#fff", padding: "2px 8px", borderRadius: 10, fontWeight: 700 },
  mapsLink: { fontSize: 12, color: "#ea580c", textDecoration: "none", display: "inline-block", marginTop: 3, fontWeight: 500 },
  listPrice: { fontSize: 12, color: "#a3a3a3", textDecoration: "line-through" },
  priceAmount: { fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 18 },
  addStoreBtn: { width: 32, height: 32, borderRadius: 10, border: "1.5px solid #e7e5e4", background: "#fff", color: "#ea580c", fontSize: 18, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },

  // Buttons
  btnPrimary: { width: "100%", padding: "14px 24px", background: "#ea580c", color: "#fff", border: "none", borderRadius: 14, fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 15, cursor: "pointer" },
  btnBlue: { padding: "12px 24px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 14, fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 14, cursor: "pointer" },
  btnSmall: { padding: "8px 14px", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 10, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  chipBtn: { padding: "10px 16px", borderRadius: 12, border: "1.5px solid #e7e5e4", background: "#fff", color: "#78716c", fontSize: 14, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 },
  chipBtnActive: { background: "#ea580c", color: "#fff", border: "1.5px solid #ea580c" },
  chipBtnBlueActive: { background: "#2563eb", color: "#fff", border: "1.5px solid #2563eb" },

  // States
  emptyState: { textAlign: "center", padding: "48px 20px", color: "#78716c", fontFamily: "'DM Sans', sans-serif" },
  spinner: { width: 36, height: 36, border: "3px solid #e7e5e4", borderTopColor: "#ea580c", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" },
  spinnerBlue: { width: 36, height: 36, border: "3px solid #e7e5e4", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" },
  toast: { position: "fixed", bottom: 90, left: "50%", background: "#fff", border: "1px solid #15803d", color: "#15803d", borderRadius: 30, padding: "10px 20px", fontSize: 14, whiteSpace: "nowrap", zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,0.1)", animation: "toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, transform: "translateX(-50%)" },
  errorBox: { background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 12, padding: "12px 16px", fontSize: 13, marginBottom: 16 },

  // Cart
  cartSummary: { background: "#fff", border: "1px solid #e7e5e4", borderRadius: 16, padding: 18, marginBottom: 16 },
  totalAmount: { fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 36, color: "#ea580c", letterSpacing: -1, marginTop: 4 },
  cheapestInfo: { marginTop: 10, paddingTop: 10, borderTop: "1px solid #f5f5f4", fontSize: 14, color: "#15803d", lineHeight: 1.6 },
  cartItem: { background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, animation: "slideUp 0.2s ease" },
  cartItemName: { fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 14, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cartChip: { fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#f5f5f4", color: "#78716c" },
  cartChipBest: { background: "#dcfce7", color: "#15803d" },
  qtyBtn: { width: 30, height: 30, background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 8, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },

  // AI & Forms
  aiHero: { textAlign: "center", padding: "24px 20px", marginBottom: 20 },
  formGroup: { marginBottom: 20 },
  formLabel: { display: "block", fontSize: 14, fontWeight: 600, marginBottom: 8, fontFamily: "'Fredoka', sans-serif" },
  input: { width: "100%", padding: "13px 16px", borderRadius: 14, border: "1.5px solid #e7e5e4", background: "#fff", fontSize: 14, fontFamily: "'DM Sans', sans-serif", color: "#171717" },
  tipBox: { background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#15803d", lineHeight: 1.5 },

  // Menu
  menuDay: { display: "flex", gap: 12, padding: "10px 14px", background: "#fff", border: "1px solid #f5f5f4", borderRadius: 12, alignItems: "center" },
  menuDayLabel: { fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 13, color: "#ea580c", minWidth: 55 },
  ingredientBtn: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, cursor: "pointer", width: "100%", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, color: "#171717" },

  // SUBE links
  subeLink: { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, textDecoration: "none", color: "#171717", fontFamily: "'DM Sans', sans-serif" },

  // Lista de compras
  listaItem: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, animation: "slideUp 0.15s ease" },
  listaCheck: { border: "none", background: "transparent", padding: 0, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" },
  listaRemove: { border: "none", background: "transparent", color: "#d6d3d1", fontSize: 14, cursor: "pointer", padding: "4px 6px", flexShrink: 0 },
  listaSearchBtn: { border: "1px solid #e7e5e4", background: "#fff", borderRadius: 8, padding: "4px 8px", cursor: "pointer", fontSize: 13, flexShrink: 0, color: "#ea580c" },
  presetBtn: { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, cursor: "pointer", width: "100%", fontFamily: "'DM Sans', sans-serif", transition: "border-color 0.15s" },
};