'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Zap, Building2, MapPin, FileText, CreditCard,
  ChevronRight, CheckCircle2, Circle, Clock, XCircle,
  Upload, ClipboardCheck, BarChart3, Presentation, PenTool,
  UserCheck, TrendingUp, AlertTriangle, Edit2, Trash2,
  RefreshCw, ChevronDown, ChevronUp, Loader2, Activity, ExternalLink, Download,
  Plus, X, Pencil, Check, Flame, Phone as PhoneIcon, Copy, Mail
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { PowerStudy } from '@/components/supply/PowerStudy'
import AnnualEconomics from '@/components/supply/AnnualEconomics'
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
import { useAuthStore } from '@/stores/auth'
import type { SupplyStatus } from '@/types/database'

// Pipeline steps in order
const PIPELINE_STEPS: { key: SupplyStatus; label: string; icon: any }[] = [
  { key: 'primer_contacto', label: 'Contacto', icon: UserCheck },
  { key: 'facturas_recibidas', label: 'Facturas', icon: Upload },
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
    facturas_recibidas: 1,
    estudio_en_curso: 2,
    estudio_completado: 3,
    presentado: 4,
    // Legacy states map to closest step
    prescoring_pendiente: 4,
    prescoring_completado: 4,
    pendiente_firma: 5,
    firmado: 6,
    suscrito: 7,
    seguimiento_activo: 8,
    rechazado: -1,
  }
  return map[status] ?? -1
}

// Next valid transitions
const TRANSITIONS: Record<string, { next: SupplyStatus; label: string }[]> = {
  // Main pipeline flow
  // Prescoring is now automatic — created when invoices are added
  primer_contacto: [{ next: 'facturas_recibidas', label: 'Facturas recibidas' }],
  facturas_recibidas: [{ next: 'estudio_en_curso', label: 'Enviar a informes' }],
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
  const [supply, setSupply] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState<'sips' | 'economics' | 'potencias' | null>(null)
  const [sipsLoading, setSipsLoading] = useState(false)
  const [sipsError, setSipsError] = useState('')
  const [sipsTab, setSipsTab] = useState<'consumos' | 'maximetros' | 'reactivas'>('consumos')
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null)
  const [uploadingInvoices, setUploadingInvoices] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, 'uploading' | 'analyzing' | 'done' | 'error'>>({})
  const [uploadingStudy, setUploadingStudy] = useState(false)
  const [deletingStudyId, setDeletingStudyId] = useState<string | null>(null)
  const [siblingSupplies, setSiblingSupplies] = useState<any[]>([])
  const [clientModalOpen, setClientModalOpen] = useState(false)
  const [supplyOverlayOpen, setSupplyOverlayOpen] = useState(false)
  const [docsOverlayOpen, setDocsOverlayOpen] = useState(false)
  const [technicalModalOpen, setTechnicalModalOpen] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [zipProgress, setZipProgress] = useState<DownloadProgress | null>(null)
  const invoiceInputRef = useRef<HTMLInputElement>(null)
  const studyInputRef = useRef<HTMLInputElement>(null)
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const { user } = useAuthStore()

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
        client:clients(id, name, cif, nif, cif_nif, email, phone, type),
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

    // ── Fetch sibling supplies (same client) for the supply switcher ──
    if (data?.client_id) {
      const { data: siblings } = await supabase
        .from('supplies')
        .select('id, name, cups, type, status, tariff')
        .eq('client_id', data.client_id)
        .order('created_at', { ascending: true })
      setSiblingSupplies(siblings || [])
    }

    // ── Auto-refresh SIPS if maxímetros or reactiva are missing ──
    const hasMaximetros = data?.consumption_data?.maximetroHistory?.length > 0
    const hasReactiva = data?.consumption_data?.reactivaHistory?.length > 0
    const studyIsStale = data?.power_study_result && (
      // Old study had no real maxímetros but we now have them
      (!data.power_study_result.hasRealMaximetros && hasMaximetros) ||
      // Study has fewer months than current consumption history
      (data.power_study_result.meses?.length < (data.consumption_data?.history?.length || 0))
    )
    const needsRefresh = data && data.cups && (
      !data.consumption_data || !hasMaximetros || !hasReactiva || studyIsStale
    )
    if (needsRefresh) {
      setSipsLoading(true)
      try {
        const sipsRes = await fetch('/api/sips', {
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
    if (!confirm(`¿Eliminar esta factura${inv.period_start ? ` (${new Date(inv.period_start).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })})` : ''}? Se eliminará del suministro y del almacenamiento.`)) return
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

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const fileId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const ext = file.name.split('.').pop()
      newProgress[fileId] = 'uploading'
      setUploadProgress({ ...newProgress })

      try {
        // 1. Upload to Supabase Storage
        const filePath = `invoices/${Date.now()}/${fileId}.${ext}`
        const { data: storageData, error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, file)
        if (uploadError) throw uploadError

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storageData.path)
        const publicUrl = urlData.publicUrl

        // 2. Analyze with Gemini
        newProgress[fileId] = 'analyzing'
        setUploadProgress({ ...newProgress })

        const fileType = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result as string
            resolve(result.split(',')[1])
          }
          reader.onerror = () => reject(new Error('Error leyendo archivo'))
          reader.readAsDataURL(file)
        })

        const analyzeRes = await fetch('/api/analyze-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_base64: base64, file_type: fileType, file_name: file.name }),
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
          // Clean up the orphan file to avoid storage bloat
          await supabase.storage.from('documents').remove([storageData.path]).catch(() => {})
          newProgress[fileId] = 'error'
          setUploadProgress({ ...newProgress })
          showNotification(
            `Factura rechazada: el CUPS de "${file.name}" (${invoiceCupsNorm}) no coincide con el CUPS de este suministro (${supplyCupsNorm}). Un suministro solo puede contener facturas de un único CUPS.`,
            'error'
          )
          continue
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

        // 4. Insert invoice row
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

        // 5. Auto-fill missing client fields from invoice extraction
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

    // Ensure a prescoring row exists now that we have invoice data — runs
    // exactly once per upload batch and is a no-op if one already exists.
    await ensurePendingPrescoring(createClient(), supply.id, { userId: user?.id })

    // Re-fetch supply to update everything
    await fetchSupply()
    setUploadingInvoices(false)
    setUploadProgress({})
  }

  // ── Upload economic study (PDF/Excel) ────────────────────────────────────
  const handleUploadStudy = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !supply || !user) return
    setUploadingStudy(true)

    try {
      const supabase = createClient()

      // 1. Upload file to Storage
      const filePath = `reports/${supply.id}/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file)
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

      // 3. Update supply status to estudio_completado
      await supabase
        .from('supplies')
        .update({ status: 'estudio_completado', updated_at: new Date().toISOString() })
        .eq('id', supply.id)

      // 4. Create notification for the commercial
      if (supply.client?.id) {
        const { data: clientData } = await supabase
          .from('clients')
          .select('commercial_id, name')
          .eq('id', supply.client.id)
          .single()

        if (clientData?.commercial_id) {
          await supabase.from('notifications').insert({
            user_id: clientData.commercial_id,
            type: 'estudio_completado',
            title: 'Informe listo',
            message: `El informe económico de ${clientData.name} (${supply.cups || 'sin CUPS'}) ya está disponible.`,
            link: `/supplies/${supply.id}`,
            read: false,
            created_at: new Date().toISOString(),
            metadata: {
              report_url: reportUrl,
              client_name: clientData.name,
              cups: supply.cups,
              supply_id: supply.id,
            },
          })
        }
      }

      // 5. Re-fetch supply
      await fetchSupply()
    } catch (err) {
      console.error('Error subiendo estudio económico:', err)
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
    setSipsLoading(true)
    setSipsError('')
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
        const earlyStatuses = ['primer_contacto', 'facturas_recibidas']
        if (earlyStatuses.includes(supply.status)) {
          await createClient()
            .from('supplies')
            .update({ status: 'estudio_en_curso', updated_at: new Date().toISOString() })
            .eq('id', supply.id)
        }

        await fetchSupply()
      } else {
        setSipsError(result.error || 'No se encontraron datos SIPS')
      }
    } catch (err: any) {
      setSipsError(err.message || 'Error consultando SIPS')
    } finally {
      setSipsLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!supply) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <AlertTriangle className="w-12 h-12 text-warning" />
        <p className="text-on-surface-variant">Suministro no encontrado</p>
        <Button variant="secondary" onClick={() => router.push('/supplies')}>
          Volver a suministros
        </Button>
      </div>
    )
  }

  const currentIndex = getPipelineIndex(supply.status)
  const isRejected = supply.status === 'rechazado'
  const transitions = TRANSITIONS[supply.status] || []

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
            <h3 className="text-sm font-semibold text-on-surface-variant mb-4 uppercase tracking-wider">
              Pipeline del suministro
            </h3>

            {isRejected && (
              <div className="flex items-center gap-3 mb-4 p-3 bg-error-container/30 rounded-xl">
                <XCircle className="w-5 h-5 text-error flex-shrink-0" />
                <p className="text-sm font-medium text-error">
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
                          ? 'bg-success'
                          : isCurrent
                          ? 'gradient-primary'
                          : 'bg-surface-container-high hover:bg-on-surface-variant/30'
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
                    <div className="w-10 h-10 rounded-xl gradient-primary text-white flex items-center justify-center flex-shrink-0">
                      <CurrentIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-on-surface">{PIPELINE_STEPS[currentIndex].label}</p>
                      <p className="text-xs text-on-surface-variant">
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
                            ? 'bg-success text-white group-hover:ring-2 group-hover:ring-success/30'
                            : isCurrent
                            ? 'gradient-primary text-white ring-4 ring-primary/20'
                            : 'bg-surface-container-high text-on-surface-variant group-hover:bg-primary/20 group-hover:text-primary group-hover:ring-2 group-hover:ring-primary/20'
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
                            ? 'text-primary font-bold'
                            : isCompleted
                            ? 'text-success'
                            : 'text-on-surface-variant group-hover:text-primary'
                        }`}
                      >
                        {step.label}
                      </span>
                    </button>
                    {index < PIPELINE_STEPS.length - 1 && (
                      <div
                        className={`w-10 h-0.5 mx-1 flex-shrink-0 ${
                          isCompleted ? 'bg-success' : 'bg-surface-container-high'
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
              <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wider">
                Datos del suministro
              </h3>
              {siblingSupplies.length > 1 && (
                <span className="text-[10px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  Ver todos <ChevronRight className="w-3 h-3" />
                </span>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Zap className="w-4 h-4 text-primary flex-shrink-0" />
                <div>
                  <p className="text-xs text-on-surface-variant">CUPS</p>
                  <p className="text-sm font-mono font-medium text-on-surface">{supply.cups || 'Sin CUPS'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                <div>
                  <p className="text-xs text-on-surface-variant">Tipo / Tarifa</p>
                  <p className="text-sm text-on-surface capitalize">
                    {supply.type} · <Badge variant="info">{supply.tariff}</Badge>
                  </p>
                </div>
              </div>
              {supply.address && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-xs text-on-surface-variant">Direccion</p>
                    <p className="text-sm text-on-surface">{supply.address}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-primary flex-shrink-0" />
                <div>
                  <p className="text-xs text-on-surface-variant">Estado actual</p>
                  <StatusBadge status={supply.status} />
                </div>
              </div>
            </div>

            {/* CUPS chips for sibling supplies */}
            {siblingSupplies.length > 1 && (
              <div className="pt-3 mt-3 border-t border-outline-variant/10">
                <div className="flex flex-wrap gap-1.5">
                  {siblingSupplies.map((s) => {
                    const isCurrent = s.id === id
                    return (
                      <button
                        key={s.id}
                        onClick={(e) => { e.stopPropagation(); if (!isCurrent) router.push(`/supplies/${s.id}`) }}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold transition-colors ${
                          isCurrent
                            ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                            : 'bg-surface-container-high text-on-surface-variant hover:bg-primary/10 hover:text-primary'
                        }`}
                        title={s.cups || 'Sin CUPS'}
                      >
                        {s.name || (s.cups ? `…${s.cups.slice(-4)}` : '?')}
                        {isCurrent && ' ✓'}
                      </button>
                    )
                  })}

                  {/* ─── Trigger for Supply Report (Ayuntamientos) ─── */}
                  {supply?.client?.type === 'ayuntamiento' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setTechnicalModalOpen(true) }}
                      className="flex items-center gap-1.5 px-3 py-0.5 rounded-md text-[11px] font-bold bg-primary text-white hover:bg-primary-container hover:text-primary transition-all shadow-sm"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      Estudios de Suministro
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
              <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wider">
                Cliente
              </h3>
              {supply.client && (
                <span className="text-[10px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  Ver ficha completa <ChevronRight className="w-3 h-3" />
                </span>
              )}
            </div>
            {supply.client ? (
              <div className="space-y-2">
                {([
                  { key: 'cl_name', label: 'Nombre', value: supply.client.name, icon: Building2 },
                  { key: 'cl_id', label: supply.client.cif ? 'CIF' : 'NIF', value: supply.client.cif || supply.client.nif || supply.client.cif_nif, icon: FileText },
                  { key: 'cl_phone', label: 'Teléfono', value: supply.client.phone, icon: PhoneIcon },
                  { key: 'cl_email', label: 'Email', value: supply.client.email, icon: Mail },
                  { key: 'cl_addr', label: 'Dir. fiscal', value: supply.client.fiscal_address, icon: MapPin },
                ] as const).map((f) => (
                  <div key={f.key} className="flex items-center gap-2.5 group/row">
                    <f.icon className="w-4 h-4 text-on-surface-variant/60 flex-shrink-0" />
                    <span className="flex-1 text-sm text-on-surface truncate">
                      {f.value || <span className="text-on-surface-variant/40 italic text-xs">—</span>}
                    </span>
                    {f.value && (
                      <button
                        onClick={(e) => { e.stopPropagation(); copyToClip(f.key, String(f.value)) }}
                        className="p-1 rounded-md text-on-surface-variant/30 hover:text-primary hover:bg-primary/10 transition-all opacity-0 group-hover/row:opacity-100 flex-shrink-0"
                        title="Copiar"
                      >
                        {copiedField === f.key
                          ? <Check className="w-3.5 h-3.5 text-success" />
                          : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">Sin cliente asignado</p>
            )}
          </Card>

          {/* Documents — compact preview, click opens full overlay */}
          <Card
            className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition group flex flex-col gap-0"
            onClick={() => setDocsOverlayOpen(true)}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Documentos
              </h3>
              <span className="text-[10px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                Abrir gestor <ChevronRight className="w-3 h-3" />
              </span>
            </div>

            {/* Compact summary counts */}
            <div className="space-y-2">
              {/* Facturas */}
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${(supply.invoices?.length || 0) > 0 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                <span className="text-xs text-on-surface flex-1">Facturas</span>
                <span className="text-xs font-semibold text-on-surface-variant">{supply.invoices?.length || 0}</span>
              </div>
              {/* Informes */}
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${supply.power_study_result || supply.studies?.some((s: any) => s.status === 'completed') ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="text-xs text-on-surface flex-1">Informes</span>
                <span className="text-xs font-semibold text-on-surface-variant">
                  {(supply.power_study_result ? 1 : 0) + (supply.studies?.filter((s: any) => s.status === 'completed').length || 0)}
                </span>
              </div>
              {/* Contratos */}
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${(supply.contracts?.length || 0) > 0 ? 'bg-purple-500' : 'bg-gray-300'}`} />
                <span className="text-xs text-on-surface flex-1">Contratos</span>
                <span className="text-xs font-semibold text-on-surface-variant">{supply.contracts?.length || 0}</span>
              </div>
            </div>

            {/* Comercializadora pill */}
            {supply.comercializadora && (
              <div className="flex items-center gap-2 mt-3 px-2 py-1.5 bg-surface-container-low rounded-lg">
                <Building2 className="w-3.5 h-3.5 text-on-surface-variant flex-shrink-0" />
                <p className="text-xs font-semibold text-on-surface truncate">{supply.comercializadora.name}</p>
              </div>
            )}
          </Card>

          {/* Hidden file inputs (need to be outside overlay for stability) */}
          <input ref={studyInputRef} type="file" accept=".pdf,.xlsx,.xls,.doc,.docx" className="hidden" onChange={handleUploadStudy} />
          <input ref={invoiceInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple className="hidden" onChange={handleUploadInvoices} />
        </div>

        {/* ═══════ SECTION TAB BUTTONS ═══════ */}
        <div className="grid grid-cols-3 gap-3">
          {([
            {
              key: 'sips' as const,
              label: 'DATOS SIPS',
              icon: Activity,
              activeClass: 'border-blue-500 bg-blue-50 text-blue-700 shadow-md',
              inactiveClass: 'border-outline-variant/30 bg-white text-on-surface hover:border-blue-300 hover:bg-blue-50/40',
              dot: supply.consumption_data ? 'bg-blue-500' : 'bg-gray-300',
            },
            {
              key: 'economics' as const,
              label: 'ANUAL ECONOMICS',
              icon: TrendingUp,
              activeClass: 'border-green-500 bg-green-50 text-green-700 shadow-md',
              inactiveClass: 'border-outline-variant/30 bg-white text-on-surface hover:border-green-300 hover:bg-green-50/40',
              dot: (supply.invoices?.some((inv: any) => inv.extracted_data?.economics)) ? 'bg-green-500'
                : (supply.invoices?.length > 0) ? 'bg-amber-400' : 'bg-gray-300',
            },
            {
              key: 'potencias' as const,
              label: 'POTENCIAS Y CONSUMOS',
              icon: BarChart3,
              activeClass: 'border-amber-500 bg-amber-50 text-amber-700 shadow-md',
              inactiveClass: 'border-outline-variant/30 bg-white text-on-surface hover:border-amber-300 hover:bg-amber-50/40',
              dot: supply.power_study_result ? 'bg-amber-500' : 'bg-gray-300',
            },
          ]).map(tab => {
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

        {/* ═══════ DATOS SIPS panel ═══════ */}
        {activeTab === 'sips' && supply.cups && (
          <div id="sips-data" className="scroll-mt-4">
            <Card className="overflow-hidden">
              <div className="p-4 space-y-5">

                {/* Fetch / Refresh + last update */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={handleFetchSips} disabled={sipsLoading} loading={sipsLoading}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    {supply.consumption_data ? 'Actualizar datos SIPS' : 'Consultar SIPS'}
                  </Button>
                  {sipsError && <span className="text-xs text-error">{sipsError}</span>}
                  {supply.consumption_data?.fetched_at && (
                    <span className="text-xs text-on-surface-variant ml-auto">
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
                    pending:  { bg: 'bg-amber-50 border-amber-200',  text: 'text-amber-700',  label: 'Pendiente' },
                    sent:     { bg: 'bg-blue-50 border-blue-200',    text: 'text-blue-700',   label: 'Enviado'   },
                    approved: { bg: 'bg-green-50 border-green-200',  text: 'text-green-700',  label: 'Aprobado'  },
                    rejected: { bg: 'bg-red-50 border-red-200',      text: 'text-red-700',    label: 'Rechazado' },
                  }
                  const c = cfg[latest.status] || cfg.pending
                  return (
                    <div className={`rounded-xl border px-3 py-2 flex items-center gap-2 ${c.bg}`}>
                      <ClipboardCheck className={`w-4 h-4 ${c.text} flex-shrink-0`} />
                      <p className="text-xs font-semibold text-on-surface">
                        Prescoring: <span className={c.text}>{c.label}</span>
                      </p>
                      {latest.requested_at && (
                        <span className="text-[10px] text-on-surface-variant ml-auto">{formatDate(latest.requested_at)}</span>
                      )}
                    </div>
                  )
                })()}

                {supply.consumption_data && (supply.consumption_data.history || supply.consumption_data.consumoPeriodos) && (
                  <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="bg-surface-container-low rounded-xl p-3">
                        <p className="text-xs text-on-surface-variant">Consumo Total</p>
                        <p className="text-lg font-bold text-on-surface mt-0.5">
                          {supply.consumption_data.totalKwh
                            ? `${Math.round(supply.consumption_data.totalKwh).toLocaleString('es-ES')} kWh`
                            : supply.consumption_data.total || '-'}
                        </p>
                      </div>
                      <div className="bg-surface-container-low rounded-xl p-3">
                        <p className="text-xs text-on-surface-variant">Tarifa SIPS</p>
                        <p className="text-lg font-bold text-on-surface mt-0.5">
                          {supply.consumption_data.sips_tariff || supply.tariff || '-'}
                        </p>
                      </div>
                      <div className="bg-surface-container-low rounded-xl p-3">
                        <p className="text-xs text-on-surface-variant">Distribuidora</p>
                        <p className="text-xs font-medium text-on-surface mt-1 leading-tight">
                          {supply.consumption_data.distribuidora || '-'}
                        </p>
                      </div>
                      <div className="bg-surface-container-low rounded-xl p-3">
                        <p className="text-xs text-on-surface-variant">Tensión</p>
                        <p className="text-lg font-bold text-on-surface mt-0.5">
                          {supply.consumption_data.tension ? `${supply.consumption_data.tension} V` : '-'}
                        </p>
                      </div>
                    </div>

                    {/* Potencia Contratada & Consumo Anual Aggregated */}
                    {(supply.consumption_data.potenciaContratada || supply.consumption_data.consumoPeriodos) && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {supply.consumption_data.potenciaContratada && (
                          <div>
                            <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                              Potencia Contratada (kW)
                            </h4>
                            <div className="grid grid-cols-6 gap-2">
                              {(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const).map((label, i) => (
                                <div key={label} className="bg-surface-container-low rounded-lg p-2 text-center">
                                  <p className="text-[10px] font-semibold" style={{ color: ['#0ea5e9', '#334155', '#f97316', '#06b6d4', '#ec4899', '#eab308'][i] }}>{label}</p>
                                  <p className="text-sm font-bold text-on-surface">
                                    {supply.consumption_data.potenciaContratada[label]?.toLocaleString() || '-'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {supply.consumption_data.consumoPeriodos && (
                          <div>
                            <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                              Consumo Anual por Periodo (kWh)
                            </h4>
                            <div className="grid grid-cols-6 gap-2">
                              {(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const).map((label, i) => (
                                <div key={label} className="bg-surface-container-low rounded-lg p-2 text-center">
                                  <p className="text-[10px] font-semibold" style={{ color: ['#0ea5e9', '#334155', '#f97316', '#06b6d4', '#ec4899', '#eab308'][i] }}>{label}</p>
                                  <p className="text-sm font-bold text-on-surface">
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
                        <div className="flex gap-0 border-b border-outline-variant/20 -mt-1">
                          {tabs.map((tab) => (
                            <button key={tab.key} type="button" onClick={() => setSipsTab(tab.key)}
                              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                                sipsTab === tab.key
                                  ? 'border-primary text-primary'
                                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
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
                        <div className="overflow-x-auto rounded-xl border border-outline-variant/20">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="bg-surface-container-low">
                                <th className="text-left py-1 px-2 font-semibold text-on-surface-variant whitespace-nowrap">Inicio</th>
                                <th className="text-left py-1 px-2 font-semibold text-on-surface-variant whitespace-nowrap">Fin</th>
                                {['P1','P2','P3','P4','P5','P6'].map((p, i) => (
                                  <th key={p} className="text-right py-1 px-1.5 font-semibold whitespace-nowrap" style={{ color: P_COLORS[i] }}>{p}</th>
                                ))}
                                <th className="text-right py-1 px-2 font-bold text-on-surface whitespace-nowrap">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {history.map((p: any, i: number) => {
                                const isTop = topIdx.has(i)
                                const rowCls = isTop ? 'border-t border-outline-variant/10 bg-red-50' : 'border-t border-outline-variant/10 hover:bg-surface-container-low/40'
                                const textCls = isTop ? 'text-red-700 font-semibold' : 'text-on-surface-variant'
                                return (
                                  <tr key={i} className={rowCls}>
                                    <td className={`py-0.5 px-2 whitespace-nowrap ${isTop ? 'text-red-700 font-semibold' : 'text-on-surface'}`}>{fmtD(p.fechaInicio || p.fecha)}</td>
                                    <td className={`py-0.5 px-2 whitespace-nowrap ${textCls}`}>{fmtD(p.fechaFin || '')}</td>
                                    {['P1','P2','P3','P4','P5','P6'].map(k => (
                                      <td key={k} className={`py-0.5 px-1.5 text-right ${textCls}`}>{p[k] ? p[k].toLocaleString() : '-'}</td>
                                    ))}
                                    <td className={`py-0.5 px-2 text-right ${isTop ? 'text-red-700 font-bold' : 'text-on-surface font-bold'}`}>{p.total?.toLocaleString() || '-'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                            {history.length > 1 && (
                              <tfoot>
                                <tr className="border-t-2 border-outline-variant/30 bg-surface-container-low font-bold">
                                  <td className="py-1 px-2 text-on-surface text-[10px]" colSpan={2}>TOTAL</td>
                                  {['P1','P2','P3','P4','P5','P6','total'].map(key => (
                                    <td key={key} className="py-1 px-1.5 text-right text-on-surface text-[10px]">
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
                        <div className="text-center py-8 text-on-surface-variant text-sm">
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
                        if (!cont || !val) return { cls: 'text-on-surface-variant' }
                        const r = val / cont
                        if (r >= 1.15) return { cls: 'text-red-600 font-bold' }
                        if (r >= 1.00) return { cls: 'text-orange-600 font-semibold' }
                        if (r >= 0.90) return { cls: 'text-yellow-700' }
                        return { cls: 'text-green-700' }
                      }
                      return (
                        <div className="space-y-4">
                          {potencia && (
                            <div className="grid grid-cols-6 gap-2">
                              {PERIODS.map((p, i) => {
                                const cont = potencia[p] ?? 0
                                const maxVal = Math.max(...maxHist.map((h: any) => h[p] ?? 0))
                                const r = cont > 0 && maxVal > 0 ? maxVal / cont : null
                                const bg = r === null ? 'bg-surface-container-low text-on-surface'
                                  : r >= 1.15 ? 'bg-red-100 text-red-700'
                                  : r >= 1.00 ? 'bg-orange-100 text-orange-700'
                                  : r >= 0.90 ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-green-100 text-green-700'
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
                          <div className="overflow-x-auto rounded-xl border border-outline-variant/20">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-surface-container-low">
                                  <th className="text-left py-2 px-3 font-semibold text-on-surface-variant whitespace-nowrap">Fecha inicio</th>
                                  <th className="text-left py-2 px-3 font-semibold text-on-surface-variant whitespace-nowrap">Fecha fin</th>
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
                                    <tr key={i} className="border-t border-outline-variant/10 hover:bg-surface-container-low/50 transition-colors">
                                      <td className="py-1.5 px-3 text-on-surface font-medium whitespace-nowrap">{fmtD2(startDate)}</td>
                                      <td className="py-1.5 px-3 text-on-surface-variant whitespace-nowrap">{fmtD2(endDate)}</td>
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
                                <tr className="border-t-2 border-outline-variant/30 bg-surface-container-low font-bold">
                                  <td className="py-2 px-3 text-on-surface" colSpan={2}>MÁX</td>
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
                            <p className="text-[10px] text-on-surface-variant">
                              Semáforo: <span className="text-green-700 font-medium">&lt;90%</span> · <span className="text-yellow-700 font-medium">90–100%</span> · <span className="text-orange-600 font-medium">100–115%</span> · <span className="text-red-600 font-medium">≥115%</span> de la potencia contratada
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
                        <div className="text-center py-8 text-on-surface-variant text-sm">
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
                          <p className="text-[10px] text-on-surface-variant">
                            Energía reactiva desde SIPS. Umbral de penalización: <span className="font-semibold text-orange-600">&gt; {THRESHOLD.toLocaleString()} kvarh</span>.
                          </p>
                          <div className="overflow-x-auto rounded-xl border border-outline-variant/20">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-surface-container-low">
                                  <th className="text-left py-2 px-3 font-semibold text-on-surface-variant whitespace-nowrap">Fecha inicio</th>
                                  <th className="text-left py-2 px-3 font-semibold text-on-surface-variant whitespace-nowrap">Fecha fin</th>
                                  {PERIODS2.map((p, i) => (
                                    <th key={p} className="text-right py-2 px-2 font-semibold whitespace-nowrap" style={{ color: P_COLORS2[i] }}>
                                      {p} <span className="font-normal opacity-60 text-[9px]">kvarh</span>
                                    </th>
                                  ))}
                                  <th className="text-right py-2 px-3 font-bold text-on-surface whitespace-nowrap">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reactivaHist.map((h: any, i: number) => {
                                  const rowTotal = PERIODS2.reduce((s, p) => s + (h[p] || 0), 0)
                                  const hasOver = PERIODS2.some(p => (h[p] || 0) > THRESHOLD)
                                  return (
                                    <tr key={i} className={`border-t border-outline-variant/10 transition-colors ${hasOver ? 'bg-orange-50/50' : 'hover:bg-surface-container-low/50'}`}>
                                      <td className="py-1.5 px-3 text-on-surface font-medium whitespace-nowrap">{fmtD3(h.fechaInicio || h.fecha)}</td>
                                      <td className="py-1.5 px-3 text-on-surface-variant whitespace-nowrap">{fmtD3(h.fechaFin || h.fecha)}</td>
                                      {PERIODS2.map(p => {
                                        const val = h[p] || 0
                                        return (
                                          <td key={p} className={`py-1.5 px-2 text-right ${val > THRESHOLD ? 'text-orange-600 font-semibold' : 'text-on-surface-variant'}`}>
                                            {val > 0 ? val.toLocaleString() : '-'}
                                          </td>
                                        )
                                      })}
                                      <td className={`py-1.5 px-3 text-right font-bold ${hasOver ? 'text-orange-600' : 'text-on-surface'}`}>
                                        {rowTotal > 0 ? rowTotal.toLocaleString() : '-'}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-outline-variant/30 bg-surface-container-low font-bold">
                                  <td className="py-2 px-3 text-on-surface" colSpan={2}>TOTAL</td>
                                  {PERIODS2.map(p => {
                                    const total = reactivaHist.reduce((s, h) => s + (h[p] || 0), 0)
                                    return (
                                      <td key={p} className={`py-2 px-2 text-right ${total > THRESHOLD * reactivaHist.length / 12 ? 'text-orange-600' : 'text-on-surface'}`}>
                                        {total > 0 ? total.toLocaleString() : '-'}
                                      </td>
                                    )
                                  })}
                                  <td className="py-2 px-3 text-right text-on-surface">
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
                      <div className="flex flex-wrap gap-4 text-xs text-on-surface-variant pt-2 border-t border-outline-variant/10">
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
                  <div className="text-center py-6 text-on-surface-variant text-sm">
                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>No hay datos SIPS disponibles</p>
                    <p className="text-xs mt-1">Pulsa "Consultar SIPS" para obtener los datos de consumo</p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* ═══════ ANUAL ECONOMICS panel ═══════ */}
        {activeTab === 'economics' && (
          <AnnualEconomics
            supplyId={supply.id}
            invoices={supply.invoices || []}
            onInvoicesUpdated={async () => {
              // Re-fetch supply data to update indicators
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
        {activeTab === 'potencias' && supply.cups && (
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

        {/* ═══════ TIMESTAMPS ═══════ */}
        <div className="flex gap-4 text-xs text-on-surface-variant">
          <span>Creado: {formatDate(supply.created_at)}</span>
          <span>Actualizado: {formatDate(supply.updated_at)}</span>
        </div>
      </div>

      {/* ═══════ BULK SIGNING MODAL ═══════ */}
      {showBulkSign && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[100] backdrop-blur-sm" onClick={() => setShowBulkSign(false)} />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
            <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b border-outline-variant/15">
                <h3 className="font-display font-semibold text-lg text-on-surface">
                  {pendingTransition === 'presentado' ? 'Marcar como presentado' : 'Firma de contratos'}
                </h3>
                <p className="text-xs text-on-surface-variant mt-1">
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
                            : 'bg-surface-container-high/50 hover:bg-surface-container-high'
                      }`}
                    >
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border ${
                        alreadySigned
                          ? 'bg-success/20 border-success/30'
                          : isSelected
                            ? 'bg-primary border-primary'
                            : 'border-outline-variant/30'
                      }`}>
                        {(isSelected || alreadySigned) && <Check className={`w-3 h-3 ${alreadySigned ? 'text-success' : 'text-white'}`} />}
                      </div>

                      <SIcon className="w-4 h-4 text-on-surface-variant flex-shrink-0" />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">
                          {s.name || s.cups || 'Sin CUPS'}
                        </p>
                        {s.name && s.cups && (
                          <p className="text-[10px] text-on-surface-variant font-mono">{s.cups}</p>
                        )}
                      </div>

                      {alreadySigned ? (
                        <span className="text-[10px] text-success font-medium">
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
              <div className="px-6 py-4 border-t border-outline-variant/15 flex items-center justify-between">
                <p className="text-xs text-on-surface-variant">
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
                  className="flex-1 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
            className="relative bg-surface rounded-3xl shadow-ambient-lg w-full max-w-4xl mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-surface/95 backdrop-blur border-b border-outline-variant/10 rounded-t-3xl">
              <h2 className="font-display font-semibold text-lg text-on-surface">
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
                <button onClick={() => setSupplyOverlayOpen(false)} className="p-2 rounded-xl hover:bg-surface-container-low transition-all">
                  <X className="w-5 h-5 text-on-surface-variant" />
                </button>
              </div>
            </div>

            {/* Download progress bar */}
            {zipProgress && zipProgress.phase !== 'done' && zipProgress.phase !== 'error' && (
              <div className="px-6 py-3 bg-primary/5 border-b border-outline-variant/10">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-on-surface">
                    {zipProgress.phase === 'fetching' ? 'Cargando datos...' :
                     zipProgress.phase === 'zipping' ? 'Generando ZIP...' :
                     `Descargando ${zipProgress.downloaded}/${zipProgress.total}`}
                  </span>
                  <span className="text-[10px] text-on-surface-variant truncate ml-4 max-w-[200px]">{zipProgress.currentFile}</span>
                </div>
                <div className="w-full h-1.5 bg-outline-variant/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
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
                        : 'bg-surface-container-lowest hover:shadow-ambient-lg hover:-translate-y-0.5'
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
                          {isCurrent && <Check className="w-3.5 h-3.5 text-primary" />}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <h3 className={`text-sm font-semibold truncate transition-colors ${isCurrent ? 'text-primary' : 'text-on-surface group-hover/card:text-primary'}`}>
                          {s.name || s.cups || 'Sin CUPS'}
                        </h3>
                        {s.name && s.cups && (
                          <p className="text-[10px] font-mono text-on-surface-variant truncate mt-0.5">{s.cups}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-surface-container-low/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-semibold">Tarifa</p>
                          <p className="text-xs text-on-surface font-semibold truncate">{s.tariff || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-surface-container-low/60 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-semibold">Tipo</p>
                          <p className="text-xs text-on-surface font-semibold capitalize truncate">{s.type || '—'}</p>
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
            className="relative bg-surface rounded-3xl shadow-ambient-lg w-full max-w-4xl mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-surface/95 backdrop-blur border-b border-outline-variant/10 rounded-t-3xl">
              <h2 className="font-display font-semibold text-lg text-on-surface flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Gestor de documentos
              </h2>
              <button onClick={() => setDocsOverlayOpen(false)} className="p-2 rounded-xl hover:bg-surface-container-low transition-all">
                <X className="w-5 h-5 text-on-surface-variant" />
              </button>
            </div>

            <div className="p-6 space-y-6">

              {/* ── 1. FACTURAS DEL CLIENTE ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    Facturas del cliente
                  </h3>
                  <button
                    type="button"
                    onClick={() => invoiceInputRef.current?.click()}
                    disabled={uploadingInvoices}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition disabled:opacity-50"
                  >
                    {uploadingInvoices ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Subir facturas
                  </button>
                </div>

                {/* Upload progress */}
                {Object.keys(uploadProgress).length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {Object.entries(uploadProgress).map(([name, status]) => (
                      <div key={name} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-surface-container-low">
                        {status === 'uploading' && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                        {status === 'analyzing' && <Loader2 className="w-3 h-3 animate-spin text-amber-500" />}
                        {status === 'done' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                        {status === 'error' && <XCircle className="w-3 h-3 text-red-500" />}
                        <span className="truncate flex-1 text-on-surface-variant">{name}</span>
                        <span className="text-[10px] font-medium capitalize text-on-surface-variant/70">
                          {status === 'uploading' ? 'Subiendo...' : status === 'analyzing' ? 'Analizando...' : status === 'done' ? 'Listo' : 'Error'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {supply.invoices && supply.invoices.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {[...supply.invoices]
                      .sort((a: any, b: any) => new Date(b.period_start || b.created_at).getTime() - new Date(a.period_start || a.created_at).getTime())
                      .map((inv: any) => {
                        const period = inv.period_start
                          ? new Date(inv.period_start).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
                          : null
                        return (
                          <div key={inv.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/10 hover:border-blue-200 transition">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-4 h-4 text-blue-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-on-surface truncate">
                                {period || 'Sin periodo'}
                              </p>
                              {inv.extracted_data?.total_amount && (
                                <p className="text-[10px] text-on-surface-variant">{formatCurrency(inv.extracted_data.total_amount)}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {inv.file_url && (
                                <a href={getViewUrl(inv.file_url)} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-blue-50 transition" title="Ver">
                                  <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                                </a>
                              )}
                              <button
                                onClick={() => handleDeleteInvoice(inv)}
                                disabled={deletingInvoiceId === inv.id}
                                className="p-1.5 rounded-lg hover:bg-red-50 transition"
                                title="Eliminar"
                              >
                                {deletingInvoiceId === inv.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                )}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                ) : (
                  <div className="text-center py-6 rounded-xl bg-surface-container-low/50">
                    <FileText className="w-8 h-8 text-on-surface-variant/30 mx-auto mb-2" />
                    <p className="text-xs text-on-surface-variant">Sin facturas</p>
                    <button onClick={() => invoiceInputRef.current?.click()} className="text-xs text-primary font-semibold mt-1 hover:underline">
                      Subir primera factura
                    </button>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-outline-variant/10" />

              {/* ── 2. INFORMES ── */}
              <div>
                <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  Informes
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Potencias */}
                  <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 mb-1">
                      <BarChart3 className="w-4 h-4 text-amber-500" />
                      <h4 className="text-xs font-bold text-on-surface">Informe de Potencias</h4>
                    </div>
                    {supply.power_study_result ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                          <span className="text-xs text-green-700 font-medium">Generado</span>
                        </div>
                        <button
                          onClick={handleDownloadPowerStudyPDF}
                          className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition mt-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Ver informe
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-on-surface-variant">Pendiente de datos SIPS</p>
                    )}
                  </div>

                  {/* Económico */}
                  <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-green-500" />
                        <h4 className="text-xs font-bold text-on-surface">Informe Económico</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => studyInputRef.current?.click()}
                        disabled={uploadingStudy}
                        className="text-xs text-primary font-semibold hover:text-primary/80 transition flex items-center gap-1"
                      >
                        {uploadingStudy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                        Subir
                      </button>
                    </div>
                    {supply.studies && supply.studies.filter((s: any) => s.status === 'completed').length > 0 ? (
                      <div className="space-y-2">
                        {supply.studies
                          .filter((s: any) => s.status === 'completed')
                          .sort((a: any, b: any) => new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime())
                          .map((study: any) => (
                            <div key={study.id} className="group flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-container-low/60 hover:bg-green-50/50 transition">
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                              <span className="text-xs text-on-surface flex-1 truncate">
                                {study.completed_at ? formatDate(study.completed_at) : 'Informe'}
                              </span>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {study.report_url && (
                                  <a href={getViewUrl(study.report_url)} target="_blank" rel="noopener noreferrer" className="p-1 rounded-lg hover:bg-green-100 transition" title="Ver">
                                    <ExternalLink className="w-3.5 h-3.5 text-green-600" />
                                  </a>
                                )}
                                <button
                                  onClick={() => handleDeleteStudy(study)}
                                  disabled={deletingStudyId === study.id}
                                  className="p-1 rounded-lg hover:bg-red-50 transition"
                                  title="Eliminar"
                                >
                                  {deletingStudyId === study.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                  )}
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-xs text-on-surface-variant">Sin informes económicos</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-outline-variant/10" />

              {/* ── 3. CONTRATOS ── */}
              <div>
                <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  Contratos
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Voltis */}
                  <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-primary" />
                      <h4 className="text-xs font-bold text-on-surface">Contrato Voltis</h4>
                    </div>
                    {supply.contracts && supply.contracts.filter((c: any) => c.type === 'voltis' || c.contract_type === 'voltis').length > 0 ? (
                      <div className="space-y-2">
                        {supply.contracts
                          .filter((c: any) => c.type === 'voltis' || c.contract_type === 'voltis')
                          .map((contract: any) => (
                            <div key={contract.id} className="group flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-container-low/60 hover:bg-primary/5 transition">
                              <FileText className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                              <span className="text-xs text-on-surface flex-1 truncate">
                                {contract.signed_at ? formatDate(contract.signed_at) : 'Contrato'}
                              </span>
                              {(contract.document_url || contract.file_url) && (
                                <a
                                  href={getViewUrl(contract.document_url || contract.file_url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1 rounded-lg hover:bg-primary/10 transition opacity-0 group-hover:opacity-100"
                                  title="Ver contrato"
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-primary" />
                                </a>
                              )}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-xs text-on-surface-variant">Sin contrato Voltis</p>
                    )}
                  </div>

                  {/* Comercializadora */}
                  <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-4 h-4 text-purple-500" />
                      <h4 className="text-xs font-bold text-on-surface">Contrato Comercializadora</h4>
                    </div>
                    {supply.comercializadora && (
                      <p className="text-[10px] text-on-surface-variant mb-2">{supply.comercializadora.name}</p>
                    )}
                    {supply.contracts && supply.contracts.filter((c: any) => c.type === 'comercializadora' || c.contract_type === 'comercializadora').length > 0 ? (
                      <div className="space-y-2">
                        {supply.contracts
                          .filter((c: any) => c.type === 'comercializadora' || c.contract_type === 'comercializadora')
                          .map((contract: any) => (
                            <div key={contract.id} className="group flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-container-low/60 hover:bg-purple-50/50 transition">
                              <FileText className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                              <span className="text-xs text-on-surface flex-1 truncate">
                                {contract.signed_at ? formatDate(contract.signed_at) : 'Contrato'}
                              </span>
                              {(contract.document_url || contract.file_url) && (
                                <a
                                  href={getViewUrl(contract.document_url || contract.file_url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1 rounded-lg hover:bg-purple-100 transition opacity-0 group-hover:opacity-100"
                                  title="Ver contrato"
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-purple-500" />
                                </a>
                              )}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-xs text-on-surface-variant">Sin contrato comercializadora</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-outline-variant/10" />

              {/* ── 4. FACTURAS DESDE ACTIVACIÓN ── */}
              <div>
                <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  Facturas desde activación
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Facturas Voltis */}
                  <div className="rounded-xl border border-outline-variant/10 border-dashed bg-surface-container-low/30 p-4 flex flex-col items-center gap-2">
                    <Zap className="w-5 h-5 text-on-surface-variant/30" />
                    <p className="text-xs text-on-surface-variant text-center">Facturas Voltis</p>
                    <p className="text-[10px] text-on-surface-variant/60 text-center">Disponible tras activación</p>
                  </div>

                  {/* Facturas Comercializadora */}
                  <div className="rounded-xl border border-outline-variant/10 border-dashed bg-surface-container-low/30 p-4 flex flex-col items-center gap-2">
                    <Building2 className="w-5 h-5 text-on-surface-variant/30" />
                    <p className="text-xs text-on-surface-variant text-center">Facturas Comercializadora</p>
                    <p className="text-[10px] text-on-surface-variant/60 text-center">Disponible tras activación</p>
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
        <div className="fixed bottom-4 right-4 z-40">
          <div
            className={`px-4 py-3 rounded-lg shadow-lg border flex items-center gap-3 max-w-sm animate-in slide-in-from-bottom-4 ${
              notification.type === 'success'
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-error/10 border-error/30 text-error'
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
    </div>
  )
}
