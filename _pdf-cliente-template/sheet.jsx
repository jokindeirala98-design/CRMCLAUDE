/* global React, ReactDOM, useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakText */
const { useState } = React;

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "cobalt",
  "showQR": true,
  "clientName": "AYUNTAMIENTO DE ORCOYEN",
  "greetingName": "Ayuntamiento de Orcoyen",
  "headline": "Querido {name},",
  "subhead": "bienvenido al club Voltis.",
  "url": "https://voltis-crm-bueno.vercel.app/portal/116f38cfd0c246b983a54ad99ee1c5ebe1d3a1c1a0404f0a9c03fd110f23d400",
  "date": "15 de mayo de 2026"
} /*EDITMODE-END*/;

// Simple decorative QR-like glyph (not a real QR — placeholder visual).
// Generated deterministically so it looks like a real QR.
function FakeQR() {
  const size = 25;
  const cells = [];
  // Seeded pseudo-random
  let s = 0x9e3779b1;
  const rnd = () => {
    s = s * 1664525 + 1013904223 >>> 0;
    return (s & 0xff) / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Finder patterns at three corners
      const inFinder =
      x < 7 && y < 7 ||
      x >= size - 7 && y < 7 ||
      x < 7 && y >= size - 7;
      if (inFinder) continue;
      if (rnd() < 0.48) cells.push([x, y]);
    }
  }
  const FinderPattern = ({ cx, cy }) =>
  <g>
      <rect x={cx} y={cy} width="7" height="7" fill="currentColor" />
      <rect x={cx + 1} y={cy + 1} width="5" height="5" fill="#fff" />
      <rect x={cx + 2} y={cy + 2} width="3" height="3" fill="currentColor" />
    </g>;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <FinderPattern cx={0} cy={0} />
      <FinderPattern cx={size - 7} cy={0} />
      <FinderPattern cx={0} cy={size - 7} />
      {cells.map(([x, y], i) =>
      <rect key={i} x={x} y={y} width="1" height="1" fill="currentColor" />
      )}
    </svg>);

}

function Icon({ name }) {
  const c = "currentColor";
  if (name === "chart")
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19h16" />
        <path d="M7 15v-4" />
        <path d="M12 15V7" />
        <path d="M17 15v-6" />
      </svg>);

  if (name === "doc")
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5" />
        <path d="M9.5 13h7" />
        <path d="M9.5 17h5" />
      </svg>);

  if (name === "download")
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v11" />
        <path d="M7 11l5 5 5-5" />
        <path d="M5 20h14" />
      </svg>);

  if (name === "lock")
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>);

  return null;
}

// Splits the URL after the path prefix so the secret token stands out.
function UrlDisplay({ url }) {
  const m = url.match(/^(https?:\/\/[^\/]+\/portal\/)(.+)$/);
  if (!m) return <span>{url}</span>;
  const prefix = m[1];
  const token = m[2];
  // Insert zero-width breaks every 8 chars to keep token wrapping pretty
  return (
    <span>
      {prefix}
      <b>{token}</b>
    </span>);

}

function Sheet() {
  const [t, setTweak] = useTweaks(DEFAULTS);

  return (
    <React.Fragment>
      <div className={`sheet theme-${t.theme}`} style={{ color: "rgb(255, 255, 255)" }}>
        <div className="page">

          {/* Top bar */}
          <div className="top">
            <div className="brand">
              <div className="brand-name">
                <b>Voltis</b> <span>Energía</span>
              </div>
            </div>
            <div className="top-meta">Acceso · {t.date}</div>
          </div>

          {/* Hero */}
          <div className="hero">
            <div className="hero-text">
              <div className="eyebrow">
                <span className="dot"></span>
                Tu portal está listo
              </div>
              <h1 className="headline">
                {t.headline.replace("{name}", t.greetingName)} <em>{t.subhead}</em>
              </h1>
              <p className="lede">
                Hemos preparado un espacio privado donde puedes ver, en cualquier
                momento, todo lo que pasa con tu energía: consumo, gasto y facturas.
                Sin contraseñas, sin apps, sin papeleo. Sólo abrir y leer.
              </p>
            </div>
            <div className="mascot-wrap">
              <img src="assets/voltis-mascota.png" alt="" />
            </div>
          </div>

          {/* Portal card */}
          <div className="portal-card">
            <div className="portal-head">
              <div>
                <div className="portal-label">Portal privado de</div>
                <div className="client-name">{t.clientName}</div>
              </div>
              <div className="pill-live">
                <span className="dot"></span>
                Datos en vivo
              </div>
            </div>

            <div className="url-row">
              <div className="url-block">
                <div className="url-caption">Ábrelo desde tu navegador</div>
                <div className="url-string">
                  <UrlDisplay url={t.url} />
                </div>
                <div className="url-help">
                  Copia y pega el enlace, guárdalo como marcador o escanea el código
                  para entrar al instante. Es tuyo y sólo tuyo.
                </div>
              </div>
              {t.showQR &&
              <div className="qr">
                  <FakeQR />
                </div>
              }
            </div>
          </div>

          {/* Inside */}
          <div className="inside-head">
            <div className="inside-title">Lo que encontrarás dentro</div>
            <div className="inside-sub">Se actualiza solo con cada nueva factura</div>
          </div>

          <div className="features">
            <div className="feature">
              <div className="glyph"><Icon name="chart" /></div>
              <h3>Tu resumen anual</h3>
              <p>Cuánto pagas en luz y gas, dónde se concentra el gasto y cómo evoluciona mes a mes.</p>
            </div>
            <div className="feature">
              <div className="glyph"><Icon name="doc" /></div>
              <h3>Detalle por suministro</h3>
              <p>Consumo, potencias, precios y conceptos exactos de cada una de tus facturas.</p>
            </div>
            <div className="feature">
              <div className="glyph"><Icon name="download" /></div>
              <h3>Descargas en Excel</h3>
              <p>Datos listos para tu contabilidad o cualquier auditoría que necesites hacer.</p>
            </div>
          </div>

          {/* Footer */}
          <div className="footer">
            <div className="signoff">
              <b>Estamos aquí para ti.</b> Si tienes cualquier duda, una llamada o un
              correo basta — somos personas reales al otro lado, y nos encanta poner
              las cosas fáciles.
              <div className="sig">— El equipo de Voltis</div>
            </div>
            <div className="contact">
              <span className="label">Contacto</span>
              <span className="line strong">747 474 360</span>
              <span className="line">admin@voltisenergia.com</span>
              <span className="line">www.voltisenergia.com</span>
            </div>
          </div>

        </div>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Estilo">
          <TweakRadio
            label="Tema"
            value={t.theme}
            options={[
            { value: "cobalt", label: "Cobalto" },
            { value: "midnight", label: "Noche" },
            { value: "light", label: "Claro" }]
            }
            onChange={(v) => setTweak("theme", v)} />
          
          <TweakToggle
            label="Mostrar QR"
            value={t.showQR}
            onChange={(v) => setTweak("showQR", v)} />
          
        </TweakSection>
        <TweakSection label="Contenido">
          <TweakText label="Cliente (tarjeta)" value={t.clientName} onChange={(v) => setTweak("clientName", v)} />
          <TweakText label="Nombre (saludo)" value={t.greetingName} onChange={(v) => setTweak("greetingName", v)} />
          <TweakText label="Saludo" value={t.headline} onChange={(v) => setTweak("headline", v)} />
          <TweakText label="Bienvenida" value={t.subhead} onChange={(v) => setTweak("subhead", v)} />
          <TweakText label="Fecha" value={t.date} onChange={(v) => setTweak("date", v)} />
          <TweakText label="URL del portal" value={t.url} onChange={(v) => setTweak("url", v)} />
        </TweakSection>
      </TweaksPanel>
    </React.Fragment>);

}

ReactDOM.createRoot(document.getElementById("sheet-root")).render(<Sheet />);