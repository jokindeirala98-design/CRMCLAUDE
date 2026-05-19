'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Calculator,
  Zap,
  TrendingUp,
  Sparkles,
  ChevronDown,
  RotateCcw,
  Send,
  Upload,
  FileText,
  AlertTriangle,
  Database,
  CheckCircle2,
  Plus,
  Download,
  User,
  Search,
  Building2,
  FileSpreadsheet,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { cn } from '@/lib/utils/cn'
import type {
  ResultadoComparativa,
  ResultadoTarifa,
} from '@/lib/comparativas/calcular'

// ── Tipos auxiliares ─────────────────────────────────────────────────────────

interface ExtraOpcional {
  concepto: string
  importe: number
  importeMensual: number
  importeAnual: number
}

interface ExtraccionFactura {
  cups: string | null
  comercializadora: string | null
  tarifa: string
  supplyAddress: string | null
  fechaInicio: string | null
  fechaFin: string | null
  dias: number
  potencias: { p1: number; p2: number }
  energias: { punta: number; llano: number; valle: number }
  totalFactura: number
  preciosUnitarios: {
    kwDia: { p1: number; p2: number }
    kwh: { punta: number; llano: number; valle: number }
  }
  extrasOpcionales: ExtraOpcional[]
  warnings: string[]
  modoExtraccion: 'gemini' | 'claude' | 'manual'
}

interface SipsAnual {
  cups: string
  tarifa: string
  distribuidora: string | null
  potenciasContratadas: { p1: number; p2: number }
  consumoAnual: { punta: number; llano: number; valle: number; total: number }
  diasCobertura: number
  fuente: string
}

// ── Tipos CRM ────────────────────────────────────────────────────────────────

interface CrmSearchResult {
  id: string
  cups: string
  tariff: string
  clientName: string | null
  clientId: string | null
}

interface CrmSupplyData {
  supply: {
    id: string
    cups: string
    tariff: string
    address: string | null
    clientName: string | null
    clientId: string | null
  }
  potencia: { P1: number; P2: number }
  powerPrices: { P1: number; P2: number }
  energyPrices: { P1: number; P2: number; P3: number }
  consumption: { punta: number; llano: number; valle: number; total: number } | null
  consumptionSource: 'sips' | 'invoices' | null
  totalAnual: number | null
  invoiceCount: number
  extras: Array<{ concepto: string; importeAnual: number }>
}

// ── Estado del formulario ────────────────────────────────────────────────────

interface FormState {
  cups: string
  // Potencia contratada (kW)
  p1: string
  p2: string
  igualarPotencias: boolean
  // Consumo anual (kWh)
  punta: string
  llano: string
  valle: string
  // Precios actuales de la comercializadora
  precioP1: string    // €/kW·día
  precioP2: string    // €/kW·día
  precioPunta: string // €/kWh
  precioLlano: string // €/kWh
  precioValle: string // €/kWh
  // Configuración
  dias: string
  ivaPct: string
  alquiler: string
  // Datos del titular (opcionales, para PDF)
  titularNombre: string
  titularDni: string
  titularEmail: string
  titularTelefono: string
}

const INITIAL_FORM: FormState = {
  cups: '',
  p1: '',
  p2: '',
  igualarPotencias: true,
  punta: '',
  llano: '',
  valle: '',
  precioP1: '',
  precioP2: '',
  precioPunta: '',
  precioLlano: '',
  precioValle: '',
  dias: '365',
  ivaPct: '21',
  alquiler: '',
  titularNombre: '',
  titularDni: '',
  titularEmail: '',
  titularTelefono: '',
}

// ── Constantes reguladas (mismo valor que calcular.ts) ───────────────────────
const BONO_SOCIAL_ANUAL = 0.5737 * 12   // ≈ 6.88 €/año
const IMPUESTO_ELECTRICO = 0.038

// ── Página ───────────────────────────────────────────────────────────────────

export default function ComparativasPage() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [calcLoading, setCalcLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResultadoComparativa | null>(null)

  // Estado del flujo de extracción
  const [extracting, setExtracting] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [extraccion, setExtraccion] = useState<ExtraccionFactura | null>(null)
  const [extrasSeleccionados, setExtrasSeleccionados] = useState<Set<number>>(new Set())

  // SIPS
  const [sipsLoading, setSipsLoading] = useState(false)
  const [sipsError, setSipsError] = useState<string | null>(null)
  const [sipsData, setSipsData] = useState<SipsAnual | null>(null)
  const [sipsConsentimiento, setSipsConsentimiento] = useState(false)
  const [horizonte, setHorizonte] = useState<'mensual' | 'anual'>('mensual')

  // Descarga PDF
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  // Exportar Excel
  const [xlsxLoading, setXlsxLoading] = useState(false)
  const [xlsxError, setXlsxError] = useState<string | null>(null)

  // Búsqueda en CRM
  const [crmQuery, setCrmQuery] = useState('')
  const [crmLoading, setCrmLoading] = useState(false)
  const [crmResults, setCrmResults] = useState<CrmSearchResult[]>([])
  const [crmSelected, setCrmSelected] = useState<CrmSupplyData | null>(null)
  const [crmError, setCrmError] = useState<string | null>(null)
  const [crmLoadingSupply, setCrmLoadingSupply] = useState(false)

  const fileRef = useRef<HTMLInputElement | null>(null)

  const setField = (key: keyof FormState, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value as never }))

  // ── Total auto-calculado de la comercializadora actual ─────────────────────
  const totalCalculado = useMemo(() => {
    const p1 = parseNum(form.p1)
    const p2 = form.igualarPotencias ? p1 : parseNum(form.p2)
    const dias = parseNum(form.dias) || 365
    const ivaPct = parseNum(form.ivaPct)
    const meses = dias / 30

    const pp1 = parseNum(form.precioP1)
    const pp2 = form.igualarPotencias ? pp1 : parseNum(form.precioP2)
    const ePunta = parseNum(form.precioPunta)
    const eLlano = parseNum(form.precioLlano)
    const eValle = parseNum(form.precioValle)

    const costeP1 = p1 * dias * pp1
    const costeP2 = p2 * dias * pp2
    const costePunta = parseNum(form.punta) * ePunta
    const costeLlano = parseNum(form.llano) * eLlano
    const costeValle = parseNum(form.valle) * eValle

    const totalPE = costeP1 + costeP2 + costePunta + costeLlano + costeValle
    if (totalPE <= 0) return 0

    const impuesto = totalPE * IMPUESTO_ELECTRICO
    const bonoSocial = BONO_SOCIAL_ANUAL * (meses / 12)
    const sinIva = totalPE + impuesto + bonoSocial
    const iva = sinIva * (ivaPct / 100)
    const alquiler = parseNum(form.alquiler)
    return Math.round((sinIva + iva + alquiler) * 100) / 100
  }, [form])

  const formularioValido = useMemo(() => {
    const tieneAlgunConsumo =
      parseNum(form.punta) > 0 || parseNum(form.llano) > 0 || parseNum(form.valle) > 0
    const tieneTotal = totalCalculado > 0
    return (
      String(form.p1).trim() !== '' &&
      tieneAlgunConsumo &&
      tieneTotal &&
      (form.igualarPotencias || form.p2.trim() !== '')
    )
  }, [form, totalCalculado])

  // ── Subir factura ──────────────────────────────────────────────────────────
  const onPickFile = () => fileRef.current?.click()

  const onFileSelected = async (file: File | null) => {
    if (!file) return
    setError(null)
    setSipsError(null)
    setExtraccion(null)
    setSipsData(null)
    setExtrasSeleccionados(new Set())
    setFileName(file.name)
    setExtracting(true)

    try {
      const base64 = await fileToBase64(file)
      const fileType = file.type.includes('pdf')
        ? 'pdf'
        : file.type.split('/')[1] || 'jpeg'

      const res = await fetch('/api/comparativas/extraer-factura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_base64: base64,
          file_type: fileType,
          file_name: file.name,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'No se pudo extraer la factura')
      }

      const data: ExtraccionFactura = json.data
      setExtraccion(data)

      // Como la comparativa es SIEMPRE anual, extrapolamos los kWh y el total
      // de la factura mensual a su equivalente anual (× 365/diasFactura).
      // Las potencias contratadas no cambian (son fijas) y los precios
      // unitarios tampoco (son €/kWh y €/kW·día).
      const diasFactura = data.dias > 0 ? data.dias : 30
      const factorAnual = 365 / diasFactura

      const igualar =
        data.potencias.p1 > 0 &&
        data.potencias.p2 > 0 &&
        Math.abs(data.potencias.p1 - data.potencias.p2) < 0.01

      setForm((prev) => ({
        ...prev,
        cups: data.cups ?? '',
        p1: numToStr(data.potencias.p1),
        p2: numToStr(data.potencias.p2),
        igualarPotencias: igualar,
        punta: numToStr(redondearN(data.energias.punta * factorAnual)),
        llano: numToStr(redondearN(data.energias.llano * factorAnual)),
        valle: numToStr(redondearN(data.energias.valle * factorAnual)),
        // Precios unitarios extraídos de la factura
        precioP1: numToStr(data.preciosUnitarios.kwDia.p1),
        precioP2: numToStr(data.preciosUnitarios.kwDia.p2),
        precioPunta: numToStr(data.preciosUnitarios.kwh.punta),
        precioLlano: numToStr(data.preciosUnitarios.kwh.llano),
        precioValle: numToStr(data.preciosUnitarios.kwh.valle),
        dias: '365',
        alquiler: '',
      }))
      // Por defecto marcamos todos los extras detectados (el comercial puede
      // desmarcar lo que no aplique)
      setExtrasSeleccionados(new Set(data.extrasOpcionales.map((_, i) => i)))
      // El horizonte arranca como 'anual' porque hemos escalado los datos.
      // Si el comercial pulsa "Consultar SIPS" después, los reemplazamos por
      // los valores reales del histórico SIPS.
      setHorizonte('anual')
    } catch (e: any) {
      setError(e?.message ?? 'Error al extraer factura')
      setFileName(null)
    } finally {
      setExtracting(false)
    }
  }

  // ── Consultar SIPS ─────────────────────────────────────────────────────────
  // Funciona tanto si el CUPS ha llegado de extraer la factura como si el
  // comercial lo ha tecleado a mano sin haber subido factura.
  const onConsultarSips = async () => {
    const cups = form.cups.trim().toUpperCase()
    if (!cups || !sipsConsentimiento) return
    setSipsError(null)
    setSipsLoading(true)

    try {
      const res = await fetch('/api/comparativas/sips-anual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cups }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'No se pudo consultar SIPS')
      }
      const data: SipsAnual = json.data
      setSipsData(data)
      // Sustituimos consumos y potencias por los oficiales SIPS. Si ya
      // teníamos potencias en el formulario (extraídas de factura) las
      // mantenemos como prioritarias; si están vacías, usamos las SIPS.
      setForm((f) => {
        const tienePotenciaFactura = parseNum(f.p1) > 0
        const igualar = tienePotenciaFactura
          ? f.igualarPotencias
          : Math.abs(data.potenciasContratadas.p1 - data.potenciasContratadas.p2) < 0.01
        return {
          ...f,
          cups,
          p1: tienePotenciaFactura ? f.p1 : numToStr(data.potenciasContratadas.p1),
          p2: tienePotenciaFactura ? f.p2 : numToStr(data.potenciasContratadas.p2),
          igualarPotencias: igualar,
          punta: numToStr(data.consumoAnual.punta),
          llano: numToStr(data.consumoAnual.llano),
          valle: numToStr(data.consumoAnual.valle),
          dias: '365',
        }
      })
      // Si tenemos la factura, escalamos el total pagado a anual; si no,
      // dejamos el total como está (el comercial lo introducirá manualmente).
      // totalCalculado is derived automatically from price fields — nothing extra to set here
      setHorizonte('anual')
    } catch (e: any) {
      setSipsError(e?.message ?? 'Error consultando SIPS')
    } finally {
      setSipsLoading(false)
    }
  }

  // ── Calcular ───────────────────────────────────────────────────────────────
  const onCalcular = async () => {
    setError(null)
    setResult(null)
    setCalcLoading(true)

    const p1 = parseNum(form.p1)
    const p2 = form.igualarPotencias ? p1 : parseNum(form.p2)

    const payload = {
      potencias: { p1, p2 },
      energias: {
        punta: parseNum(form.punta),
        llano: parseNum(form.llano),
        valle: parseNum(form.valle),
      },
      dias: parseNum(form.dias),
      ivaPct: parseNum(form.ivaPct),
      totalFacturaActual: totalCalculado,
      alquiler: parseNum(form.alquiler),
    }

    try {
      const res = await fetch('/api/calcular-luz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'No se pudo calcular la comparativa')
      }
      setResult(json.data as ResultadoComparativa)
    } catch (e: any) {
      setError(e?.message ?? 'Error inesperado')
    } finally {
      setCalcLoading(false)
    }
  }

  const onLimpiar = () => {
    setForm(INITIAL_FORM)
    setResult(null)
    setError(null)
    setFileName(null)
    setExtraccion(null)
    setSipsData(null)
    setSipsConsentimiento(false)
    setSipsError(null)
    setExtrasSeleccionados(new Set())
    setHorizonte('mensual')
    setPdfError(null)
    setXlsxError(null)
    setCrmSelected(null)
    setCrmQuery('')
    setCrmResults([])
    setCrmError(null)
  }

  // ── Búsqueda CRM ───────────────────────────────────────────────────────────
  const onCrmSearch = async (q: string) => {
    setCrmQuery(q)
    setCrmResults([])
    if (q.trim().length < 2) return
    setCrmLoading(true)
    setCrmError(null)
    try {
      const res = await fetch(`/api/comparativas/crm-data?q=${encodeURIComponent(q.trim())}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Error buscando')
      setCrmResults(json.results ?? [])
    } catch (e: any) {
      setCrmError(e?.message ?? 'Error de búsqueda')
    } finally {
      setCrmLoading(false)
    }
  }

  const onCrmSelect = async (item: CrmSearchResult) => {
    setCrmResults([])
    setCrmQuery(item.clientName ? `${item.clientName} — ${item.cups}` : item.cups)
    setCrmLoadingSupply(true)
    setCrmError(null)
    try {
      const res = await fetch(`/api/comparativas/crm-data?supply_id=${item.id}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Error cargando suministro')
      const data: CrmSupplyData = json

      setCrmSelected(data)

      // Auto-rellenar formulario
      const p1 = data.potencia.P1 || 0
      const p2 = data.potencia.P2 || 0
      const cons = data.consumption
      const igualar = p1 > 0 && p2 > 0 && Math.abs(p1 - p2) < 0.01

      const pp1 = data.powerPrices.P1
      const pp2 = data.powerPrices.P2
      const ep  = data.energyPrices.P1
      const el  = data.energyPrices.P2
      const ev  = data.energyPrices.P3
      const igualarPreciosPot = pp1 > 0 && pp2 > 0 && Math.abs(pp1 - pp2) < 0.0001

      setForm((f) => ({
        ...f,
        cups: data.supply.cups ?? f.cups,
        p1: p1 > 0 ? String(p1) : f.p1,
        p2: p2 > 0 ? String(p2) : f.p2,
        igualarPotencias: igualar || igualarPreciosPot,
        punta: cons && cons.punta > 0 ? String(Math.round(cons.punta)) : f.punta,
        llano: cons && cons.llano > 0 ? String(Math.round(cons.llano)) : f.llano,
        valle: cons && cons.valle > 0 ? String(Math.round(cons.valle)) : f.valle,
        precioP1: pp1 > 0 ? String(pp1) : f.precioP1,
        precioP2: pp2 > 0 ? String(pp2) : f.precioP2,
        precioPunta: ep > 0 ? String(ep) : f.precioPunta,
        precioLlano: el > 0 ? String(el) : f.precioLlano,
        precioValle: ev > 0 ? String(ev) : f.precioValle,
        dias: '365',
        titularNombre: data.supply.clientName ?? f.titularNombre,
      }))

      // Extras del CRM
      if (data.extras && data.extras.length > 0) {
        setExtrasSeleccionados(new Set(data.extras.map((_, i) => i)))
      }
      setHorizonte('anual')
    } catch (e: any) {
      setCrmError(e?.message ?? 'Error cargando datos')
    } finally {
      setCrmLoadingSupply(false)
    }
  }

  // ── Exportar Excel ─────────────────────────────────────────────────────────
  const onExportarExcel = async () => {
    if (!result) return
    setXlsxError(null)
    setXlsxLoading(true)
    try {
      const p1 = parseNum(form.p1)
      const p2 = form.igualarPotencias ? p1 : parseNum(form.p2)

      const extrasArr = crmSelected?.extras?.length
        ? crmSelected.extras
        : extraccion
        ? Array.from(extrasSeleccionados)
            .map((idx) => extraccion.extrasOpcionales[idx])
            .filter(Boolean)
            .map((e) => ({ concepto: e.concepto, importeAnual: e.importeAnual }))
        : []

      const payload = {
        input: {
          potencias: { p1, p2 },
          energias: {
            punta: parseNum(form.punta),
            llano: parseNum(form.llano),
            valle: parseNum(form.valle),
          },
          dias: parseNum(form.dias) || 365,
          ivaPct: parseNum(form.ivaPct),
          totalFacturaActual: totalCalculado,
          alquiler: parseNum(form.alquiler),
        },
        cliente: {
          nombre: form.titularNombre.trim(),
          cups: form.cups.trim(),
          clientName: crmSelected?.supply?.clientName ?? form.titularNombre.trim(),
        },
        preciosActuales: parseNum(form.precioP1) > 0 ? {
          kwDia: {
            p1: parseNum(form.precioP1),
            p2: parseNum(form.igualarPotencias ? form.precioP1 : form.precioP2),
          },
          kwh: {
            punta: parseNum(form.precioPunta),
            llano: parseNum(form.precioLlano),
            valle: parseNum(form.precioValle),
          },
        } : null,
        extras: extrasArr,
      }

      const res = await fetch('/api/comparativas/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        let msg = `Error ${res.status} generando el Excel`
        try {
          const j = await res.json()
          if (j?.error) msg = j.error
        } catch {}
        throw new Error(msg)
      }

      const blob = await res.blob()
      const cups = form.cups.trim().replace(/\s/g, '')
      const today = new Date().toISOString().slice(0, 10)
      const fname = cups
        ? `Comparativa_${cups}_${today}.xlsx`
        : `Comparativa_Voltis_${today}.xlsx`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fname
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e: any) {
      setXlsxError(e?.message ?? 'Error inesperado generando el Excel')
    } finally {
      setXlsxLoading(false)
    }
  }

  // ── Descargar PDF ──────────────────────────────────────────────────────────
  const onDescargarPdf = async () => {
    if (!result) return
    setPdfError(null)
    setPdfLoading(true)
    try {
      const p1 = parseNum(form.p1)
      const p2 = form.igualarPotencias ? p1 : parseNum(form.p2)

      const extrasArr = extraccion
        ? Array.from(extrasSeleccionados)
            .map((idx) => extraccion.extrasOpcionales[idx])
            .filter(Boolean)
            .map((e) => ({ concepto: e.concepto, importeAnual: e.importeAnual }))
        : []

      const payload = {
        input: {
          potencias: { p1, p2 },
          energias: {
            punta: parseNum(form.punta),
            llano: parseNum(form.llano),
            valle: parseNum(form.valle),
          },
          dias: parseNum(form.dias) || 365,
          ivaPct: parseNum(form.ivaPct),
          totalFacturaActual: totalCalculado,
          alquiler: parseNum(form.alquiler),
        },
        cliente: {
          nombre: form.titularNombre.trim(),
          dni: form.titularDni.trim(),
          email: form.titularEmail.trim(),
          telefono: form.titularTelefono.trim(),
        },
        suministro: {
          cups: form.cups.trim(),
          direccion: extraccion?.supplyAddress ?? '',
          distribuidora: sipsData?.distribuidora ?? '',
          comercializadoraActual: extraccion?.comercializadora ?? '',
          tarifa: '2.0TD',
        },
        extras: extrasArr,
      }

      const res = await fetch('/api/comparativas/generar-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        let msg = `Error ${res.status} generando el PDF`
        try {
          const j = await res.json()
          if (j?.error) msg = j.error
        } catch {}
        throw new Error(msg)
      }

      const blob = await res.blob()
      const fechaIso = new Date().toISOString().slice(0, 10)
      const nombreFichero = form.titularNombre.trim()
        ? `Comparativa_Voltis_${form.titularNombre.trim().replace(/[^a-zA-Z0-9]+/g, '_')}_${fechaIso}.pdf`
        : `Comparativa_Voltis_${fechaIso}.pdf`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombreFichero
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e: any) {
      setPdfError(e?.message ?? 'Error inesperado generando el PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  // ── Cálculo de extras anuales seleccionados ────────────────────────────────
  const ahorroExtrasAnual = useMemo(() => {
    if (!extraccion) return 0
    let total = 0
    extrasSeleccionados.forEach((idx) => {
      total += extraccion.extrasOpcionales[idx]?.importeAnual ?? 0
    })
    return Math.round(total * 100) / 100
  }, [extraccion, extrasSeleccionados])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <Header
        title="Comparativas 2.0"
        subtitle="Compara la factura del cliente con las tarifas 2.0TD de Gana Energía"
        actions={
          <Button variant="ghost" onClick={onLimpiar} disabled={calcLoading || extracting}>
            <RotateCcw className="w-4 h-4" />
            Limpiar
          </Button>
        }
      />

      <div className="px-6 lg:px-8 py-6 space-y-6 max-w-5xl">
        {/* ── Buscar en CRM ────────────────────────────────────────────────── */}
        <Card>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-brand/10 text-brand flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">Cargar datos desde el CRM</p>
              <p className="text-xs text-ink-3 mt-0.5">
                Busca por nombre de cliente o CUPS para auto-rellenar potencia, consumo y precios de las facturas.
              </p>
            </div>
          </div>

          <div className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3 pointer-events-none" />
              <input
                type="text"
                placeholder="Nombre del cliente o CUPS…"
                value={crmQuery}
                onChange={(e) => onCrmSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg border border-line bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
              />
              {crmLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
              )}
            </div>

            {/* Dropdown resultados */}
            {crmResults.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-lg overflow-hidden">
                {crmResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onCrmSelect(item)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-2 transition"
                  >
                    <Zap className="w-4 h-4 text-ink-3 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink truncate">{item.clientName ?? 'Sin cliente'}</p>
                      <p className="text-xs text-ink-3 font-mono truncate">{item.cups}</p>
                    </div>
                    <span className="text-[11px] label-mono text-ink-4 flex-shrink-0">{item.tariff}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Datos cargados */}
          {crmLoadingSupply && (
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-3">
              <div className="w-3.5 h-3.5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
              Cargando datos del suministro…
            </div>
          )}

          {crmSelected && !crmLoadingSupply && (
            <div className="mt-4 pt-4 border-t border-line space-y-2 text-xs">
              <div className="flex items-center gap-2 text-ok">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="font-semibold">Datos cargados desde CRM</span>
                {crmSelected.consumptionSource && (
                  <span className="text-ink-4 font-normal">
                    · consumo desde {crmSelected.consumptionSource === 'sips' ? 'SIPS' : 'facturas'}
                  </span>
                )}
                {crmSelected.invoiceCount > 0 && (
                  <span className="text-ink-4 font-normal">
                    · {crmSelected.invoiceCount} facturas analizadas
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-ink-2">
                <Field label="CUPS" value={crmSelected.supply.cups} mono />
                <Field label="Potencia P1" value={crmSelected.potencia.P1 > 0 ? `${crmSelected.potencia.P1} kW` : null} />
                <Field label="Potencia P2" value={crmSelected.potencia.P2 > 0 ? `${crmSelected.potencia.P2} kW` : null} />
                <Field label="Consumo total" value={crmSelected.consumption ? `${Math.round(crmSelected.consumption.total).toLocaleString('es-ES')} kWh/año` : null} />
              </div>
              {(crmSelected.powerPrices.P1 > 0 || crmSelected.energyPrices.P1 > 0) && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-2">
                  <div className="px-2.5 py-1.5 rounded-md bg-bg-2">
                    <p className="text-ink-4 text-[10px] label-mono">P1 €/kW·día</p>
                    <p className="font-mono text-ink">{crmSelected.powerPrices.P1 > 0 ? crmSelected.powerPrices.P1.toFixed(6) : '—'}</p>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-md bg-bg-2">
                    <p className="text-ink-4 text-[10px] label-mono">P2 €/kW·día</p>
                    <p className="font-mono text-ink">{crmSelected.powerPrices.P2 > 0 ? crmSelected.powerPrices.P2.toFixed(6) : '—'}</p>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-md bg-bg-2">
                    <p className="text-ink-4 text-[10px] label-mono">Punta €/kWh</p>
                    <p className="font-mono text-ink">{crmSelected.energyPrices.P1 > 0 ? crmSelected.energyPrices.P1.toFixed(6) : '—'}</p>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-md bg-bg-2">
                    <p className="text-ink-4 text-[10px] label-mono">Llano €/kWh</p>
                    <p className="font-mono text-ink">{crmSelected.energyPrices.P2 > 0 ? crmSelected.energyPrices.P2.toFixed(6) : '—'}</p>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-md bg-bg-2">
                    <p className="text-ink-4 text-[10px] label-mono">Valle €/kWh</p>
                    <p className="font-mono text-ink">{crmSelected.energyPrices.P3 > 0 ? crmSelected.energyPrices.P3.toFixed(6) : '—'}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {crmError && (
            <div className="mt-3 px-3 py-2 rounded-md bg-err-container/40 border border-err/20 text-xs text-err">
              {crmError}
            </div>
          )}
        </Card>

        {/* ── Subir factura ────────────────────────────────────────────────── */}
        <Card>
          <div className="flex items-start gap-4 flex-col sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-brand/10 text-brand flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Subir factura del cliente</p>
                <p className="text-xs text-ink-3 mt-0.5">
                  PDF o foto · 2.0TD · Iberdrola, Endesa, Naturgy, Repsol, Holaluz, Audax y otras
                </p>
                {fileName && (
                  <p className="text-xs text-ink-2 mt-1 truncate font-mono">
                    {fileName}
                  </p>
                )}
              </div>
            </div>
            <Button onClick={onPickFile} loading={extracting} disabled={extracting}>
              <Upload className="w-4 h-4" />
              {fileName ? 'Cambiar factura' : 'Elegir archivo'}
            </Button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
            className="hidden"
            onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
          />

          {/* Datos extraídos */}
          {extraccion && (
            <div className="mt-4 pt-4 border-t border-line space-y-2 text-xs">
              <div className="flex items-center gap-2 text-ok">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="font-semibold">
                  Factura extraída ({extraccion.modoExtraccion})
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-ink-2">
                <Field label="CUPS" value={extraccion.cups} mono />
                <Field label="Comercializadora" value={extraccion.comercializadora} />
                <Field label="Tarifa" value={extraccion.tarifa} />
                <Field
                  label="Periodo"
                  value={
                    extraccion.fechaInicio && extraccion.fechaFin
                      ? `${extraccion.fechaInicio} → ${extraccion.fechaFin}`
                      : `${extraccion.dias} días`
                  }
                />
              </div>
              {extraccion.warnings.length > 0 && (
                <div className="mt-2 px-3 py-2 rounded-md bg-warn-container/40 border border-warn/20 text-ink-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-warn flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold mb-1">Revisa estos puntos:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {extraccion.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-err-container/40 border border-err/30 text-sm text-err">
              {error}
            </div>
          )}
        </Card>

        {/* ── Situación actual ─────────────────────────────────────────── */}
        <Card className="overflow-hidden p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 bg-bg-2 border-b border-line">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-brand" />
              <p className="text-sm font-semibold text-brand">Situación actual del cliente</p>
              <span className="text-[11px] label-mono text-ink-4 ml-1">
                {extraccion ? '· pre-rellenado' : sipsData ? '· datos SIPS' : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-4">IVA</span>
              <Select
                label=""
                value={form.ivaPct}
                onChange={(e) => setField('ivaPct', e.target.value)}
                options={[
                  { value: '10', label: '10 %' },
                  { value: '21', label: '21 %' },
                ]}
              />
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* ─ Calculadora ── tabla 4 columnas estilo Excel ─ */}
            <div className="rounded-xl border border-line overflow-hidden">

              {/* === POTENCIA === */}
              <div className="border-b border-line">
                <div className="px-4 py-2 bg-bg-2 flex items-center justify-between">
                  <p className="label-mono text-ink-4 text-[11px]">POTENCIA CONTRATADA</p>
                  <label className="flex items-center gap-1.5 text-[11px] text-ink-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.igualarPotencias}
                      onChange={(e) => setField('igualarPotencias', e.target.checked)}
                      className="rounded border-line text-ink focus:ring-0 w-3 h-3"
                    />
                    P1 = P2
                  </label>
                </div>
                {/* Table header */}
                <div className="grid grid-cols-[80px_1fr_1fr_88px] border-b border-line bg-bg-2/50">
                  <div className="px-3 py-1.5 text-[10px] label-mono text-ink-4">Período</div>
                  <div className="px-3 py-1.5 text-[10px] label-mono text-ink-4 border-l border-line">kW contratado</div>
                  <div className="px-3 py-1.5 text-[10px] label-mono text-ink-4 border-l border-line">€ / kW · día</div>
                  <div className="px-3 py-1.5 text-[10px] label-mono text-ink-4 border-l border-line text-right">€ / año</div>
                </div>
                {/* P1 row */}
                {(() => {
                  const _p1 = parseNum(form.p1)
                  const _pp1 = parseNum(form.precioP1)
                  const _dias = parseNum(form.dias) || 365
                  const coste1 = _p1 * _dias * _pp1
                  return (
                    <div className="grid grid-cols-[80px_1fr_1fr_88px] border-b border-line/60">
                      <div className="px-3 py-2 flex items-center">
                        <span className="text-xs font-bold text-ink">P1</span>
                        <span className="text-[10px] text-ink-3 ml-1">Punta</span>
                      </div>
                      <div className="border-l border-line/60 p-1">
                        <input type="number" step="0.001" inputMode="decimal" placeholder="kW"
                          value={form.p1} onChange={(e) => setField('p1', e.target.value)}
                          className="w-full px-2 py-1 text-sm rounded border border-transparent hover:border-line focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 bg-transparent font-mono transition"
                        />
                      </div>
                      <div className="border-l border-line/60 p-1">
                        <input type="number" step="0.000001" inputMode="decimal" placeholder="0.000000"
                          value={form.precioP1} onChange={(e) => setField('precioP1', e.target.value)}
                          className="w-full px-2 py-1 text-sm rounded border border-transparent hover:border-line focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 bg-transparent font-mono transition"
                        />
                      </div>
                      <div className="border-l border-line/60 px-3 py-2 flex items-center justify-end">
                        <span className={cn('text-sm font-semibold tabular-nums', coste1 > 0 ? 'text-ink' : 'text-ink-4')}>
                          {coste1 > 0 ? fmtEur(coste1) : '—'}
                        </span>
                      </div>
                    </div>
                  )
                })()}
                {/* P2 row */}
                {(() => {
                  const _p1 = parseNum(form.p1)
                  const _p2 = form.igualarPotencias ? _p1 : parseNum(form.p2)
                  const _pp1 = parseNum(form.precioP1)
                  const _pp2 = form.igualarPotencias ? _pp1 : parseNum(form.precioP2)
                  const _dias = parseNum(form.dias) || 365
                  const coste2 = _p2 * _dias * _pp2
                  const costeTotal = _p1 * _dias * _pp1 + coste2
                  return (
                    <>
                      <div className="grid grid-cols-[80px_1fr_1fr_88px] border-b border-line/60">
                        <div className="px-3 py-2 flex items-center">
                          <span className="text-xs font-bold text-ink">P2</span>
                          <span className="text-[10px] text-ink-3 ml-1">Valle</span>
                        </div>
                        <div className={cn('border-l border-line/60 p-1', form.igualarPotencias && 'bg-bg-2/60')}>
                          <input type="number" step="0.001" inputMode="decimal"
                            placeholder={form.igualarPotencias ? '= P1' : 'kW'}
                            value={form.igualarPotencias ? form.p1 : form.p2}
                            onChange={(e) => setField('p2', e.target.value)}
                            disabled={form.igualarPotencias}
                            className={cn('w-full px-2 py-1 text-sm rounded border border-transparent font-mono transition',
                              form.igualarPotencias
                                ? 'text-ink-3 cursor-not-allowed'
                                : 'hover:border-line focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 bg-transparent'
                            )}
                          />
                        </div>
                        <div className={cn('border-l border-line/60 p-1', form.igualarPotencias && 'bg-bg-2/60')}>
                          <input type="number" step="0.000001" inputMode="decimal"
                            placeholder={form.igualarPotencias ? '= P1' : '0.000000'}
                            value={form.igualarPotencias ? form.precioP1 : form.precioP2}
                            onChange={(e) => setField('precioP2', e.target.value)}
                            disabled={form.igualarPotencias}
                            className={cn('w-full px-2 py-1 text-sm rounded border border-transparent font-mono transition',
                              form.igualarPotencias
                                ? 'text-ink-3 cursor-not-allowed'
                                : 'hover:border-line focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 bg-transparent'
                            )}
                          />
                        </div>
                        <div className="border-l border-line/60 px-3 py-2 flex items-center justify-end">
                          <span className={cn('text-sm font-semibold tabular-nums', coste2 > 0 ? 'text-ink' : 'text-ink-4')}>
                            {coste2 > 0 ? fmtEur(coste2) : '—'}
                          </span>
                        </div>
                      </div>
                      {/* Subtotal potencia */}
                      {costeTotal > 0 && (
                        <div className="grid grid-cols-[80px_1fr_1fr_88px] bg-bg-2/60">
                          <div className="px-3 py-1.5 col-span-3 flex items-center">
                            <span className="text-[10px] label-mono text-ink-4">Subtotal potencia</span>
                          </div>
                          <div className="border-l border-line/60 px-3 py-1.5 flex items-center justify-end">
                            <span className="text-xs font-bold text-brand tabular-nums">{fmtEur(costeTotal)}</span>
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>

              {/* === ENERGÍA === */}
              <div>
                <div className="px-4 py-2 bg-bg-2 border-b border-line">
                  <p className="label-mono text-ink-4 text-[11px]">CONSUMO ANUAL · ENERGÍA</p>
                </div>
                {/* Table header */}
                <div className="grid grid-cols-[80px_1fr_1fr_88px] border-b border-line bg-bg-2/50">
                  <div className="px-3 py-1.5 text-[10px] label-mono text-ink-4">Período</div>
                  <div className="px-3 py-1.5 text-[10px] label-mono text-ink-4 border-l border-line">kWh / año</div>
                  <div className="px-3 py-1.5 text-[10px] label-mono text-ink-4 border-l border-line">€ / kWh</div>
                  <div className="px-3 py-1.5 text-[10px] label-mono text-ink-4 border-l border-line text-right">€ / año</div>
                </div>
                {/* Energy rows */}
                {([
                  { key: 'punta',  precioKey: 'precioPunta',  label: 'P1', sub: 'Punta' },
                  { key: 'llano',  precioKey: 'precioLlano',  label: 'P2', sub: 'Llano' },
                  { key: 'valle',  precioKey: 'precioValle',  label: 'P3', sub: 'Valle' },
                ] as { key: keyof FormState; precioKey: keyof FormState; label: string; sub: string }[]).map(({ key, precioKey, label, sub }) => {
                  const kwh = parseNum(form[key] as string)
                  const precio = parseNum(form[precioKey] as string)
                  const coste = kwh * precio
                  return (
                    <div key={key} className="grid grid-cols-[80px_1fr_1fr_88px] border-b border-line/60">
                      <div className="px-3 py-2 flex items-center">
                        <span className="text-xs font-bold text-ink">{label}</span>
                        <span className="text-[10px] text-ink-3 ml-1">{sub}</span>
                      </div>
                      <div className="border-l border-line/60 p-1">
                        <input type="number" step="1" inputMode="numeric" placeholder="kWh"
                          value={form[key] as string} onChange={(e) => setField(key, e.target.value)}
                          className="w-full px-2 py-1 text-sm rounded border border-transparent hover:border-line focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 bg-transparent font-mono transition"
                        />
                      </div>
                      <div className="border-l border-line/60 p-1">
                        <input type="number" step="0.0001" inputMode="decimal" placeholder="0.0000"
                          value={form[precioKey] as string} onChange={(e) => setField(precioKey, e.target.value)}
                          className="w-full px-2 py-1 text-sm rounded border border-transparent hover:border-line focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 bg-transparent font-mono transition"
                        />
                      </div>
                      <div className="border-l border-line/60 px-3 py-2 flex items-center justify-end">
                        <span className={cn('text-sm font-semibold tabular-nums', coste > 0 ? 'text-ink' : 'text-ink-4')}>
                          {coste > 0 ? fmtEur(coste) : '—'}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {/* Subtotal energía */}
                {(() => {
                  const sub =
                    parseNum(form.punta) * parseNum(form.precioPunta) +
                    parseNum(form.llano) * parseNum(form.precioLlano) +
                    parseNum(form.valle) * parseNum(form.precioValle)
                  return sub > 0 ? (
                    <div className="grid grid-cols-[80px_1fr_1fr_88px] bg-bg-2/60">
                      <div className="px-3 py-1.5 col-span-3 flex items-center">
                        <span className="text-[10px] label-mono text-ink-4">Subtotal energía</span>
                      </div>
                      <div className="border-l border-line/60 px-3 py-1.5 flex items-center justify-end">
                        <span className="text-xs font-bold text-brand tabular-nums">{fmtEur(sub)}</span>
                      </div>
                    </div>
                  ) : null
                })()}
              </div>
            </div>

            {/* ─ CUPS + SIPS ─ */}
            <div className="rounded-xl border border-line overflow-hidden">
              <div className="px-4 py-2.5 bg-bg-2 border-b border-line">
                <p className="label-mono text-ink-4">CUPS y consulta SIPS</p>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                  <Input
                    label="CUPS (opcional)"
                    placeholder="ES0021000012345678AB"
                    value={form.cups}
                    onChange={(e) => setField('cups', e.target.value.toUpperCase())}
                    hint={
                      sipsData
                        ? `${sipsData.consumoAnual.total.toLocaleString('es-ES')} kWh/año · ${sipsData.distribuidora ?? ''} · ${sipsData.fuente}`
                        : undefined
                    }
                    className="font-mono"
                  />
                  <Button
                    variant="secondary"
                    onClick={onConsultarSips}
                    loading={sipsLoading}
                    disabled={!form.cups.trim() || !sipsConsentimiento || sipsLoading}
                  >
                    <Database className="w-4 h-4" />
                    Consultar SIPS
                  </Button>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sipsConsentimiento}
                    onChange={(e) => setSipsConsentimiento(e.target.checked)}
                    className="rounded border-line focus:ring-0"
                  />
                  Confirmo que el titular me ha autorizado a consultar SIPS
                </label>
                {sipsError && (
                  <div className="px-3 py-2 rounded-md bg-err-container/40 border border-err/20 text-xs text-err">
                    {sipsError}
                  </div>
                )}
              </div>
            </div>

            {/* ─ Datos titular (collapsible) ─ */}
            <details className="rounded-xl border border-line overflow-hidden group">
              <summary className="px-4 py-2.5 bg-bg-2 cursor-pointer flex items-center gap-2 select-none list-none">
                <User className="w-3.5 h-3.5 text-ink-3" />
                <span className="label-mono text-ink-4">Datos del titular</span>
                <span className="text-[10px] text-ink-4 ml-1">(opcional · aparecen en el PDF)</span>
                <ChevronDown className="w-3.5 h-3.5 text-ink-4 ml-auto transition-transform group-open:rotate-180" />
              </summary>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                <Input
                  label="Nombre completo"
                  placeholder="Ej. Juan Pérez García"
                  value={form.titularNombre}
                  onChange={(e) => setField('titularNombre', e.target.value)}
                />
                <Input
                  label="DNI / CIF"
                  placeholder="00000000T"
                  value={form.titularDni}
                  onChange={(e) => setField('titularDni', e.target.value.toUpperCase())}
                  className="font-mono"
                />
                <Input
                  label="Email"
                  type="email"
                  placeholder="cliente@email.com"
                  value={form.titularEmail}
                  onChange={(e) => setField('titularEmail', e.target.value)}
                />
                <Input
                  label="Teléfono"
                  type="tel"
                  placeholder="600 000 000"
                  value={form.titularTelefono}
                  onChange={(e) => setField('titularTelefono', e.target.value)}
                />
              </div>
            </details>

            {/* ─ Alquiler + Total + Botón ─ */}
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 items-end">
              <Input
                label="Alquiler de equipo (€/año)"
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="0"
                value={form.alquiler}
                onChange={(e) => setField('alquiler', e.target.value)}
              />
              {/* Total calculado */}
              <div className={cn(
                'rounded-xl border-2 px-4 py-3 flex items-center justify-between transition-colors',
                totalCalculado > 0 ? 'border-ok/50 bg-ok-container/20' : 'border-line bg-bg-2'
              )}>
                <div>
                  <p className={cn('text-[11px] font-semibold', totalCalculado > 0 ? 'text-ok' : 'text-ink-4')}>
                    TOTAL PAGADO ANUAL
                  </p>
                  <p className="text-[10px] text-ink-4 mt-0.5">
                    Potencia + Energía + Imp. eléctrico 3,8% + Bono Social + IVA {form.ivaPct}%
                  </p>
                </div>
                <p className={cn(
                  'font-sans font-bold text-2xl tabular-nums ml-4',
                  totalCalculado > 0 ? 'text-ok' : 'text-ink-3'
                )}>
                  {totalCalculado > 0 ? fmtEur(totalCalculado) : '—'}
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                variant="ink"
                onClick={onCalcular}
                loading={calcLoading}
                disabled={!formularioValido || calcLoading}
              >
                <Calculator className="w-4 h-4" />
                Calcular comparativa
              </Button>
            </div>
          </div>
        </Card>

        {/* ── Extras opcionales detectados ────────────────────────────────── */}
        {extraccion && extraccion.extrasOpcionales.length > 0 && (
          <ExtrasOpcionalesPanel
            extras={extraccion.extrasOpcionales}
            seleccionados={extrasSeleccionados}
            onToggle={(idx) =>
              setExtrasSeleccionados((prev) => {
                const next = new Set(prev)
                if (next.has(idx)) next.delete(idx)
                else next.add(idx)
                return next
              })
            }
            ahorroAnual={ahorroExtrasAnual}
          />
        )}

        {/* ── Resultados ──────────────────────────────────────────────────── */}
        {result && (
          <Resultados
            result={result}
            ahorroExtrasAnual={ahorroExtrasAnual}
            horizonte={horizonte}
            onDescargarPdf={onDescargarPdf}
            pdfLoading={pdfLoading}
            pdfError={pdfError}
            onExportarExcel={onExportarExcel}
            xlsxLoading={xlsxLoading}
            xlsxError={xlsxError}
          />
        )}
      </div>
    </div>
  )
}

// ── Subcomponentes ───────────────────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-ink-4 label-mono">{label}</p>
      <p className={cn('text-ink-2 truncate', mono && 'font-mono text-[11px]')}>
        {value || '—'}
      </p>
    </div>
  )
}

function PreciosUnitariosExtraidos({ extraccion }: { extraccion: ExtraccionFactura }) {
  const { kwDia, kwh } = extraccion.preciosUnitarios
  const algunoCero =
    kwDia.p1 === 0 || kwh.punta === 0
  return (
    <div className="mt-6 pt-6 border-t border-line">
      <div className="flex items-center justify-between mb-2">
        <p className="label-mono text-ink-4">
          Precios unitarios de la comercializadora actual
        </p>
        {algunoCero && (
          <span className="text-[10px] text-warn font-semibold">
            ⚠ revisa antes de calcular
          </span>
        )}
      </div>
      <p className="text-xs text-ink-3 mb-3">
        Extraídos de la factura. Se usan internamente como referencia; ajústalos si la factura es ambigua.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
        <UnitField label="P1 (€/kW·día)" value={kwDia.p1} digits={6} />
        <UnitField label="P2 (€/kW·día)" value={kwDia.p2} digits={6} />
        <UnitField label="Punta (€/kWh)" value={kwh.punta} digits={6} />
        <UnitField label="Llano (€/kWh)" value={kwh.llano} digits={6} />
        <UnitField label="Valle (€/kWh)" value={kwh.valle} digits={6} />
      </div>
    </div>
  )
}

function UnitField({ label, value, digits }: { label: string; value: number; digits: number }) {
  return (
    <div className="px-2.5 py-1.5 rounded-md bg-bg-2">
      <p className="text-ink-4 text-[10px] label-mono">{label}</p>
      <p className="font-mono tabular-nums text-ink">
        {value > 0 ? value.toFixed(digits) : '—'}
      </p>
    </div>
  )
}

function ExtrasOpcionalesPanel({
  extras,
  seleccionados,
  onToggle,
  ahorroAnual,
}: {
  extras: ExtraOpcional[]
  seleccionados: Set<number>
  onToggle: (idx: number) => void
  ahorroAnual: number
}) {
  return (
    <Card>
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-brand" />
          <p className="text-sm font-semibold text-ink">
            Extras opcionales detectados en la factura
          </p>
        </div>
        <span className="text-xs text-ink-3">
          Al cambiar a Gana, estos servicios desaparecen
        </span>
      </div>
      <div className="space-y-2">
        {extras.map((e, idx) => {
          const checked = seleccionados.has(idx)
          return (
            <label
              key={idx}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                checked
                  ? 'border-brand bg-brand/5'
                  : 'border-line hover:border-line-2',
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(idx)}
                className="rounded border-line focus:ring-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{e.concepto}</p>
                <p className="text-[11px] text-ink-3">
                  {e.importe.toFixed(2)} € en esta factura · ≈ {e.importeMensual.toFixed(2)} €/mes
                </p>
              </div>
              <p className="font-semibold text-ink tabular-nums text-sm">
                {e.importeAnual.toFixed(2)} €/año
              </p>
            </label>
          )
        })}
      </div>
      <div className="mt-4 pt-4 border-t border-line flex items-center justify-between">
        <p className="text-xs text-ink-3">
          Suma de los extras seleccionados (ahorro anual al cambiar)
        </p>
        <p className="font-sans font-bold text-lg text-ok tabular-nums">
          +{ahorroAnual.toFixed(2)} €/año
        </p>
      </div>
    </Card>
  )
}

function Resultados({
  result,
  ahorroExtrasAnual,
  horizonte,
  onDescargarPdf,
  pdfLoading,
  pdfError,
  onExportarExcel,
  xlsxLoading,
  xlsxError,
}: {
  result: ResultadoComparativa
  ahorroExtrasAnual: number
  horizonte: 'mensual' | 'anual'
  onDescargarPdf: () => void
  pdfLoading: boolean
  pdfError: string | null
  onExportarExcel: () => void
  xlsxLoading: boolean
  xlsxError: string | null
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-brand" />
          <p className="text-sm font-semibold text-ink">Resultados</p>
          {horizonte === 'anual' && (
            <span className="text-[10px] label-mono text-ink-4 px-2 py-0.5 rounded bg-bg-2">
              Datos anuales
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onExportarExcel}
            loading={xlsxLoading}
            disabled={xlsxLoading}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Excel
          </Button>
          <Button
            variant="ink"
            size="sm"
            onClick={onDescargarPdf}
            loading={pdfLoading}
            disabled={pdfLoading}
          >
            <Download className="w-4 h-4" />
            Descargar PDF
          </Button>
        </div>
      </div>

      {pdfError && (
        <div className="px-3 py-2 rounded-lg bg-err-container/40 border border-err/30 text-sm text-err">
          {pdfError}
        </div>
      )}
      {xlsxError && (
        <div className="px-3 py-2 rounded-lg bg-err-container/40 border border-err/30 text-sm text-err">
          {xlsxError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {result.resultados.map((r) => (
          <TarifaCard
            key={r.tarifa.id}
            resultado={r}
            esMejor={r.tarifa.id === result.mejorTarifaId}
            facturaActual={result.input.totalFacturaActual}
            ahorroExtrasAnual={ahorroExtrasAnual}
          />
        ))}
      </div>
    </section>
  )
}

function TarifaCard({
  resultado: r,
  esMejor,
  facturaActual,
  ahorroExtrasAnual,
}: {
  resultado: ResultadoTarifa
  esMejor: boolean
  facturaActual: number
  ahorroExtrasAnual: number
}) {
  const [open, setOpen] = useState(false)
  const ahorroPct = facturaActual > 0 ? (r.ahorro / facturaActual) * 100 : 0
  const positivo = r.ahorro > 0
  const ahorroAnualTotal = r.ahorroAnyo + ahorroExtrasAnual

  return (
    <Card className={cn(esMejor && 'border-brand border-l-2 border-l-brand shadow-ambient-sm')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-3.5 h-3.5 text-ink-3" />
            <p className="text-xs label-mono text-ink-4">2.0TD</p>
            {esMejor && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand/10 text-brand">
                <Sparkles className="w-3 h-3" />
                Mejor
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-ink leading-snug">{r.tarifa.nombre}</p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-line">
        <p className="text-xs text-ink-3 font-medium">Total con Gana</p>
        <p className="font-sans font-bold text-2xl text-ink mt-0.5 tabular-nums">
          {fmtEur(r.total)}
        </p>
      </div>

      <div
        className={cn(
          'mt-3 px-3 py-2 rounded-lg',
          positivo ? 'bg-ok-container/50' : 'bg-err-container/40',
        )}
      >
        <p className="text-[11px] text-ink-3 font-medium">Ahorro vs. factura actual</p>
        <p
          className={cn(
            'font-sans font-bold text-base tabular-nums mt-0.5',
            positivo ? 'text-ok' : 'text-err',
          )}
        >
          {positivo ? '+' : ''}
          {fmtEur(r.ahorro)}{' '}
          <span className="text-xs font-semibold opacity-70">
            ({positivo ? '+' : ''}
            {ahorroPct.toFixed(1)} %)
          </span>
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="px-2 py-1.5 rounded-md bg-bg-2">
          <p className="text-ink-4">6 meses</p>
          <p className="font-semibold text-ink tabular-nums">{fmtEur(r.ahorro6Meses)}</p>
        </div>
        <div className="px-2 py-1.5 rounded-md bg-bg-2">
          <p className="text-ink-4">1 año</p>
          <p className="font-semibold text-ink tabular-nums">{fmtEur(r.ahorroAnyo)}</p>
        </div>
      </div>

      {/* Bonus extras */}
      {ahorroExtrasAnual > 0 && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-brand/5 border border-brand/20">
          <p className="text-[11px] text-ink-3 font-medium">+ ahorro al cancelar extras</p>
          <p className="font-sans font-bold text-sm text-brand tabular-nums mt-0.5">
            +{fmtEur(ahorroExtrasAnual)}/año
          </p>
          <div className="mt-1 pt-1 border-t border-brand/20">
            <p className="text-[10px] text-ink-3">Ahorro anual total</p>
            <p className="font-sans font-bold text-base text-ok tabular-nums">
              {fmtEur(ahorroAnualTotal)}
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-3 w-full flex items-center justify-between text-xs text-ink-3 hover:text-ink transition-colors"
      >
        <span>Ver desglose</span>
        <ChevronDown
          className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <Desglose r={r} />}

      <div className="mt-4 pt-3 border-t border-line">
        <Button
          variant="volt"
          size="sm"
          className="w-full"
          disabled
          title="Disponible en Sprint 3"
        >
          <Send className="w-3.5 h-3.5" />
          Tramitar contrato
        </Button>
      </div>
    </Card>
  )
}

function Desglose({ r }: { r: ResultadoTarifa }) {
  return (
    <div className="mt-3 space-y-1 text-xs text-ink-2 font-mono tabular-nums">
      <Row label="Coste potencia P1" value={r.costePotencia.p1} />
      <Row label="Coste potencia P2" value={r.costePotencia.p2} />
      <Row label="Coste energía Punta" value={r.costeEnergia.punta} />
      <Row label="Coste energía Llano" value={r.costeEnergia.llano} />
      <Row label="Coste energía Valle" value={r.costeEnergia.valle} />
      {r.servicioGanaEnergia > 0 && (
        <Row label="Servicio Gana Energía" value={r.servicioGanaEnergia} />
      )}
      <Row label="Bono Social" value={r.bonoSocial} />
      <Row label="Impuesto eléctrico" value={r.impuestoElectrico} />
      <Row label="Subtotal sin IVA" value={r.totalSinIva} bold />
      <Row label="IVA" value={r.iva} />
      {r.alquiler > 0 && <Row label="Alquiler equipo" value={r.alquiler} />}
      {r.descuentoDespuesIva > 0 && (
        <Row label="Descuento" value={-r.descuentoDespuesIva} />
      )}
      <Row label="Total" value={r.total} bold />
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between',
        bold && 'pt-1 mt-1 border-t border-line text-ink font-semibold',
      )}
    >
      <span>{label}</span>
      <span>{fmtEur(value)}</span>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNum(v: string): number {
  if (!v) return 0
  const parsed = parseFloat(v.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function numToStr(n: number): string {
  if (!Number.isFinite(n) || n === 0) return ''
  return String(n)
}

function redondearN(n: number): number {
  return Math.round(n * 100) / 100
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(n)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the "data:...;base64," prefix
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
