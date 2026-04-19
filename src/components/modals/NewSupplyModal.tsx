'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Zap, Upload, Check, AlertCircle, BarChart3, Loader2, AlertTriangle, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { SearchableClientSelector } from '@/components/ui/SearchableClientSelector'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { normalizeCups } from '@/lib/utils/cups'
import { ensurePendingPrescoring } from '@/lib/ensurePrescoring'

/** Convert DD/MM/YYYY or DD/MM/YY to YYYY-MM-DD for PostgreSQL. Returns null if unparseable. */
function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m) {
    const day = m[1].padStart(2, '0')
    const month = m[2].padStart(2, '0')
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${month}-${day}`
  }
  return null
}
import type { SupplyType } from '@/types/database'

interface NewSupplyModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
  preselectedClientId?: string
}

interface UploadedFile {
  id: string
  file: File
  url?: string
  storagePath?: string  // Supabase Storage path for server-side download
  analyzing?: boolean
  extractedData?: ExtractedInvoiceData
  error?: string
}

interface ExtractedInvoiceData {
  mode: 'gemini' | 'manual'
  holder_name?: string
  holder_cif_nif?: string
  billing_address?: string
  supply_address?: string
  cups?: string
  emission_date?: string
  billing_period?: string
  type?: 'luz' | 'gas' | 'telefonia'
  tariff?: string
  comercializadora?: string
  total_amount?: string
  // Full economics data extracted by unified Gemini prompt
  economics?: {
    fechaInicio?: string
    fechaFin?: string
    titular?: string
    comercializadora?: string
    cups?: string
    tarifa?: string
    consumo?: Array<{ periodo: string; kwh: number; precioKwh: number; total: number; precioEstimado?: boolean }>
    potencia?: Array<{ periodo: string; kw: number; precioKwDia: number; dias: number; total: number }>
    otrosConceptos?: Array<{ concepto: string; total: number }>
    consumoTotalKwh?: number
    costeTotalConsumo?: number
    costeMedioKwh?: number
    costeTotalPotencia?: number
    totalFactura?: number
  }
  error?: string
}

interface SipsData {
  cups: string
  tariff?: string
  totalConsumption?: string
  totalConsumptionKwh?: number
  consumoPeriodos?: { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
  potenciaContratada?: { P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }
  consumptionHistory?: Array<{ fecha: string; P1: number; P2: number; P3: number; P4: number; P5: number; P6: number; total: number }>
  maximetroHistory?: Array<{ fecha: string; P1: number; P2: number; P3: number; P4: number; P5: number; P6: number }>
  distribuidora?: string
  codigoPostal?: string
  provincia?: string
  municipio?: string
  cnae?: string
  tension?: string
  fechaAlta?: string
  fechaUltimaLectura?: string
}

export function NewSupplyModal({ open, onClose, onCreated, preselectedClientId }: NewSupplyModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [comercializadoras, setComercializadoras] = useState<{ value: string; label: string }[]>([])
  const [form, setForm] = useState({
    client_id: preselectedClientId || '',
    titular_name: '',
    billing_address: '',
    supply_address: '',
    cups: '',
    type: 'luz' as SupplyType,
    tariff: '2.0',
    comercializadora_id: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sipsData, setSipsData] = useState<SipsData | null>(null)
  const [sipsLoading, setSipsLoading] = useState(false)
  const [sipsError, setSipsError] = useState('')
  const [sipsTab, setSipsTab] = useState<'consumos' | 'maximetros'>('consumos')
  // CUPS duplicate detection
  const [cupsChecking, setCupsChecking] = useState(false)
  const [cupsDuplicates, setCupsDuplicates] = useState<{ id: string; client_name: string; status: string; client_id: string }[]>([])
  const [cupsCheckDone, setCupsCheckDone] = useState(false)
  const cupsCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragZoneRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { user } = useAuthStore()

  // Load clients and comercializadoras
  useEffect(() => {
    if (!open) return

    setStep(1)
    setUploadedFiles([])
    setError('')
    setSipsData(null)
    setSipsLoading(false)
    setSipsError('')
    setCupsDuplicates([])
    setCupsCheckDone(false)
    setCupsChecking(false)
    setForm({
      client_id: preselectedClientId || '',
      titular_name: '',
      billing_address: '',
      supply_address: '',
      cups: '',
      type: 'luz',
      tariff: '2.0',
      comercializadora_id: '',
    })

    const fetchData = async () => {
      const supabase = createClient()
      const [clientsRes, comRes] = await Promise.all([
        supabase.from('clients').select('id, name').order('name'),
        supabase.from('comercializadoras').select('id, name').eq('active', true).order('name'),
      ])

      if (clientsRes.data) {
        setClients(clientsRes.data as { id: string; name: string }[])
      }
      if (comRes.data) {
        setComercializadoras([
          { value: '', label: 'Sin asignar' },
          ...comRes.data.map((c) => ({ value: c.id, label: c.name })),
        ])
      }
    }
    fetchData()
  }, [open, preselectedClientId])

  // Fetch SIPS data when CUPS is available
  const fetchSipsData = useCallback(async (cups: string) => {
    if (!cups || cups.length < 20) return

    setSipsLoading(true)
    setSipsError('')
    setSipsData(null)

    try {
      console.log('[SIPS] Fetching data for CUPS:', cups)
      const res = await fetch('/api/sips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cups }),
      })

      const result = await res.json()
      console.log('[SIPS] Result:', result)

      if (result.success && result.data) {
        setSipsData(result.data)
        // SIPS tariff is authoritative — override whatever was extracted from the invoice
        if (result.data.tariff) {
          const s = result.data.tariff.toUpperCase().replace(/\s+/g, '')
          // Match to the longest known prefix first (6.4, 6.3, 6.2 before 6.1)
          const prefix = ['6.4', '6.3', '6.2', '6.1', '3.0', '2.0'].find((p) => s.startsWith(p))
          if (prefix) {
            // 6.2/6.3/6.4 map to '6.1' in the form (all high-voltage tariffs)
            const formTariff = ['6.2', '6.3', '6.4'].includes(prefix) ? '6.1' : prefix
            setForm((prev) => ({ ...prev, tariff: formTariff }))
          }
        }
      } else {
        setSipsError(result.error || 'No se encontraron datos SIPS')
      }
    } catch (err: any) {
      console.error('[SIPS] Error:', err)
      setSipsError(err.message || 'Error consultando SIPS')
    } finally {
      setSipsLoading(false)
    }
  }, [])

  // Check for duplicate CUPS across all supplies (debounced)
  const checkCupsDuplicate = useCallback(async (cups: string) => {
    if (!cups || cups.length < 20) {
      setCupsDuplicates([])
      setCupsCheckDone(false)
      return
    }

    setCupsChecking(true)
    setCupsCheckDone(false)
    try {
      const res = await fetch('/api/check-cups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cups }),
      })
      const data = await res.json()
      setCupsDuplicates(data.exists ? data.supplies : [])
    } catch {
      setCupsDuplicates([])
    } finally {
      setCupsChecking(false)
      setCupsCheckDone(true)
    }
  }, [])

  // Debounce CUPS check when user types
  const handleCupsChange = useCallback((value: string) => {
    const upper = value.toUpperCase()
    setForm((p) => ({ ...p, cups: upper }))
    setCupsCheckDone(false)
    setCupsDuplicates([])

    if (cupsCheckTimer.current) clearTimeout(cupsCheckTimer.current)
    if (upper.length >= 20) {
      cupsCheckTimer.current = setTimeout(() => {
        checkCupsDuplicate(upper)
        fetchSipsData(upper)
      }, 600)
    }
  }, [checkCupsDuplicate, fetchSipsData])

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dragZoneRef.current) {
      dragZoneRef.current.classList.add('border-brand/60', 'bg-secondary/5')
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dragZoneRef.current) {
      dragZoneRef.current.classList.remove('border-brand/60', 'bg-secondary/5')
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dragZoneRef.current) {
      dragZoneRef.current.classList.remove('border-brand/60', 'bg-secondary/5')
    }

    const files = Array.from(e.dataTransfer.files)
    await handleFiles(files)
  }

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    await handleFiles(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFiles = async (files: File[]) => {
    setError('')

    // Validate and filter files
    const validFiles = files.filter((file) => {
      const ext = file.name.toLowerCase().split('.').pop()
      const validExts = ['pdf', 'jpg', 'jpeg', 'png', 'zip']
      if (!validExts.includes(ext || '')) {
        setError(`Archivo ${file.name} no es válido. Solo PDF, imágenes (JPG, PNG) o ZIP.`)
        return false
      }
      if (file.size > 20 * 1024 * 1024) {
        setError(`${file.name} excede 20MB.`)
        return false
      }
      return true
    })

    if (validFiles.length === 0) return

    // Upload files to Supabase Storage
    const supabase = createClient()
    const newFiles: UploadedFile[] = []

    for (const file of validFiles) {
      const fileId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const ext = file.name.split('.').pop()

      try {
        const filePath = `invoices/${Date.now()}/${fileId}.${ext}`
        const { data, error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
          })

        if (uploadError) {
          console.error('Supabase upload error:', uploadError)
          // Continue with analysis even if storage upload fails — file is still in memory
          const uploadedFile: UploadedFile = {
            id: fileId,
            file,
            url: '',
            storagePath: '',
            analyzing: true,
          }
          newFiles.push(uploadedFile)
          continue
        }

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(data.path)

        const uploadedFile: UploadedFile = {
          id: fileId,
          file,
          url: urlData.publicUrl,
          storagePath: data.path,  // Save storage path for server-side download
          analyzing: true,
        }

        newFiles.push(uploadedFile)
      } catch (err: any) {
        console.error('Upload error:', err)
        // Don't block analysis — still add file for Gemini processing
        const uploadedFile: UploadedFile = {
          id: fileId,
          file,
          url: '',
          storagePath: '',
          analyzing: true,
        }
        newFiles.push(uploadedFile)
      }
    }

    setUploadedFiles((prev) => [...prev, ...newFiles])

    // ── Multi-page invoice support ──
    // When multiple files are uploaded together they likely represent the same
    // invoice spread across pages (e.g. front + detail scan). Send them ALL to
    // Gemini in a single request so it can see the CUPS from page 2 while
    // reading economics from page 1, etc.
    //
    // Single-file uploads use the same path (no extra_pages sent).

    try {
      // Step 1: Read all new files as base64 in parallel
      const filePages = await Promise.all(
        newFiles.map(async (uploadedFile) => {
          const fileType = uploadedFile.file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const result = reader.result as string
              resolve(result.split(',')[1])
            }
            reader.onerror = () => reject(new Error('Error leyendo archivo'))
            reader.readAsDataURL(uploadedFile.file)
          })
          return { id: uploadedFile.id, base64, fileType, fileName: uploadedFile.file.name }
        })
      )

      // Step 2: Send all pages in one request (primary + extra_pages)
      const [primary, ...rest] = filePages
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 180000) // 3 min for multi-page

      const response = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_base64: primary.base64,
          file_type: primary.fileType,
          file_name: primary.fileName,
          ...(rest.length > 0 && {
            extra_pages: rest.map(p => ({
              file_base64: p.base64,
              file_type: p.fileType,
              file_name: p.fileName,
            }))
          }),
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Error del servidor')
        throw new Error(`Error ${response.status}: ${errorText.substring(0, 200)}`)
      }

      const result = (await response.json()) as ExtractedInvoiceData
      console.log('[Invoice Analysis] Multi-page result (', filePages.length, 'pages ):', JSON.stringify(result))

      // Step 3: Assign the combined result to the primary file, mark rest as analysed
      setUploadedFiles((prev) =>
        prev.map((f) => {
          if (f.id === primary.id) {
            return {
              ...f,
              analyzing: false,
              extractedData: result,
              error: result.mode === 'manual' && result.error ? result.error : undefined,
            }
          }
          if (rest.some(r => r.id === f.id)) {
            // Secondary pages: mark done but share the combined result
            return { ...f, analyzing: false, extractedData: result }
          }
          return f
        })
      )
    } catch (err: any) {
      console.error('Analysis error:', err)
      const errorMsg = err.name === 'AbortError'
        ? 'Tiempo de espera agotado. El archivo puede ser demasiado grande.'
        : err.message === 'Failed to fetch'
          ? 'Error de conexion. Verifica tu conexion a internet e intenta de nuevo.'
          : err.message || 'Error al analizar'
      // Mark all new files as failed
      setUploadedFiles((prev) =>
        prev.map((f) =>
          newFiles.some(nf => nf.id === f.id)
            ? { ...f, analyzing: false, error: errorMsg }
            : f
        )
      )
    }
  }

  const removeFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  // Get tariff options based on type
  const tariffOptions = form.type === 'luz'
    ? [
        { value: '2.0', label: '2.0' },
        { value: '3.0', label: '3.0' },
        { value: '6.1', label: '6.1' },
      ]
    : form.type === 'gas'
    ? [
        { value: 'RL1', label: 'RL1' },
        { value: 'RL2', label: 'RL2' },
        { value: 'RL3', label: 'RL3' },
        { value: 'RL4', label: 'RL4' },
      ]
    : [
        { value: 'Movil', label: 'Movil' },
        { value: 'Fibra', label: 'Fibra' },
        { value: 'Convergente', label: 'Convergente' },
      ]

  const handleProceedToReview = () => {
    // Merge extracted data from ALL files: take the best value for each field
    // (e.g. CUPS from page 2, economics from page 1)
    const allExtracted = uploadedFiles
      .filter((f) => f.extractedData?.mode === 'gemini' && !f.error)
      .map((f) => f.extractedData!)

    if (allExtracted.length === 0) return

    // Build merged data: for each field, take first non-null value across all pages
    const merged: typeof allExtracted[0] = { ...allExtracted[0] }
    for (const d of allExtracted.slice(1)) {
      if (!merged.cups && d.cups) merged.cups = d.cups
      if (!merged.holder_name && d.holder_name) merged.holder_name = d.holder_name
      if (!merged.holder_cif_nif && d.holder_cif_nif) merged.holder_cif_nif = d.holder_cif_nif
      if (!merged.supply_address && d.supply_address) merged.supply_address = d.supply_address
      if (!merged.tariff && d.tariff) merged.tariff = d.tariff
      if (!merged.comercializadora && d.comercializadora) merged.comercializadora = d.comercializadora
      if (!merged.billing_period && d.billing_period) merged.billing_period = d.billing_period
      if (!merged.total_amount && d.total_amount) merged.total_amount = d.total_amount
      if (!merged.type && d.type) merged.type = d.type
      // Prefer the economics with more entries (more detailed)
      const curCount = (merged.economics?.consumo?.length || 0) + (merged.economics?.potencia?.length || 0)
      const newCount = (d.economics?.consumo?.length || 0) + (d.economics?.potencia?.length || 0)
      if (newCount > curCount) merged.economics = d.economics
    }

    const firstFileWithData = { extractedData: merged }
    if (firstFileWithData?.extractedData) {
      const data = firstFileWithData.extractedData
      const extractedType = (data.type as SupplyType) || 'luz'

      // Get valid tariff options for the extracted type
      const validTariffs = extractedType === 'luz'
        ? ['2.0', '3.0', '6.1']
        : extractedType === 'gas'
        ? ['RL1', 'RL2', 'RL3', 'RL4']
        : ['Movil', 'Fibra', 'Convergente']

      // Match extracted tariff to valid options (case-insensitive, partial match)
      let matchedTariff = ''
      if (data.tariff) {
        const extracted = data.tariff.trim()
        matchedTariff = validTariffs.find(
          (t) => t.toLowerCase() === extracted.toLowerCase() || extracted.toLowerCase().startsWith(t.toLowerCase())
        ) || ''
      }
      if (!matchedTariff) {
        matchedTariff = validTariffs[0] // Default to first option
      }

      setForm((prev) => ({
        ...prev,
        titular_name: data.holder_name || prev.titular_name,
        billing_address: data.billing_address || prev.billing_address,
        supply_address: data.supply_address || prev.supply_address,
        cups: data.cups || prev.cups,
        type: extractedType,
        tariff: matchedTariff,
        comercializadora_id: prev.comercializadora_id,
      }))

      // Find comercializadora by name if extracted
      if (data.comercializadora && comercializadoras.length > 0) {
        const found = comercializadoras.find(
          (c) => c.label.toLowerCase().includes(data.comercializadora?.toLowerCase() || '')
        )
        if (found) {
          setForm((prev) => ({ ...prev, comercializadora_id: found.value }))
        }
      }

      // Auto-fetch SIPS data and check duplicates if CUPS was extracted
      if (data.cups && data.cups.length >= 20) {
        fetchSipsData(data.cups)
        checkCupsDuplicate(data.cups)
      }
    }

    setStep(2)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.client_id) {
      setError('Selecciona un cliente')
      return
    }

    setSaving(true)
    setError('')

    try {
      const supabase = createClient()

      const normalizedCups = normalizeCups(form.cups) || null
      const hasInvoicesToAdd = uploadedFiles.some((f) => f.url)
      const hasExtractedData = uploadedFiles.some((f) => f.extractedData?.mode === 'gemini' && !f.error)

      // ── Authoritative duplicate CUPS check (always query DB, regardless of UI state) ──
      let targetSupplyId: string | null = null
      let isExistingSupply = false

      if (normalizedCups) {
        const { data: existingSupplies } = await supabase
          .from('supplies')
          .select('id, client_id')
          .eq('cups', normalizedCups)
          .limit(1)

        if (existingSupplies && existingSupplies.length > 0) {
          if (hasInvoicesToAdd) {
            // Merge: attach uploaded invoices to the existing supply
            targetSupplyId = existingSupplies[0].id
            isExistingSupply = true
          } else {
            // Hard block: CUPS already exists and nothing to merge
            setError('Este CUPS ya está registrado en otro suministro. Abre ese suministro para modificarlo.')
            setSaving(false)
            return
          }
        }
      }

      // ── Create new supply only if CUPS is not a duplicate ──
      if (!isExistingSupply) {
        const initialStatus = hasExtractedData ? 'estudio_en_curso' : 'primer_contacto'

        const { data: supplyData, error: supplyError } = await supabase
          .from('supplies')
          .insert({
            client_id: form.client_id,
            cups: normalizedCups,
            type: form.type,
            tariff: form.tariff,
            address: form.supply_address.trim() || null,
            comercializadora_id: form.comercializadora_id || null,
            status: initialStatus,
            consumption_data: sipsData ? {
              source: 'greening_sips',
              fetched_at: new Date().toISOString(),
              total: sipsData.totalConsumption,
              totalKwh: sipsData.totalConsumptionKwh,
              sips_tariff: sipsData.tariff,
              consumoPeriodos: sipsData.consumoPeriodos,
              potenciaContratada: sipsData.potenciaContratada,
              history: sipsData.consumptionHistory || [],
              distribuidora: sipsData.distribuidora,
              codigoPostal: sipsData.codigoPostal,
              provincia: sipsData.provincia,
              municipio: sipsData.municipio,
              cnae: sipsData.cnae,
              tension: sipsData.tension,
              fechaAlta: sipsData.fechaAlta,
              fechaUltimaLectura: sipsData.fechaUltimaLectura,
            } : null,
          })
          .select('id')
          .single()

        if (supplyError) {
          // Handle unique constraint conflict (race condition with Telegram/email)
          if (normalizedCups && (supplyError.code === '23505' || supplyError.message?.includes('unique') || supplyError.message?.includes('duplicate'))) {
            const { data: existing } = await supabase
              .from('supplies')
              .select('id')
              .eq('cups', normalizedCups)
              .limit(1)
              .single()
            if (existing) {
              targetSupplyId = existing.id
              isExistingSupply = true
            } else {
              throw supplyError
            }
          } else {
            throw supplyError
          }
        } else {
          targetSupplyId = supplyData.id
        }
      }

      // ── Attach invoices to targetSupplyId (new or existing) ──
      const invoiceInserts = uploadedFiles
        .filter((f) => f.url)
        .map((f) => {
          const eco = f.extractedData?.economics
          // Prefer economics-derived dates (more precise) over billing_period string
          const periodStart = eco?.fechaInicio
            ? toIsoDate(eco.fechaInicio)
            : toIsoDate(f.extractedData?.billing_period?.split(/\s*[-–]\s*/)[0])
          const periodEnd = eco?.fechaFin
            ? toIsoDate(eco.fechaFin)
            : toIsoDate(f.extractedData?.billing_period?.split(/\s*[-–]\s*/)[1])
          const totalAmount = eco?.totalFactura
            ? eco.totalFactura
            : f.extractedData?.total_amount ? parseFloat(f.extractedData.total_amount) : null
          return {
            supply_id: targetSupplyId,
            file_url: f.url,
            file_type: f.file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image',
            extracted_data: f.extractedData ? JSON.parse(JSON.stringify(f.extractedData)) : null,
            extraction_status: f.extractedData ? 'completed' : 'pending',
            period_start: periodStart,
            period_end: periodEnd,
            total_amount: totalAmount,
          }
        })

      if (invoiceInserts.length > 0) {
        const { error: invoiceError } = await supabase.from('invoices').insert(invoiceInserts)
        if (invoiceError) throw invoiceError
      }

      // ── Ensure a pending prescoring row exists for this supply ──
      // Idempotent helper: skips 2.0 tariffs internally and is a no-op if a
      // row already exists. Runs for both brand-new and pre-existing supplies
      // so a CUPS that lacked one (e.g. created via an older path) gets it now.
      if (targetSupplyId) {
        await ensurePendingPrescoring(supabase, targetSupplyId, { userId: user?.id, updateNulls: true })
      }

      onCreated()
      onClose()
    } catch (err: any) {
      console.error('Error creating supply:', err)
      setError(err.message || 'Error al crear el suministro')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-bg rounded-2xl shadow-ambient-lg w-full max-w-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line-2-variant/30 sticky top-0 bg-bg z-10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-secondary/10 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-brand" />
                </div>
                <div>
                  <h2 className="font-sans font-semibold text-ink">
                    {step === 1 ? 'Subir Facturas' : 'Revisar y Crear Suministro'}
                  </h2>
                  <p className="text-xs text-ink-3">
                    {step === 1 ? 'Paso 1 de 2' : 'Paso 2 de 2'}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-ink-3 hover:bg-bg-2 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {step === 1 ? (
                // Step 1: Upload
                <div className="space-y-6">
                  {/* Drag and Drop Zone */}
                  <div
                    ref={dragZoneRef}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className="border-2 border-dashed border-line-2-variant/40 rounded-2xl p-8 text-center transition-all cursor-pointer hover:border-brand/40 hover:bg-secondary/5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-8 h-8 text-brand mx-auto mb-3" />
                    <p className="text-sm font-medium text-ink">Arrastra facturas aquí</p>
                    <p className="text-xs text-ink-3 mt-1">
                      PDF, imágenes (JPG, PNG) o ZIP
                    </p>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.zip"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />

                  {/* Uploaded Files List */}
                  {uploadedFiles.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-ink">Archivos subidos</h3>
                      {uploadedFiles.map((file) => (
                        <motion.div
                          key={file.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-4 bg-bg-2 rounded-xl border border-line-2-variant/20"
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-ink truncate">{file.file.name}</p>
                              <p className="text-xs text-ink-3">
                                {(file.file.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                            <button
                              onClick={() => removeFile(file.id)}
                              className="p-2 rounded-lg text-ink-3 hover:text-err hover:bg-err-container/30 transition-all"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          {file.analyzing && (
                            <div className="flex items-center gap-2 text-xs text-ink-3">
                              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Analizando...
                            </div>
                          )}

                          {file.error && (
                            <div className="flex items-center gap-2 text-xs text-err">
                              <AlertCircle className="w-3 h-3 flex-shrink-0" />
                              {file.error}
                            </div>
                          )}

                          {file.extractedData && !file.error && file.extractedData.mode === 'gemini' && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-xs text-ok mb-2">
                                <Check className="w-3 h-3 flex-shrink-0" />
                                Datos extraídos con IA
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {file.extractedData.holder_name && (
                                  <div>
                                    <span className="text-ink-3">Titular:</span>
                                    <p className="text-ink font-medium">{file.extractedData.holder_name}</p>
                                  </div>
                                )}
                                {file.extractedData.cups && (
                                  <div>
                                    <span className="text-ink-3">CUPS:</span>
                                    <p className="text-ink font-medium">{file.extractedData.cups}</p>
                                  </div>
                                )}
                                {file.extractedData.type && (
                                  <div>
                                    <span className="text-ink-3">Tipo:</span>
                                    <p className="text-ink font-medium capitalize">{file.extractedData.type}</p>
                                  </div>
                                )}
                                {file.extractedData.comercializadora && (
                                  <div>
                                    <span className="text-ink-3">Comercializadora:</span>
                                    <p className="text-ink font-medium">{file.extractedData.comercializadora}</p>
                                  </div>
                                )}
                                {file.extractedData.total_amount && (
                                  <div>
                                    <span className="text-ink-3">Importe:</span>
                                    <p className="text-ink font-medium">{file.extractedData.total_amount} EUR</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {file.extractedData && !file.error && file.extractedData.mode === 'manual' && (
                            <div className="flex items-center gap-2 text-xs text-ink-3">
                              <AlertCircle className="w-3 h-3 flex-shrink-0 text-warn" />
                              {file.extractedData.error
                                ? `No se pudo analizar: ${file.extractedData.error}`
                                : 'Analisis IA no disponible — rellena los datos manualmente'}
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {error && (
                    <div className="bg-err-container rounded-xl px-4 py-2.5">
                      <p className="text-sm text-err font-medium">{error}</p>
                    </div>
                  )}

                  {/* Step 1 Actions */}
                  <div className="flex gap-3 justify-end pt-4">
                    <Button variant="secondary" type="button" onClick={onClose}>
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleProceedToReview}
                      disabled={uploadedFiles.length === 0 || uploadedFiles.some((f) => f.analyzing)}
                    >
                      Continuar a Revisión
                    </Button>
                  </div>
                </div>
              ) : (
                // Step 2: Review & Create
                <form onSubmit={handleSubmit} className="space-y-4">
                  {!preselectedClientId && (
                    <SearchableClientSelector
                      label="Cliente *"
                      required
                      value={form.client_id}
                      onChange={(clientId) => setForm((p) => ({ ...p, client_id: clientId }))}
                      clients={clients}
                      placeholder="Buscar cliente..."
                    />
                  )}

                  <Input
                    id="titular_name"
                    label="Nombre del Titular"
                    placeholder="Nombre extraído de la factura"
                    value={form.titular_name}
                    onChange={(e) => setForm((p) => ({ ...p, titular_name: e.target.value }))}
                  />

                  <Input
                    id="billing_address"
                    label="Dirección de Facturación"
                    placeholder="Dirección de facturación"
                    value={form.billing_address}
                    onChange={(e) => setForm((p) => ({ ...p, billing_address: e.target.value }))}
                  />

                  <Input
                    id="supply_address"
                    label="Dirección del Suministro"
                    placeholder="Donde está el contador"
                    value={form.supply_address}
                    onChange={(e) => setForm((p) => ({ ...p, supply_address: e.target.value }))}
                  />

                  <Input
                    id="cups"
                    label="CUPS"
                    placeholder="ES0000000000000000XX"
                    value={form.cups}
                    onChange={(e) => handleCupsChange(e.target.value)}
                    hint="Código Universal de Punto de Suministro"
                  />

                  {/* CUPS duplicate detection feedback */}
                  {cupsChecking && (
                    <div className="flex items-center gap-2 text-xs text-ink-3 mt-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Verificando CUPS...</span>
                    </div>
                  )}

                  {!cupsChecking && cupsCheckDone && cupsDuplicates.length > 0 && (
                    <div className={`mt-2 rounded-lg border p-3 ${
                      uploadedFiles.some((f) => f.url)
                        ? 'border-brand/40 bg-secondary/5'
                        : 'border-error/40 bg-error/5'
                    }`}>
                      <div className="flex items-start gap-2">
                        <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                          uploadedFiles.some((f) => f.url) ? 'text-brand' : 'text-err'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${
                            uploadedFiles.some((f) => f.url) ? 'text-brand' : 'text-err'
                          }`}>
                            {uploadedFiles.some((f) => f.url)
                              ? 'Las facturas se agregarán al suministro existente'
                              : 'CUPS ya registrado — no se puede duplicar'}
                          </p>
                          <ul className="mt-1 space-y-1">
                            {cupsDuplicates.map((dup) => (
                              <li key={dup.id} className="text-xs text-ink-3 flex items-center gap-1">
                                <span className="font-medium text-ink">{dup.client_name}</span>
                                <span>·</span>
                                <span className="capitalize">{dup.status.replace(/_/g, ' ')}</span>
                                <a
                                  href={`/clients/${dup.client_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-1 text-brand hover:underline flex items-center gap-0.5"
                                >
                                  Ver cliente
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </li>
                            ))}
                          </ul>
                          <p className="text-xs text-ink-3 mt-1.5">
                            {uploadedFiles.some((f) => f.url)
                              ? 'No se creará un suministro nuevo. Las facturas se vincularán al CUPS existente.'
                              : 'Accede al suministro existente para modificarlo, o sube facturas para agregarlas a él.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {!cupsChecking && cupsCheckDone && cupsDuplicates.length === 0 && form.cups.length >= 20 && (
                    <div className="flex items-center gap-1.5 text-xs text-ok mt-1">
                      <Check className="w-3 h-3" />
                      <span>CUPS no duplicado</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <Select
                      id="type"
                      label="Tipo"
                      value={form.type}
                      onChange={(e) => {
                        const newType = e.target.value as SupplyType
                        const defaultTariff = newType === 'luz' ? '2.0' : newType === 'gas' ? 'RL1' : 'Movil'
                        setForm((p) => ({ ...p, type: newType, tariff: defaultTariff }))
                      }}
                      options={[
                        { value: 'luz', label: 'Luz' },
                        { value: 'gas', label: 'Gas' },
                        { value: 'telefonia', label: 'Telefonica' },
                      ]}
                    />
                    <Select
                      id="tariff"
                      label="Tarifa"
                      value={form.tariff}
                      onChange={(e) => setForm((p) => ({ ...p, tariff: e.target.value }))}
                      options={tariffOptions}
                    />
                  </div>

                  <Select
                    id="comercializadora_id"
                    label="Comercializadora"
                    value={form.comercializadora_id}
                    onChange={(e) => setForm((p) => ({ ...p, comercializadora_id: e.target.value }))}
                    options={comercializadoras.length > 0 ? comercializadoras : [{ value: '', label: 'Cargando...' }]}
                  />

                  {/* SIPS Data Section */}
                  {(sipsLoading || sipsData || sipsError) && (
                    <div className="border border-line-2-variant/30 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-2 border-b border-line-2-variant/20">
                        <BarChart3 className="w-4 h-4 text-brand" />
                        <span className="text-sm font-medium text-ink">Datos SIPS</span>
                        {sipsLoading && <Loader2 className="w-3.5 h-3.5 text-ink-3 animate-spin ml-auto" />}
                        {sipsData && <span className="text-xs text-ok ml-auto">Datos obtenidos</span>}
                      </div>

                      {sipsLoading && (
                        <div className="px-4 py-3 text-xs text-ink-3">
                          Consultando consumos en SIPS...
                        </div>
                      )}

                      {sipsError && (
                        <div className="px-4 py-3 text-xs text-ink-3">
                          <span className="text-warn">{sipsError}</span>
                          {form.cups && form.cups.length >= 20 && (
                            <button
                              type="button"
                              onClick={() => fetchSipsData(form.cups)}
                              className="ml-2 text-brand underline hover:no-underline"
                            >
                              Reintentar
                            </button>
                          )}
                        </div>
                      )}

                      {sipsData && (
                        <div className="px-4 py-3 space-y-3">
                          {/* Summary */}
                          <div className="flex flex-wrap gap-4 text-xs">
                            {sipsData.tariff && (
                              <div>
                                <span className="text-ink-3">Tarifa SIPS:</span>
                                <span className="ml-1 font-medium text-ink">{sipsData.tariff}</span>
                              </div>
                            )}
                            {sipsData.totalConsumption && (
                              <div>
                                <span className="text-ink-3">Consumo total:</span>
                                <span className="ml-1 font-medium text-ink">{sipsData.totalConsumption}</span>
                              </div>
                            )}
                            {sipsData.distribuidora && (
                              <div>
                                <span className="text-ink-3">Distribuidora:</span>
                                <span className="ml-1 font-medium text-ink">{sipsData.distribuidora}</span>
                              </div>
                            )}
                          </div>

                          {/* Tab switcher */}
                          <div className="flex gap-0 border-b border-line-2-variant/20">
                            {(['consumos', 'maximetros'] as const).map((tab) => {
                              const hasMaximetros = sipsData.maximetroHistory && sipsData.maximetroHistory.length > 0
                              if (tab === 'maximetros' && !hasMaximetros) return null
                              const labels = { consumos: 'Consumos (kWh)', maximetros: 'Maxímetros (kW)' }
                              const active = sipsTab === tab
                              return (
                                <button
                                  key={tab}
                                  type="button"
                                  onClick={() => setSipsTab(tab)}
                                  className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                                    active
                                      ? 'border-brand text-brand'
                                      : 'border-transparent text-ink-3 hover:text-ink'
                                  }`}
                                >
                                  {labels[tab]}
                                </button>
                              )
                            })}
                          </div>

                          {/* ── Consumos tab ── */}
                          {sipsTab === 'consumos' && (
                            <>
                              {sipsData.consumoPeriodos && (
                                <div className="grid grid-cols-6 gap-1.5">
                                  {(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const).map((label) => (
                                    <div key={label} className="bg-bg-2 rounded-lg p-1.5 text-center">
                                      <p className="text-[10px] text-ink-3">{label}</p>
                                      <p className="text-xs font-bold text-ink">{sipsData.consumoPeriodos?.[label]?.toLocaleString() || '-'}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {sipsData.consumptionHistory && sipsData.consumptionHistory.length > 0 && (
                                <div className="overflow-x-auto -mx-1">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-line-2-variant/20">
                                        <th className="text-left py-1.5 px-1 text-ink-3 font-medium">Mes</th>
                                        {(['P1','P2','P3','P4','P5','P6'] as const).map(p => (
                                          <th key={p} className="text-right py-1.5 px-1 text-ink-3 font-medium">{p}</th>
                                        ))}
                                        <th className="text-right py-1.5 px-1 text-ink font-semibold">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sipsData.consumptionHistory.slice(0, 12).map((h, i) => {
                                        const month = (() => {
                                          try { return new Date(h.fecha).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }) }
                                          catch { return h.fecha?.slice(0, 7) || '' }
                                        })()
                                        return (
                                          <tr key={i} className="border-b border-line-2-variant/10 last:border-0">
                                            <td className="py-1 px-1 text-ink">{month}</td>
                                            {(['P1','P2','P3','P4','P5','P6'] as const).map(p => (
                                              <td key={p} className="py-1 px-1 text-right text-ink-3">{h[p]?.toLocaleString() || '-'}</td>
                                            ))}
                                            <td className="py-1 px-1 text-right font-medium text-ink">{h.total?.toLocaleString() || '-'}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          )}

                          {/* ── Maxímetros tab ── */}
                          {sipsTab === 'maximetros' && sipsData.maximetroHistory && sipsData.maximetroHistory.length > 0 && (
                            <>
                              {/* Max per period summary */}
                              {sipsData.potenciaContratada && (
                                <div className="grid grid-cols-6 gap-1.5">
                                  {(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const).map((p) => {
                                    const contratada = sipsData.potenciaContratada?.[p] ?? 0
                                    const maxVal = Math.max(...(sipsData.maximetroHistory?.map(h => h[p] ?? 0) || [0]))
                                    const ratio = contratada > 0 && maxVal > 0 ? maxVal / contratada : null
                                    const color = ratio === null
                                      ? 'bg-bg-2 text-ink'
                                      : ratio >= 1.15 ? 'bg-err-container text-err'
                                      : ratio >= 1.00 ? 'bg-warn-container text-warn'
                                      : ratio >= 0.90 ? 'bg-yellow-100 text-yellow-700'
                                      : 'bg-ok-container text-ok'
                                    return (
                                      <div key={p} className={`rounded-lg p-1.5 text-center ${color}`}>
                                        <p className="text-[10px] font-medium opacity-70">{p}</p>
                                        <p className="text-xs font-bold">{maxVal > 0 ? maxVal.toFixed(1) : '-'}</p>
                                        {contratada > 0 && <p className="text-[9px] opacity-60">/ {contratada} kW</p>}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                              <div className="overflow-x-auto -mx-1">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-line-2-variant/20">
                                      <th className="text-left py-1.5 px-1 text-ink-3 font-medium">Mes</th>
                                      {(['P1','P2','P3','P4','P5','P6'] as const).map(p => (
                                        <th key={p} className="text-right py-1.5 px-1 text-ink-3 font-medium">{p}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sipsData.maximetroHistory.slice(0, 12).map((h, i) => {
                                      const month = (() => {
                                        try { return new Date(h.fecha).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }) }
                                        catch { return h.fecha?.slice(0, 7) || '' }
                                      })()
                                      return (
                                        <tr key={i} className="border-b border-line-2-variant/10 last:border-0">
                                          <td className="py-1 px-1 text-ink">{month}</td>
                                          {(['P1','P2','P3','P4','P5','P6'] as const).map(p => {
                                            const val = h[p] ?? 0
                                            const contratada = sipsData.potenciaContratada?.[p] ?? 0
                                            const ratio = contratada > 0 && val > 0 ? val / contratada : null
                                            const cellColor = ratio === null ? ''
                                              : ratio >= 1.15 ? 'text-err font-semibold'
                                              : ratio >= 1.00 ? 'text-warn font-semibold'
                                              : ratio >= 0.90 ? 'text-yellow-700'
                                              : 'text-ok'
                                            return (
                                              <td key={p} className={`py-1 px-1 text-right ${cellColor || 'text-ink-3'}`}>
                                                {val > 0 ? val.toFixed(1) : '-'}
                                              </td>
                                            )
                                          })}
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manual SIPS query button if no auto-query happened */}
                  {!sipsLoading && !sipsData && !sipsError && form.cups && form.cups.length >= 20 && (
                    <button
                      type="button"
                      onClick={() => fetchSipsData(form.cups)}
                      className="flex items-center gap-2 text-sm text-brand hover:text-secondary/80 transition-colors"
                    >
                      <BarChart3 className="w-4 h-4" />
                      Consultar datos SIPS
                    </button>
                  )}

                  {error && (
                    <div className="bg-err-container rounded-xl px-4 py-2.5">
                      <p className="text-sm text-err font-medium">{error}</p>
                    </div>
                  )}

                  {/* Step 2 Actions */}
                  <div className="flex gap-3 justify-end pt-4">
                    <Button variant="secondary" type="button" onClick={() => setStep(1)}>
                      Volver
                    </Button>
                    <Button type="submit" loading={saving}>
                      <Zap className="w-4 h-4" />
                      Crear Suministro
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
