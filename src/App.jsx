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
  { id: "super", label: "Supermercado", icon: "\uD83D\uDED2", color: "#ea580c" },
  { id: "transporte", label: "Transporte", icon: "\uD83D\uDE8C", color: "#2563eb" },
];

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

/* ═══════ PRICE COMPARISON CARD ═══════ */
function PriceCard({ result, productName, productImage, onAddToCart, onAddToLista, onBack }) {
  const withPrice = result.filter((r) => r.precio);
  const minPrice = withPrice.length ? Math.min(...withPrice.map((r) => r.precio)) : 0;
  const nombre = productName || result.find((r) => r.nombre)?.nombre || "Producto";
  const imagen = productImage || result.find((r) => r.imagen)?.imagen;
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        {imagen ? <img src={imagen} alt="" style={S.cardImg} onError={(e) => (e.target.style.display = "none")} /> : <div style={S.cardImgPlaceholder}>{"\uD83D\uDED2"}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.cardName}>{nombre}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {onBack && <button style={{ ...S.btnBack, fontSize: 12 }} onClick={onBack}>{"\u2190"} Elegir otro</button>}
            {onAddToLista && <button style={{ ...S.btnBack, fontSize: 12, color: "#ea580c", borderColor: "#fed7aa" }} onClick={() => onAddToLista(nombre)}>{"\uD83D\uDCDD"} A la lista</button>}
          </div>
        </div>
      </div>
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
      <div style={S.aiHero}><div style={{ fontSize: 48, marginBottom: 8 }}>{"\uD83E\uDD16"}</div><h3 style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", marginBottom: 4 }}>Menú Semanal con IA</h3><p style={{ fontSize: 13, color: "#78716c", maxWidth: 280, margin: "0 auto" }}>Generá un menú personalizado y buscá los mejores precios</p></div>
      {error && <div style={S.errorBox}>{error}</div>}
      <div style={S.formGroup}><label style={S.formLabel}>{"\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66"} ¿Para cuántas personas?</label><div style={{ display: "flex", gap: 8 }}>{["1","2","3","4","5","6"].map((n) => <button key={n} style={{ ...S.chipBtn, ...(personas === n ? S.chipBtnActive : {}) }} onClick={() => setPersonas(n)}>{n}</button>)}</div></div>
      <div style={S.formGroup}><label style={S.formLabel}>{"\uD83D\uDCB0"} Presupuesto</label><div style={{ display: "flex", gap: 8 }}>{[["económico","Económico"],["moderado","Moderado"],["sin límite","Sin límite"]].map(([v,l]) => <button key={v} style={{ ...S.chipBtn, flex: 1, ...(presupuesto === v ? S.chipBtnActive : {}) }} onClick={() => setPresupuesto(v)}>{l}</button>)}</div></div>
      <div style={S.formGroup}><label style={S.formLabel}>{"\uD83E\uDD57"} Restricciones (opcional)</label><input style={S.input} value={restricciones} onChange={(e) => setRestricciones(e.target.value)} placeholder="Ej: sin gluten, vegetariano..." /></div>
      <button style={{ ...S.btnPrimary, width: "100%", padding: "16px 24px", fontSize: 16, marginTop: 8 }} onClick={generateMenu}>{"\u2728"} Generar mi menú semanal</button>
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

function ListaView({ lista, setLista, onSearchProduct }) {
  const [newItem, setNewItem] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [aiError, setAiError] = useState(null);

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

  // ── AI Loading state ──
  if (aiLoading) {
    return (
      <div style={S.emptyState}>
        <div style={S.spinner} />
        <div style={{ marginTop: 16, fontWeight: 600 }}>Generando lista con IA...</div>
        <div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4 }}>Esto puede tardar unos segundos</div>
      </div>
    );
  }

  // ── Presets panel ──
  if (showPresets) {
    return (
      <div style={{ animation: "slideUp 0.25s ease" }}>
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
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", margin: 0 }}>{"\uD83D\uDCDD"} Lista de Compras</h3>
          <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>
            {uncheckedCount} pendiente{uncheckedCount !== 1 ? "s" : ""}
            {checkedCount > 0 && ` \u00B7 ${checkedCount} listo${checkedCount !== 1 ? "s" : ""}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={{ ...S.btnSmall, fontSize: 12 }} onClick={() => setShowPresets(true)}>{"\u2728"} IA</button>
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
  const [alertas, setAlertas] = useState({ subte: null, trenes: null });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("subte");

  useEffect(() => {
    fetchAlertas();
  }, []);

  const fetchAlertas = async () => {
    setLoading(true);
    const results = { subte: null, trenes: null };
    try {
      const [subteResp, trenesResp] = await Promise.all([
        fetch(TRANSPORTE_PROXY + "?tipo=subte-alertas").then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(TRANSPORTE_PROXY + "?tipo=trenes-alertas").then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      results.subte = subteResp;
      results.trenes = trenesResp;
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
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["subte", "\uD83D\uDE87 Subte"], ["trenes", "\uD83D\uDE86 Trenes"]].map(([id, label]) => (
          <button key={id} style={{ ...S.chipBtn, flex: 1, ...(activeTab === id ? S.chipBtnBlueActive : {}) }} onClick={() => setActiveTab(id)}>{label}</button>
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

/* ═══════ CONFIG VIEW ═══════ */
function ConfigView() {
  return (
    <div>
      <div style={S.aiHero}><div style={{ fontSize: 48, marginBottom: 8 }}>{"\u2699\uFE0F"}</div><h3 style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Fredoka', sans-serif" }}>Configuración</h3></div>
      <div style={{ ...S.card, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{"\uD83D\uDCF1"} Sobre SuperMamu</div>
        <p style={{ fontSize: 13, color: "#78716c", lineHeight: 1.6 }}>Tu gestor del hogar: compará precios de supermercados, consultá precios de nafta, estado del transporte público y tarifas actualizadas.</p>
        <div style={{ fontSize: 12, color: "#a3a3a3", marginTop: 12 }}>Menú IA por OpenRouter · Transporte por API BA · v2.0</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════ */
export default function SuperMamu() {
  const [category, setCategory] = useState("super");
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
  const [lista, setLista] = useState([]);
  const inputRef = useRef(null);
  const scannerObjRef = useRef(null);
  const lastScannedRef = useRef(null);
  const searchingRef = useRef(false);

  useEffect(() => {
    try { const m = localStorage.getItem("supermamu_menu"); if (m) { const parsed = JSON.parse(m); setMenuResult(parsed); setMenuStep("result"); } } catch {}
    try { const c = localStorage.getItem("supermamu_cart"); if (c) setCart(JSON.parse(c)); } catch {}
    try { const l = localStorage.getItem("supermamu_lista"); if (l) setLista(JSON.parse(l)); } catch {}
    if (!document.getElementById("html5qr-script")) { const s = document.createElement("script"); s.id = "html5qr-script"; s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"; s.async = true; document.head.appendChild(s); }
  }, []);

  useEffect(() => { if (tab !== "buscar" && scannerActive) stopScanner(); }, [tab, scannerActive]);
  useEffect(() => { try { localStorage.setItem("supermamu_cart", JSON.stringify(cart)); } catch {} }, [cart]);
  useEffect(() => { try { localStorage.setItem("supermamu_lista", JSON.stringify(lista)); } catch {} }, [lista]);

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
  const addToLista = (text) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    // Avoid duplicates (case-insensitive)
    if (lista.some((l) => l.text.toLowerCase() === trimmed.toLowerCase())) {
      showToast("Ya está en la lista");
      return;
    }
    setLista((prev) => [...prev, { id: Date.now() + Math.random(), text: trimmed, checked: false }]);
    showToast("Agregado a la lista \u2713");
  };
  const addAllIngredientsToLista = (ingredientes) => {
    let added = 0;
    const existing = new Set(lista.map((l) => l.text.toLowerCase()));
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
      setLista((prev) => [...prev, ...newItems]);
      showToast(added + " producto" + (added > 1 ? "s" : "") + " agregado" + (added > 1 ? "s" : "") + " a la lista \u2713");
    } else {
      showToast("Ya están todos en la lista");
    }
  };
  const totalItems = cart.reduce((a, c) => a + c.qty, 0);

  const accentColor = category === "super" ? "#ea580c" : "#2563eb";

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* ═══ HEADER ═══ */}
      <div style={S.header}>
        <div style={S.logo}>
          <img src="/logo-header.png" alt="SuperMamu" style={{ height: 40, width: 40, borderRadius: 20, marginRight: 8, verticalAlign: "middle" }} />
          <span style={{ color: "#ea580c" }}>Super</span><span style={{ color: "#171717" }}>Mamu</span>
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
              {id === "lista" && lista.filter((l) => !l.checked).length > 0 && <span style={{ ...S.cartBadge, position: "absolute", top: 4, right: "calc(50% - 18px)", fontSize: 9, padding: "0px 5px", minWidth: 16 }}>{lista.filter((l) => !l.checked).length}</span>}
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
              <input ref={inputRef} style={S.searchInput} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder='Buscá: "agua benedictino"' />
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
        {category === "super" && tab === "lista" && <ListaView lista={lista} setLista={setLista} onSearchProduct={(q) => { setQuery(q); setTab("buscar"); setTimeout(() => doSearchOptions(q), 100); }} />}
        {category === "super" && tab === "carrito" && <CartView cart={cart} setCart={setCart} />}
        {category === "super" && tab === "config" && <ConfigView />}

        {/* TRANSPORTE CONTENT */}
        {category === "transporte" && transporteTab === "transporte" && <TransporteView />}
        {category === "transporte" && transporteTab === "config" && <ConfigView />}
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
        #mamu-scanner-region video{border-radius:10px!important;object-fit:cover!important;max-height:130px!important}
        #mamu-scanner-region{border-radius:10px!important;overflow:hidden!important;max-height:130px!important}
      `}</style>
    </div>
  );
}

/* ═══════ STYLES ═══════ */
const S = {
  app: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#faf9f6", fontFamily: "'DM Sans', system-ui, sans-serif", position: "relative", paddingBottom: 80 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", background: "#faf9f6", borderBottom: "1px solid #e7e5e4", position: "sticky", top: 0, zIndex: 100 },
  logo: { fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: -0.5, display: "flex", alignItems: "center" },
  cartHeaderBtn: { background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 12, padding: "8px 14px", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  cartBadge: { background: "#ea580c", color: "#fff", fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 20, minWidth: 20, textAlign: "center" },

  // Category bar
  categoryBar: { display: "flex", gap: 8, padding: "10px 20px", background: "#faf9f6", borderBottom: "1px solid #e7e5e4", position: "sticky", top: 61, zIndex: 99 },
  categoryBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 12, border: "1.5px solid #e7e5e4", background: "#fff", color: "#78716c", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", flex: 1, justifyContent: "center", transition: "all 0.2s" },

  tabBar: { display: "flex", position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#faf9f6", borderTop: "1px solid #e7e5e4", zIndex: 100, padding: "6px 0 env(safe-area-inset-bottom, 8px) 0" },
  tabItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 4px", border: "none", background: "transparent", color: "#a3a3a3", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  content: { padding: 20, animation: "fadeIn 0.2s ease" },

  // Search
  searchBox: { display: "flex", gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, padding: "14px 16px", borderRadius: 14, border: "1.5px solid #e7e5e4", background: "#fff", fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: "#171717", minWidth: 0 },
  searchBtn: { padding: "14px 16px", borderRadius: 14, border: "none", background: "#ea580c", color: "#fff", fontSize: 18, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  scanBtn: { padding: "14px 15px", borderRadius: 14, border: "none", fontSize: 16, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  suggestionChip: { padding: "6px 12px", borderRadius: 20, border: "1px solid #e7e5e4", background: "#fff", color: "#78716c", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  scannerWrap: { marginBottom: 14, borderRadius: 14, border: "2px solid #ea580c", overflow: "hidden", background: "#e7e5e4", animation: "scanPulse 2s ease infinite" },
  scannerRegion: { width: "100%", maxHeight: 130, overflow: "hidden" },
  scannerHint: { textAlign: "center", color: "#57534e", fontSize: 12, padding: "5px 0", background: "#d6d3d1", letterSpacing: 0.3, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  scannerDot: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "blink 1.2s ease infinite" },

  // Product options
  optionCard: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, cursor: "pointer", width: "100%", fontFamily: "'DM Sans', sans-serif" },
  optionImg: { width: 56, height: 56, objectFit: "contain", borderRadius: 8, border: "1px solid #f5f5f4", background: "#fff", flexShrink: 0 },
  optionImgPlaceholder: { width: 56, height: 56, borderRadius: 8, border: "1px solid #f5f5f4", background: "#f5f5f4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 },
  optionName: { fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: "#171717" },
  optionBrand: { fontSize: 12, color: "#78716c", marginTop: 1 },
  optionEan: { fontSize: 11, color: "#a3a3a3", marginTop: 1 },
  optionPrice: { fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 16, color: "#ea580c", flexShrink: 0 },
  btnBack: { padding: "6px 12px", borderRadius: 8, border: "1px solid #e7e5e4", background: "#fff", color: "#78716c", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },

  // Cards
  card: { background: "#fff", border: "1px solid #e7e5e4", borderRadius: 16, overflow: "hidden", animation: "slideUp 0.25s ease" },
  cardHeader: { padding: "16px 18px", borderBottom: "1px solid #f5f5f4", display: "flex", gap: 14, alignItems: "flex-start" },
  cardImg: { width: 100, height: 100, objectFit: "contain", borderRadius: 10, border: "1px solid #f5f5f4", background: "#fff", flexShrink: 0 },
  cardImgPlaceholder: { width: 100, height: 100, borderRadius: 10, border: "1px solid #f5f5f4", background: "#f5f5f4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5rem", flexShrink: 0 },
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