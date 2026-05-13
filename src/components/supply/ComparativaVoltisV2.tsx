'use client'

/**
 * ComparativaVoltisV2.tsx — Vista V2 con metodología tripartita.
 *
 * Sigue el prompt-de-sistema Voltis: hero con mascot, 7 pestañas (Ahorro,
 * Consumos, Estimación × luz/gas + Documentos), paleta corporativa exacta y
 * descomposición tripartita Voltis/Gobierno/Cliente.
 *
 * Convive con la V1 (`ComparativaVoltis.tsx`); ambos se renderizan según el
 * flag pasado desde la ficha del supply. Cero acoplamiento con la V1.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, AlertCircle, Zap, Flame, Download,
  TrendingDown, FileText, ExternalLink,
} from 'lucide-react'
import type { ResultadoTripartito } from '@/lib/comparativa-tripartita'

// ── Paleta Voltis (idéntica al HTML de UNICE) ─────────────────────────────
const C = {
  blue: '#1B4FA0',
  blueDark: '#133B7A',
  blueLight: '#7FB3E8',
  blueHero: '#A7C8EC',
  blueSoft: '#EEF4FB',
  greyAntes: '#B8C5D6',
  text: '#1A1A1A',
  text2: '#5A5A5A',
  text3: '#8A8A8A',
  border: '#E5E8EE',
  borderStrong: '#D0D5DD',
  bg: '#FFFFFF',
  bgSoft: '#F7F9FC',
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const fEur = (n: number, d = 2) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €'
const fKwh = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' kWh'
const fPct = (n: number, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %'
const fNum = (n: number, d = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
const fPrice = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 5, maximumFractionDigits: 5 }) + ' €/kWh'

// ─── API response ─────────────────────────────────────────────────────────
interface ApiV2Response {
  supply: {
    id: string
    cups: string | null
    tariff: string | null
    type: string
    name: string | null
    client_id: string
    client_name: string | null
    client_cif: string | null
    comercializadora: string | null
  }
  resultado: ResultadoTripartito
  otrosCupsClient: Array<{ id: string; cups: string | null; tariff: string | null; type: string; has_voltis: boolean }>
}

interface Props {
  supplyId: string
  onBack?: () => void
}

// ══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════

export default function ComparativaVoltisV2({ supplyId, onBack }: Props) {
  const router = useRouter()
  const [data, setData] = useState<ApiV2Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>('')
  const [downloadingHtml, setDownloadingHtml] = useState(false)

  // ── Descargar HTML standalone para mandar al cliente ──────────────────────
  // Llama al endpoint /standalone-html (que embebe las facturas del periodo
  // comparado en base64) y descarga el archivo .html resultante. El comercial
  // luego lo manda al cliente por email/WhatsApp.
  const handleDownloadHtml = async () => {
    setDownloadingHtml(true)
    try {
      const res = await fetch(`/api/comparativa/${supplyId}/standalone-html`)
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Error generando HTML' }))
        throw new Error(errBody.error || `Error ${res.status}`)
      }
      const blob = await res.blob()
      // Recuperar nombre del Content-Disposition si está
      const disp = res.headers.get('content-disposition') || ''
      const m = disp.match(/filename="([^"]+)"/)
      const filename = m?.[1] || `voltis_comparativa.html`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 100)
    } catch (e: any) {
      alert(e?.message || 'Error descargando HTML')
    } finally {
      setDownloadingHtml(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/comparativa/${supplyId}/v2`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json.error) throw new Error(json.error)
        setData(json)
        // Tab inicial según tipo de suministro
        const isGas = json.resultado.supplyType === 'gas'
        setActiveTab(isGas ? 'ahorro-gas' : 'ahorro-luz')
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'Error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [supplyId])

  if (loading) return <Centered><Loader2 className="w-8 h-8 animate-spin" style={{ color: C.blue }} /></Centered>
  if (error) return <Centered><div className="text-sm" style={{ color: '#DC2626' }}><AlertCircle className="inline w-4 h-4 mr-2" />{error}</div></Centered>
  if (!data) return null

  const { supply, resultado } = data
  const isGas = resultado.supplyType === 'gas'

  // Pestañas según tipo
  const tabs: Array<{ id: string; label: string; icon?: React.ReactNode }> = isGas
    ? [
        { id: 'ahorro-gas', label: 'Ahorro gas', icon: <Flame className="w-4 h-4" /> },
        { id: 'estimacion-gas', label: 'Estimación gas' },
        { id: 'documentos', label: 'Documentos', icon: <FileText className="w-4 h-4" /> },
      ]
    : [
        { id: 'ahorro-luz', label: 'Ahorro luz', icon: <Zap className="w-4 h-4" /> },
        { id: 'consumos-luz', label: 'Consumos luz' },
        { id: 'estimacion-luz', label: 'Estimación luz' },
        { id: 'documentos', label: 'Documentos', icon: <FileText className="w-4 h-4" /> },
      ]

  return (
    <div style={{ background: C.bgSoft, minHeight: '100vh', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Hero
        supply={supply}
        resultado={resultado}
        onBack={onBack ?? (() => router.back())}
        onDownloadHtml={handleDownloadHtml}
        downloadingHtml={downloadingHtml}
      />

      <div style={{ maxWidth: 1200, margin: '-32px auto 0', padding: '0 32px 48px', position: 'relative', zIndex: 2 }}>
        {/* Tabs */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: 6, display: 'flex', gap: 4,
          boxShadow: '0 4px 24px rgba(19, 59, 122, 0.08)',
          border: `1px solid ${C.border}`, marginBottom: 28, overflowX: 'auto',
        }}>
          {tabs.map(t => (
            <button key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                border: 'none', background: activeTab === t.id ? C.blue : 'transparent',
                color: activeTab === t.id ? '#fff' : C.text2,
                padding: '10px 18px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer',
                borderRadius: 10, whiteSpace: 'nowrap', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.15s',
              }}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Panels */}
        {activeTab === 'ahorro-luz' && <AhorroPanel data={data} supplyType="luz" />}
        {activeTab === 'consumos-luz' && <ConsumosPanel data={data} />}
        {activeTab === 'estimacion-luz' && <EstimacionPanel data={data} supplyType="luz" />}
        {activeTab === 'ahorro-gas' && <AhorroPanel data={data} supplyType="gas" />}
        {activeTab === 'estimacion-gas' && <EstimacionPanel data={data} supplyType="gas" />}
        {activeTab === 'documentos' && <DocumentosPanel data={data} />}

        {/* Aviso de validación si alguna factura no cuadra */}
        {resultado.validacionFacturas.some(v => !v.ok) && (
          <div style={{
            marginTop: 24, padding: 14, borderRadius: 12, background: '#FFF7ED',
            border: '1px solid #FED7AA', color: '#9A3412', fontSize: 13,
          }}>
            <strong>⚠ Validación:</strong> {resultado.validacionFacturas.filter(v => !v.ok).length} factura(s) tienen una desviación &gt;0,10 €
            entre el total declarado y la reconstrucción. Revisa la extracción antes de publicar.
          </div>
        )}

        {/* Footer */}
        <footer style={{
          marginTop: 32, padding: '20px 0', borderTop: `1px solid ${C.border}`,
          fontSize: 11, color: C.text3, display: 'flex', justifyContent: 'space-between',
        }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>Voltis · Comparativa V2 · Metodología tripartita</span>
          <span>Generado {new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </footer>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// HERO con mascot Buddy
// ══════════════════════════════════════════════════════════════════════════

function Hero({ supply, resultado, onBack, onDownloadHtml, downloadingHtml }: {
  supply: ApiV2Response['supply']
  resultado: ResultadoTripartito
  onBack: () => void
  onDownloadHtml: () => void
  downloadingHtml: boolean
}) {
  const c = resultado.cobertura
  const periodoTxt = c.desde && c.hasta
    ? `${MESES_SHORT[c.desde.mes]} ${c.desde.year} – ${MESES_SHORT[c.hasta.mes]} ${c.hasta.year}`
    : '—'
  return (
    <header style={{ background: `linear-gradient(135deg, ${C.blueHero} 0%, ${C.blueLight} 100%)`, position: 'relative', overflow: 'hidden' }}>
      <div style={{
        background: 'rgba(255,255,255,0.97)', borderBottom: '1px solid rgba(255,255,255,0.6)',
        padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16,
        maxWidth: 1200, margin: '0 auto',
      }}>
        <button onClick={onBack} style={{
          border: 'none', background: 'transparent', padding: 4, cursor: 'pointer',
          color: C.text2, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
        }}>
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div style={{ width: 1, height: 28, background: C.border }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <span style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>Cliente</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{supply.client_name || '—'}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onDownloadHtml}
            disabled={downloadingHtml}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
              borderRadius: 10, border: 'none', cursor: downloadingHtml ? 'wait' : 'pointer',
              background: C.blue, color: '#fff', fontWeight: 600, fontSize: 12,
              fontFamily: 'inherit', opacity: downloadingHtml ? 0.7 : 1,
              boxShadow: '0 4px 12px rgba(19,59,122,0.15)',
            }}>
            {downloadingHtml ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {downloadingHtml ? 'Generando…' : 'Descargar HTML para cliente'}
          </button>
          <div style={{ textAlign: 'right', fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ color: C.text3 }}>CUPS</div>
            <div style={{ fontWeight: 600, color: C.text, fontFamily: "'SF Mono', Menlo, monospace", fontSize: 11 }}>
              {supply.cups || '—'}
            </div>
            <div style={{ color: C.text3 }}>{supply.tariff || '—'}</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 32px 64px', display: 'flex', alignItems: 'center', gap: 32 }}>
        <div style={{ flex: 1, color: '#fff' }}>
          <h1 style={{ fontSize: 38, fontWeight: 800, margin: '0 0 14px', lineHeight: 1.1, letterSpacing: -0.8, color: '#fff' }}>
            Tu ahorro energético, en datos
          </h1>
          <p style={{ fontSize: 16, margin: 0, maxWidth: 540, color: 'rgba(255,255,255,0.95)', lineHeight: 1.5 }}>
            Comparativa {resultado.supplyType === 'gas' ? 'de gas natural' : 'eléctrica'} de {c.mesesComparados} {c.mesesComparados === 1 ? 'mes' : 'meses'} ({periodoTxt}) con Voltis frente a {resultado.comercializadoraAntigua || 'tu antigua comercializadora'}.
          </p>
        </div>
        <BuddySVG />
      </div>
    </header>
  )
}

function BuddySVG() {
  return (
    <svg width={200} height={230} viewBox="0 0 100 115" xmlns="http://www.w3.org/2000/svg"
      style={{ filter: 'drop-shadow(0 12px 32px rgba(19, 59, 122, 0.25))', flexShrink: 0 }}>
      <defs>
        <radialGradient id="bulbGradV2" cx="0.4" cy="0.3">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor="#E0EFFF" />
          <stop offset="100%" stopColor={C.blueHero} />
        </radialGradient>
        <linearGradient id="bodyGradV2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.blue} />
          <stop offset="100%" stopColor={C.blueDark} />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="42" rx="34" ry="36" fill="url(#bulbGradV2)" stroke="#FFFFFF" strokeWidth="1.5" />
      <path d="M35 38 Q40 28 45 38 Q50 28 55 38 Q60 28 65 38" stroke={C.blue} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="36" y="72" width="28" height="22" rx="6" fill="url(#bodyGradV2)" />
      <ellipse cx="50" cy="93" rx="14" ry="3" fill={C.blueDark} opacity="0.4" />
      <circle cx="44" cy="82" r="2.2" fill="#FFFFFF" />
      <circle cx="56" cy="82" r="2.2" fill="#FFFFFF" />
      <circle cx="44.5" cy="82.5" r="0.9" fill="#1E293B" />
      <circle cx="56.5" cy="82.5" r="0.9" fill="#1E293B" />
      <path d="M46 88 Q50 91 54 88" stroke="#FFFFFF" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <rect x="40" y="94" width="6" height="14" rx="3" fill="url(#bodyGradV2)" />
      <rect x="54" y="94" width="6" height="14" rx="3" fill="url(#bodyGradV2)" />
    </svg>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// HELPERS UI
// ══════════════════════════════════════════════════════════════════════════

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
}

function SectionHeader({ meta, title }: { meta: string; title: string }) {
  return (
    <div style={{ margin: '4px 4px 20px' }}>
      <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, margin: '0 0 6px' }}>{meta}</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: C.text, letterSpacing: -0.3 }}>{title}</h2>
    </div>
  )
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14,
      padding: '18px 20px',
    }}>
      <div style={{ fontSize: 11, color: C.text2, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 700, letterSpacing: -0.5,
        color: accent ? C.blue : C.text,
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>{children}</div>
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, ...style }}>{children}</div>
}

// ══════════════════════════════════════════════════════════════════════════
// PESTAÑA: AHORRO (luz o gas)
// ══════════════════════════════════════════════════════════════════════════

function AhorroPanel({ data, supplyType }: { data: ApiV2Response; supplyType: 'luz' | 'gas' }) {
  const { resultado } = data
  const d = resultado.descomposicion
  const isGas = supplyType === 'gas'

  // Variación consumo
  const kwhAntes = resultado.S0.porMes.reduce((s, m) => s + m.resumen.consumoKwh, 0)
  const kwhAhora = resultado.S3.porMes.reduce((s, m) => s + m.resumen.consumoKwh, 0)
  const varKwh = kwhAhora - kwhAntes
  const varKwhPct = kwhAntes > 0 ? (varKwh / kwhAntes) * 100 : 0

  // Precio medio €/kWh sólo término variable de energía
  const energiaAntes = resultado.S0.porMes.reduce((s, m) => s + m.resumen.totalEnergia, 0)
  const energiaAhora = resultado.S3.porMes.reduce((s, m) => s + m.resumen.totalEnergia, 0)
  const eurKwhAntes = kwhAntes > 0 ? energiaAntes / kwhAntes : 0
  const eurKwhAhora = kwhAhora > 0 ? energiaAhora / kwhAhora : 0
  const varPrecio = eurKwhAhora - eurKwhAntes
  const varPrecioPct = eurKwhAntes > 0 ? (varPrecio / eurKwhAntes) * 100 : 0

  return (
    <div>
      <SectionHeader
        meta={isGas ? 'GAS · COMPARATIVA REAL' : 'LUZ · COMPARATIVA REAL'}
        title={`Ahorro total verificado: ${fEur(d.ahorroTotal)}`}
      />

      <KpiGrid>
        <Kpi label={`Ahorro ${resultado.cobertura.mesesComparados}M`} value={fEur(d.ahorroTotal)} hint={fPct(d.pctTotal)} accent />
        <Kpi label="Variación consumo"
          value={`${varKwh >= 0 ? '+' : ''}${fNum(varKwh)} kWh`}
          hint={fPct(varKwhPct)} />
        <Kpi label="Precio medio energía"
          value={fPrice(eurKwhAhora)}
          hint={`Antes ${fPrice(eurKwhAntes)} · ${fPct(varPrecioPct)}`} />
      </KpiGrid>

      {/* Cards Antes / Ahora */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
        <SimpleCard
          title={`Antes · ${resultado.comercializadoraAntigua || 'Comercializadora previa'}`}
          color={C.greyAntes}
          rows={[
            ['Total facturado', fEur(resultado.S0.total)],
            ['Energía consumida', fKwh(kwhAntes)],
            ['Coste energía pura', fEur(energiaAntes)],
            ['€/kWh sólo energía', fPrice(eurKwhAntes)],
          ]}
        />
        <SimpleCard
          title={`Ahora · ${resultado.comercializadoraVoltis || 'Voltis'}`}
          color={C.blue}
          rows={[
            ['Total facturado', fEur(resultado.S3.total)],
            ['Energía consumida', fKwh(kwhAhora)],
            ['Coste energía pura', fEur(energiaAhora)],
            ['€/kWh sólo energía', fPrice(eurKwhAhora)],
          ]}
        />
      </div>

      {/* Tabla mes a mes */}
      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>Coste mes a mes</h3>
        <DataTable
          headers={['Mes', 'Antes', 'Ahora', 'Ahorro €', 'Variación %']}
          rows={resultado.S0.porMes.map((m, i) => {
            const ahora = resultado.S3.porMes[i]?.total || 0
            const ahorro = m.total - ahora
            const pct = m.total > 0 ? (ahorro / m.total) * 100 : 0
            return [
              `${MESES[m.mes]} ${m.year}`,
              fEur(m.total),
              fEur(ahora),
              { value: fEur(ahorro), highlight: ahorro > 0 },
              fPct(pct),
            ]
          })}
          totalRow={['Total', fEur(resultado.S0.total), fEur(resultado.S3.total), { value: fEur(d.ahorroTotal), highlight: true }, fPct(d.pctTotal)]}
        />
      </Card>

      {/* Comparativa de precios medios (barras horizontales) */}
      <Card>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>
          Precio medio sólo término variable de energía
        </h3>
        <HBars
          rows={[
            { label: 'Antes', value: eurKwhAntes, color: C.greyAntes },
            { label: 'Ahora · Voltis', value: eurKwhAhora, color: C.blue },
          ]}
          max={Math.max(eurKwhAntes, eurKwhAhora) * 1.15}
          formatter={(v) => fPrice(v)}
        />
      </Card>

      {/* Sólo gas: descomposición tripartita dentro del panel Ahorro */}
      {isGas && (
        <div style={{ marginTop: 24 }}>
          <SectionHeader meta="GAS · DESCOMPOSICIÓN" title="¿De dónde viene el ahorro?" />
          <TripartitaCards d={d} />
          <TripartitaBar d={d} />
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// PESTAÑA: CONSUMOS (sólo luz)
// ══════════════════════════════════════════════════════════════════════════

function ConsumosPanel({ data }: { data: ApiV2Response }) {
  const { resultado } = data
  const kwhAntes = resultado.S0.porMes.reduce((s, m) => s + m.resumen.consumoKwh, 0)
  const kwhAhora = resultado.S3.porMes.reduce((s, m) => s + m.resumen.consumoKwh, 0)
  const diasAntes = resultado.S0.porMes.reduce((s, m) => s + m.resumen.dias, 0)
  const diasAhora = resultado.S3.porMes.reduce((s, m) => s + m.resumen.dias, 0)
  const medioAntes = diasAntes > 0 ? kwhAntes / diasAntes : 0
  const medioAhora = diasAhora > 0 ? kwhAhora / diasAhora : 0
  const varTotal = kwhAntes > 0 ? ((kwhAhora - kwhAntes) / kwhAntes) * 100 : 0
  const varMedio = medioAntes > 0 ? ((medioAhora - medioAntes) / medioAntes) * 100 : 0

  return (
    <div>
      <SectionHeader meta="LUZ · CONSUMOS" title="Evolución del consumo eléctrico" />
      <KpiGrid>
        <Kpi label="Antes" value={fKwh(kwhAntes)} hint={`${diasAntes} días`} />
        <Kpi label="Ahora" value={fKwh(kwhAhora)} hint={`${diasAhora} días`} accent />
        <Kpi label="Variación total" value={fPct(varTotal)} hint={`${kwhAhora - kwhAntes >= 0 ? '+' : ''}${fNum(kwhAhora - kwhAntes)} kWh`} />
        <Kpi label="Variación medio diario" value={fPct(varMedio)} hint={`${fNum(medioAntes)} → ${fNum(medioAhora)} kWh/día`} />
      </KpiGrid>

      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>Consumo total mensual</h3>
        <GroupedBars
          months={resultado.S0.porMes.map((m, i) => ({
            label: `${MESES_SHORT[m.mes]} ${String(m.year).slice(2)}`,
            antes: m.resumen.consumoKwh,
            ahora: resultado.S3.porMes[i]?.resumen.consumoKwh || 0,
          }))}
          formatter={fKwh}
        />
      </Card>

      <Card>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>Detalle factura a factura</h3>
        <DataTable
          headers={['Mes', 'Antes (kWh · días)', 'Ahora (kWh · días)', 'Δ kWh', 'Δ %']}
          rows={resultado.S0.porMes.map((m, i) => {
            const a = resultado.S3.porMes[i]
            const da = m.resumen.consumoKwh
            const db = a?.resumen.consumoKwh || 0
            const delta = db - da
            const pct = da > 0 ? (delta / da) * 100 : 0
            return [
              `${MESES[m.mes]} ${m.year}`,
              `${fNum(m.resumen.consumoKwh)} · ${m.resumen.dias}`,
              `${fNum(a?.resumen.consumoKwh || 0)} · ${a?.resumen.dias || 0}`,
              `${delta >= 0 ? '+' : ''}${fNum(delta)}`,
              fPct(pct),
            ]
          })}
        />
      </Card>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// PESTAÑA: ESTIMACIÓN (luz o gas) — metodología tripartita
// ══════════════════════════════════════════════════════════════════════════

function EstimacionPanel({ data, supplyType }: { data: ApiV2Response; supplyType: 'luz' | 'gas' }) {
  const { resultado } = data
  const d = resultado.descomposicion
  const cn = resultado.cambiosNormativos
  const huboNormativo = cn.some(c => c.ivaCambio || c.ieCambio || c.iehCambio)

  return (
    <div>
      <SectionHeader meta={`${supplyType.toUpperCase()} · METODOLOGÍA TRIPARTITA`} title="¿De dónde viene cada euro de ahorro?" />

      {/* 4 KPIs descomposición */}
      <TripartitaCards d={d} />

      {/* Barra horizontal apilada con los 3 componentes */}
      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>Descomposición del ahorro</h3>
        <TripartitaBar d={d} />
      </Card>

      {/* Tabla de los 4 escenarios */}
      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>Los 4 escenarios</h3>
        <DataTable
          headers={['Escenario', 'Qué representa', 'Total']}
          rows={[
            ['S0 · Antigua real', 'Lo que pagaste con tu antigua comercializadora', fEur(d.S0)],
            ['S1 · Voltis @ régimen antiguo', 'Mismo consumo, precios Voltis, IVA/IE/IEH del año pasado', fEur(d.S1)],
            ['S2 · Voltis @ régimen actual', 'Mismo consumo, precios Voltis, IVA/IE/IEH del año en curso', fEur(d.S2)],
            ['S3 · Voltis real', 'Lo que has pagado realmente con Voltis', fEur(d.S3)],
          ]}
        />
        <div style={{ marginTop: 14, padding: 12, background: C.blueSoft, borderRadius: 10, fontSize: 12, color: C.text2 }}>
          <strong style={{ color: C.blueDark }}>Identidad verificada:</strong> S0 − S3 = (S0 − S1) + (S1 − S2) + (S2 − S3) =
          tarifa + normativo + consumo. Residual de verificación: <strong>{fEur(d.residualVerificacion, 4)}</strong>
        </div>
      </Card>

      {/* Cambios normativos */}
      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>Cambios normativos detectados</h3>
        {!huboNormativo ? (
          <p style={{ fontSize: 13, color: C.text2, margin: 0 }}>
            No hay cambios fiscales relevantes entre los periodos comparados. Todo el ahorro de tarifa es atribuible a Voltis.
          </p>
        ) : (
          <DataTable
            headers={['Mes', 'IVA', supplyType === 'luz' ? 'IE' : 'IEH', '¿Cambio?']}
            rows={cn.map(c => [
              `${MESES[c.mes]} ${c.year}`,
              c.ivaCambio
                ? `${fPct(c.ivaAntigua * 100)} → ${fPct(c.ivaVoltis * 100)}`
                : fPct(c.ivaVoltis * 100),
              supplyType === 'luz'
                ? (c.ieCambio
                    ? `${fPct((c.ieAntigua ?? 0) * 100, 3)} → ${fPct((c.ieVoltis ?? 0) * 100, 3)}`
                    : fPct((c.ieVoltis ?? 0) * 100, 3))
                : (c.iehCambio
                    ? `${(c.iehAntigua ?? 0).toFixed(6)} → ${(c.iehVoltis ?? 0).toFixed(6)} €/kWh`
                    : `${(c.iehVoltis ?? 0).toFixed(6)} €/kWh`),
              (c.ivaCambio || c.ieCambio || c.iehCambio) ? 'Sí' : '—',
            ])}
          />
        )}
      </Card>

      {/* Detalle mes a mes con S1 y S2 */}
      <Card>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>Detalle mes a mes</h3>
        <DataTable
          headers={['Mes', 'S0 antigua', 'S1 Voltis@antiguo', 'S2 Voltis@actual', 'S3 Voltis real']}
          rows={resultado.S0.porMes.map((m, i) => [
            `${MESES[m.mes]} ${m.year}`,
            fEur(m.total),
            fEur(resultado.S1.porMes[i]?.total || 0),
            fEur(resultado.S2.porMes[i]?.total || 0),
            fEur(resultado.S3.porMes[i]?.total || 0),
          ])}
          totalRow={['Total', fEur(d.S0), fEur(d.S1), fEur(d.S2), fEur(d.S3)]}
        />
      </Card>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// PESTAÑA: DOCUMENTOS
// ══════════════════════════════════════════════════════════════════════════

function DocumentosPanel({ data }: { data: ApiV2Response }) {
  const pares = data.resultado.pares
  return (
    <div>
      <SectionHeader meta="DOCUMENTOS" title="Facturas del periodo comparado" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {pares.map((p, i) => (
          <React.Fragment key={i}>
            <DocCard
              title={`${MESES[p.mes]} ${p.year - 1} · Antigua`}
              subtitle={data.resultado.comercializadoraAntigua || 'Comercializadora previa'}
              fileUrl={p.antigua.file_url}
              color={C.greyAntes}
            />
            <DocCard
              title={`${MESES[p.mes]} ${p.year} · Voltis`}
              subtitle={data.resultado.comercializadoraVoltis || 'Voltis'}
              fileUrl={p.voltis.file_url}
              color={C.blue}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function DocCard({ title, subtitle, fileUrl, color }: { title: string; subtitle: string; fileUrl?: string; color: string }) {
  return (
    <a href={fileUrl || '#'} target="_blank" rel="noopener noreferrer"
      style={{
        background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: 16,
        textDecoration: 'none', color: C.text, display: 'flex', flexDirection: 'column', gap: 10,
        opacity: fileUrl ? 1 : 0.4, cursor: fileUrl ? 'pointer' : 'not-allowed',
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => { if (fileUrl) e.currentTarget.style.borderColor = color }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border }}
      onClick={(e) => { if (!fileUrl) e.preventDefault() }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: `${color}1F`, color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <FileText className="w-5 h-5" />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 11, color: C.text3 }}>{subtitle}</div>
      </div>
      {fileUrl && (
        <div style={{ marginTop: 'auto', fontSize: 11, color, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
          <ExternalLink className="w-3 h-3" />
          Abrir factura
        </div>
      )}
    </a>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// COMPONENTES VISUALES REUTILIZABLES
// ══════════════════════════════════════════════════════════════════════════

function SimpleCard({ title, rows, color }: {
  title: string
  rows: Array<[string, string]>
  color: string
}) {
  return (
    <Card style={{ borderTop: `4px solid ${color}` }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>{title}</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <td style={{ padding: '12px 0', color: C.text2, fontSize: 13 }}>{k}</td>
              <td style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600, color: C.text, fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

type Cell = string | { value: string; highlight?: boolean }

function DataTable({ headers, rows, totalRow }: {
  headers: string[]
  rows: Cell[][]
  totalRow?: Cell[]
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${C.blue}` }}>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: '12px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: 0.6, color: C.text2, textAlign: i === 0 ? 'left' : 'right',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              {r.map((c, j) => {
                const cell = typeof c === 'string' ? { value: c, highlight: false } : c
                return (
                  <td key={j} style={{
                    padding: '14px', fontSize: 14, color: cell.highlight ? C.blue : C.text,
                    fontWeight: cell.highlight ? 600 : 400, textAlign: j === 0 ? 'left' : 'right',
                  }}>{cell.value}</td>
                )
              })}
            </tr>
          ))}
          {totalRow && (
            <tr style={{ background: C.blueSoft, borderTop: `2px solid ${C.blue}` }}>
              {totalRow.map((c, j) => {
                const cell = typeof c === 'string' ? { value: c, highlight: false } : c
                return (
                  <td key={j} style={{
                    padding: 16, fontSize: 14, fontWeight: 700,
                    color: j === 0 ? C.blueDark : (cell.highlight ? C.blue : C.blueDark),
                    textAlign: j === 0 ? 'left' : 'right',
                  }}>{cell.value}</td>
                )
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function HBars({ rows, max, formatter }: {
  rows: Array<{ label: string; value: number; color: string }>
  max: number
  formatter: (v: number) => string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((r, i) => {
        const pct = max > 0 ? (r.value / max) * 100 : 0
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
              <span style={{ color: C.text2, fontWeight: 500 }}>{r.label}</span>
              <span style={{ color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatter(r.value)}</span>
            </div>
            <div style={{ height: 10, background: C.bgSoft, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: r.color, borderRadius: 6, transition: 'width 0.3s' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GroupedBars({ months, formatter }: {
  months: Array<{ label: string; antes: number; ahora: number }>
  formatter: (v: number) => string
}) {
  const max = Math.max(...months.flatMap(m => [m.antes, m.ahora]), 1) * 1.1
  const w = 800; const h = 260
  const pad = { top: 20, right: 16, left: 60, bottom: 36 }
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom
  const groupW = plotW / months.length
  const barW = (groupW - 8) / 2
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', maxWidth: '100%', minWidth: months.length * 70 }}>
        {/* Y grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
          const y = pad.top + plotH - plotH * p
          return (
            <g key={i}>
              <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke={C.border} strokeDasharray="3 3" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill={C.text3}>{formatter(max * p)}</text>
            </g>
          )
        })}
        {months.map((m, i) => {
          const x = pad.left + i * groupW + 4
          const hA = (m.antes / max) * plotH
          const hB = (m.ahora / max) * plotH
          return (
            <g key={i}>
              <rect x={x} y={pad.top + plotH - hA} width={barW} height={hA} rx={4} fill={C.greyAntes} />
              <rect x={x + barW + 6} y={pad.top + plotH - hB} width={barW} height={hB} rx={4} fill={C.blue} />
              <text x={x + barW + 3} y={h - 12} textAnchor="middle" fontSize="11" fill={C.text2}>{m.label}</text>
            </g>
          )
        })}
        {/* Leyenda */}
        <g transform={`translate(${pad.left}, 8)`}>
          <rect width={10} height={10} rx={2} fill={C.greyAntes} />
          <text x={16} y={9} fontSize="11" fill={C.text2}>Antes</text>
          <rect x={70} width={10} height={10} rx={2} fill={C.blue} />
          <text x={86} y={9} fontSize="11" fill={C.text2}>Voltis</text>
        </g>
      </svg>
    </div>
  )
}

function TripartitaCards({ d }: { d: ResultadoTripartito['descomposicion'] }) {
  return (
    <KpiGrid>
      <Kpi label="Por cambio de tarifa (Voltis)" value={fEur(d.ahorroTarifa)} hint={`${fPct(d.pctTarifa)} sobre S0`} accent />
      <Kpi label="Por cambio normativo (Gobierno)" value={fEur(d.ahorroNormativo)} hint={`${fPct(d.pctNormativo)} sobre S0`} />
      <Kpi label="Por menor consumo (Cliente)" value={fEur(d.ahorroConsumo)} hint={`${fPct(d.pctConsumo)} sobre S0`} />
      <Kpi label="Ahorro total verificado" value={fEur(d.ahorroTotal)} hint={fPct(d.pctTotal)} accent />
    </KpiGrid>
  )
}

function TripartitaBar({ d }: { d: ResultadoTripartito['descomposicion'] }) {
  const total = Math.max(Math.abs(d.ahorroTarifa) + Math.abs(d.ahorroNormativo) + Math.abs(d.ahorroConsumo), 1)
  const wT = (Math.abs(d.ahorroTarifa) / total) * 100
  const wN = (Math.abs(d.ahorroNormativo) / total) * 100
  const wC = (Math.abs(d.ahorroConsumo) / total) * 100
  return (
    <div>
      <div style={{ height: 24, borderRadius: 12, overflow: 'hidden', display: 'flex', border: `1px solid ${C.border}` }}>
        <div title={`Tarifa: ${fEur(d.ahorroTarifa)}`} style={{ width: `${wT}%`, background: C.blue }} />
        <div title={`Normativo: ${fEur(d.ahorroNormativo)}`} style={{ width: `${wN}%`, background: C.blueLight }} />
        <div title={`Consumo: ${fEur(d.ahorroConsumo)}`} style={{ width: `${wC}%`, background: C.blueHero }} />
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 12, flexWrap: 'wrap' }}>
        <Legend color={C.blue} label="Tarifa (Voltis)" value={fEur(d.ahorroTarifa)} />
        <Legend color={C.blueLight} label="Normativo (Gobierno)" value={fEur(d.ahorroNormativo)} />
        <Legend color={C.blueHero} label="Consumo (Cliente)" value={fEur(d.ahorroConsumo)} />
      </div>
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 12, height: 12, borderRadius: 3, background: color }} />
      <span style={{ color: C.text2 }}>{label}</span>
      <strong style={{ color: C.text }}>{value}</strong>
    </div>
  )
}
