import { useState, useEffect, useRef, useCallback } from "react";

const PROXY = "https://coto-proxy.supermamuuu.workers.dev";
const AI_PROXY = "https://supermamu-ai.supermamuuu.workers.dev";

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
  // Coto doesn't search by EAN — use exactName or fall back to name from VTEX results
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

/* searchProductSimple removed — ingredients now link to the search tab */

/* ═══════ PRODUCT OPTIONS LIST ═══════ */
function ProductOptionsList({ options, onSelect, onBack }) {
  return (
    <div style={{ animation: "slideUp 0.25s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button style={S.btnBack} onClick={onBack}>{"\u2190"} Volver</button>
        <span style={{ fontSize: 14, color: "#78716c" }}>{options.length} producto{options.length !== 1 ? "s" : ""} encontrado{options.length !== 1 ? "s" : ""}</span>
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
function PriceCard({ result, productName, productImage, onAddToCart, onBack }) {
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
          {onBack && <button style={{ ...S.btnBack, marginTop: 8, fontSize: 12 }} onClick={onBack}>{"\u2190"} Elegir otro producto</button>}
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
function MenuIA({ setTab, onSearchProduct, menuStep, setMenuStep, menuResult, setMenuResult }) {
  const [personas, setPersonas] = useState("4");
  const [restricciones, setRestricciones] = useState("");
  const [presupuesto, setPresupuesto] = useState("moderado");
  const [error, setError] = useState(null);

  const generateMenu = async () => {
    setMenuStep("loading"); setError(null);
    try {
      const supermercados = TIENDAS.map((t) => t.label).join(", ");
      const prompt = "Sos un nutricionista argentino experto en cocina familiar y en hacer compras inteligentes. Generá un menú semanal (lunes a domingo) para " + personas + " personas.\n" + (restricciones ? "Restricciones alimentarias: " + restricciones : "Sin restricciones alimentarias especiales.") + "\nPresupuesto: " + presupuesto + ".\n\nIMPORTANTE SOBRE LOS INGREDIENTES:\n- La lista debe contener ÚNICAMENTE productos reales que se compran en un supermercado, verdulería o carnicería. Cada ingrediente debe ser algo que se encuentra en una góndola o mostrador.\n- NUNCA repitas un producto. Si un ingrediente se usa en varios platos, listalo UNA SOLA VEZ con la cantidad total para la semana.\n- Usá nombres comerciales argentinos cuando sea posible (ej: \"Fideos Matarazzo spaghetti 500 g\").\n- Incluí cantidades aproximadas para " + personas + " personas durante una semana.\n\nEjemplos CORRECTOS de ingredientes: \"Pechuga de pollo 2 kg\", \"Arroz largo fino 1 kg\", \"Tomates redondos 2 kg\", \"Cebolla 1.5 kg\", \"Aceite de girasol 1.5 L\"\nEjemplos INCORRECTOS: \"Ensalada de pollo\", \"Milanesas con puré\", \"Tarta de verduras\" (estos son platos, NO productos)\n\nRespondé ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown, sin backticks:\n{\"menu\":[{\"dia\":\"Lunes\",\"almuerzo\":\"nombre del plato\",\"cena\":\"nombre del plato\"},{\"dia\":\"Martes\",\"almuerzo\":\"nombre del plato\",\"cena\":\"nombre del plato\"},{\"dia\":\"Miércoles\",\"almuerzo\":\"nombre del plato\",\"cena\":\"nombre del plato\"},{\"dia\":\"Jueves\",\"almuerzo\":\"nombre del plato\",\"cena\":\"nombre del plato\"},{\"dia\":\"Viernes\",\"almuerzo\":\"nombre del plato\",\"cena\":\"nombre del plato\"},{\"dia\":\"Sábado\",\"almuerzo\":\"nombre del plato\",\"cena\":\"nombre del plato\"},{\"dia\":\"Domingo\",\"almuerzo\":\"nombre del plato\",\"cena\":\"nombre del plato\"}],\"ingredientes\":[\"producto 1 con cantidad total\",\"producto 2 con cantidad total\"],\"tips\":\"Un consejo útil breve para ahorrar en la compra\"}";

      const resp = await fetch(AI_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "arcee-ai/trinity-large-preview:free", messages: [{ role: "system", content: "Respondés ÚNICAMENTE con JSON válido. Sin texto, sin markdown, solo JSON. NUNCA repitas ingredientes en la lista." }, { role: "user", content: prompt }], max_tokens: 4096, temperature: 0.7 }),
      });
      if (!resp.ok) { const t = await resp.text().catch(() => ""); let m = "Error " + resp.status; try { m = JSON.parse(t).error?.message || m; } catch {} throw new Error(m); }
      const rawText = await resp.text();
      if (!rawText?.trim()) throw new Error("El modelo devolvió una respuesta vacía. Intentá de nuevo.");
      let data; try { data = JSON.parse(rawText); } catch { throw new Error("Respuesta inválida del servidor."); }
      let content = data.choices?.[0]?.message?.content || "";
      if (!content?.trim()) throw new Error("El modelo no generó contenido. Intentá de nuevo.");
      content = content.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      const js = content.indexOf("{"), je = content.lastIndexOf("}");
      if (js === -1 || je === -1) throw new Error("El modelo no devolvió JSON válido.");
      content = content.slice(js, je + 1);
      let parsed; try { parsed = JSON.parse(content); } catch { try { parsed = JSON.parse(content.replace(/,\s*([}\]])/g, "$1")); } catch { throw new Error("JSON incompleto. Intentá de nuevo."); } }
      if (!parsed.menu || !Array.isArray(parsed.menu)) throw new Error("Menú inválido. Intentá de nuevo.");
      // Normalize: merge category lists into single ingredientes if model used categories
      if (!parsed.ingredientes) {
        const all = [...(parsed.supermercado || []), ...(parsed.verduleria || []), ...(parsed.carniceria || [])];
        parsed.ingredientes = all;
      }
      // Deduplicate ingredients (case-insensitive)
      if (parsed.ingredientes) {
        const seen = new Set();
        parsed.ingredientes = parsed.ingredientes.filter((ing) => {
          const key = ing.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      setMenuResult(parsed); setMenuStep("result");
      try { localStorage.setItem("supermamu_menu", JSON.stringify(parsed)); } catch {}
    } catch (e) { setError(e.message || "Error generando el menú"); setMenuStep("config"); }
  };

  const handleIngredientClick = (ing) => {
    const searchTerm = ing.split("(")[0].replace(/\d+\s*(kg|g|l|ml|unidad|un|lt|cc)\b/gi, "").trim();
    onSearchProduct(searchTerm);
  };

  if (menuStep === "loading") return <div style={S.emptyState}><div style={S.spinner} /><div style={{ marginTop: 16, fontWeight: 600 }}>Generando tu menú semanal...</div><div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4 }}>Esto puede tardar unos segundos</div></div>;

  if (menuStep === "result" && menuResult) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Fredoka', sans-serif" }}>{"\uD83C\uDF7D\uFE0F"} Tu Menú Semanal</h3>
          <button style={S.btnSmall} onClick={() => { setMenuStep("config"); setMenuResult(null); try { localStorage.removeItem("supermamu_menu"); } catch {} }}>{"\u2728"} Nuevo menú</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {menuResult.menu?.map((day, i) => <div key={i} style={S.menuDay}><div style={S.menuDayLabel}>{day.dia}</div><div style={{ flex: 1 }}><div style={{ fontSize: 13 }}>{"\uD83C\uDF24\uFE0F"} {day.almuerzo}</div><div style={{ fontSize: 13, marginTop: 2 }}>{"\uD83C\uDF19"} {day.cena}</div></div></div>)}
        </div>
        {menuResult.tips && <div style={S.tipBox}>{"\uD83D\uDCA1"} <strong>Tip:</strong> {menuResult.tips}</div>}

        <h3 style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Fredoka', sans-serif", marginBottom: 4, marginTop: 20 }}>{"\uD83D\uDECD\uFE0F"} Lista de Compras</h3>
        <div style={{ fontSize: 12, color: "#78716c", marginBottom: 12 }}>Tocá un producto para buscarlo y comparar precios</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {menuResult.ingredientes?.map((ing, i) => (
            <button key={i} style={S.ingredientBtn} onClick={() => handleIngredientClick(ing)}>
              <span style={{ flex: 1, textAlign: "left" }}>{ing}</span>
              <span style={{ color: "#ea580c", fontSize: 13, flexShrink: 0 }}>{"\uD83D\uDD0D"} Buscar</span>
            </button>
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
      <div style={S.formGroup}><label style={S.formLabel}>{"\uD83E\uDD57"} Restricciones alimentarias (opcional)</label><input style={S.input} value={restricciones} onChange={(e) => setRestricciones(e.target.value)} placeholder="Ej: sin gluten, vegetariano..." /></div>
      <button style={{ ...S.btnPrimary, width: "100%", padding: "16px 24px", fontSize: 16, marginTop: 8 }} onClick={generateMenu}>{"\u2728"} Generar mi menú semanal</button>
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
        <p style={{ fontSize: 13, color: "#78716c", lineHeight: 1.6 }}>Compará precios entre los principales supermercados argentinos. Escaneá o buscá productos, armá tu lista de compras, y dejá que la IA te ayude a planificar tu menú semanal ahorrando.</p>
        <div style={{ fontSize: 12, color: "#a3a3a3", marginTop: 12 }}>Menú IA powered by OpenRouter</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════ */
export default function SuperMamu() {
  const [tab, setTab] = useState("buscar");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState([]);
  const [toast, setToast] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [searchStep, setSearchStep] = useState("idle");
  const [productOptions, setProductOptions] = useState([]);
  // Menu IA state (lifted so it persists across tab switches)
  const [menuStep, setMenuStep] = useState("config");
  const [menuResult, setMenuResult] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [comparisonResult, setComparisonResult] = useState(null);
  const inputRef = useRef(null);
  const scannerObjRef = useRef(null);
  const lastScannedRef = useRef(null);
  const searchingRef = useRef(false);

  useEffect(() => {
    try { const m = localStorage.getItem("supermamu_menu"); if (m) { const parsed = JSON.parse(m); setMenuResult(parsed); setMenuStep("result"); } } catch {}
    try { const c = localStorage.getItem("supermamu_cart"); if (c) setCart(JSON.parse(c)); } catch {}
    if (!document.getElementById("html5qr-script")) { const s = document.createElement("script"); s.id = "html5qr-script"; s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"; s.async = true; document.head.appendChild(s); }
  }, []);

  useEffect(() => { if (tab !== "buscar" && scannerActive) stopScanner(); }, [tab, scannerActive]);

  // Persist cart to localStorage
  useEffect(() => { try { localStorage.setItem("supermamu_cart", JSON.stringify(cart)); } catch {} }, [cart]);

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
    } catch (err) { console.error("Scanner error:", err); showToast("No se pudo acceder a la cámara"); setScannerActive(false); }
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
      const key = item.nombre + " @ " + item.tiendaMin;
      const existing = prev.find((c) => c.nombre === item.nombre && c.tiendaMin === item.tiendaMin);
      if (existing) return prev.map((c) => (c.nombre === item.nombre && c.tiendaMin === item.tiendaMin) ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { ...item, qty: 1 }];
    });
    showToast("Agregado de " + item.tiendaMin + " \u2713");
  };
  const totalItems = cart.reduce((a, c) => a + c.qty, 0);

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
      <div style={S.header}><div style={S.logo}><img src="/logo-header.png" alt="SuperMamu" style={{ height: 76, width: 76, borderRadius: 38, marginRight: 10, verticalAlign: "middle" }} /><span style={{ color: "#ea580c" }}>Super</span><span style={{ color: "#171717" }}>Mamu</span></div><button style={S.cartHeaderBtn} onClick={() => setTab("carrito")}>{"\uD83D\uDED2"} {totalItems > 0 && <span style={S.cartBadge}>{totalItems}</span>}</button></div>
      <div style={S.tabBar}>
        {[["buscar","\uD83D\uDD0D","Buscar"],["menu","\uD83E\uDD16","Menú IA"],["carrito","\uD83D\uDED2","Carrito"],["config","\u2699\uFE0F","Config"]].map(([id,icon,label]) => <button key={id} style={{ ...S.tabItem, ...(tab === id ? S.tabActive : {}) }} onClick={() => setTab(id)}><span style={{ fontSize: 18 }}>{icon}</span><span style={{ fontSize: 10, marginTop: 2 }}>{label}</span></button>)}
      </div>
      <div style={S.content}>
        {tab === "buscar" && (
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
            {!searching && searchStep === "comparing" && comparisonResult && <PriceCard result={comparisonResult} productName={selectedProduct?.nombre} productImage={selectedProduct?.imagen} onAddToCart={addToCart} onBack={productOptions.length > 1 ? goBackToOptions : resetSearch} />}
            {!searching && searchStep === "idle" && !scannerActive && <div style={S.emptyState}><div style={{ fontSize: 56, marginBottom: 12 }}>{"\uD83D\uDD0D"}</div><div style={{ fontWeight: 600 }}>Buscá o escaneá un producto</div><div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4, maxWidth: 260, lineHeight: 1.5, margin: "4px auto 0" }}>Escribí el nombre, un código EAN, o tocá {"\uD83D\uDCF7"} para escanear el código de barras</div></div>}
          </div>
        )}
        {tab === "menu" && <MenuIA setTab={setTab} onSearchProduct={(q) => { setQuery(q); setTab("buscar"); setTimeout(() => doSearchOptions(q), 100); }} menuStep={menuStep} setMenuStep={setMenuStep} menuResult={menuResult} setMenuResult={setMenuResult} />}
        {tab === "carrito" && <CartView cart={cart} setCart={setCart} />}
        {tab === "config" && <ConfigView />}
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
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "#faf9f6", borderBottom: "1px solid #e7e5e4", position: "sticky", top: 0, zIndex: 100 },
  logo: { fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: -0.5 },
  cartHeaderBtn: { background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 12, padding: "8px 14px", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  cartBadge: { background: "#ea580c", color: "#fff", fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 20, minWidth: 20, textAlign: "center" },
  tabBar: { display: "flex", position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#faf9f6", borderTop: "1px solid #e7e5e4", zIndex: 100, padding: "6px 0 env(safe-area-inset-bottom, 8px) 0" },
  tabItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 4px", border: "none", background: "transparent", color: "#a3a3a3", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  tabActive: { color: "#ea580c" },
  content: { padding: 20, animation: "fadeIn 0.2s ease" },
  searchBox: { display: "flex", gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, padding: "14px 16px", borderRadius: 14, border: "1.5px solid #e7e5e4", background: "#fff", fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: "#171717", minWidth: 0 },
  searchBtn: { padding: "14px 16px", borderRadius: 14, border: "none", background: "#ea580c", color: "#fff", fontSize: 18, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  scanBtn: { padding: "14px 15px", borderRadius: 14, border: "none", color: "#fff", fontSize: 16, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  suggestionChip: { padding: "6px 12px", borderRadius: 20, border: "1px solid #e7e5e4", background: "#fff", color: "#78716c", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  scannerWrap: { marginBottom: 14, borderRadius: 14, border: "2px solid #ea580c", overflow: "hidden", background: "#e7e5e4", animation: "scanPulse 2s ease infinite" },
  scannerRegion: { width: "100%", maxHeight: 130, overflow: "hidden" },
  scannerHint: { textAlign: "center", color: "#57534e", fontSize: 12, padding: "5px 0", background: "#d6d3d1", letterSpacing: 0.3, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  scannerDot: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "blink 1.2s ease infinite" },
  optionCard: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, cursor: "pointer", width: "100%", fontFamily: "'DM Sans', sans-serif" },
  optionImg: { width: 56, height: 56, objectFit: "contain", borderRadius: 8, border: "1px solid #f5f5f4", background: "#fff", flexShrink: 0 },
  optionImgPlaceholder: { width: 56, height: 56, borderRadius: 8, border: "1px solid #f5f5f4", background: "#f5f5f4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 },
  optionName: { fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: "#171717" },
  optionBrand: { fontSize: 12, color: "#78716c", marginTop: 1 },
  optionEan: { fontSize: 11, color: "#a3a3a3", marginTop: 1 },
  optionPrice: { fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 16, color: "#ea580c", flexShrink: 0 },
  btnBack: { padding: "6px 12px", borderRadius: 8, border: "1px solid #e7e5e4", background: "#fff", color: "#78716c", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
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
  cardActions: { padding: "14px 18px", borderTop: "1px solid #f5f5f4" },
  addStoreBtn: { width: 32, height: 32, borderRadius: 10, border: "1.5px solid #e7e5e4", background: "#fff", color: "#ea580c", fontSize: 18, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" },
  btnPrimary: { width: "100%", padding: "14px 24px", background: "#ea580c", color: "#fff", border: "none", borderRadius: 14, fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 15, cursor: "pointer" },
  btnSmall: { padding: "8px 14px", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 10, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  emptyState: { textAlign: "center", padding: "48px 20px", color: "#78716c", fontFamily: "'DM Sans', sans-serif" },
  spinner: { width: 36, height: 36, border: "3px solid #e7e5e4", borderTopColor: "#ea580c", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" },
  toast: { position: "fixed", bottom: 90, left: "50%", background: "#fff", border: "1px solid #15803d", color: "#15803d", borderRadius: 30, padding: "10px 20px", fontSize: 14, whiteSpace: "nowrap", zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,0.1)", animation: "toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, transform: "translateX(-50%)" },
  cartSummary: { background: "#fff", border: "1px solid #e7e5e4", borderRadius: 16, padding: 18, marginBottom: 16 },
  totalAmount: { fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 36, color: "#ea580c", letterSpacing: -1, marginTop: 4 },
  cheapestInfo: { marginTop: 10, paddingTop: 10, borderTop: "1px solid #f5f5f4", fontSize: 14, color: "#15803d", lineHeight: 1.6 },
  cartItem: { background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, animation: "slideUp 0.2s ease" },
  cartItemName: { fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 14, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cartChip: { fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#f5f5f4", color: "#78716c" },
  cartChipBest: { background: "#dcfce7", color: "#15803d" },
  qtyBtn: { width: 30, height: 30, background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 8, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  aiHero: { textAlign: "center", padding: "24px 20px", marginBottom: 20 },
  formGroup: { marginBottom: 20 },
  formLabel: { display: "block", fontSize: 14, fontWeight: 600, marginBottom: 8, fontFamily: "'Fredoka', sans-serif" },
  input: { width: "100%", padding: "13px 16px", borderRadius: 14, border: "1.5px solid #e7e5e4", background: "#fff", fontSize: 14, fontFamily: "'DM Sans', sans-serif", color: "#171717" },
  chipBtn: { padding: "10px 16px", borderRadius: 12, border: "1.5px solid #e7e5e4", background: "#fff", color: "#78716c", fontSize: 14, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 },
  chipBtnActive: { background: "#ea580c", color: "#fff", border: "1.5px solid #ea580c" },
  errorBox: { background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 12, padding: "12px 16px", fontSize: 13, marginBottom: 16 },
  menuDay: { display: "flex", gap: 12, padding: "10px 14px", background: "#fff", border: "1px solid #f5f5f4", borderRadius: 12, alignItems: "center" },
  menuDayLabel: { fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 13, color: "#ea580c", minWidth: 55 },
  tipBox: { background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#15803d", lineHeight: 1.5 },
  ingredientRow: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#fff", border: "1px solid #f5f5f4", borderRadius: 12 },
  ingredientBtn: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, cursor: "pointer", width: "100%", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, color: "#171717", transition: "border-color 0.15s" },
};
