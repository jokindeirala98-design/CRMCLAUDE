'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  ArrowLeft, Zap, Building2, MapPin, FileText, CreditCard,
  ChevronRight, CheckCircle2, Circle, Clock, XCircle,
  Upload, ClipboardCheck, BarChart3, Presentation, PenTool,
  UserCheck, TrendingUp, AlertTriangle, Edit2, Trash2,
  RefreshCw, ChevronDown, ChevronUp, Loader2, Activity, ExternalLink, Download,
  Plus, X, Pencil, Check, Flame, Phone as PhoneIcon, Copy, Mail, Scale
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { ClientDetailModal } from '@/components/clients/ClientDetailModal'
import { Card } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { TechnicalAuditModal } from '@/components/modals/TechnicalAuditModal'
import { DataTable } from '@/components/ui/DataTable'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatCurrency } from '@/lib/utils/format'
import { getViewUrl } from '@/lib/utils/storage'
import { normalizeCups } from '@/lib/utils/cups'
import { ensurePendingPrescoring } from '@/lib/ensurePrescoring'
import { downloadClientInvoicesZip, type DownloadProgress } from '@/lib/utils/download-invoices-zip'
import { advanceSupplyPipeline } from '@/lib/supply-pipeline'
import { useAuthStore } from '@/stores/auth'
import type { SupplyStatus } from '@/types/database'
import { generatePropuestaHTML, generateContratoHTML, generateAndDownloadPDF } from '@/lib/voltis-contract-templates'

// ── Lazy-load: solo se descargan al abrir la pestaña/modal correspondiente.
//    Reducen el bundle inicial de la ficha de suministro significativamente.
//    El componente final es idéntico al import estático: misma API, mismas props.
const AnnualEconomics = dynamic(
  () => import('@/components/supply/AnnualEconomics'),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-20 text-ink-3 text-sm">Cargando estudio económico…</div> }
)
const ComparativaVoltis = dynamic(
  () => import('@/components/supply/ComparativaVoltis'),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-20 text-ink-3 text-sm">Cargando comparativa…</div> }
)
const PowerStudy = dynamic(
  () => import('@/components/supply/PowerStudy').then(m => m.PowerStudy),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-20 text-ink-3 text-sm">Cargando estudio de potencias…</div> }
)
const EconomicStudyModal = dynamic(
  () => import('@/components/modals/EconomicStudyModal').then(m => m.EconomicStudyModal),
  { ssr: false }
)
const GasExcelImport = dynamic(
  () => import('@/components/supply/GasExcelImport').then(m => m.GasExcelImport),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-8 text-ink-3 text-sm">Cargando importador…</div> }
)

// ── Voltis contract helpers ───────────────────────────────────────────────────
const SC_MODALITY_LABELS: Record<string, string> = {
  A: 'Pago único al inicio',
  B: 'Trimestral vencido (×4)',
  C: 'Entrada 50% + 4 cuotas',
  D: 'Pago único al vencimiento',
}

function scAddMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function scBuildPaymentSchedule(modality: string, feeAmount: number, startDate: Date) {
  switch (modality) {
    case 'A': return [{ label: 'Pago único', date: startDate, amount: feeAmount }]
    case 'B': { const q = feeAmount / 4; return [1,2,3,4].map(i => ({ label: `Cuota T${i}`, date: scAddMonths(startDate, i*3), amount: q, isPast: scAddMonths(startDate, i*3) < new Date() })) }
    case 'C': { const half = feeAmount / 2; const quarter = half / 4; return [{ label: 'Entrada (50%)', date: startDate, amount: half }, ...[1,2,3,4].map(i => ({ label: `Cuota T${i} (12,5%)`, date: scAddMonths(startDate, i*3), amount: quarter, isPast: scAddMonths(startDate, i*3) < new Date() }))] }
    case 'D': return [{ label: 'Pago único al vencimiento', date: scAddMonths(startDate, 12), amount: feeAmount }]
    default:  return [{ label: 'Pago único', date: startDate, amount: feeAmount }]
  }
}

// Pipeline steps in order
const PIPELINE_STEPS: { key: SupplyStatus; label: string; icon: any }[] = [
  { key: 'primer_contacto', label: 'Contacto', icon: UserCheck },
  { key: 'estudio_en_curso', label: 'Informes', icon: BarChart3 },
  { key: 'estudio_completado', label: 'Inf. Listo', icon: CheckCircle2 },
  { key: 'presentado', label: 'Presentado', icon: Presentation },
  { key: 'pendiente_firma', label: 'Firma', icon: PenTool },
  { key: 'firmado', label: 'Firmado', icon: FileText },
  { key: 'suscrito', label: 'Suscrito', icon: CreditCard },
  { key: 'seguimiento_activo', label: 'Seguimiento', icon: TrendingUp },
]

// Map compound statuses to their pipeline position
function getPipelineIndex(status: string): number {
  const map: Record<string, number> = {
    primer_contacto: 0,
    facturas_recibidas: 1, // legacy — maps to estudio_en_curso position
    estudio_en_curso: 1,
    estudio_completado: 2,
    presentado: 3,
    // Legacy states map to closest step
    prescoring_pendiente: 3,
    prescoring_completado: 3,
    pendiente_firma: 4,
    firmado: 5,
    suscrito: 6,
    seguimiento_activo: 7,
    rechazado: -1,
  }
  return map[status] ?? -1
}

// Next valid transitions
const TRANSITIONS: Record<string, { next: SupplyStatus; label: string }[]> = {
  // Main pipeline flow
  // Prescoring is now automatic — created when invoices are added
  primer_contacto: [{ next: 'estudio_en_curso', label: 'Esperando informes' }],
  facturas_recibidas: [{ next: 'estudio_en_curso', label: 'Esperando informes' }], // legacy
  estudio_en_curso: [], // Admin transitions this via /informes page
  estudio_completado: [{ next: 'presentado', label: 'Marcar como presentado' }],
  presentado: [
    { next: 'pendiente_firma', label: 'Enviar a firma' },
    { next: 'rechazado', label: 'Cliente rechaza' },
  ],
  pendiente_firma: [
    { next: 'firmado', label: 'Contrato firmado' },
    { next: 'rechazado', label: 'Rechazado' },
  ],
  firmado: [{ next: 'suscrito', label: 'Activar suscripcion' }],
  suscrito: [{ next: 'seguimiento_activo', label: 'Iniciar seguimiento' }],
  seguimiento_activo: [],
  rechazado: [{ next: 'primer_contacto', label: 'Reabrir' }],
}

export default function SupplyDetailPage() {
  const { id: rawId } = useParams()
  const id = Array.isArray(rawId) ? rawId[0] : rawId as string
  const router = useRouter()
  const searchParams = useSearchParams()
  const [supply, setSupply] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // Auto-open tab from ?tab= URL param (e.g. from Telegram bot deep links)
  const urlTab = searchParams.get('tab') as 'sips' | 'economics' | 'potencias' | 'comparativa-voltis' | null
  const [activeTab, setActiveTab] = useState<'sips' | 'economics' | 'potencias' | 'comparativa-voltis' | null>(
    ['sips', 'economics', 'potencias', 'comparativa-voltis'].includes(urlTab || '') ? urlTab : null
  )
  const [sipsLoading, setSipsLoading] = useState(false)
  const [sipsError, setSipsError] = useState('')
  const [sipsConnectFailed, setSipsConnectFailed] = useState(false)
  const [sipsTab, setSipsTab] = useState<'consumos' | 'maximetros' | 'reactivas'>('consumos')
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null)
  const [uploadingInvoices, setUploadingInvoices] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, 'uploading' | 'analyzing' | 'done' | 'error'>>({})
  // Voltis invoices (nueva comercializadora contratada vía Voltis: Galp, Axpo, Gana…)
  const [uploadingVoltisInvoices, setUploadingVoltisInvoices] = useState(false)
  const [voltisUploadProgress, setVoltisUploadProgress] = useState<Record<string, 'uploading' | 'analyzing' | 'done' | 'error' | 'wrong-client'>>({})
  const [uploadingStudy, setUploadingStudy] = useState(false)
  const [deletingStudyId, setDeletingStudyId] = useState<string | null>(null)
  const [siblingSupplies, setSiblingSupplies] = useState<any[]>([])
  const [clientModalOpen, setClientModalOpen] = useState(false)
  const [supplyOverlayOpen, setSupplyOverlayOpen] = useState(false)
  const [docsOverlayOpen, setDocsOverlayOpen] = useState(false)
  const [technicalModalOpen, setTechnicalModalOpen] = useState(false)
  const [economicStudyOpen, setEconomicStudyOpen] = useState(false)
  const [powerAdjustForStudyOpen, setPowerAdjustForStudyOpen] = useState(false)
  const [studyAdjustedPowers, setStudyAdjustedPowers] = useState<number[] | null>(null)
  const [studyPowerInputs, setStudyPowerInputs] = useState<Record<string, string>>({})
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [zipProgress, setZipProgress] = useState<DownloadProgress | null>(null)
  const [serviceContracts, setServiceContracts] = useState<any[]>([])
  const invoiceInputRef = useRef<HTMLInputElement>(null)
  const voltisInvoiceInputRef = useRef<HTMLInputElement>(null)
  const studyInputRef = useRef<HTMLInputElement>(null)
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const { user, isAdmin } = useAuthStore()

  // ── Show notification with auto-dismiss ──────────────────────────────────
  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current)
    }
    setNotification({ message, type })
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null)
    }, 4000)
  }

  // ── Download all client invoices as ZIP ──────────────────────────────────
  const handleDownloadInvoicesZip = async () => {
    if (!supply?.client_id || !supply?.client?.name) return
    setZipProgress({ total: 0, downloaded: 0, currentFile: 'Iniciando...', phase: 'fetching' })
    await downloadClientInvoicesZip(
      supply.client_id,
      supply.client.name,
      (progress) => {
        setZipProgress(progress)
        if (progress.phase === 'done') {
          showNotification('Facturas descargadas correctamente')
          setTimeout(() => setZipProgress(null), 2000)
        } else if (progress.phase === 'error') {
          showNotification(progress.error || 'Error al descargar', 'error')
          setTimeout(() => setZipProgress(null), 3000)
        }
      }
    )
  }

  const fetchSupply = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('supplies')
      .select(`
        *,
        client:clients(*),
        comercializadora:comercializadoras(id, name, signing_method),
        contracts(*),
        prescorings:prescorings(*),
        studies:studies(*),
        invoices:invoices(*)
      `)
      .eq('id', id)
      .single()

    setSupply(data)
    setLoading(false)

    // ── Fetch service_contracts (Voltis contracts) for this client ──
    if (data?.client_id) {
      const { data: sc } = await supabase
        .from('service_contracts')
        .select('id, contract_type, proposal_url, contract_url, status, created_at, start_date, end_date, ahorro_confirmado, fee_amount, payment_modality, representative_name, representative_nif, signing_location, subscription_monthly, is_renewal')
        .eq('client_id', data.client_id)
        .order('created_at', { ascending: false })
      setServiceContracts(sc || [])
    }

    // ── Fetch sibling supplies (same client) for the supply switcher ──
    if (data?.client_id) {
      const { data: siblings } = await supabase
        .from('supplies')
        .select('id, name, cups, type, status, tariff')
        .eq('client_id', data.client_id)
        .order('created_at', { ascending: true })
      // Sort: Luz first (6.4→6.1→3.0→2.0), then Gas (RL4→RL3→RL2→RL1) — always highest first
      const supplyPriority = (s: any): number => {
        const t = (s.tariff || '').trim().toUpperCase()
        if (s.type !== 'gas') {
          if (t.startsWith('6.4')) return 164
          if (t.startsWith('6.3')) return 163
          if (t.startsWith('6.2')) return 162
          if (t.startsWith('6.1')) return 161
          if (t.startsWith('6'))   return 160
          if (t.startsWith('3'))   return 140
          if (t.startsWith('2'))   return 120
          return 100
        }
        // Gas: RL4 > RL3 > RL2 > RL1
        if (t.includes('4')) return 84
        if (t.includes('3')) return 83
        if (t.includes('2')) return 82
        if (t.includes('1')) return 81
        return 80
      }
      const sorted = (siblings || []).slice().sort((a, b) => supplyPriority(b) - supplyPriority(a))
      setSiblingSupplies(sorted)
    }

    // ── Auto-refresh SIPS if maxímetros or reactiva are missing (luz only) ──
    // Gas supplies never auto-fetch SIPS — data comes exclusively from Excel import.
    const isGasLoad = data?.type === 'gas' || /^RL/i.test(data?.tariff || '')
    const hasMaximetros = data?.consumption_data?.maximetroHistory?.length > 0
    const hasReactiva = data?.consumption_data?.reactivaHistory?.length > 0
    const studyIsStale = data?.power_study_result && (
      // Old study had no real maxímetros but we now have them
      (!data.power_study_result.hasRealMaximetros && hasMaximetros) ||
      // Study has fewer months than current consumption history
      (data.power_study_result.meses?.length < (data.consumption_data?.history?.length || 0))
    )
    const needsRefresh = !isGasLoad && data && data.cups && (
      !data.consumption_data || !hasMaximetros || !hasReactiva || studyIsStale
    )
    if (needsRefresh) {
      setSipsLoading(true)
      try {
        const sipsEndpoint = '/api/sips'
        const sipsRes = await fetch(sipsEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cups: data.cups }),
        })
        const sipsResult = await sipsRes.json()
        if (sipsResult.success && sipsResult.data) {
          const d = sipsResult.data
          const supabase = createClient()
          const newHistory = d.consumptionHistory?.length > 0
            ? d.consumptionHistory.map((h: any) => ({
                fecha: h.fecha, fechaInicio: h.fechaInicio, fechaFin: h.fechaFin,
                P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6, total: h.total,
              }))
            : (data.consumption_data?.history || [])
          const newMaximetro = (d.maximetroHistory || []).map((h: any) => ({
            fecha: h.fecha, fechaInicio: h.fechaInicio, fechaFin: h.fechaFin,
            P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6,
          }))
          const newReactiva = (d.reactivaHistory || []).map((h: any) => ({
            fecha: h.fecha, fechaInicio: h.fechaInicio, fechaFin: h.fechaFin,
            P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6,
          }))
          const updatedConsumption = {
            ...(data.consumption_data || {}),
            source: 'greening_sips',
            fetched_at: new Date().toISOString(),
            history: newHistory,
            maximetroHistory: newMaximetro,
            reactivaHistory: newReactiva,
            potenciaContratada: d.potenciaContratada || data.consumption_data?.potenciaContratada,
            consumoPeriodos: d.consumoPeriodos || data.consumption_data?.consumoPeriodos,
            total: d.totalConsumption || data.consumption_data?.total,
            totalKwh: d.totalConsumptionKwh || data.consumption_data?.totalKwh,
            sips_tariff: d.tariff || data.consumption_data?.sips_tariff,
            distribuidora: d.distribuidora || data.consumption_data?.distribuidora,
            codigoPostal: d.codigoPostal || data.consumption_data?.codigoPostal,
            provincia: d.provincia || data.consumption_data?.provincia,
            municipio: d.municipio || data.consumption_data?.municipio,
            cnae: d.cnae || data.consumption_data?.cnae,
            tension: d.tension || data.consumption_data?.tension,
            fechaAlta: d.fechaAlta || data.consumption_data?.fechaAlta,
            fechaUltimaLectura: d.fechaUltimaLectura || data.consumption_data?.fechaUltimaLectura,
          }
          await supabase
            .from('supplies')
            .update({ consumption_data: updatedConsumption, updated_at: new Date().toISOString() })
            .eq('id', id)

          // Always regenerate power study with fresh full data
          try {
            const studyRes = await fetch('/api/power-study-auto', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cups: data.cups,
                clientName: data.client?.name,
                potenciaContratada: d.potenciaContratada || data.consumption_data.potenciaContratada,
                consumptionHistory: newHistory,
                maximetroHistory: newMaximetro,
                reactivaHistory: newReactiva,
              }),
            })
            if (studyRes.ok) {
              const studyResult = await studyRes.json()
              await supabase.from('supplies').update({ power_study_result: studyResult }).eq('id', id)
              setSupply((prev: any) => prev ? { ...prev, consumption_data: updatedConsumption, power_study_result: studyResult } : prev)
            } else {
              setSupply((prev: any) => prev ? { ...prev, consumption_data: updatedConsumption } : prev)
            }
          } catch {
            setSupply((prev: any) => prev ? { ...prev, consumption_data: updatedConsumption } : prev)
          }
        }
      } catch (err) {
        console.error('[fetchSupply] Auto SIPS refresh error:', err)
        setSipsConnectFailed(true)
      } finally {
        setSipsLoading(false)
      }
    }

    // ── Auto-generate power study if SIPS data exists but study hasn't been computed yet ──
    if (
      data &&
      !data.power_study_result &&
      data.consumption_data?.potenciaContratada &&
      data.consumption_data?.history?.length > 0
    ) {
      try {
        const studyRes = await fetch('/api/power-study-auto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cups: data.cups,
            clientName: data.client?.name,
            potenciaContratada: data.consumption_data.potenciaContratada,
            consumptionHistory: data.consumption_data.history,
            maximetroHistory: data.consumption_data.maximetroHistory || [],
          }),
        })
        if (studyRes.ok) {
          const studyResult = await studyRes.json()
          await supabase
            .from('supplies')
            .update({ power_study_result: studyResult, updated_at: new Date().toISOString() })
            .eq('id', id)
          // Update local state so the UI re-renders without a full refetch
          setSupply((prev: any) => prev ? { ...prev, power_study_result: studyResult } : prev)
        }
      } catch (err) {
        console.error('[fetchSupply] Auto power study error:', err)
      }
    }
  }, [id])

  useEffect(() => {
    // Ensure the `alias` column exists in `clients` (runs migration if needed, safe to call repeatedly)
    fetch('/api/migrate-client-alias', { method: 'POST' }).catch(() => {})
    fetchSupply()
  }, [fetchSupply])

  // Scroll to #sips-data if the URL hash requests it (from "Ver CONS&POTS" button)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash !== '#sips-data') return
    // Wait until the page has rendered, then scroll
    const timer = setTimeout(() => {
      const el = document.getElementById('sips-data')
      if (el) {
        setActiveTab('sips') // open the SIPS tab
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [supply]) // re-run once supply data loads

  // ── Bulk transition state (used for both 'presentado' cascade and 'firmado' bulk signing) ──
  const [showBulkSign, setShowBulkSign] = useState(false)
  const [bulkSignSelected, setBulkSignSelected] = useState<Set<string>>(new Set())
  const [bulkSigning, setBulkSigning] = useState(false)
  const [pendingTransition, setPendingTransition] = useState<SupplyStatus | null>(null)

  const handleTransition = async (nextStatus: SupplyStatus) => {
    if (updating) return

    // If transitioning to 'presentado' and client has other supplies with completed studies,
    // cascade — mark them all as presentado
    if (nextStatus === 'presentado' && siblingSupplies.length > 1) {
      const eligibleStatuses = new Set(['estudio_completado'])
      const eligibleIds = new Set(
        siblingSupplies
          .filter(s => eligibleStatuses.has(s.status))
          .map(s => s.id)
      )
      if (eligibleIds.size > 0) {
        setBulkSignSelected(eligibleIds)
        setPendingTransition(nextStatus)
        setShowBulkSign(true)
        return
      }
    }

    // If transitioning to 'firmado' and client has other supplies, show bulk sign modal
    if (nextStatus === 'firmado' && siblingSupplies.length > 1) {
      const alreadySigned = new Set(['firmado', 'suscrito', 'seguimiento_activo'])
      const eligibleIds = new Set(
        siblingSupplies
          .filter(s => !alreadySigned.has(s.status))
          .map(s => s.id)
      )
      setBulkSignSelected(eligibleIds)
      setPendingTransition(nextStatus)
      setShowBulkSign(true)
      return
    }

    setUpdating(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('supplies')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) {
        showNotification(`Error: ${error.message}`, 'error')
      } else {
        showNotification(`Estado actualizado a "${nextStatus}"`, 'success')
        // Bidirectional sync: mark related panel notifications as read
        if (nextStatus === 'presentado') {
          await supabase
            .from('notifications')
            .update({ read: true })
            .eq('type', 'estudio_completado')
            .contains('metadata', { supply_id: id })
        }
      }
      await fetchSupply()
    } catch (err: any) {
      showNotification(`Error: ${err.message}`, 'error')
    }
    setUpdating(false)
  }

  const handleBulkSign = async () => {
    if (!pendingTransition) return
    setBulkSigning(true)
    const supabase = createClient()
    const ids = Array.from(bulkSignSelected)
    const targetStatus = pendingTransition
    if (ids.length > 0) {
      for (const supplyId of ids) {
        await supabase
          .from('supplies')
          .update({ status: targetStatus, updated_at: new Date().toISOString() })
          .eq('id', supplyId)
        // Bidirectional sync: mark related notifications as read when transitioning to presentado
        if (targetStatus === 'presentado') {
          await supabase
            .from('notifications')
            .update({ read: true })
            .eq('type', 'estudio_completado')
            .contains('metadata', { supply_id: supplyId })
        }
      }
    }
    showNotification(
      targetStatus === 'presentado'
        ? `${ids.length} suministro(s) marcado(s) como presentado`
        : `${ids.length} suministro(s) firmado(s)`,
      'success'
    )
    setBulkSigning(false)
    setShowBulkSign(false)
    setPendingTransition(null)
    await fetchSupply()
  }

  /** Copy to clipboard and briefly show a "copied" tooltip */
  const copyToClip = (key: string, value: string) => {
    navigator.clipboard.writeText(value)
    setCopiedField(key)
    setTimeout(() => setCopiedField(null), 1200)
  }

  const handleDelete = async () => {
    setShowDeleteConfirm(true)
  }

  const handleConfirmDelete = async () => {
    setDeleting(true)
    try {
      const supabase = createClient()
      await supabase.from('supplies').delete().eq('id', id)
      router.push('/supplies')
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // ── Delete a single invoice ──────────────────────────────────────────────
  const handleDeleteInvoice = async (inv: any) => {
    const periodLabel = inv.period_end ? new Date(inv.period_end).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }) : inv.period_start ? new Date(inv.period_start).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }) : null
    if (!confirm(`¿Eliminar esta factura${periodLabel ? ` (${periodLabel})` : ''}? Se eliminará del suministro y del almacenamiento.`)) return
    setDeletingInvoiceId(inv.id)
    try {
      const supabase = createClient()
      // 1. Delete from Storage if file_url exists
      if (inv.file_url) {
        // Extract storage path from the public URL
        const publicPattern = '/storage/v1/object/public/documents/'
        const idx = inv.file_url.indexOf(publicPattern)
        if (idx !== -1) {
          const storagePath = decodeURIComponent(inv.file_url.substring(idx + publicPattern.length))
          await supabase.storage.from('documents').remove([storagePath])
        }
      }
      // 2. Delete from invoices table
      await supabase.from('invoices').delete().eq('id', inv.id)

      // 3. Check if there are remaining invoices for this supply
      const { data: remainingInvoices, error: countError } = await supabase
        .from('invoices')
        .select('id', { count: 'exact' })
        .eq('supply_id', supply.id)

      if (countError) throw countError

      const remainingCount = remainingInvoices?.length || 0

      // 4. If no invoices left, clear the related fields from supply
      if (remainingCount === 0) {
        await supabase
          .from('supplies')
          .update({
            cups: null,
            sips_data: null,
            address: null,
            tariff: null,
            comercializadora_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', supply.id)

        showNotification('Datos del suministro limpiados al eliminar todas las facturas', 'success')
      }

      // 5. Re-fetch supply to update UI (Documentos + Annual Economics)
      await fetchSupply()
    } catch (err) {
      console.error('Error eliminando factura:', err)
      showNotification('Error al eliminar la factura', 'error')
    } finally {
      setDeletingInvoiceId(null)
    }
  }

  // ── Upload & analyze new invoices ────────────────────────────────────────
  const handleUploadInvoices = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !supply) return
    setUploadingInvoices(true)

    const supabase = createClient()
    const newProgress: Record<string, 'uploading' | 'analyzing' | 'done' | 'error'> = {}

    // ── Multi-page image grouping ────────────────────────────────────────────
    // When a user selects multiple IMAGE files (e.g. 2 photos of a 2-page invoice),
    // send them ALL to Gemini together so the CUPS on page 2 is found when the
    // consumption data is on page 1.
    // PDFs already support multiple pages natively, so each PDF = 1 invoice.
    const fileArray = Array.from(files)
    const isPdf = (f: File) => f.name.toLowerCase().endsWith('.pdf')
    const imageFiles = fileArray.filter(f => !isPdf(f))
    const pdfFiles = fileArray.filter(isPdf)

    // Pre-load existing invoice periods for this supply (for duplicate detection)
    const { data: existingInvoices } = await supabase
      .from('invoices')
      .select('period_start, period_end')
      .eq('supply_id', supply.id)
    // Set of "start|end" strings seen in DB + within this batch
    const seenPeriods = new Set<string>(
      (existingInvoices || [])
        .filter((i: any) => i.period_start && i.period_end)
        .map((i: any) => `${i.period_start}|${i.period_end}`)
    )

    // Group: all images together as one multi-page invoice, each PDF separate
    type InvoiceGroup = { files: File[]; isMultiPage: boolean }
    const groups: InvoiceGroup[] = []
    if (imageFiles.length > 0) groups.push({ files: imageFiles, isMultiPage: imageFiles.length > 1 })
    for (const pdf of pdfFiles) groups.push({ files: [pdf], isMultiPage: false })

    for (const group of groups) {
      // Use the first file's id/path for the main invoice record
      const file = group.files[0]
      const fileId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const ext = file.name.split('.').pop()
      newProgress[fileId] = 'uploading'
      setUploadProgress({ ...newProgress })

      try {
        // 1. Upload primary file to Supabase Storage
        const filePath = `invoices/${Date.now()}/${fileId}.${ext}`
        const { data: storageData, error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, file)
        if (uploadError) throw uploadError

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storageData.path)
        const publicUrl = urlData.publicUrl

        // 2. Analyze with Gemini (all pages in one request for multi-page groups)
        newProgress[fileId] = 'analyzing'
        setUploadProgress({ ...newProgress })

        const fileType = isPdf(file) ? 'pdf' : 'image'

        const readBase64 = (f: File): Promise<string> =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve((reader.result as string).split(',')[1])
            reader.onerror = () => reject(new Error('Error leyendo archivo'))
            reader.readAsDataURL(f)
          })

        const base64 = await readBase64(file)

        // Build extra_pages for additional images in this group
        const extraPages = group.isMultiPage
          ? await Promise.all(group.files.slice(1).map(async (f) => ({
              file_base64: await readBase64(f),
              file_type: 'image',
              file_name: f.name,
            })))
          : undefined

        const analyzeRes = await fetch('/api/analyze-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_base64: base64,
            file_type: fileType,
            file_name: file.name,
            ...(extraPages && extraPages.length > 0 ? { extra_pages: extraPages } : {}),
          }),
        })
        const extractedData = await analyzeRes.json()

        // 2.5 ── STRICT CUPS VALIDATION ─────────────────────────────────────
        // A supply must never mix invoices from different CUPS.
        // Reject any invoice whose extracted CUPS does not match this supply.
        const supplyCupsNorm = normalizeCups(supply.cups)
        const invoiceCupsRaw: string | null =
          extractedData?.cups ??
          extractedData?.economics?.cups ??
          null
        const invoiceCupsNorm = normalizeCups(invoiceCupsRaw)

        if (!supplyCupsNorm) {
          // Supply has no CUPS yet — cannot validate, but still reject to be strict
          await supabase.storage.from('documents').remove([storageData.path]).catch(() => {})
          newProgress[fileId] = 'error'
          setUploadProgress({ ...newProgress })
          showNotification(
            `No se puede validar "${file.name}": este suministro no tiene CUPS asignado.`,
            'error'
          )
          continue
        }

        if (!invoiceCupsNorm) {
          await supabase.storage.from('documents').remove([storageData.path]).catch(() => {})
          newProgress[fileId] = 'error'
          setUploadProgress({ ...newProgress })
          showNotification(
            `Factura rechazada: no se pudo extraer un CUPS válido de "${file.name}".`,
            'error'
          )
          continue
        }

        if (invoiceCupsNorm !== supplyCupsNorm) {
          // Count character-level differences (Hamming distance)
          let cupsDiffs = Infinity
          if (invoiceCupsNorm && supplyCupsNorm && invoiceCupsNorm.length === supplyCupsNorm.length) {
            cupsDiffs = 0
            for (let i = 0; i < invoiceCupsNorm.length; i++) {
              if (invoiceCupsNorm[i] !== supplyCupsNorm[i]) cupsDiffs++
            }
          }

          // Safety guard: supply-point segment (chars 6–17, 12 chars) must match
          // exactly. Only distributor code (2–5) and control letters (18–19) may
          // differ — those are the positions where OCR errors occur.
          const supplyPointMatches =
            invoiceCupsNorm.length >= 18 && supplyCupsNorm.length >= 18
              ? invoiceCupsNorm.slice(6, 18) === supplyCupsNorm.slice(6, 18)
              : true  // short strings — fall through to char-diff gate

          if (cupsDiffs <= 2 && supplyPointMatches) {
            // ≤ 2 differences AND supply-point segment identical →
            // OCR/AI error in distributor code or control letters. Accept.
            console.log(
              `[SupplyPage] Fuzzy CUPS match: invoice "${invoiceCupsNorm}" accepted for supply "${supplyCupsNorm}" (${cupsDiffs} char diff${cupsDiffs !== 1 ? 's' : ''}, supply-point segment identical — OCR tolerance)`,
            )
          } else {
            // Supply-point differs or > 2 total diffs → genuinely different supply — reject.
            await supabase.storage.from('documents').remove([storageData.path]).catch(() => {})
            newProgress[fileId] = 'error'
            setUploadProgress({ ...newProgress })
            showNotification(
              `Factura rechazada: el CUPS de "${file.name}" (${invoiceCupsNorm}) no coincide con este suministro (${supplyCupsNorm}). Comprueba que es la factura correcta.`,
              'error'
            )
            continue
          }
        }

        // 3. Compute period dates and total from extracted data
        const eco = extractedData?.economics
        const toIso = (s?: string) => {
          if (!s) return null
          const d = new Date(s)
          return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
        }
        const periodStart = eco?.fechaInicio
          ? toIso(eco.fechaInicio)
          : toIso(extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[0])
        const periodEnd = eco?.fechaFin
          ? toIso(eco.fechaFin)
          : toIso(extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[1])
        const totalAmount = eco?.totalFactura
          ? eco.totalFactura
          : extractedData?.total_amount ? parseFloat(extractedData.total_amount) : null

        // 4. Duplicate check — same billing period already in this supply?
        if (periodStart && periodEnd) {
          const periodKey = `${periodStart}|${periodEnd}`
          if (seenPeriods.has(periodKey)) {
            // Clean up the file we just uploaded — we don't need it
            await supabase.storage.from('documents').remove([storageData.path]).catch(() => {})
            newProgress[fileId] = 'error'
            setUploadProgress({ ...newProgress })
            showNotification(
              `Factura duplicada: ya existe una factura para el periodo ${periodStart} – ${periodEnd} en este suministro.`,
              'error'
            )
            continue
          }
          // Mark this period as seen so later files in this same batch are also rejected
          seenPeriods.add(periodKey)
        }

        // 5. Insert invoice row
        await supabase.from('invoices').insert({
          supply_id: supply.id,
          file_url: publicUrl,
          file_type: fileType,
          extracted_data: extractedData,
          extraction_status: extractedData?.mode === 'gemini' ? 'completed' : 'pending',
          period_start: periodStart,
          period_end: periodEnd,
          total_amount: totalAmount,
        })

        // 6. Auto-fill missing client fields from invoice extraction
        if (supply.client?.id && extractedData) {
          const holderName = (extractedData.holder_name || '').trim()
          const holderCifNif = (extractedData.holder_cif_nif || '').trim().toUpperCase()
          const fiscalAddr = (extractedData.fiscal_address || extractedData.supply_address || '').trim()

          const { data: currentClient } = await supabase
            .from('clients')
            .select('id, name, cif, nif, cif_nif, fiscal_address')
            .eq('id', supply.client.id)
            .single()

          if (currentClient) {
            const patch: Record<string, any> = {}
            if (!currentClient.name && holderName) patch.name = holderName
            if (!currentClient.fiscal_address && fiscalAddr) patch.fiscal_address = fiscalAddr
            if (holderCifNif) {
              // CIF starts with letter, NIF is 8 digits + letter
              const isCif = /^[A-HJNP-SUVW]\d{7}[0-9A-J]$/.test(holderCifNif)
              if (isCif && !currentClient.cif) patch.cif = holderCifNif
              if (!isCif && !currentClient.nif) patch.nif = holderCifNif
              if (!currentClient.cif_nif) patch.cif_nif = holderCifNif
            }
            if (Object.keys(patch).length > 0) {
              await supabase.from('clients').update(patch).eq('id', supply.client.id)
            }
          }
        }

        newProgress[fileId] = 'done'
        setUploadProgress({ ...newProgress })
      } catch (err: any) {
        console.error('Error uploading invoice:', err)
        newProgress[fileId] = 'error'
        setUploadProgress({ ...newProgress })
      }
    }

    // Reset file input
    if (invoiceInputRef.current) invoiceInputRef.current.value = ''

    // Ensure prescoring row exists and is fully populated from invoice data.
    // updateNulls: true means if a row already exists, we patch any missing fields.
    const sb = createClient()
    await ensurePendingPrescoring(sb, supply.id, { userId: user?.id, updateNulls: true })

    // Auto-advance pipeline: if supply is in early stages, move to estudio_en_curso
    await advanceSupplyPipeline({
      supabase: sb,
      supplyId: supply.id,
      event: 'invoices_added',
      currentStatus: supply.status,
      userId: user?.id,
    })

    // Re-fetch supply to update everything
    await fetchSupply()
    setUploadingInvoices(false)
    setUploadProgress({})
  }

  // ── Upload Voltis invoices (nueva comercializadora) ──────────────────────
  // Acepta facturas de cualquier CUPS del cliente. Para cada factura:
  //   1. Sube a Storage
  //   2. Extrae datos con Gemini
  //   3. Busca el supply correcto del cliente por CUPS (puede ser este o un sibling)
  //   4. Inserta la invoice con source='voltis' en el supply correspondiente
  //   5. Si el CUPS no pertenece a ningún supply del cliente → error
  const handleUploadVoltisInvoices = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !supply?.client?.id) return
    setUploadingVoltisInvoices(true)

    const supabase = createClient()
    const newProgress: Record<string, 'uploading' | 'analyzing' | 'done' | 'error' | 'wrong-client'> = {}

    // Precargar todos los suministros del cliente con su CUPS
    const { data: clientSupplies } = await supabase
      .from('supplies')
      .select('id, cups, tariff, type')
      .eq('client_id', supply.client.id)

    const cupsToSupplyId = new Map<string, string>()
    for (const s of (clientSupplies || []) as any[]) {
      const c = normalizeCups(s.cups)
      if (c) cupsToSupplyId.set(c, s.id)
    }

    // Cada PDF = 1 factura. Las imágenes se procesan individualmente aquí
    // (asumimos que la factura Voltis viene en PDF, que es lo normal en B2B).
    const fileArray = Array.from(files)

    let movedCount = 0
    let errorCount = 0

    for (const file of fileArray) {
      const fileId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const ext = file.name.split('.').pop()
      const isPdf = file.name.toLowerCase().endsWith('.pdf')
      newProgress[fileId] = 'uploading'
      setVoltisUploadProgress({ ...newProgress })

      try {
        // 1. Subir a Storage
        const filePath = `invoices-voltis/${Date.now()}/${fileId}.${ext}`
        const { data: storageData, error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, file)
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storageData.path)
        const publicUrl = urlData.publicUrl

        // 2. Analizar con Gemini
        newProgress[fileId] = 'analyzing'
        setVoltisUploadProgress({ ...newProgress })

        const readBase64 = (f: File): Promise<string> =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve((reader.result as string).split(',')[1])
            reader.onerror = () => reject(new Error('Error leyendo archivo'))
            reader.readAsDataURL(f)
          })
        const base64 = await readBase64(file)
        const fileType = isPdf ? 'pdf' : 'image'

        const analyzeRes = await fetch('/api/analyze-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_base64: base64, file_type: fileType, file_name: file.name }),
        })
        const extractedData = await analyzeRes.json()

        // 3. Identificar CUPS y mapear al supply correcto del cliente
        const invoiceCupsRaw: string | null =
          extractedData?.cups ?? extractedData?.economics?.cups ?? null
        const invoiceCupsNorm = normalizeCups(invoiceCupsRaw)

        if (!invoiceCupsNorm) {
          await supabase.storage.from('documents').remove([storageData.path]).catch(() => {})
          newProgress[fileId] = 'error'
          setVoltisUploadProgress({ ...newProgress })
          showNotification(`No se pudo extraer un CUPS válido de "${file.name}".`, 'error')
          errorCount++
          continue
        }

        let targetSupplyId = cupsToSupplyId.get(invoiceCupsNorm) || null
        // Tolerancia: matcheo por bloque central (caracteres 6-17) como en upload normal
        if (!targetSupplyId) {
          for (const [c, sid] of cupsToSupplyId.entries()) {
            if (c.length >= 18 && invoiceCupsNorm.length >= 18 && c.slice(6, 18) === invoiceCupsNorm.slice(6, 18)) {
              targetSupplyId = sid
              break
            }
          }
        }

        if (!targetSupplyId) {
          // ⚠️ NO eliminamos el archivo de Storage: queda persistido por si el
          //    usuario quiere crear el supply correspondiente y reasignarlo.
          //    Tampoco creamos un cliente nuevo silenciosamente (UNICE TOYS vs
          //    UNICE TOYS SL): asumimos que el cliente ya existe.
          newProgress[fileId] = 'wrong-client'
          setVoltisUploadProgress({ ...newProgress })
          const cupsType = /^ES02\d/.test(invoiceCupsNorm) ? 'gas' : 'luz'
          showNotification(
            `⚠️ El CUPS ${invoiceCupsNorm} (${cupsType}) de "${file.name}" no tiene suministro en este cliente. Crea primero el suministro de ${cupsType} y vuelve a subir la factura.`,
            'error'
          )
          errorCount++
          continue
        }

        // 4. Datos de periodo y total
        const eco = extractedData?.economics
        const toIso = (s?: string) => {
          if (!s) return null
          const d = new Date(s)
          return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
        }
        const periodStart = eco?.fechaInicio
          ? toIso(eco.fechaInicio)
          : toIso(extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[0])
        const periodEnd = eco?.fechaFin
          ? toIso(eco.fechaFin)
          : toIso(extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[1])
        const totalAmount = eco?.totalFactura
          ? eco.totalFactura
          : extractedData?.total_amount ? parseFloat(extractedData.total_amount) : null

        // 5. Deduplicación: si ya existe esa pareja (start,end,source='voltis') en el supply, saltar
        if (periodStart && periodEnd) {
          const { data: existing } = await supabase
            .from('invoices')
            .select('id')
            .eq('supply_id', targetSupplyId)
            .eq('source', 'voltis')
            .eq('period_start', periodStart)
            .eq('period_end', periodEnd)
            .limit(1)
          if (existing && existing.length > 0) {
            await supabase.storage.from('documents').remove([storageData.path]).catch(() => {})
            newProgress[fileId] = 'error'
            setVoltisUploadProgress({ ...newProgress })
            showNotification(
              `Factura Voltis duplicada: ya existe ${periodStart} – ${periodEnd}.`,
              'error'
            )
            errorCount++
            continue
          }
        }

        // 6. Insertar invoice marcada como Voltis
        await supabase.from('invoices').insert({
          supply_id: targetSupplyId,
          file_url: publicUrl,
          file_type: fileType,
          extracted_data: extractedData,
          extraction_status: extractedData?.mode === 'gemini' ? 'completed' : 'pending',
          period_start: periodStart,
          period_end: periodEnd,
          total_amount: totalAmount,
          source: 'voltis',
          voltis_uploaded_at: new Date().toISOString(),
        })

        if (targetSupplyId !== supply.id) movedCount++

        newProgress[fileId] = 'done'
        setVoltisUploadProgress({ ...newProgress })
      } catch (err: any) {
        console.error('Error uploading Voltis invoice:', err)
        newProgress[fileId] = 'error'
        setVoltisUploadProgress({ ...newProgress })
        errorCount++
      }
    }

    if (voltisInvoiceInputRef.current) voltisInvoiceInputRef.current.value = ''

    if (movedCount > 0) {
      showNotification(
        `${movedCount} factura${movedCount > 1 ? 's' : ''} asignada${movedCount > 1 ? 's' : ''} automáticamente a otros suministros del cliente.`,
        'success'
      )
    }

    await fetchSupply()
    setUploadingVoltisInvoices(false)
    // Mantener mensajes 4s y limpiar
    setTimeout(() => setVoltisUploadProgress({}), 4000)
  }

  // ── Upload economic study (PDF/Excel) ────────────────────────────────────
  const handleUploadStudy = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !supply || !user) return
    setUploadingStudy(true)

    try {
      const supabase = createClient()

      // 1. Upload file to Storage (pass contentType so PDFs aren't rejected)
      // Sanitize filename: remove accents, replace spaces/special chars with underscores
      const safeFileName = file.name
        .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
        .replace(/[^a-zA-Z0-9.\-_]/g, '_')                 // replace anything else
      const filePath = `reports/${supply.id}/${Date.now()}_${safeFileName}`
      const contentType = file.type || (
        file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' :
        file.name.toLowerCase().endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
        file.name.toLowerCase().endsWith('.xls') ? 'application/vnd.ms-excel' :
        'application/octet-stream'
      )
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, { contentType })
      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath)
      const reportUrl = urlData.publicUrl

      // 2. Create study record
      const { error: studyError } = await supabase.from('studies').insert({
        supply_id: supply.id,
        type: 'economico',
        report_url: reportUrl,
        status: 'completed',
        created_by: user.id,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      if (studyError) throw studyError

      // 3. Re-fetch supply immediately so the new study appears in the UI
      await fetchSupply()
      showNotification('Comparativa subida correctamente', 'success')

      // 4. Try to advance pipeline + notify commercial (non-fatal — don't block UI)
      try {
        await advanceSupplyPipeline({
          supabase,
          supplyId: supply.id,
          event: 'report_uploaded',
          userId: user?.id,
        })

        if (supply.client?.id) {
          const { data: clientData } = await supabase
            .from('clients')
            .select('commercial_id, name')
            .eq('id', supply.client.id)
            .single()

          if (clientData?.commercial_id) {
            await fetch('/api/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: clientData.commercial_id,
                type: 'estudio_completado',
                title: 'Informe listo',
                message: `El informe económico de ${clientData.name} (${supply.cups || 'sin CUPS'}) ya está disponible.`,
                link: `/supplies/${supply.id}`,
                metadata: {
                  report_url: reportUrl,
                  client_name: clientData.name,
                  cups: supply.cups,
                  supply_id: supply.id,
                },
              }),
            })
          }
        }
      } catch (pipelineErr) {
        console.error('Pipeline advance failed (non-fatal):', pipelineErr)
      }
    } catch (err: any) {
      console.error('Error subiendo estudio económico:', err)
      showNotification(
        `Error al subir el archivo: ${err?.message ?? 'Error desconocido'}`,
        'error'
      )
    } finally {
      setUploadingStudy(false)
      if (studyInputRef.current) studyInputRef.current.value = ''
    }
  }

  // ── Delete economic study ────────────────────────────────────────────────
  const handleDeleteStudy = async (study: any) => {
    if (!confirm('¿Eliminar este informe económico?')) return
    setDeletingStudyId(study.id)
    try {
      const supabase = createClient()
      // Delete file from storage
      if (study.report_url) {
        const publicPattern = '/storage/v1/object/public/documents/'
        const idx = study.report_url.indexOf(publicPattern)
        if (idx !== -1) {
          const storagePath = decodeURIComponent(study.report_url.substring(idx + publicPattern.length))
          await supabase.storage.from('documents').remove([storagePath])
        }
      }
      // Delete study record
      await supabase.from('studies').delete().eq('id', study.id)

      // Pipeline: revert status if it was just completed
      await advanceSupplyPipeline({
        supabase,
        supplyId: supply.id,
        event: 'report_deleted',
        userId: user?.id,
      })

      // Re-fetch
      await fetchSupply()
    } catch (err) {
      console.error('Error eliminando estudio:', err)
    } finally {
      setDeletingStudyId(null)
    }
  }

  const handleDownloadPowerStudyPDF = async () => {
    if (!supply?.power_study_result) return
    try {
      const res = await fetch('/api/power-study-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supply.power_study_result),
      })
      if (!res.ok) return
      const html = await res.text()
      const w = window.open('', '_blank')
      if (!w) return
      w.document.write(html)
      w.document.close()
    } catch (err) {
      console.error('Error generando PDF:', err)
    }
  }

  const handleFetchSips = async () => {
    if (!supply?.cups || sipsLoading) return
    // Gas supplies get their data exclusively from Excel import — never from SIPS
    if (supply.type === 'gas' || /^RL/i.test(supply.tariff || '')) return
    setSipsLoading(true)
    setSipsError('')
    setSipsConnectFailed(false)
    try {
      const res = await fetch('/api/sips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cups: supply.cups }),
      })
      const result = await res.json()
      if (result.success && result.data) {
        const d = result.data
        // Save full SIPS data to DB
        const supabase = createClient()
        await supabase
          .from('supplies')
          .update({
            consumption_data: {
              source: 'greening_sips',
              fetched_at: new Date().toISOString(),
              total: d.totalConsumption,
              totalKwh: d.totalConsumptionKwh,
              sips_tariff: d.tariff,
              consumoPeriodos: d.consumoPeriodos,
              potenciaContratada: d.potenciaContratada,
              history: (d.consumptionHistory || []).map((h: any) => ({
                fecha: h.fecha,
                fechaInicio: h.fechaInicio,
                fechaFin: h.fechaFin,
                P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6,
                total: h.total,
              })),
              maximetroHistory: (d.maximetroHistory || []).map((h: any) => ({
                fecha: h.fecha,
                fechaInicio: h.fechaInicio,
                fechaFin: h.fechaFin,
                P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6,
              })),
              reactivaHistory: (d.reactivaHistory || []).map((h: any) => ({
                fecha: h.fecha,
                fechaInicio: h.fechaInicio,
                fechaFin: h.fechaFin,
                P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6,
              })),
              distribuidora: d.distribuidora,
              codigoPostal: d.codigoPostal,
              provincia: d.provincia,
              municipio: d.municipio,
              cnae: d.cnae,
              tension: d.tension,
              fechaAlta: d.fechaAlta,
              fechaUltimaLectura: d.fechaUltimaLectura,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', supply.id)

        // Auto-generate power study from SIPS data
        if (d.consumptionHistory?.length > 0 && d.potenciaContratada) {
          try {
            const studyRes = await fetch('/api/power-study-auto', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cups: supply.cups,
                clientName: supply.client?.name,
                potenciaContratada: d.potenciaContratada,
                consumptionHistory: d.consumptionHistory,
                maximetroHistory: d.maximetroHistory || [],
              }),
            })
            if (studyRes.ok) {
              const studyResult = await studyRes.json()
              await createClient()
                .from('supplies')
                .update({ power_study_result: studyResult })
                .eq('id', supply.id)
            }
          } catch (err) {
            console.error('Auto power study error:', err)
          }
        }

        // Auto-transition to estudio_en_curso if in early stages
        const earlyStatuses = ['primer_contacto', 'facturas_recibidas'] // facturas_recibidas kept for legacy DB records
        if (earlyStatuses.includes(supply.status)) {
          await createClient()
            .from('supplies')
            .update({ status: 'estudio_en_curso', updated_at: new Date().toISOString() })
            .eq('id', supply.id)
        }

        setSipsConnectFailed(false)
        await fetchSupply()
      } else {
        setSipsError(result.error || 'No se encontraron datos SIPS')
        setSipsConnectFailed(true)
      }
    } catch (err: any) {
      setSipsError(err.message || 'Error consultando SIPS')
      setSipsConnectFailed(true)
    } finally {
      setSipsLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (!supply) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <AlertTriangle className="w-12 h-12 text-warn" />
        <p className="text-ink-3">Suministro no encontrado</p>
        <Button variant="secondary" onClick={() => router.push('/supplies')}>
          Volver a suministros
        </Button>
      </div>
    )
  }

  const currentIndex = getPipelineIndex(supply.status)
  const isRejected = supply.status === 'rechazado'
  const transitions = TRANSITIONS[supply.status] || []
  const isGasSupply = supply.type === 'gas' || /^RL/i.test(supply.tariff || '')

  return (
    <div>
      <Header
        title={supply.name || supply.cups || 'Sin CUPS'}
        subtitle={
          supply.name
            ? supply.cups || ''
            : `${supply.client?.name || 'Sin cliente'} · ${supply.type?.toUpperCase()}`
        }
        subtitleMono={!!supply.name}
        onTitleSave={async (newValue) => {
          const supabase = createClient()
          const trimmed = newValue.trim() || null
          await supabase.from('supplies').update({ name: trimmed }).eq('id', id)
          setSupply((prev: any) => ({ ...prev, name: trimmed }))
          setSiblingSupplies(prev =>
            prev.map(s => (s.id === id ? { ...s, name: trimmed } : s))
          )
        }}
        titleEditPlaceholder={supply.cups || 'Nombre del suministro'}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => router.back()}>
              <ArrowLeft className="w-4 h-4" />
              Volver
            </Button>
            <Button variant="tertiary" onClick={handleDelete} disabled={deleting}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      <div className="px-4 lg:px-8 pb-24 lg:pb-8 space-y-6">
        {/* ═══════ PIPELINE STEPPER ═══════ */}
        <Card className="overflow-hidden">
          <div className="p-4">
            <h3 className="text-sm font-semibold text-ink-3 mb-4 uppercase tracking-wider">
              Pipeline del suministro
            </h3>

            {isRejected && (
              <div className="flex items-center gap-3 mb-4 p-3 bg-err-container/30 rounded-xl">
                <XCircle className="w-5 h-5 text-err flex-shrink-0" />
                <p className="text-sm font-medium text-err">
                  Este suministro ha sido rechazado. Puedes reabrirlo desde las acciones.
                </p>
              </div>
            )}

            {/* MOBILE: Compact progress bar + current step */}
            <div className="lg:hidden">
              {/* Progress bar — clickable steps */}
              <div className="flex gap-1 mb-3">
                {PIPELINE_STEPS.map((step, index) => {
                  const isCompleted = !isRejected && currentIndex > index
                  const isCurrent = !isRejected && currentIndex === index
                  return (
                    <button
                      key={step.key}
                      onClick={() => handleTransition(step.key)}
                      disabled={updating || isCurrent}
                      title={step.label}
                      className={`h-2.5 flex-1 rounded-full transition-all hover:opacity-80 active:scale-95 disabled:cursor-default ${
                        isCompleted
                          ? 'bg-ok'
                          : isCurrent
                          ? 'bg-brand'
                          : 'bg-bg-2 hover:bg-ink-3/30'
                      }`}
                    />
                  )
                })}
              </div>

              {/* Current step detail */}
              {!isRejected && PIPELINE_STEPS[currentIndex] && (() => {
                const CurrentIcon = PIPELINE_STEPS[currentIndex].icon
                return (
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand text-white flex items-center justify-center flex-shrink-0">
                      <CurrentIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ink">{PIPELINE_STEPS[currentIndex].label}</p>
                      <p className="text-xs text-ink-3">
                        Paso {currentIndex + 1} de {PIPELINE_STEPS.length}
                      </p>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* DESKTOP: Full horizontal stepper — all steps clickable */}
            <div className="hidden lg:flex items-center gap-0 overflow-x-auto pb-2">
              {PIPELINE_STEPS.map((step, index) => {
                const Icon = step.icon
                const isCompleted = !isRejected && currentIndex > index
                const isCurrent = !isRejected && currentIndex === index

                return (
                  <div key={step.key} className="flex items-center flex-shrink-0">
                    <button
                      onClick={() => handleTransition(step.key)}
                      disabled={updating || isCurrent}
                      className="flex flex-col items-center gap-1.5 group disabled:cursor-default"
                      title={`Cambiar a: ${step.label}`}
                    >
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                          isCompleted
                            ? 'bg-ok text-white group-hover:ring-2 group-hover:ring-success/30'
                            : isCurrent
                            ? 'bg-brand text-white ring-4 ring-primary/20'
                            : 'bg-bg-2 text-ink-3 group-hover:bg-primary/20 group-hover:text-brand group-hover:ring-2 group-hover:ring-primary/20'
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : isCurrent ? (
                          <Icon className="w-4 h-4" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 group-hover:hidden" />
                        )}
                        {!isCompleted && !isCurrent && (
                          <Icon className="w-3.5 h-3.5 hidden group-hover:block" />
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-medium whitespace-nowrap transition-colors ${
                          isCurrent
                            ? 'text-brand font-bold'
                            : isCompleted
                            ? 'text-ok'
                            : 'text-ink-3 group-hover:text-brand'
                        }`}
                      >
                        {step.label}
                      </span>
                    </button>
                    {index < PIPELINE_STEPS.length - 1 && (
                      <div
                        className={`w-10 h-0.5 mx-1 flex-shrink-0 ${
                          isCompleted ? 'bg-ok' : 'bg-bg-2'
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </Card>

        {/* ═══════ ACTIONS ═══════ */}
        {transitions.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {transitions.map((t) => (
              <Button
                key={t.next}
                variant={t.next === 'rechazado' ? 'secondary' : 'primary'}
                onClick={() => handleTransition(t.next)}
                disabled={updating}
              >
                {t.next === 'rechazado' ? (
                  <XCircle className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                {t.label}
              </Button>
            ))}
          </div>
        )}

        {/* ═══════ INFO CARDS ═══════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Datos del suministro ── */}
          <Card
            className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition group"
            onClick={() => { if (siblingSupplies.length > 1) setSupplyOverlayOpen(true) }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink-3 uppercase tracking-wider">
                Datos del suministro
              </h3>
              {siblingSupplies.length > 1 && (
                <span className="text-[10px] text-brand font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  Ver todos <ChevronRight className="w-3 h-3" />
                </span>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 group/cups">
                <Zap className="w-4 h-4 text-brand flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-ink-3">CUPS</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono font-medium text-ink truncate">{supply.cups || 'Sin CUPS'}</p>
                    {supply.cups && (
                      <button
                        onClick={(e) => { e.stopPropagation(); copyToClip('cups_main', supply.cups) }}
                        className="p-1 rounded-md text-ink-3/30 hover:text-brand hover:bg-primary/10 transition-all opacity-0 group-hover/cups:opacity-100 flex-shrink-0"
                        title="Copiar CUPS"
                      >
                        {copiedField === 'cups_main'
                          ? <Check className="w-3.5 h-3.5 text-ok" />
                          : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-brand flex-shrink-0" />
                <div>
                  <p className="text-xs text-ink-3">Tipo / Tarifa</p>
                  <p className="text-sm text-ink capitalize">
                    {supply.type} · <Badge variant="info">{supply.tariff}</Badge>
                  </p>
                </div>
              </div>
              {supply.address && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-brand flex-shrink-0" />
                  <div>
                    <p className="text-xs text-ink-3">Direccion</p>
                    <p className="text-sm text-ink">{supply.address}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-brand flex-shrink-0" />
                <div>
                  <p className="text-xs text-ink-3">Estado actual</p>
                  <StatusBadge status={supply.status} />
                </div>
              </div>
            </div>

            {/* CUPS chips for sibling supplies */}
            {siblingSupplies.length > 1 && (
              <div className="pt-3 mt-3 border-t border-line-2-variant/10">
                <div className="space-y-2 mb-2">
                  {(() => {
                    // Group chips by tariff label (supplies already sorted by priority)
                    const groups: { label: string; items: typeof siblingSupplies }[] = []
                    for (const s of siblingSupplies) {
                      const label = s.tariff?.trim() || (s.type === 'gas' ? 'Gas' : 'Luz')
                      const last = groups[groups.length - 1]
                      if (last && last.label === label) last.items.push(s)
                      else groups.push({ label, items: [s] })
                    }
                    return groups.map(({ label, items }) => (
                      <div key={label}>
                        <p className="text-[8px] font-mono font-bold text-ink-4 tracking-widest uppercase mb-1">
                          {label} <span className="opacity-50">({items.length})</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {items.map((s) => {
                            const isCurrent = s.id === id
                            return (
                              <button
                                key={s.id}
                                onClick={(e) => { e.stopPropagation(); if (!isCurrent) router.push(`/supplies/${s.id}`) }}
                                className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold transition-colors ${
                                  isCurrent
                                    ? 'bg-primary/15 text-brand ring-1 ring-primary/30'
                                    : 'bg-bg-2 text-ink-3 hover:bg-primary/10 hover:text-brand'
                                }`}
                                title={s.cups || 'Sin CUPS'}
                              >
                                {s.name || (s.cups ? `…${s.cups.slice(-4)}` : '?')}
                                {isCurrent && ' ✓'}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
                <div className="flex flex-wrap gap-1.5">

                  {/* ─── Estudio económico comparativo ─── */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const maxiHist: any[] = supply?.consumption_data?.maximetroHistory || []
                      const potContr: any = supply?.consumption_data?.potenciaContratada || {}
                      const periods = ['P1','P2','P3','P4','P5','P6']
                      const hasDeviation = periods.some(p => {
                        const contracted = Number(potContr[p]) || 0
                        if (contracted <= 0) return false
                        const vals = maxiHist.map((h: any) => Number(h[p]) || 0).filter(v => v > 0)
                        if (!vals.length) return false
                        const avg = vals.reduce((s: number, v: number) => s + v, 0) / vals.length
                        return Math.abs(avg - contracted) / contracted > 0.15
                      })
                      if (hasDeviation && !studyAdjustedPowers) {
                        const inputs: Record<string, string> = {}
                        periods.forEach(p => { const v = Number(potContr[p]); if (v > 0) inputs[p] = String(v) })
                        setStudyPowerInputs(inputs)
                        setPowerAdjustForStudyOpen(true)
                      } else {
                        setEconomicStudyOpen(true)
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-0.5 rounded-md text-[11px] font-bold bg-ok/10 text-ok hover:bg-ok hover:text-white transition-all shadow-sm border border-ok/20"
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    Estudio económico
                  </button>

                  {/* ─── Trigger for Supply Report (Ayuntamientos) ─── */}
                  {supply?.client?.type === 'ayuntamiento' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setTechnicalModalOpen(true) }}
                      className="flex items-center gap-1.5 px-3 py-0.5 rounded-md text-[11px] font-bold bg-brand text-white hover:bg-brand-container hover:text-brand transition-all shadow-sm"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      Estudios de Suministro
                    </button>
                  )}

                  {/* ─── Estudio económico global del cliente ─── */}
                  {supply?.client?.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/clients/${supply.client.id}/economic-overview`)
                      }}
                      className="flex items-center gap-1.5 px-3 py-0.5 rounded-md text-[11px] font-bold bg-volt/30 text-volt-ink hover:bg-volt hover:text-volt-ink transition-all shadow-sm border border-volt/40"
                      title="Estudio económico global de todos los suministros del cliente"
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                      Estudio anual global
                    </button>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* ── Cliente preview — click opens full modal ── */}
          <Card
            className={supply.client ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 transition group' : ''}
            onClick={supply.client ? () => setClientModalOpen(true) : undefined}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink-3 uppercase tracking-wider">
                Cliente
              </h3>
              {supply.client && (
                <span className="text-[10px] text-brand font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  Ver ficha completa <ChevronRight className="w-3 h-3" />
                </span>
              )}
            </div>
            {supply.client ? (
              <div className="space-y-2">
                {/* Name row — shows alias prominently if set, real name as subtag */}
                <div className="flex items-start gap-2.5 group/row">
                  <Building2 className="w-4 h-4 text-ink-3/60 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-ink truncate block">
                      {supply.client.alias || supply.client.name}
                    </span>
                    {supply.client.alias && (
                      <span className="text-[10px] text-ink-3/50 truncate block">
                        {supply.client.name}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); copyToClip('cl_name', supply.client.alias || supply.client.name) }}
                    className="p-1 rounded-md text-ink-3/30 hover:text-brand hover:bg-primary/10 transition-all opacity-0 group-hover/row:opacity-100 flex-shrink-0"
                    title="Copiar nombre"
                  >
                    {copiedField === 'cl_name' ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Other fields */}
                {([
                  { key: 'cl_id', label: supply.client.cif ? 'CIF' : 'NIF', value: supply.client.cif || supply.client.nif || supply.client.cif_nif, icon: FileText },
                  { key: 'cl_phone', label: 'Teléfono', value: supply.client.phone, icon: PhoneIcon },
                  { key: 'cl_email', label: 'Email', value: supply.client.email, icon: Mail },
                  { key: 'cl_addr', label: 'Dir. fiscal', value: supply.client.fiscal_address, icon: MapPin },
                ] as const).map((f) => (
                  <div key={f.key} className="flex items-center gap-2.5 group/row">
                    <f.icon className="w-4 h-4 text-ink-3/60 flex-shrink-0" />
                    <span className="flex-1 text-sm text-ink truncate">
                      {f.value || <span className="text-ink-3/40 italic text-xs">—</span>}
                    </span>
                    {f.value && (
                      <button
                        onClick={(e) => { e.stopPropagation(); copyToClip(f.key, String(f.value)) }}
                        className="p-1 rounded-md text-ink-3/30 hover:text-brand hover:bg-primary/10 transition-all opacity-0 group-hover/row:opacity-100 flex-shrink-0"
                        title="Copiar"
                      >
                        {copiedField === f.key
                          ? <Check className="w-3.5 h-3.5 text-ok" />
                          : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-3">Sin cliente asignado</p>
            )}
          </Card>

          {/* Documents — compact preview, click opens full overlay */}
          <Card
            className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition group flex flex-col gap-0"
            onClick={() => setDocsOverlayOpen(true)}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink-3 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Documentos
              </h3>
              <span className="text-[10px] text-brand font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                Abrir gestor <ChevronRight className="w-3 h-3" />
              </span>
            </div>

            {/* Compact summary counts */}
            <div className="space-y-2">
              {/* Facturas */}
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${(supply.invoices?.length || 0) > 0 ? 'bg-info-container/400' : 'bg-gray-300'}`} />
                <span className="text-xs text-ink flex-1">Facturas</span>
                <span className="text-xs font-semibold text-ink-3">{supply.invoices?.length || 0}</span>
              </div>
              {/* Informes */}
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${supply.power_study_result || supply.studies?.some((s: any) => s.status === 'completed') ? 'bg-ok-container/400' : 'bg-gray-300'}`} />
                <span className="text-xs text-ink flex-1">Informes</span>
                <span className="text-xs font-semibold text-ink-3">
                  {(supply.power_study_result ? 1 : 0) + (supply.studies?.filter((s: any) => s.status === 'completed').length || 0)}
                </span>
              </div>
              {/* Contratos */}
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${(supply.contracts?.length || 0) > 0 ? 'bg-info-container/400' : 'bg-gray-300'}`} />
                <span className="text-xs text-ink flex-1">Contratos</span>
                <span className="text-xs font-semibold text-ink-3">{supply.contracts?.length || 0}</span>
              </div>
            </div>

            {/* Comercializadora pill */}
            {supply.comercializadora && (
              <div className="flex items-center gap-2 mt-3 px-2 py-1.5 bg-bg-2 rounded-lg">
                <Building2 className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
                <p className="text-xs font-semibold text-ink truncate">{supply.comercializadora.name}</p>
              </div>
            )}
          </Card>

          {/* Hidden file inputs (need to be outside overlay for stability) */}
          <input ref={studyInputRef} type="file" accept=".pdf,.xlsx,.xls" className="hidden" onChange={handleUploadStudy} />
          <input ref={invoiceInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple className="hidden" onChange={handleUploadInvoices} />
          <input ref={voltisInvoiceInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple className="hidden" onChange={handleUploadVoltisInvoices} />
        </div>

        {/* ═══════ SECTION TAB BUTTONS ═══════ */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {([
            {
              key: 'sips' as const,
              label: isGasSupply ? 'DATOS GAS' : 'DATOS SIPS',
              icon: isGasSupply ? Flame : Activity,
              activeClass: 'border-info/30 bg-info-container/40 text-info shadow-md',
              inactiveClass: 'border-line-2-variant/30 bg-white text-ink hover:border-info/30 hover:bg-info-container/40',
              dot: supply.consumption_data ? 'bg-info-container/400' : 'bg-gray-300',
            },
            {
              key: 'economics' as const,
              label: 'ANUAL ECONOMICS',
              icon: TrendingUp,
              activeClass: 'border-ok/30 bg-ok-container/40 text-ok shadow-md',
              inactiveClass: 'border-line-2-variant/30 bg-white text-ink hover:border-ok/30 hover:bg-ok-container/40',
              dot: (supply.invoices?.some((inv: any) => inv.extracted_data?.economics)) ? 'bg-ok-container/400'
                : (supply.invoices?.length > 0) ? 'bg-warn' : 'bg-ink-4',
            },
            {
              key: 'potencias' as const,
              label: 'POTENCIAS Y CONSUMOS',
              icon: BarChart3,
              activeClass: 'border-warn/30 bg-warn-container/40 text-warn shadow-md',
              inactiveClass: 'border-line-2-variant/30 bg-white text-ink hover:border-warn/30 hover:bg-warn-container/40',
              dot: supply.power_study_result ? 'bg-warn-container/400' : 'bg-gray-300',
            },
            {
              key: 'comparativa-voltis' as const,
              label: 'COMPARATIVA VOLTIS',
              icon: Scale,
              activeClass: 'border-brand/40 bg-volt/30 text-brand shadow-md',
              inactiveClass: 'border-line-2-variant/30 bg-white text-ink hover:border-brand/40 hover:bg-volt/20',
              dot: supply.invoices?.some((inv: any) => inv.source === 'voltis')
                ? 'bg-volt' : 'bg-gray-300',
            },
          ]).filter(tab => {
            // Hide POTENCIAS Y CONSUMOS for gas supplies
            if (tab.key === 'potencias' && (supply.type === 'gas' || /^RL/i.test(supply.tariff || ''))) return false
            // Hide COMPARATIVA VOLTIS unless there's at least one Voltis invoice
            if (tab.key === 'comparativa-voltis' && !supply.invoices?.some((inv: any) => inv.source === 'voltis')) return false
            return true
          }).map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(isActive ? null : tab.key)}
                className={`relative flex flex-col items-center gap-2 px-3 py-4 rounded-2xl border-2 transition-all ${isActive ? tab.activeClass : tab.inactiveClass}`}
              >
                <span className={`absolute top-2.5 right-2.5 w-2 h-2 rounded-full ${tab.dot}`} />
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-bold tracking-wide text-center leading-tight">{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* ═══════ DATOS SIPS / GAS panel ═══════ */}
        {activeTab === 'sips' && supply.cups && (
          <div id="sips-data" className="scroll-mt-4">
            <Card className="overflow-hidden">
              <div className="p-4 space-y-5">

                {/* ── Gas supply: Excel import zone + data display ── */}
                {isGasSupply ? (
                  <>
                  <GasExcelImport
                    supplyId={supply.id}
                    cups={supply.cups}
                    existingData={supply.consumption_data}
                    onImported={(newData) => {
                      setSupply((prev: any) => prev ? { ...prev, consumption_data: newData } : prev)
                    }}
                  />

                  {/* Gas data display (like electricity SIPS) */}
                  {supply.consumption_data && (supply.consumption_data.totalKwh > 0 || (supply.consumption_data.gasHistory?.length > 0)) && (() => {
                    const cd = supply.consumption_data
                    const gasHistory: any[] = cd.gasHistory || []
                    const totalKwh = cd.totalKwh || 0
                    const fmtKwh = (n: number) => n > 0 ? `${Math.round(n).toLocaleString('es-ES')} kWh` : '-'
                    const fmtD = (s: string) => {
                      try { return new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) }
                      catch { return s?.slice(0, 10) || '' }
                    }
                    return (
                      <div className="space-y-4 mt-2">
                        {/* Summary cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="bg-bg-2 rounded-xl p-3">
                            <p className="text-xs text-ink-3">Consumo Anual</p>
                            <p className="text-lg font-bold text-ink mt-0.5">{fmtKwh(totalKwh)}</p>
                          </div>
                          <div className="bg-bg-2 rounded-xl p-3">
                            <p className="text-xs text-ink-3">Tarifa</p>
                            <p className="text-lg font-bold text-ink mt-0.5">{cd.sips_tariff || '-'}</p>
                          </div>
                          <div className="bg-bg-2 rounded-xl p-3">
                            <p className="text-xs text-ink-3">Distribuidora</p>
                            <p className="text-xs font-medium text-ink mt-1 leading-tight">{cd.distribuidora || '-'}</p>
                          </div>
                          <div className="bg-bg-2 rounded-xl p-3">
                            <p className="text-xs text-ink-3">Última lectura</p>
                            <p className="text-sm font-bold text-ink mt-0.5">
                              {cd.fecha_lectura ? fmtD(cd.fecha_lectura) : cd.fetched_at ? fmtD(cd.fetched_at) : '-'}
                            </p>
                          </div>
                        </div>

                        {/* Address info */}
                        {(cd.address || cd.municipio) && (
                          <div className="bg-bg-2 rounded-xl p-3 flex gap-4 flex-wrap">
                            {cd.address && (
                              <div>
                                <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">Dirección</p>
                                <p className="text-xs font-medium text-ink mt-0.5">{cd.address}</p>
                              </div>
                            )}
                            {cd.municipio && (
                              <div>
                                <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">Municipio</p>
                                <p className="text-xs font-medium text-ink mt-0.5">{[cd.municipio, cd.provincia].filter(Boolean).join(', ')}</p>
                              </div>
                            )}
                            {cd.cnae && (
                              <div>
                                <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">CNAE</p>
                                <p className="text-xs font-medium text-ink mt-0.5">{cd.cnae}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Monthly history table */}
                        {gasHistory.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">
                              Historial de consumos ({gasHistory.length} períodos)
                            </h4>
                            <div className="rounded-xl border border-line-2-variant/30 overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-bg-2 border-b border-line-2-variant/20">
                                    <th className="text-left px-3 py-2 text-ink-3 font-semibold">Inicio</th>
                                    <th className="text-left px-3 py-2 text-ink-3 font-semibold">Fin</th>
                                    <th className="text-right px-3 py-2 text-ink-3 font-semibold">Consumo (kWh)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...gasHistory].reverse().map((p: any, i: number) => (
                                    <tr key={i} className={`border-b border-line-2-variant/10 ${i % 2 === 0 ? '' : 'bg-bg-2/50'}`}>
                                      <td className="px-3 py-2 text-ink-3">{p.fechaInicio ? fmtD(p.fechaInicio) : '-'}</td>
                                      <td className="px-3 py-2 text-ink-3">{p.fechaFin ? fmtD(p.fechaFin) : '-'}</td>
                                      <td className="px-3 py-2 text-right font-semibold text-ink">
                                        {p.kwh > 0 ? Math.round(p.kwh).toLocaleString('es-ES') : '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="bg-bg-2 border-t border-line-2-variant/30">
                                    <td colSpan={2} className="px-3 py-2 font-bold text-ink">Total anual estimado</td>
                                    <td className="px-3 py-2 text-right font-bold text-brand">{fmtKwh(totalKwh)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  </>
                ) : (
                <>

                {/* Fetch / Refresh + last update */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={handleFetchSips} disabled={sipsLoading} loading={sipsLoading}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    {supply.consumption_data ? 'Actualizar datos SIPS' : 'Consultar SIPS'}
                  </Button>
                  {sipsError && (
                    <div className="flex flex-col gap-2 mt-2">
                      <span className="text-xs text-err">{sipsError}</span>
                      <p className="text-xs text-ink-3">No se pudo conectar con la distribuidora. Puedes subir el Excel de la distribuidora manualmente:</p>
                      <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-warn-container/40 text-warn border border-warn/30 rounded-lg hover:bg-warn-container transition-colors w-fit">
                        <FileText className="w-3.5 h-3.5" />
                        Subir Excel distribuidora
                        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const reader = new FileReader()
                          reader.onload = async (ev) => {
                            const base64 = (ev.target?.result as string).split(',')[1]
                            const res = await fetch('/api/parse-excel-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_base64: base64 }) })
                            const result = await res.json()
                            if (result.cups && result.invoices) {
                              setSipsError('')
                              alert(`Excel procesado: ${result.invoices.length} facturas encontradas para CUPS ${result.cups}`)
                            }
                          }
                          reader.readAsDataURL(file)
                        }} />
                      </label>
                    </div>
                  )}
                  {supply.consumption_data?.fetched_at && (
                    <span className="text-xs text-ink-3 ml-auto">
                      Actualizado: {formatDate(supply.consumption_data.fetched_at)}
                    </span>
                  )}
                </div>

                {/* Prescoring status pill */}
                {supply.prescorings && supply.prescorings.length > 0 && (() => {
                  const latest = [...supply.prescorings].sort(
                    (a: any, b: any) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime()
                  )[0]
                  const cfg: Record<string, { bg: string; text: string; label: string }> = {
                    pending:  { bg: 'bg-warn-container/40 border-warn/30',  text: 'text-warn',  label: 'Pendiente' },
                    sent:     { bg: 'bg-info-container/40 border-info/30',    text: 'text-info',   label: 'Enviado'   },
                    approved: { bg: 'bg-ok-container/40 border-ok/30',  text: 'text-ok',  label: 'Aprobado'  },
                    rejected: { bg: 'bg-err-container/40 border-err/30',      text: 'text-err',    label: 'Rechazado' },
                  }
                  const c = cfg[latest.status] || cfg.pending
                  return (
                    <div className={`rounded-xl border px-3 py-2 flex items-center gap-2 ${c.bg}`}>
                      <ClipboardCheck className={`w-4 h-4 ${c.text} flex-shrink-0`} />
                      <p className="text-xs font-semibold text-ink">
                        Prescoring: <span className={c.text}>{c.label}</span>
                      </p>
                      {latest.requested_at && (
                        <span className="text-[10px] text-ink-3 ml-auto">{formatDate(latest.requested_at)}</span>
                      )}
                    </div>
                  )
                })()}

                {/* SIPS connection failed — show Consumo Anual in red to distinguish from genuinely 0 consumption */}
                {sipsConnectFailed && !supply.consumption_data && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-err-container/20 border border-err/30 rounded-xl p-3">
                      <p className="text-xs text-err font-medium">Consumo Anual</p>
                      <p className="text-lg font-bold text-err mt-0.5">Sin conexión SIPS</p>
                    </div>
                  </div>
                )}

                {supply.consumption_data && (supply.consumption_data.history || supply.consumption_data.consumoPeriodos) && (
                  <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="bg-bg-2 rounded-xl p-3">
                        <p className="text-xs text-ink-3">Consumo Anual</p>
                        <p className="text-lg font-bold text-ink mt-0.5">
                          {(() => {
                            const cp2 = supply.consumption_data.consumoPeriodos || {}
                            const pSum = (Number(cp2.P1)||0)+(Number(cp2.P2)||0)+(Number(cp2.P3)||0)+(Number(cp2.P4)||0)+(Number(cp2.P5)||0)+(Number(cp2.P6)||0)
                            const kwh = pSum > 0 ? pSum : (supply.consumption_data.totalKwh || 0)
                            return kwh > 0 ? `${Math.round(kwh).toLocaleString('es-ES')} kWh` : '-'
                          })()}
                        </p>
                      </div>
                      <div className="bg-bg-2 rounded-xl p-3">
                        <p className="text-xs text-ink-3">Tarifa SIPS</p>
                        <p className="text-lg font-bold text-ink mt-0.5">
                          {supply.consumption_data.sips_tariff || supply.tariff || '-'}
                        </p>
                      </div>
                      <div className="bg-bg-2 rounded-xl p-3">
                        <p className="text-xs text-ink-3">Distribuidora</p>
                        <p className="text-xs font-medium text-ink mt-1 leading-tight">
                          {supply.consumption_data.distribuidora || '-'}
                        </p>
                      </div>
                      <div className="bg-bg-2 rounded-xl p-3">
                        <p className="text-xs text-ink-3">Tensión</p>
                        <p className="text-lg font-bold text-ink mt-0.5">
                          {supply.consumption_data.tension ? `${supply.consumption_data.tension} V` : '-'}
                        </p>
                      </div>
                    </div>

                    {/* Potencia Contratada & Consumo Anual Aggregated */}
                    {(supply.consumption_data.potenciaContratada || supply.consumption_data.consumoPeriodos) && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {supply.consumption_data.potenciaContratada && (
                          <div>
                            <h4 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">
                              Potencia Contratada (kW)
                            </h4>
                            <div className="grid grid-cols-6 gap-2">
                              {(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const).map((label, i) => (
                                <div key={label} className="bg-bg-2 rounded-lg p-2 text-center">
                                  <p className="text-[10px] font-semibold" style={{ color: ['#0ea5e9', '#334155', '#f97316', '#06b6d4', '#ec4899', '#eab308'][i] }}>{label}</p>
                                  <p className="text-sm font-bold text-ink">
                                    {supply.consumption_data.potenciaContratada[label]?.toLocaleString() || '-'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {supply.consumption_data.consumoPeriodos && (
                          <div>
                            <h4 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">
                              Consumo Anual por Periodo (kWh)
                            </h4>
                            <div className="grid grid-cols-6 gap-2">
                              {(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const).map((label, i) => (
                                <div key={label} className="bg-bg-2 rounded-lg p-2 text-center">
                                  <p className="text-[10px] font-semibold" style={{ color: ['#0ea5e9', '#334155', '#f97316', '#06b6d4', '#ec4899', '#eab308'][i] }}>{label}</p>
                                  <p className="text-sm font-bold text-ink">
                                    {supply.consumption_data.consumoPeriodos[label]?.toLocaleString() || '-'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Sub-tab switcher (consumos / maximetros / reactivas) ── */}
                    {(() => {
                      const isLuz = supply.type === 'luz'
                      const hasReactivas = (supply.consumption_data.reactivaHistory?.length > 0) ||
                        (supply.power_study_result?.hasRelevantReactiva && (supply.power_study_result?.meses || []).some((m: any) => m.reactiva))
                      const tabs = [
                        { key: 'consumos', label: 'Consumos (kWh)' },
                        ...(isLuz ? [{ key: 'maximetros', label: 'Maxímetros (kW)' }] : []),
                        ...(hasReactivas ? [{ key: 'reactivas', label: 'Reactiva (kvarh)' }] : []),
                      ] as { key: typeof sipsTab; label: string }[]
                      return (
                        <div className="flex gap-0 border-b border-line-2-variant/20 -mt-1">
                          {tabs.map((tab) => (
                            <button key={tab.key} type="button" onClick={() => setSipsTab(tab.key)}
                              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                                sipsTab === tab.key
                                  ? 'border-brand text-brand'
                                  : 'border-transparent text-ink-3 hover:text-ink'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      )
                    })()}

                    {/* ── CONSUMOS sub-tab ── */}
                    {sipsTab === 'consumos' && (() => {
                      const history: any[] = supply.consumption_data.history || []
                      if (history.length === 0) return null
                      const P_COLORS = ['#0ea5e9', '#334155', '#f97316', '#06b6d4', '#ec4899', '#eab308']
                      const fmtD = (s: string) => {
                        try { return new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) }
                        catch { return s?.slice(0, 10) || '' }
                      }
                      const byYear = new Map<number, { idx: number; total: number }[]>()
                      history.forEach((p: any, i: number) => {
                        const yr = new Date(p.fechaInicio || p.fecha).getFullYear()
                        if (!byYear.has(yr)) byYear.set(yr, [])
                        byYear.get(yr)!.push({ idx: i, total: p.total || 0 })
                      })
                      const topIdx = new Set<number>()
                      byYear.forEach(entries => {
                        entries.sort((a, b) => b.total - a.total)
                        entries.slice(0, 3).forEach(e => topIdx.add(e.idx))
                      })
                      return (
                        <div className="overflow-x-auto rounded-xl border border-line-2-variant/20">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="bg-bg-2">
                                <th className="text-left py-1 px-2 font-semibold text-ink-3 whitespace-nowrap">Inicio</th>
                                <th className="text-left py-1 px-2 font-semibold text-ink-3 whitespace-nowrap">Fin</th>
                                {['P1','P2','P3','P4','P5','P6'].map((p, i) => (
                                  <th key={p} className="text-right py-1 px-1.5 font-semibold whitespace-nowrap" style={{ color: P_COLORS[i] }}>{p}</th>
                                ))}
                                <th className="text-right py-1 px-2 font-bold text-ink whitespace-nowrap">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {history.map((p: any, i: number) => {
                                const isTop = topIdx.has(i)
                                const rowCls = isTop ? 'border-t border-line-2-variant/10 bg-err-container/40' : 'border-t border-line-2-variant/10 hover:bg-bg-2/40'
                                const textCls = isTop ? 'text-err font-semibold' : 'text-ink-3'
                                return (
                                  <tr key={i} className={rowCls}>
                                    <td className={`py-0.5 px-2 whitespace-nowrap ${isTop ? 'text-err font-semibold' : 'text-ink'}`}>{fmtD(p.fechaInicio || p.fecha)}</td>
                                    <td className={`py-0.5 px-2 whitespace-nowrap ${textCls}`}>{fmtD(p.fechaFin || '')}</td>
                                    {['P1','P2','P3','P4','P5','P6'].map(k => (
                                      <td key={k} className={`py-0.5 px-1.5 text-right ${textCls}`}>{p[k] ? p[k].toLocaleString() : '-'}</td>
                                    ))}
                                    <td className={`py-0.5 px-2 text-right ${isTop ? 'text-err font-bold' : 'text-ink font-bold'}`}>{p.total?.toLocaleString() || '-'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                            {history.length > 1 && (
                              <tfoot>
                                <tr className="border-t-2 border-line-2-variant/30 bg-bg-2 font-bold">
                                  <td className="py-1 px-2 text-ink text-[10px]" colSpan={2}>TOTAL</td>
                                  {['P1','P2','P3','P4','P5','P6','total'].map(key => (
                                    <td key={key} className="py-1 px-1.5 text-right text-ink text-[10px]">
                                      {history.reduce((s: number, p: any) => s + (p[key] || 0), 0).toLocaleString()}
                                    </td>
                                  ))}
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      )
                    })()}

                    {/* ── MAXÍMETROS sub-tab ── */}
                    {sipsTab === 'maximetros' && (() => {
                      const maxHist: any[] = supply.consumption_data.maximetroHistory || []
                      const potencia = supply.consumption_data.potenciaContratada
                      if (maxHist.length === 0) return (
                        <div className="text-center py-8 text-ink-3 text-sm">
                          {sipsLoading
                            ? <p>Obteniendo datos de maxímetros de SIPS...</p>
                            : <p>No hay datos de maxímetros disponibles.<br/><span className="text-xs mt-1 block">Pulsa "Actualizar datos SIPS" para intentar obtenerlos.</span></p>
                          }
                        </div>
                      )
                      const P_COLORS = ['#0ea5e9', '#334155', '#f97316', '#06b6d4', '#ec4899', '#eab308']
                      const PERIODS = ['P1','P2','P3','P4','P5','P6'] as const
                      const cellStyle = (val: number, p: string) => {
                        const cont = potencia?.[p] ?? 0
                        if (!cont || !val) return { cls: 'text-ink-3' }
                        const r = val / cont
                        if (r >= 1.15) return { cls: 'text-err font-bold' }
                        if (r >= 1.00) return { cls: 'text-warn font-semibold' }
                        if (r >= 0.90) return { cls: 'text-yellow-700' }
                        return { cls: 'text-ok' }
                      }
                      return (
                        <div className="space-y-4">
                          {potencia && (
                            <div className="grid grid-cols-6 gap-2">
                              {PERIODS.map((p, i) => {
                                const cont = potencia[p] ?? 0
                                const maxVal = Math.max(...maxHist.map((h: any) => h[p] ?? 0))
                                const r = cont > 0 && maxVal > 0 ? maxVal / cont : null
                                const bg = r === null ? 'bg-bg-2 text-ink'
                                  : r >= 1.15 ? 'bg-err-container text-err'
                                  : r >= 1.00 ? 'bg-warn-container text-warn'
                                  : r >= 0.90 ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-ok-container text-ok'
                                return (
                                  <div key={p} className={`rounded-xl p-2 text-center ${bg}`}>
                                    <p className="text-[10px] font-semibold" style={{ color: P_COLORS[i] }}>{p}</p>
                                    <p className="text-sm font-bold">{maxVal > 0 ? maxVal.toFixed(1) : '-'}</p>
                                    {cont > 0 && <p className="text-[9px] opacity-60">/ {cont} kW</p>}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          <div className="overflow-x-auto rounded-xl border border-line-2-variant/20">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-bg-2">
                                  <th className="text-left py-2 px-3 font-semibold text-ink-3 whitespace-nowrap">Fecha inicio</th>
                                  <th className="text-left py-2 px-3 font-semibold text-ink-3 whitespace-nowrap">Fecha fin</th>
                                  {PERIODS.map((p, i) => (
                                    <th key={p} className="text-right py-2 px-2 font-semibold whitespace-nowrap" style={{ color: P_COLORS[i] }}>
                                      {p} <span className="font-normal opacity-60 text-[9px]">kW</span>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {maxHist.map((h: any, i: number) => {
                                  const startDate = new Date(h.fecha)
                                  let endDate: Date
                                  if (i < maxHist.length - 1) {
                                    endDate = new Date(maxHist[i + 1].fecha)
                                    endDate.setDate(endDate.getDate() - 1)
                                  } else {
                                    endDate = new Date(startDate)
                                    endDate.setMonth(endDate.getMonth() + 2)
                                    endDate.setDate(endDate.getDate() - 1)
                                  }
                                  const fmtD2 = (d: Date) => d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
                                  return (
                                    <tr key={i} className="border-t border-line-2-variant/10 hover:bg-bg-2/50 transition-colors">
                                      <td className="py-1.5 px-3 text-ink font-medium whitespace-nowrap">{fmtD2(startDate)}</td>
                                      <td className="py-1.5 px-3 text-ink-3 whitespace-nowrap">{fmtD2(endDate)}</td>
                                      {PERIODS.map(p => {
                                        const val = h[p] ?? 0
                                        const { cls } = cellStyle(val, p)
                                        return (
                                          <td key={p} className={`py-1.5 px-2 text-right ${cls}`}>
                                            {val > 0 ? val.toFixed(1) : '-'}
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  )
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-line-2-variant/30 bg-bg-2 font-bold">
                                  <td className="py-2 px-3 text-ink" colSpan={2}>MÁX</td>
                                  {PERIODS.map(p => {
                                    const maxVal = Math.max(...maxHist.map((h: any) => h[p] ?? 0))
                                    const { cls } = cellStyle(maxVal, p)
                                    return (
                                      <td key={p} className={`py-2 px-2 text-right ${cls}`}>
                                        {maxVal > 0 ? maxVal.toFixed(1) : '-'}
                                      </td>
                                    )
                                  })}
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                          {potencia && (
                            <p className="text-[10px] text-ink-3">
                              Semáforo: <span className="text-ok font-medium">&lt;90%</span> · <span className="text-yellow-700 font-medium">90–100%</span> · <span className="text-warn font-medium">100–115%</span> · <span className="text-err font-medium">≥115%</span> de la potencia contratada
                            </p>
                          )}
                        </div>
                      )
                    })()}

                    {/* ── REACTIVA sub-tab ── */}
                    {sipsTab === 'reactivas' && (() => {
                      const reactivaHist: any[] = supply.consumption_data.reactivaHistory?.length > 0
                        ? supply.consumption_data.reactivaHistory
                        : (supply.power_study_result?.meses || [])
                            .filter((m: any) => m.reactiva)
                            .map((m: any) => ({ fecha: m.fechaFin, fechaInicio: m.fechaInicio, fechaFin: m.fechaFin, ...m.reactiva }))
                      if (reactivaHist.length === 0) return (
                        <div className="text-center py-8 text-ink-3 text-sm">
                          {sipsLoading
                            ? <p>Obteniendo datos de reactiva de SIPS...</p>
                            : <p>No hay datos de reactiva disponibles.<br/><span className="text-xs mt-1 block">Pulsa "Actualizar datos SIPS" para intentar obtenerlos.</span></p>
                          }
                        </div>
                      )
                      const PERIODS2 = ['P1','P2','P3','P4','P5','P6'] as const
                      const P_COLORS2 = ['#0ea5e9', '#334155', '#f97316', '#06b6d4', '#ec4899', '#eab308']
                      const THRESHOLD = 1000
                      const fmtD3 = (d: string) => { try { return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return d?.slice(0, 10) || '' } }
                      return (
                        <div className="space-y-3">
                          <p className="text-[10px] text-ink-3">
                            Energía reactiva desde SIPS. Umbral de penalización: <span className="font-semibold text-warn">&gt; {THRESHOLD.toLocaleString()} kvarh</span>.
                          </p>
                          <div className="overflow-x-auto rounded-xl border border-line-2-variant/20">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-bg-2">
                                  <th className="text-left py-2 px-3 font-semibold text-ink-3 whitespace-nowrap">Fecha inicio</th>
                                  <th className="text-left py-2 px-3 font-semibold text-ink-3 whitespace-nowrap">Fecha fin</th>
                                  {PERIODS2.map((p, i) => (
                                    <th key={p} className="text-right py-2 px-2 font-semibold whitespace-nowrap" style={{ color: P_COLORS2[i] }}>
                                      {p} <span className="font-normal opacity-60 text-[9px]">kvarh</span>
                                    </th>
                                  ))}
                                  <th className="text-right py-2 px-3 font-bold text-ink whitespace-nowrap">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reactivaHist.map((h: any, i: number) => {
                                  const rowTotal = PERIODS2.reduce((s, p) => s + (h[p] || 0), 0)
                                  const hasOver = PERIODS2.some(p => (h[p] || 0) > THRESHOLD)
                                  return (
                                    <tr key={i} className={`border-t border-line-2-variant/10 transition-colors ${hasOver ? 'bg-orange-50/50' : 'hover:bg-bg-2/50'}`}>
                                      <td className="py-1.5 px-3 text-ink font-medium whitespace-nowrap">{fmtD3(h.fechaInicio || h.fecha)}</td>
                                      <td className="py-1.5 px-3 text-ink-3 whitespace-nowrap">{fmtD3(h.fechaFin || h.fecha)}</td>
                                      {PERIODS2.map(p => {
                                        const val = h[p] || 0
                                        return (
                                          <td key={p} className={`py-1.5 px-2 text-right ${val > THRESHOLD ? 'text-warn font-semibold' : 'text-ink-3'}`}>
                                            {val > 0 ? val.toLocaleString() : '-'}
                                          </td>
                                        )
                                      })}
                                      <td className={`py-1.5 px-3 text-right font-bold ${hasOver ? 'text-warn' : 'text-ink'}`}>
                                        {rowTotal > 0 ? rowTotal.toLocaleString() : '-'}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-line-2-variant/30 bg-bg-2 font-bold">
                                  <td className="py-2 px-3 text-ink" colSpan={2}>TOTAL</td>
                                  {PERIODS2.map(p => {
                                    const total = reactivaHist.reduce((s, h) => s + (h[p] || 0), 0)
                                    return (
                                      <td key={p} className={`py-2 px-2 text-right ${total > THRESHOLD * reactivaHist.length / 12 ? 'text-warn' : 'text-ink'}`}>
                                        {total > 0 ? total.toLocaleString() : '-'}
                                      </td>
                                    )
                                  })}
                                  <td className="py-2 px-3 text-right text-ink">
                                    {reactivaHist.reduce((s, h) => s + PERIODS2.reduce((ps, p) => ps + (h[p] || 0), 0), 0).toLocaleString()}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Extra info row */}
                    {(supply.consumption_data.codigoPostal || supply.consumption_data.fechaAlta || supply.consumption_data.cnae) && (
                      <div className="flex flex-wrap gap-4 text-xs text-ink-3 pt-2 border-t border-line-2-variant/10">
                        {supply.consumption_data.codigoPostal && <span>CP: {supply.consumption_data.codigoPostal}</span>}
                        {supply.consumption_data.municipio && <span>Municipio: {supply.consumption_data.municipio}</span>}
                        {supply.consumption_data.provincia && <span>Provincia: {supply.consumption_data.provincia}</span>}
                        {supply.consumption_data.cnae && <span>CNAE: {supply.consumption_data.cnae}</span>}
                        {supply.consumption_data.fechaAlta && <span>Alta: {new Date(supply.consumption_data.fechaAlta).toLocaleDateString('es-ES')}</span>}
                        {supply.consumption_data.fechaUltimaLectura && <span>Última lectura: {new Date(supply.consumption_data.fechaUltimaLectura).toLocaleDateString('es-ES')}</span>}
                      </div>
                    )}
                  </>
                )}

                {!supply.consumption_data && !sipsLoading && (
                  <div className="text-center py-6 text-ink-3 text-sm">
                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>No hay datos SIPS disponibles</p>
                    <p className="text-xs mt-1">Pulsa "Consultar SIPS" para obtener los datos de consumo</p>
                  </div>
                )}
                </>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* ═══════ ANUAL ECONOMICS panel — fullscreen overlay ═══════ */}
        {activeTab === 'economics' && (
          <AnnualEconomics
            supplyId={supply.id}
            supplyType={supply.type}
            invoices={supply.invoices || []}
            potenciaContratada={supply.consumption_data?.potenciaContratada}
            consumoPeriodos={supply.consumption_data?.consumoPeriodos}
            gasHistory={supply.consumption_data?.gasHistory}
            supplyName={supply.name || undefined}
            clientName={supply.client?.name || supply.cups || ''}
            initialView={searchParams.get('view') === 'informe' ? 'informe' : undefined}
            maximetroHistory={supply.consumption_data?.maximetroHistory}
            sipsHistory={supply.consumption_data?.history}
            onInvoicesUpdated={async () => {
              const supabase = createClient()
              const { data } = await supabase
                .from('supplies')
                .select('*, client:clients(*), comercializadora:comercializadoras(*), invoices:invoices(*), contracts:contracts(*), studies:studies(*)')
                .eq('id', supply.id)
                .single()
              if (data) setSupply(data as any)
            }}
          />
        )}

        {/* ═══════ POTENCIAS Y CONSUMOS panel ═══════ */}
        {activeTab === 'potencias' && supply.cups && supply.type !== 'gas' && !/^RL/i.test(supply.tariff || '') && (
          <PowerStudy
            supplyId={supply.id}
            cups={supply.cups}
            clientName={supply.client?.name}
            potenciaContratada={supply.consumption_data?.potenciaContratada}
            existingStudy={supply.power_study_result || null}
            sipsAnnualKwh={supply.consumption_data?.totalKwh ?? null}
            onStudyGenerated={async (result) => {
              const supabase = createClient()
              await supabase
                .from('supplies')
                .update({ power_study_result: result, updated_at: new Date().toISOString() })
                .eq('id', supply.id)
              await fetchSupply()
            }}
          />
        )}

        {/* ═══════ COMPARATIVA VOLTIS ═══════ */}
        {activeTab === 'comparativa-voltis' && supply.invoices?.some((inv: any) => inv.source === 'voltis') && (
          <div className="rounded-3xl overflow-hidden bg-bg border border-line">
            <ComparativaVoltis supplyId={supply.id} />
          </div>
        )}

        {/* ═══════ TIMESTAMPS ═══════ */}
        <div className="flex gap-4 text-xs text-ink-3">
          <span>Creado: {formatDate(supply.created_at)}</span>
          <span>Actualizado: {formatDate(supply.updated_at)}</span>
        </div>
      </div>

      {/* ═══════ BULK SIGNING MODAL ═══════ */}
      {showBulkSign && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[100] backdrop-blur-sm" onClick={() => setShowBulkSign(false)} />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
            <div className="bg-bg rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b border-line-2-variant/15">
                <h3 className="font-sans font-semibold text-lg text-ink">
                  {pendingTransition === 'presentado' ? 'Marcar como presentado' : 'Firma de contratos'}
                </h3>
                <p className="text-xs text-ink-3 mt-1">
                  {pendingTransition === 'presentado'
                    ? `Este cliente tiene ${siblingSupplies.length} suministros. Selecciona los que quieres marcar como presentados.`
                    : `Este cliente tiene ${siblingSupplies.length} suministros. Selecciona los que quieres marcar como firmados bajo la misma suscripción.`
                  }
                </p>
              </div>

              {/* Supply list */}
              <div className="px-6 py-4 max-h-64 overflow-y-auto space-y-2">
                {siblingSupplies.map(s => {
                  const isSelected = bulkSignSelected.has(s.id)
                  const alreadyDone = pendingTransition === 'presentado'
                    ? ['presentado', 'pendiente_firma', 'firmado', 'suscrito', 'seguimiento_activo'].includes(s.status)
                    : ['firmado', 'suscrito', 'seguimiento_activo'].includes(s.status)
                  const alreadySigned = alreadyDone
                  const SIcon = s.type === 'gas' ? Flame : s.type === 'telefonia' ? PhoneIcon : Zap
                  return (
                    <button
                      key={s.id}
                      disabled={alreadySigned}
                      onClick={() => {
                        setBulkSignSelected(prev => {
                          const next = new Set(prev)
                          if (next.has(s.id)) next.delete(s.id)
                          else next.add(s.id)
                          return next
                        })
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                        alreadySigned
                          ? 'opacity-50 cursor-not-allowed bg-success/5'
                          : isSelected
                            ? 'bg-primary/10 border border-primary/20'
                            : 'bg-bg-2/50 hover:bg-bg-2'
                      }`}
                    >
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border ${
                        alreadySigned
                          ? 'bg-success/20 border-success/30'
                          : isSelected
                            ? 'bg-brand border-brand'
                            : 'border-line-2-variant/30'
                      }`}>
                        {(isSelected || alreadySigned) && <Check className={`w-3 h-3 ${alreadySigned ? 'text-ok' : 'text-white'}`} />}
                      </div>

                      <SIcon className="w-4 h-4 text-ink-3 flex-shrink-0" />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink truncate">
                          {s.name || s.cups || 'Sin CUPS'}
                        </p>
                        {s.name && s.cups && (
                          <p className="text-[10px] text-ink-3 font-mono">{s.cups}</p>
                        )}
                      </div>

                      {alreadySigned ? (
                        <span className="text-[10px] text-ok font-medium">
                          {pendingTransition === 'presentado' ? 'Ya presentado' : 'Ya firmado'}
                        </span>
                      ) : (
                        <StatusBadge status={s.status} />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Actions */}
              <div className="px-6 py-4 border-t border-line-2-variant/15 flex items-center justify-between">
                <p className="text-xs text-ink-3">
                  {bulkSignSelected.size} suministro{bulkSignSelected.size !== 1 ? 's' : ''} seleccionado{bulkSignSelected.size !== 1 ? 's' : ''}
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowBulkSign(false)}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleBulkSign}
                    loading={bulkSigning}
                    disabled={bulkSignSelected.size === 0}
                  >
                    {pendingTransition === 'presentado' ? (
                      <><ChevronRight className="w-3.5 h-3.5" /> Marcar presentados</>
                    ) : (
                      <><PenTool className="w-3.5 h-3.5" /> Firmar seleccionados</>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════ DELETE CONFIRMATION MODAL ═══════ */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => !deleting && setShowDeleteConfirm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-[#0f172a] border border-white/10 rounded-2xl p-6 max-w-md w-full">
              <h3 className="font-semibold text-lg text-white mb-2">
                ¿Eliminar este suministro?
              </h3>
              <p className="text-sm text-white/70 mb-6">
                Se eliminarán todos los documentos y datos asociados.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-err-container/400 hover:bg-err text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Eliminando...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Eliminar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════ SUPPLY CARDS OVERLAY ═══════ */}
      {supplyOverlayOpen && siblingSupplies.length > 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setSupplyOverlayOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative bg-bg rounded-3xl shadow-ambient-lg w-full max-w-4xl mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-surface/95 backdrop-blur border-b border-line-2-variant/10 rounded-t-3xl">
              <h2 className="font-sans font-semibold text-lg text-ink">
                Suministros del cliente ({siblingSupplies.length})
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); handleDownloadInvoicesZip() }}
                  disabled={!!zipProgress && zipProgress.phase !== 'done' && zipProgress.phase !== 'error'}
                >
                  {zipProgress && zipProgress.phase !== 'done' && zipProgress.phase !== 'error' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">Descargar facturas</span>
                </Button>
                <button onClick={() => setSupplyOverlayOpen(false)} className="p-2 rounded-xl hover:bg-bg-2 transition-all">
                  <X className="w-5 h-5 text-ink-3" />
                </button>
              </div>
            </div>

            {/* Download progress bar */}
            {zipProgress && zipProgress.phase !== 'done' && zipProgress.phase !== 'error' && (
              <div className="px-6 py-3 bg-primary/5 border-b border-line-2-variant/10">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-ink">
                    {zipProgress.phase === 'fetching' ? 'Cargando datos...' :
                     zipProgress.phase === 'zipping' ? 'Generando ZIP...' :
                     `Descargando ${zipProgress.downloaded}/${zipProgress.total}`}
                  </span>
                  <span className="text-[10px] text-ink-3 truncate ml-4 max-w-[200px]">{zipProgress.currentFile}</span>
                </div>
                <div className="w-full h-1.5 bg-outline-variant/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand rounded-full transition-all duration-300"
                    style={{ width: `${zipProgress.total > 0 ? (zipProgress.downloaded / zipProgress.total) * 100 : 10}%` }}
                  />
                </div>
              </div>
            )}

            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {siblingSupplies.map((s) => {
                const isCurrent = s.id === id
                const accentColor =
                  ['firmado', 'suscrito', 'seguimiento_activo'].includes(s.status) ? 'from-success/40 to-success/0' :
                  ['estudio_en_curso', 'pendiente_firma'].includes(s.status) ? 'from-warning/40 to-warning/0' :
                  s.status === 'rechazado' ? 'from-error/40 to-error/0' :
                  ['presentado', 'estudio_completado'].includes(s.status) ? 'from-secondary/40 to-secondary/0' :
                  'from-primary/40 to-primary/0'
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (!isCurrent) router.push(`/supplies/${s.id}`) }}
                    className={`group/card relative rounded-2xl shadow-ambient-sm overflow-hidden transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                      isCurrent
                        ? 'bg-primary/5 ring-2 ring-primary/30'
                        : 'bg-card hover:shadow-ambient-lg hover:-translate-y-0.5'
                    }`}
                  >
                    <div className={`absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${accentColor} pointer-events-none`} />
                    <div className="relative p-4 flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 text-lg">
                          {s.type === 'gas' ? '🔥' : s.type === 'telefonia' ? '📞' : '⚡'}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={s.status} />
                          {isCurrent && <Check className="w-3.5 h-3.5 text-brand" />}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <h3 className={`text-sm font-semibold truncate transition-colors ${isCurrent ? 'text-brand' : 'text-ink group-hover/card:text-brand'}`}>
                          {s.name || s.cups || 'Sin CUPS'}
                        </h3>
                        {s.name && s.cups && (
                          <p className="text-[10px] font-mono text-ink-3 truncate mt-0.5">{s.cups}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-bg-2/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-ink-3/70 font-semibold">Tarifa</p>
                          <p className="text-xs text-ink font-semibold truncate">{s.tariff || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-bg-2/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-ink-3/70 font-semibold">Tipo</p>
                          <p className="text-xs text-ink font-semibold capitalize truncate">{s.type || '—'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ DOCUMENTS OVERLAY ═══════ */}
      {docsOverlayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setDocsOverlayOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative bg-bg rounded-3xl shadow-ambient-lg w-full max-w-4xl mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-surface/95 backdrop-blur border-b border-line-2-variant/10 rounded-t-3xl">
              <h2 className="font-sans font-semibold text-lg text-ink flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Gestor de documentos
              </h2>
              <button onClick={() => setDocsOverlayOpen(false)} className="p-2 rounded-xl hover:bg-bg-2 transition-all">
                <X className="w-5 h-5 text-ink-3" />
              </button>
            </div>

            <div className="p-6 space-y-6">

              {/* ── 1. FACTURAS DEL CLIENTE ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-ink uppercase tracking-wider flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-info-container/400" />
                    Facturas del cliente
                  </h3>
                  <button
                    type="button"
                    onClick={() => invoiceInputRef.current?.click()}
                    disabled={uploadingInvoices}
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand hover:text-primary/80 transition disabled:opacity-50"
                  >
                    {uploadingInvoices ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Subir facturas
                  </button>
                </div>

                {/* Upload progress */}
                {Object.keys(uploadProgress).length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {Object.entries(uploadProgress).map(([name, status]) => (
                      <div key={name} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-bg-2">
                        {status === 'uploading' && <Loader2 className="w-3 h-3 animate-spin text-info" />}
                        {status === 'analyzing' && <Loader2 className="w-3 h-3 animate-spin text-warn" />}
                        {status === 'done' && <CheckCircle2 className="w-3 h-3 text-ok" />}
                        {status === 'error' && <XCircle className="w-3 h-3 text-err" />}
                        <span className="truncate flex-1 text-ink-3">{name}</span>
                        <span className="text-[10px] font-medium capitalize text-ink-3/70">
                          {status === 'uploading' ? 'Subiendo...' : status === 'analyzing' ? 'Analizando...' : status === 'done' ? 'Listo' : 'Error'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {supply.invoices && supply.invoices.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {[...supply.invoices]
                      .filter((inv: any) => inv.source !== 'voltis')
                      .sort((a: any, b: any) => new Date(b.period_end || b.period_start || b.created_at).getTime() - new Date(a.period_end || a.period_start || a.created_at).getTime())
                      .map((inv: any) => {
                        const period = inv.period_end
                          ? new Date(inv.period_end).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
                          : inv.period_start
                            ? new Date(inv.period_start).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
                            : null
                        return (
                          <div key={inv.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card border border-line-2-variant/10 hover:border-info/30 transition">
                            <div className="w-8 h-8 rounded-lg bg-info-container/40 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-4 h-4 text-info" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-ink truncate">
                                {period || 'Sin periodo'}
                              </p>
                              {inv.extracted_data?.total_amount && (
                                <p className="text-[10px] text-ink-3">{formatCurrency(inv.extracted_data.total_amount)}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {inv.file_url && (
                                <a href={getViewUrl(inv.file_url)} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-info-container/40 transition" title="Ver">
                                  <ExternalLink className="w-3.5 h-3.5 text-info" />
                                </a>
                              )}
                              <button
                                onClick={() => handleDeleteInvoice(inv)}
                                disabled={deletingInvoiceId === inv.id}
                                className="p-1.5 rounded-lg hover:bg-err-container/40 transition"
                                title="Eliminar"
                              >
                                {deletingInvoiceId === inv.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-err" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5 text-err" />
                                )}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                ) : (
                  <div className="text-center py-6 rounded-xl bg-bg-2/50">
                    <FileText className="w-8 h-8 text-ink-3/30 mx-auto mb-2" />
                    <p className="text-xs text-ink-3">Sin facturas</p>
                    <button onClick={() => invoiceInputRef.current?.click()} className="text-xs text-brand font-semibold mt-1 hover:underline">
                      Subir primera factura
                    </button>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-line-2-variant/10" />

              {/* ── 1.5. FACTURAS CON VOLTIS ── */}
              {(() => {
                const voltisInvoices = (supply.invoices || []).filter((inv: any) => inv.source === 'voltis')
                return (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-bold text-ink uppercase tracking-wider flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-volt" />
                        Facturas con Voltis
                      </h3>
                      <button
                        type="button"
                        onClick={() => voltisInvoiceInputRef.current?.click()}
                        disabled={uploadingVoltisInvoices}
                        className="flex items-center gap-1.5 text-xs font-semibold text-brand hover:text-brand-2 transition disabled:opacity-50"
                      >
                        {uploadingVoltisInvoices ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        Subir facturas Voltis
                      </button>
                    </div>
                    <p className="text-[11px] text-ink-3 mb-3">
                      Facturas de la nueva comercializadora contratada vía Voltis. Puedes subir facturas
                      de cualquier suministro del cliente: el CRM las asigna automáticamente por CUPS.
                      Cuando exista la factura del mismo mes del año anterior, la comparativa de coste
                      real aparece en el tab "Comparativa Voltis".
                    </p>

                    {/* Progreso */}
                    {Object.keys(voltisUploadProgress).length > 0 && (
                      <div className="space-y-1.5 mb-3">
                        {Object.entries(voltisUploadProgress).map(([name, status]) => (
                          <div key={name} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-bg-2">
                            {(status === 'uploading' || status === 'analyzing') && <Loader2 className="w-3 h-3 animate-spin text-volt-ink" />}
                            {status === 'done' && <CheckCircle2 className="w-3 h-3 text-ok" />}
                            {(status === 'error' || status === 'wrong-client') && <XCircle className="w-3 h-3 text-err" />}
                            <span className="truncate flex-1 text-ink-3">{name}</span>
                            <span className="text-[10px] font-medium capitalize text-ink-3/70">
                              {status === 'uploading' ? 'Subiendo' : status === 'analyzing' ? 'Analizando' : status === 'done' ? 'Listo' : status === 'wrong-client' ? 'CUPS no encontrado' : 'Error'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {voltisInvoices.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[...voltisInvoices]
                          .sort((a: any, b: any) => new Date(b.period_end || b.period_start || b.created_at).getTime() - new Date(a.period_end || a.period_start || a.created_at).getTime())
                          .map((inv: any) => {
                            const period = inv.period_end
                              ? new Date(inv.period_end).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
                              : inv.period_start
                                ? new Date(inv.period_start).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
                                : null
                            return (
                              <div key={inv.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card border border-volt/30 hover:border-brand/40 transition">
                                <div className="w-8 h-8 rounded-lg bg-volt/30 flex items-center justify-center flex-shrink-0">
                                  <FileText className="w-4 h-4 text-volt-ink" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-ink truncate">
                                    {period || 'Sin periodo'}
                                  </p>
                                  {inv.total_amount && (
                                    <p className="text-[10px] text-ink-3">{formatCurrency(inv.total_amount)}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {inv.file_url && (
                                    <a href={getViewUrl(inv.file_url)} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-volt/30 transition" title="Ver">
                                      <ExternalLink className="w-3.5 h-3.5 text-volt-ink" />
                                    </a>
                                  )}
                                  <button
                                    onClick={() => handleDeleteInvoice(inv)}
                                    disabled={deletingInvoiceId === inv.id}
                                    className="p-1.5 rounded-lg hover:bg-err-container/40 transition"
                                    title="Eliminar"
                                  >
                                    {deletingInvoiceId === inv.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-err" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5 text-err" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    ) : (
                      <div className="text-center py-6 rounded-xl border-2 border-dashed border-volt/40 bg-volt/5">
                        <Upload className="w-8 h-8 text-volt-ink/40 mx-auto mb-2" />
                        <p className="text-xs text-ink-3">Sin facturas con Voltis aún</p>
                        <button onClick={() => voltisInvoiceInputRef.current?.click()} className="text-xs text-brand font-semibold mt-1 hover:underline">
                          Subir primera factura Voltis
                        </button>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Divider */}
              <div className="border-t border-line-2-variant/10" />

              {/* ── 2. INFORMES ── */}
              <div>
                <h3 className="text-sm font-bold text-ink uppercase tracking-wider flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-ok-container/400" />
                  Informes
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Potencias */}
                  <div className="rounded-xl border border-line-2-variant/10 bg-card p-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 mb-1">
                      <BarChart3 className="w-4 h-4 text-warn" />
                      <h4 className="text-xs font-bold text-ink">Informe de Potencias</h4>
                    </div>
                    {supply.power_study_result ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-ok" />
                          <span className="text-xs text-ok font-medium">Generado</span>
                        </div>
                        <button
                          onClick={handleDownloadPowerStudyPDF}
                          className="flex items-center gap-1.5 text-xs font-semibold text-brand hover:text-primary/80 transition mt-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Ver informe
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-3">Pendiente de datos SIPS</p>
                    )}
                  </div>

                  {/* Económico */}
                  <div className="rounded-xl border border-line-2-variant/10 bg-card p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-ok" />
                        <h4 className="text-xs font-bold text-ink">Informe Económico</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEconomicStudyOpen(true)}
                        className="text-xs text-ok font-semibold hover:text-ok/80 transition flex items-center gap-1"
                      >
                        <TrendingUp className="w-3 h-3" />
                        Generar
                      </button>
                    </div>
                    {supply.studies && supply.studies.filter((s: any) => s.status === 'completed').length > 0 ? (
                      <div className="space-y-2">
                        {supply.studies
                          .filter((s: any) => s.status === 'completed')
                          .sort((a: any, b: any) => new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime())
                          .map((study: any) => (
                            <div key={study.id} className="group flex items-center gap-2 px-2.5 py-2 rounded-lg bg-bg-2/60 hover:bg-ok-container/50 transition">
                              <CheckCircle2 className="w-3.5 h-3.5 text-ok flex-shrink-0" />
                              <span className="text-xs text-ink flex-1 truncate">
                                {study.completed_at ? formatDate(study.completed_at) : 'Informe'}
                              </span>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {study.report_url && (
                                  <a href={getViewUrl(study.report_url)} target="_blank" rel="noopener noreferrer" className="p-1 rounded-lg hover:bg-ok-container transition" title="Ver">
                                    <ExternalLink className="w-3.5 h-3.5 text-ok" />
                                  </a>
                                )}
                                <button
                                  onClick={() => handleDeleteStudy(study)}
                                  disabled={deletingStudyId === study.id}
                                  className="p-1 rounded-lg hover:bg-err-container/40 transition"
                                  title="Eliminar"
                                >
                                  {deletingStudyId === study.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-err" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5 text-err" />
                                  )}
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-3">Sin informes económicos</p>
                    )}

                    {/* Upload comparativa */}
                    <button
                      type="button"
                      onClick={() => studyInputRef.current?.click()}
                      disabled={uploadingStudy}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ok/40 bg-ok-container/20 text-ok text-xs font-semibold hover:bg-ok-container/40 transition disabled:opacity-50 w-fit"
                    >
                      {uploadingStudy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {uploadingStudy ? 'Subiendo...' : 'Adjuntar comparativa (PDF / Excel)'}
                    </button>

                    {/* Study notes — admin only */}
                    {isAdmin() && supply.study_notes && (
                      <div className="mt-2 p-2.5 rounded-lg bg-warn-container/20 border border-warn/20">
                        <p className="text-[10px] font-bold text-warn uppercase tracking-wider mb-1 flex items-center gap-1">
                          🔒 Notas internas
                        </p>
                        <p className="text-xs text-ink whitespace-pre-wrap">{supply.study_notes}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-line-2-variant/10" />

              {/* ── 3. CONTRATOS ── */}
              <div>
                <h3 className="text-sm font-bold text-ink uppercase tracking-wider flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-info-container/400" />
                  Contratos
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Voltis */}
                  <div className="rounded-xl border border-line-2-variant/10 bg-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-4 h-4 text-brand" />
                      <h4 className="text-xs font-bold text-ink">Contrato Voltis</h4>
                    </div>
                    {serviceContracts.length > 0 ? (
                      <div className="space-y-4">
                        {serviceContracts.map((sc: any) => {
                          const cl = supply?.client
                          const isNatural = ['particular', 'autonomo'].includes(cl?.type)
                          const startDateObj = sc.start_date ? new Date(sc.start_date) : new Date()
                          const endDateObj = sc.end_date ? new Date(sc.end_date) : scAddMonths(startDateObj, 12)
                          const fee = sc.fee_amount ?? 0

                          const handlePropuesta = async () => {
                            const repName = isNatural ? cl?.name : sc.representative_name
                            const html = generatePropuestaHTML({
                              clientName: cl?.name ?? '',
                              representativeName: repName ?? '',
                              ahorroConfirmado: sc.ahorro_confirmado || null,
                              feeAmount: fee,
                              startDate: startDateObj,
                              endDate: endDateObj,
                              contractType: sc.contract_type,
                            })
                            await generateAndDownloadPDF(html, `Propuesta_Voltis_${cl?.name ?? 'cliente'}.pdf`)
                          }

                          const handleContrato = async () => {
                            const repName = isNatural ? cl?.name : sc.representative_name
                            const repNif = isNatural ? (cl?.nif ?? cl?.cif_nif ?? '') : sc.representative_nif
                            const firstPaymentDate = new Date(startDateObj)
                            firstPaymentDate.setDate(firstPaymentDate.getDate() + 15)
                            const html = generateContratoHTML({
                              clientName: cl?.name ?? '',
                              clientCif: cl?.cif ?? cl?.cif_nif ?? '',
                              clientFiscalAddress: cl?.fiscal_address ?? '',
                              representativeName: repName ?? '',
                              representativeNif: repNif ?? '',
                              signingLocation: sc.signing_location ?? '',
                              startDate: startDateObj,
                              endDate: endDateObj,
                              firstPaymentDate,
                              ahorroConfirmado: sc.ahorro_confirmado || null,
                              feeAmount: fee,
                              contractType: sc.contract_type,
                              paymentModality: sc.payment_modality,
                              paymentSchedule: scBuildPaymentSchedule(sc.payment_modality, fee, startDateObj),
                              isNatural,
                            })
                            await generateAndDownloadPDF(html, `Contrato_Voltis_${cl?.name ?? 'cliente'}.pdf`)
                          }

                          return (
                            <div key={sc.id} className="space-y-2.5">
                              {/* Metadata */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[9px] font-mono uppercase tracking-wider text-accent-ink bg-accent-soft px-1.5 py-0.5 rounded">
                                    {sc.contract_type === 'porcentaje' ? '25% ahorro' : 'Suscripción'}
                                  </span>
                                  {sc.start_date && (
                                    <span className="text-[10px] text-ink-3">{formatDate(sc.start_date)}</span>
                                  )}
                                </div>
                                {sc.ahorro_confirmado && (
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-[10px] text-ink-3">Ahorro</span>
                                    <span className="text-sm font-semibold text-ink">{formatCurrency(sc.ahorro_confirmado)}</span>
                                  </div>
                                )}
                                {fee > 0 && (
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-[10px] text-ink-3">Honorarios</span>
                                    <span className="text-sm font-semibold text-brand">{formatCurrency(fee)}</span>
                                  </div>
                                )}
                                {sc.payment_modality && (
                                  <p className="text-[10px] text-ink-3">{SC_MODALITY_LABELS[sc.payment_modality]}</p>
                                )}
                              </div>
                              {/* Action buttons */}
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  onClick={handlePropuesta}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand/10 text-brand text-[11px] font-medium hover:bg-brand/20 transition"
                                >
                                  <FileText className="w-3 h-3" />
                                  {sc.proposal_url ? 'Regenerar propuesta' : 'Propuesta PDF'}
                                </button>
                                <button
                                  onClick={handleContrato}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand/10 text-brand text-[11px] font-medium hover:bg-brand/20 transition"
                                >
                                  <FileText className="w-3 h-3" />
                                  {sc.contract_url ? 'Regenerar contrato' : 'Contrato PDF'}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-3">Sin contrato Voltis</p>
                    )}
                  </div>

                  {/* Comercializadora */}
                  <div className="rounded-xl border border-line-2-variant/10 bg-card p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-4 h-4 text-info" />
                      <h4 className="text-xs font-bold text-ink">Contrato Comercializadora</h4>
                    </div>
                    {supply.comercializadora && (
                      <p className="text-[10px] text-ink-3 mb-2">{supply.comercializadora.name}</p>
                    )}
                    {supply.contracts && supply.contracts.filter((c: any) => c.type === 'comercializadora' || c.contract_type === 'comercializadora').length > 0 ? (
                      <div className="space-y-2">
                        {supply.contracts
                          .filter((c: any) => c.type === 'comercializadora' || c.contract_type === 'comercializadora')
                          .map((contract: any) => (
                            <div key={contract.id} className="group flex items-center gap-2 px-2.5 py-2 rounded-lg bg-bg-2/60 hover:bg-info-container/30 transition">
                              <FileText className="w-3.5 h-3.5 text-info flex-shrink-0" />
                              <span className="text-xs text-ink flex-1 truncate">
                                {contract.signed_at ? formatDate(contract.signed_at) : 'Contrato'}
                              </span>
                              {(contract.document_url || contract.file_url) && (
                                <a
                                  href={getViewUrl(contract.document_url || contract.file_url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1 rounded-lg hover:bg-info-container transition opacity-0 group-hover:opacity-100"
                                  title="Ver contrato"
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-info" />
                                </a>
                              )}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-3">Sin contrato comercializadora</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-line-2-variant/10" />

              {/* ── 4. FACTURAS DESDE ACTIVACIÓN ── */}
              <div>
                <h3 className="text-sm font-bold text-ink uppercase tracking-wider flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-warn-container/400" />
                  Facturas desde activación
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Facturas Voltis */}
                  <div className="rounded-xl border border-line-2-variant/10 border-dashed bg-bg-2/30 p-4 flex flex-col items-center gap-2">
                    <Zap className="w-5 h-5 text-ink-3/30" />
                    <p className="text-xs text-ink-3 text-center">Facturas Voltis</p>
                    <p className="text-[10px] text-ink-3/60 text-center">Disponible tras activación</p>
                  </div>

                  {/* Facturas Comercializadora */}
                  <div className="rounded-xl border border-line-2-variant/10 border-dashed bg-bg-2/30 p-4 flex flex-col items-center gap-2">
                    <Building2 className="w-5 h-5 text-ink-3/30" />
                    <p className="text-xs text-ink-3 text-center">Facturas Comercializadora</p>
                    <p className="text-[10px] text-ink-3/60 text-center">Disponible tras activación</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ CLIENT DETAIL MODAL ═══════ */}
      <ClientDetailModal
        clientId={supply.client?.id || null}
        isOpen={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        contextSupplyId={id as string}
        onUpdate={fetchSupply}
      />

      {/* ═══════ NOTIFICATION TOAST ═══════ */}
      {notification && (
        <div className="fixed bottom-4 right-4 z-[70]">
          <div
            className={`px-4 py-3 rounded-lg shadow-lg border flex items-center gap-3 max-w-sm animate-in slide-in-from-bottom-4 ${
              notification.type === 'success'
                ? 'bg-success/10 border-success/30 text-ok'
                : 'bg-error/10 border-error/30 text-err'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            )}
            <p className="text-sm font-medium">{notification.message}</p>
          </div>
        </div>
      )}

      {supply?.client && (
        <TechnicalAuditModal
          open={technicalModalOpen}
          onClose={() => setTechnicalModalOpen(false)}
          clientId={supply.client_id as string}
          clientName={supply.client.name}
        />
      )}

      {/* Power adjustment dialog for economic study */}
      {powerAdjustForStudyOpen && supply && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="rounded-2xl p-6 max-w-md w-full shadow-2xl" style={{ background: '#FBF7EE', border: '1px solid #E5DCC9' }}>
            <h3 className="text-lg font-black text-[#2D3A33] mb-1">Ajuste de potencias</h3>
            <p className="text-sm text-[#5A6B5F] mb-4">
              Los maxímetros detectan desviaciones &gt; 15% en algún periodo. ¿Quieres ajustar potencias para la comercializadora propuesta?
            </p>
            <div className="space-y-2 mb-5">
              <p className="text-[10px] font-bold tracking-widest text-[#8A9A8E]">POTENCIAS PARA NUEVA COMERCIALIZADORA (kW)</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(studyPowerInputs).map(([p, val]) => (
                  <div key={p} className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-[#5A6B5F]">{p}</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={val}
                      onChange={e => setStudyPowerInputs(prev => ({ ...prev, [p]: e.target.value }))}
                      className="w-full px-2 py-1.5 rounded-lg text-sm border text-[#2D3A33] outline-none focus:border-[#6B8068]"
                      style={{ background: '#fff', border: '1px solid #D9D0BC' }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setPowerAdjustForStudyOpen(false); setStudyAdjustedPowers(null); setEconomicStudyOpen(true) }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition"
                style={{ background: '#E5DCC9', color: '#5A6B5F' }}
              >
                No, usar actuales
              </button>
              <button
                onClick={() => {
                  const adjusted = ['P1','P2','P3','P4','P5','P6'].map(p => {
                    const n = parseFloat(studyPowerInputs[p] || '0')
                    return isNaN(n) ? 0 : n
                  })
                  setStudyAdjustedPowers(adjusted)
                  setPowerAdjustForStudyOpen(false)
                  setEconomicStudyOpen(true)
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition"
                style={{ background: 'linear-gradient(135deg, #6B8068, #5A6E58)', color: '#FBF7EE' }}
              >
                Sí, ajustar potencias
              </button>
            </div>
          </div>
        </div>
      )}

      {economicStudyOpen && supply && (
        <EconomicStudyModal
          supplyId={supply.id}
          cups={supply.cups || ''}
          tariff={supply.tariff || '3.0TD'}
          clientName={supply.client?.name || ''}
          comercializadoraActual={supply.comercializadora?.name}
          consumptionByPeriod={(() => {
            const cd = supply.consumption_data as any
            if (!cd) return []
            const keys = ['P1','P2','P3','P4','P5','P6']
            if (cd.consumoPeriodos && typeof cd.consumoPeriodos === 'object' && !Array.isArray(cd.consumoPeriodos)) {
              const vals = keys.map(k => Number(cd.consumoPeriodos[k] ?? 0))
              if (vals.some(v => v > 0)) return vals
            }
            if (Array.isArray(cd.consumoPorPeriodo)) return cd.consumoPorPeriodo.map(Number)
            const periods: number[] = []
            for (let i = 1; i <= 6; i++) {
              const v = cd[`consumoP${i}`] ?? cd[`energiaP${i}`]
              if (v !== undefined) periods.push(Number(v))
            }
            return periods
          })()}
          powersByPeriod={studyAdjustedPowers ?? (() => {
            const cd = supply.consumption_data as any
            if (!cd) return []
            const keys = ['P1','P2','P3','P4','P5','P6']
            if (cd.potenciaContratada && typeof cd.potenciaContratada === 'object' && !Array.isArray(cd.potenciaContratada)) {
              const vals = keys.map(k => Number(cd.potenciaContratada[k] ?? 0))
              if (vals.some(v => v > 0)) return vals
            }
            if (Array.isArray(cd.potenciasContratadas)) return cd.potenciasContratadas.map(Number)
            const powers: number[] = []
            for (let i = 1; i <= 6; i++) {
              const v = cd[`potenciaP${i}`] ?? cd[`p${i}`]
              if (v !== undefined) powers.push(Number(v))
            }
            return powers
          })()}
          currentAvgEnergyPrice={(() => {
            // Average €/kWh from all processed invoices
            const invs: any[] = supply.invoices || []
            let totalKwh = 0, totalEur = 0
            for (const inv of invs) {
              const eco = inv.extracted_data?.economics || {}
              const kwh = Number(eco.consumoTotalKwh) || 0
              const eur = Number(eco.costeTotalConsumo) || Number(eco.costeNetoConsumo) || 0
              if (kwh > 0 && eur > 0) { totalKwh += kwh; totalEur += eur }
            }
            return totalKwh > 0 ? totalEur / totalKwh : 0
          })()}
          currentPowerPriceP1={(() => {
            // Most recent invoice with P1 potencia price
            const invs: any[] = [...(supply.invoices || [])].sort((a: any, b: any) => {
              const d = (i: any) => i.extracted_data?.billing_period_end || i.extracted_data?.fecha_fin || ''
              return d(b).localeCompare(d(a))
            })
            for (const inv of invs) {
              const potArr = inv.extracted_data?.economics?.potencia || []
              const p1 = potArr.find((x: any) => x.periodo === 'P1')
              const price = Number(p1?.precioKwDia) || Number(p1?.precioKw) || 0
              if (price > 0 && price < 1) return price
            }
            return 0
          })()}
          currentPowerPriceP2={(() => {
            const invs: any[] = [...(supply.invoices || [])].sort((a: any, b: any) => {
              const d = (i: any) => i.extracted_data?.billing_period_end || i.extracted_data?.fecha_fin || ''
              return d(b).localeCompare(d(a))
            })
            for (const inv of invs) {
              const potArr = inv.extracted_data?.economics?.potencia || []
              const p2 = potArr.find((x: any) => x.periodo === 'P2')
              const price = Number(p2?.precioKwDia) || Number(p2?.precioKw) || 0
              if (price > 0 && price < 1) return price
            }
            return 0
          })()}
          onClose={() => { setEconomicStudyOpen(false); setStudyAdjustedPowers(null) }}
        />
      )}
    </div>
  )
}
