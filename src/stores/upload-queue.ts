import { create } from 'zustand'
import { normalizeCups } from '@/lib/utils/cups'
import { normalizeTariff as normalizeTariffCanonical } from '@/lib/consumption-utils'
import { ensurePendingPrescoring } from '@/lib/ensurePrescoring'
import { advanceSupplyPipeline } from '@/lib/supply-pipeline'

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TYPES                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

export interface QueuedFile {
  id: string
  file: File
  url: string
  storagePath: string
  status: 'pending' | 'uploading' | 'classifying' | 'analyzing' | 'done' | 'error'
  extractedData?: any
  error?: string
}

export interface UploadJob {
  id: string
  clientId: string
  clientName: string
  files: QueuedFile[]
  status: 'uploading' | 'analyzing' | 'grouping' | 'creating' | 'done' | 'error'
  createdAt: number
  /** Set when the job finishes — auto-dismiss after a delay */
  finishedAt?: number
  errorMessage?: string
}

interface UploadQueueState {
  jobs: UploadJob[]
  /** Whether the widget is expanded or minimized */
  expanded: boolean
  /** Global processing flag to ensure only one job runs at a time */
  isProcessing: boolean

  // Actions
  addJob: (job: UploadJob) => void
  updateJob: (jobId: string, patch: Partial<UploadJob>) => void
  updateFile: (jobId: string, fileId: string, patch: Partial<QueuedFile>) => void
  removeJob: (jobId: string) => void
  toggleExpanded: () => void
  setExpanded: (v: boolean) => void
  setIsProcessing: (v: boolean) => void
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  STORE                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

export const useUploadQueue = create<UploadQueueState>((set) => ({
  jobs: [],
  expanded: true,
  isProcessing: false,

  addJob: (job) => {
    set((s) => ({ jobs: [...s.jobs, job], expanded: true }))
    // Trigger processing
    setTimeout(() => {
      processQueue()
    }, 100)
  },

  updateJob: (jobId, patch) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j)),
    })),

  updateFile: (jobId, fileId, patch) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? { ...j, files: j.files.map((f) => (f.id === fileId ? { ...f, ...patch } : f)) }
          : j
      ),
    })),

  removeJob: (jobId) =>
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== jobId) })),

  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
  setExpanded: (v) => set({ expanded: v }),
  setIsProcessing: (v) => set({ isProcessing: v }),
}))

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  BACKGROUND PROCESSOR                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

const CONCURRENCY = 2

/** Convert DD/MM/YYYY or DD/MM/YY to YYYY-MM-DD */
function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m) {
    const day = m[1].padStart(2, '0')
    const month = m[2].padStart(2, '0')
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${month}-${day}`
  }
  return null
}

/** Normalize tariff to canonical form (2.0TD, 3.0TD, 6.1TD, RL.1, etc.) */
function normalizeTariff(raw: string): string {
  return normalizeTariffCanonical(raw) || raw
}

/**
 * Retry analysis of a single failed file in a job.
 * Resets the file to 'analyzing' and re-runs the Gemini call with 2 attempts.
 */
export async function retryFile(jobId: string, fileId: string): Promise<void> {
  const { updateFile, updateJob, jobs } = useUploadQueue.getState()
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  const file = job.files.find(f => f.id === fileId)
  if (!file) return

  updateFile(jobId, fileId, { status: 'analyzing', error: undefined })

  let retries = 2
  let lastError: any = null
  while (retries >= 0) {
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = () => reject(new Error('Error leyendo archivo'))
        reader.readAsDataURL(file.file)
      })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60_000)
      const fileType = file.file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'

      const response = await fetch('/api/analyze-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_base64: base64, file_type: fileType, file_name: file.file.name }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) {
        if (response.status >= 500 && retries > 0) throw new Error(`API ${response.status}`)
        const errResult = await response.json().catch(() => ({}))
        throw new Error(errResult.error || `Error API ${response.status}`)
      }
      const result = await response.json()
      updateFile(jobId, fileId, {
        status: 'done',
        extractedData: result,
        error: result.mode === 'manual' && result.error ? result.error : undefined,
      })

      // If the whole job was in error state because of this, resume processing
      const currentJob = useUploadQueue.getState().jobs.find(j => j.id === jobId)
      if (currentJob?.status === 'error') {
        updateJob(jobId, { status: 'analyzing', errorMessage: undefined, finishedAt: undefined })
        setTimeout(() => processQueue(), 100)
      }
      return
    } catch (err: any) {
      lastError = err
      console.warn(`[UploadQueue] Retry attempt failed for ${file.file.name} (${retries} left):`, err.message)
      if (retries === 0) {
        updateFile(jobId, fileId, {
          status: 'error',
          error: err.name === 'AbortError' ? 'Timeout' : err.message || 'Error',
        })
      } else {
        await new Promise(r => setTimeout(r, 1000 * (2 - retries)))
      }
      retries--
    }
  }
  void lastError
}

/**
 * Global queue processor
 * Ensures only one job runs at a time
 */
export async function processQueue(): Promise<void> {
  const { jobs, isProcessing, setIsProcessing } = useUploadQueue.getState()

  if (isProcessing) {
    console.log('[UploadQueue] Already processing a job, waiting...')
    return
  }

  // Find next job that needs work (pending or partially done but not finished)
  const nextJob = jobs.find((j) => j.status === 'uploading' || j.status === 'analyzing')
  if (!nextJob) return

  setIsProcessing(true)
  try {
    await processJobInBackground(nextJob.id)
  } finally {
    setIsProcessing(false)
    // Check if there are more jobs after a short delay
    setTimeout(() => {
      processQueue()
    }, 500)
  }
}

/**
 * Processes an entire upload job in the background:
 *  1. Upload files to Storage (if not already done)
 *  2. Analyze each file with Gemini (parallel, CONCURRENCY at a time)
 *  3. Classify: if Invoice -> supply/invoice; if DC -> update client (TO BE IMPLEMENTED)
 *  4. Group by CUPS (for invoices)
 */
export async function processJobInBackground(jobId: string): Promise<void> {
  const { updateJob, updateFile } = useUploadQueue.getState()

  const getJob = () => useUploadQueue.getState().jobs.find((j) => j.id === jobId)
  const job = getJob()
  if (!job) return

  // ── Phase 1: Upload & Analyze files ──
  updateJob(jobId, { status: 'analyzing' })

  const queue = [...job.files.filter((f) => f.status === 'pending' || f.status === 'uploading')]

  const cleanIdentifier = (val: string | null | undefined) => val?.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || null

  const processOne = async (item: QueuedFile): Promise<void> => {
    // 1. Upload if needed
    if (!item.url) {
      updateFile(jobId, item.id, { status: 'uploading' })
      try {
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()
        const ext = item.file.name.split('.').pop()
        const storagePath = `invoices/${Date.now()}/${item.id}.${ext}`

        const { data, error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(storagePath, item.file, { cacheControl: '3600', upsert: false })

        if (uploadErr) throw uploadErr

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(data.path)
        updateFile(jobId, item.id, { url: urlData.publicUrl, storagePath: data.path })
        item.url = urlData.publicUrl
      } catch (err: any) {
        updateFile(jobId, item.id, { status: 'error', error: `Error subiendo: ${err.message}` })
        return
      }
    }

    // 2. Analyze with retries
    updateFile(jobId, item.id, { status: 'analyzing' })

    let retries = 2
    let lastError: any = null

    while (retries >= 0) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = () => reject(new Error('Error leyendo archivo'))
          reader.readAsDataURL(item.file)
        })

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 60_000) // 1 min per attempt
        const fileType = item.file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'

        const response = await fetch('/api/analyze-document', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_base64: base64, file_type: fileType, file_name: item.file.name }),
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (!response.ok) {
          if (response.status >= 500 && retries > 0) {
             throw new Error(`API ${response.status}`)
          }
          const errResult = await response.json().catch(() => ({}))
          throw new Error(errResult.error || `Error API ${response.status}`)
        }

        const result = await response.json()
        updateFile(jobId, item.id, {
          status: 'done',
          extractedData: result,
          error: result.mode === 'manual' && result.error ? result.error : undefined,
        })
        
        // Success! Break retry loop
        break 
      } catch (err: any) {
        lastError = err
        console.warn(`[UploadQueue] Attempt failed for ${item.file.name} (${retries} left):`, err.message)
        if (retries === 0) {
          updateFile(jobId, item.id, {
            status: 'error',
            error: err.name === 'AbortError' ? 'Timeout' : err.message || 'Error',
          })
        } else {
          // Wait before retry
          await new Promise(r => setTimeout(r, 1000 * (2 - retries)))
        }
        retries--
      }
    }
  }

  // Run with concurrency limit
  const runNext = async (): Promise<void> => {
    const next = queue.shift()
    if (!next) return
    await processOne(next)
    await runNext()
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => runNext()))

  // Small pause to allow UI to breathe
  await new Promise(r => setTimeout(r, 500))

  const { createClient } = await import('@/lib/supabase/client')
  const supabase = createClient()
  let currentJob = getJob()!

  // ── Phase -1: Auto-Detect Client if missing ──
  if (!currentJob.clientId) {
    updateJob(jobId, { status: 'analyzing' })

    // Accept both 'gemini' and 'claude' (Claude fallback when Gemini key is invalid)
    const analyzedFiles = currentJob.files.filter(f => f.status === 'done' && (f.extractedData?.mode === 'gemini' || f.extractedData?.mode === 'claude'))

    // Build candidates from ALL analyzed files
    const candidates = analyzedFiles.map(f => {
      const meta = f.extractedData || {}
      return {
        cifNif: cleanIdentifier(meta.cif || meta.nif || meta.holder_cif_nif),
        name: (meta.holder_name || meta.account_holder || '').trim() || null,
      }
    })

    let matchedClient: { id: string; name: string } | null = null

    // 1. Try matching by CIF/NIF across ALL candidates
    for (const c of candidates) {
      if (!c.cifNif || c.cifNif.length < 8) continue
      try {
        const { data } = await supabase
          .from('clients')
          .select('id, name')
          .or(`cif_nif.ilike.%${c.cifNif}%,cif.ilike.%${c.cifNif}%,nif.ilike.%${c.cifNif}%`)
          .limit(1)
          .maybeSingle()
        if (data) { matchedClient = data; break }
      } catch (err) {
        console.warn('[UploadQueue] CIF lookup error:', err)
      }
    }

    // 2. Try matching by holder name keywords
    if (!matchedClient) {
      const stopWords = new Set([
        'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'o', 'en', 'por', 'con', 'para',
        'sl', 'sa', 'slu', 'cb', 'sc', 'sociedad', 'limitada', 'anonima',
      ])
      for (const c of candidates) {
        if (!c.name || c.name === 'No detectado') continue
        const cname: string = c.name
        const words: string[] = cname.split(/\s+/).filter((w: string) => w.length >= 3 && !stopWords.has(w.toLowerCase()))
        if (!words.length) continue
        const primaryKeyword = [...words].sort((a, b) => b.length - a.length)[0]
        try {
          const { data: matches } = await supabase
            .from('clients')
            .select('id, name')
            .ilike('name', `%${primaryKeyword}%`)
            .limit(5)
          if (matches?.length) {
            const scored = (matches as Array<{ id: string; name: string }>).map((m) => ({
              ...m,
              score: words.filter((w: string) => m.name.toLowerCase().includes(w.toLowerCase())).length,
            })).sort((a: { score: number }, b: { score: number }) => b.score - a.score)
            if (scored[0].score >= 1) {
              matchedClient = { id: scored[0].id, name: scored[0].name }
              break
            }
          }
        } catch (err) {
          console.warn('[UploadQueue] Name lookup error:', err)
        }
      }
    }

    // 3. Create new client with best available data
    if (!matchedClient) {
      const bestName = candidates.find(c => c.name && c.name !== 'No detectado')?.name
        || currentJob.files[0]?.file.name?.replace(/\.[^.]+$/, '')
        || 'Cliente sin nombre'
      const bestCif = candidates.find(c => c.cifNif)?.cifNif || null
      const isAyuntamiento = /ayuntamiento|ajuntament|concello|diputaci[oó]n|mancomunidad/i.test(bestName)
      const isParticular = bestCif ? /^\d/.test(bestCif) : false
      const clientType = isAyuntamiento ? 'ayuntamiento' : isParticular ? 'particular' : 'empresa'

      const { data: { user: authUser } } = await supabase.auth.getUser()

      const payload: any = {
        name: bestName,
        type: clientType,
        cif_nif: bestCif,
        marketing_consent: false,
        origin: 'captacion',
      }
      if (authUser?.id) payload.commercial_id = authUser.id

      const { data: newClient, error: createErr } = await supabase
        .from('clients')
        .insert(payload)
        .select('id, name')
        .single()

      if (createErr) {
        console.error('[UploadQueue] Failed to create client:', createErr)
      } else if (newClient) {
        matchedClient = newClient
        console.log('[UploadQueue] Created new client automatically:', newClient.name)
      }
    }

    if (matchedClient) {
      updateJob(jobId, { clientId: matchedClient.id, clientName: matchedClient.name })
      currentJob = getJob()!
    } else {
      updateJob(jobId, {
        status: 'error',
        errorMessage: 'No se pudo detectar ni crear el cliente automáticamente. Selecciónalo manualmente.',
      })
      useUploadQueue.getState().setIsProcessing(false)
      return
    }
  }

  // ── Phase 0: Update Client Documents (DCs) ──
  // Extract CIF, NIF, IBAN and update client profile if found
  // Accept both 'gemini' and 'claude' (Claude fallback when Gemini key is invalid)
  const clientDocs = currentJob.files.filter((f) =>
    f.status === 'done' &&
    (f.extractedData?.mode === 'gemini' || f.extractedData?.mode === 'claude') &&
    ['cif', 'nif', 'iban'].includes(f.extractedData?.documentType)
  )

  if (clientDocs.length > 0) {
    const updates: any = {}
    for (const doc of clientDocs) {
      const type = doc.extractedData.documentType
      if (type === 'cif' && doc.extractedData.cif) {
        updates.cif = doc.extractedData.cif
        updates.cif_file_url = doc.url
      } else if (type === 'nif' && doc.extractedData.nif) {
        updates.nif = doc.extractedData.nif
        updates.nif_file_url = doc.url
      } else if (type === 'iban' && doc.extractedData.iban) {
        updates.iban = doc.extractedData.iban
        updates.iban_file_url = doc.url
      }
    }
    if (Object.keys(updates).length > 0) {
      console.log('[UploadQueue] Updating client DCs:', updates)
      await supabase.from('clients').update(updates).eq('id', currentJob.clientId)
    }
  }

  // ── Phase 2: Group by CUPS (Invoices only) ──
  updateJob(jobId, { status: 'grouping' })

  // Accept both 'gemini' and 'claude' (Claude fallback when Gemini key is invalid)
  const analyzedInvoices = currentJob.files.filter((f) =>
    f.status === 'done' &&
    (f.extractedData?.mode === 'gemini' || f.extractedData?.mode === 'claude') &&
    f.extractedData?.documentType === 'factura'
  )

  const cupsMap = new Map<string, QueuedFile[]>()
  const noCupsFiles: QueuedFile[] = []

  /**
   * Fuzzy CUPS matcher: finds an existing key in cupsMap that differs by at
   * most 2 characters from `candidate` (Levenshtein ≤ 2). This catches
   * common OCR errors (e.g., digit substitution, missing/extra char).
   * Returns the matching key or null.
   */
  function findFuzzyCupsMatch(candidate: string): string | null {
    for (const existing of cupsMap.keys()) {
      if (existing === candidate) return existing
      // Quick length check — CUPS should be 20 chars but allow ±1
      if (Math.abs(existing.length - candidate.length) > 2) continue
      // Count character differences (simplified Hamming for same-length)
      if (existing.length === candidate.length) {
        let diffs = 0
        for (let i = 0; i < existing.length; i++) {
          if (existing[i] !== candidate[i]) diffs++
          if (diffs > 2) break
        }
        if (diffs <= 2) {
          console.log(`[UploadQueue] Fuzzy CUPS match: "${candidate}" → "${existing}" (${diffs} diffs)`)
          return existing
        }
      }
    }
    return null
  }

  for (const f of analyzedInvoices) {
    const cups = normalizeCups(f.extractedData?.cups || '')
    if (cups) {
      // Try exact match first, then fuzzy
      const matchKey = cupsMap.has(cups) ? cups : findFuzzyCupsMatch(cups)
      if (matchKey) {
        cupsMap.get(matchKey)!.push(f)
      } else {
        cupsMap.set(cups, [f])
      }
    } else {
      noCupsFiles.push(f)
    }
  }

  // ── Phase 2b: Merge "no-CUPS" pages into matching CUPS groups ──
  // When a multi-page invoice is uploaded as separate images, one page may have the
  // CUPS and another may have detailed economics but no CUPS. After individual analysis,
  // try to reunite them: if a no-CUPS file shares the same holder + billing period as a
  // known CUPS group, attach it (its economics data may fill in gaps).
  const mergedNoCups: QueuedFile[] = []
  for (const nf of noCupsFiles) {
    const nHolder = (nf.extractedData?.holder_cif_nif || nf.extractedData?.holder_name || '').toUpperCase().trim()
    const nPeriod = nf.extractedData?.billing_period?.trim() || ''
    let matched = false
    if (nHolder || nPeriod) {
      for (const [, group] of cupsMap) {
        const gf = group[0]
        const gHolder = (gf.extractedData?.holder_cif_nif || gf.extractedData?.holder_name || '').toUpperCase().trim()
        const gPeriod = gf.extractedData?.billing_period?.trim() || ''
        const holderMatch = nHolder && gHolder && (nHolder.includes(gHolder) || gHolder.includes(nHolder))
        const periodMatch = nPeriod && gPeriod && nPeriod === gPeriod
        if (holderMatch || periodMatch) {
          group.push(nf)
          matched = true
          console.log(`[UploadQueue] Merged no-CUPS file "${nf.file.name}" into CUPS group (holderMatch=${holderMatch}, periodMatch=${periodMatch})`)
          break
        }
      }
    }
    if (!matched) mergedNoCups.push(nf)
  }
  // Replace noCupsFiles with only the truly unmatched ones
  noCupsFiles.splice(0, noCupsFiles.length, ...mergedNoCups)

  if (analyzedInvoices.length === 0) {
    if (clientDocs.length > 0) {
      // Only document (CIF/NIF/IBAN) uploads, no invoices
      updateJob(jobId, { status: 'done', finishedAt: Date.now() })
    } else {
      // Collect the most informative error from failed/manual files
      const failedFiles = currentJob.files.filter(f => f.status === 'error')
      const manualFiles = currentJob.files.filter(f => f.status === 'done' && f.extractedData?.mode === 'manual')
      const sampleError = manualFiles[0]?.extractedData?.error || failedFiles[0]?.error

      let errMsg: string
      if (sampleError?.includes('API key') || sampleError?.includes('no configurada')) {
        errMsg = 'API key de Gemini no configurada. Revisa las variables de entorno en Vercel.'
      } else if (sampleError?.includes('no longer available') || sampleError?.includes('deprecated')) {
        errMsg = `Modelo Gemini no disponible: ${sampleError}`
      } else if (sampleError?.includes('quota') || sampleError?.includes('RESOURCE_EXHAUSTED')) {
        errMsg = 'Cuota de Gemini agotada. Intenta más tarde o cambia el plan.'
      } else if (sampleError) {
        errMsg = `Error Gemini: ${sampleError}`
      } else if (failedFiles.length > 0) {
        errMsg = `${failedFiles.length} archivo${failedFiles.length !== 1 ? 's' : ''} fallaron al analizarse.`
      } else {
        errMsg = 'Ningún archivo fue reconocido como factura. Verifica que sean facturas de luz o gas.'
      }
      updateJob(jobId, { status: 'error', errorMessage: errMsg, finishedAt: Date.now() })
    }
    return
  }

  // ── Phase 3: Create supplies + invoices ──
  updateJob(jobId, { status: 'creating' })

  try {
    const allGroups = [
      ...Array.from(cupsMap.entries()).map(([cups, files]) => ({ cups, files })),
      ...noCupsFiles.map((f) => ({ cups: '', files: [f] })),
    ]

    // Track ALL supplies (new and existing) that need background SIPS fetch.
    // Existing supplies need SIPS re-fetch so consumption_data.totalKwh stays accurate
    // and the supplies list shows the correct annual consumption instead of per-invoice kwh.
    const newSuppliesForSips: Array<{ supplyId: string; cups: string; holderName: string; supplyType: string }> = []
    const allSuppliesForSips: Array<{ supplyId: string; cups: string; holderName: string; supplyType: string }> = []

    // Cache for auth user (reused across groups)
    const { data: { user: authUserPhase3 } } = await supabase.auth.getUser()

    for (const group of allGroups) {
      const first = group.files[0].extractedData!
      const cups = group.cups || null
      const rawTariff = first.tariff || '2.0'
      const tariff = normalizeTariff(rawTariff)
      // Detect gas from RL tariff prefix, otherwise use extracted supply_type
      const type: string = /^RL/i.test(String(rawTariff).replace(/\s+/g, ''))
        ? 'gas'
        : (first.supply_type === 'gas' ? 'gas'
          : first.supply_type === 'telefonia' ? 'telefonia'
          : 'luz')

      // ── Resolve correct client for this CUPS group ──────────────────────────
      // Each invoice may belong to a different client (multi-client batch upload).
      // Use holder_cif_nif / holder_name from the invoice to find or create the
      // right client, falling back to the job-level client only if no data available.
      let groupClientId = currentJob.clientId

      const holderCifNif = cleanIdentifier(first.holder_cif_nif || first.cif || first.nif)
      const holderName = (first.holder_name || first.account_holder || '').trim()

      if (holderCifNif && holderCifNif.length >= 8) {
        // 1. Try match by CIF/NIF
        try {
          const { data: byId } = await supabase
            .from('clients')
            .select('id')
            .or(`cif_nif.ilike.%${holderCifNif}%,cif.ilike.%${holderCifNif}%,nif.ilike.%${holderCifNif}%`)
            .limit(1)
            .maybeSingle()
          if (byId) {
            groupClientId = byId.id
          } else if (holderName) {
            // 2. Create new client with invoice data
            const isAyunt = /ayuntamiento|ajuntament|concello|diputaci/i.test(holderName)
            const isParticular = /^\d/.test(holderCifNif)
            const clientType = isAyunt ? 'ayuntamiento' : isParticular ? 'particular' : 'empresa'
            const { data: newC } = await supabase
              .from('clients')
              .insert({
                name: holderName,
                cif_nif: holderCifNif,
                type: clientType,
                marketing_consent: false,
                origin: 'captacion',
                ...(authUserPhase3?.id ? { commercial_id: authUserPhase3.id } : {}),
              })
              .select('id')
              .single()
            if (newC) {
              groupClientId = newC.id
              console.log(`[UploadQueue] Created client for CUPS ${cups}: ${holderName} (${holderCifNif})`)
            }
          }
        } catch (err) {
          console.warn('[UploadQueue] Client resolution error for', cups, err)
        }
      } else if (holderName && holderName !== currentJob.clientName) {
        // No CIF/NIF but have a name — try name match
        try {
          const words = holderName.split(/\s+/).filter((w: string) => w.length >= 4)
          const keyword = [...words].sort((a: string, b: string) => b.length - a.length)[0]
          if (keyword) {
            const { data: byName } = await supabase
              .from('clients')
              .select('id')
              .ilike('name', `%${keyword}%`)
              .limit(1)
              .maybeSingle()
            if (byName) groupClientId = byName.id
          }
        } catch (err) {
          console.warn('[UploadQueue] Client name lookup error for', cups, err)
        }
      }

      // Check if supply already exists
      let supplyId: string | null = null
      let isExistingSupply = false
      let resolvedCups = cups // CUPS as stored in DB (may differ slightly from extracted)
      if (cups) {
        // ── Step 1: exact CUPS match ──────────────────────────────────────────
        const { data: existing } = await supabase
          .from('supplies')
          .select('id, cups')
          .eq('cups', cups)
          .limit(1)
          .maybeSingle()
        if (existing) {
          supplyId = existing.id
          isExistingSupply = true
          resolvedCups = existing.cups ?? cups
        } else {
          // ── Step 2: fuzzy CUPS match (Hamming ≤ 2) ───────────────────────
          // Catches OCR/AI errors in the distributor code or control letters.
          // e.g. "ES0022..." extracted vs "ES0226..." in DB — 2-char difference.
          // Filter by client_id to avoid cross-client false positives.
          const { data: candidates } = await supabase
            .from('supplies')
            .select('id, cups')
            .like('cups', 'ES%')
            .eq('client_id', groupClientId)
            .limit(200)

          if (candidates) {
            const fuzzyMatch = candidates.find((s: { id: string; cups: string }) => {
              if (!s.cups || s.cups.length !== cups.length) return false
              let diffs = 0
              for (let i = 0; i < cups.length; i++) {
                if (s.cups[i] !== cups[i]) diffs++
                if (diffs > 2) return false
              }
              return diffs > 0 && diffs <= 2
            })
            if (fuzzyMatch) {
              console.log(
                `[UploadQueue] Fuzzy supply match: extracted CUPS "${cups}" → DB CUPS "${fuzzyMatch.cups}" (reusing existing supply)`,
              )
              supplyId = fuzzyMatch.id
              isExistingSupply = true
              resolvedCups = fuzzyMatch.cups ?? cups
            }
          }
        }

        // Queue existing supply for SIPS refresh
        if (supplyId && isExistingSupply && resolvedCups) {
          allSuppliesForSips.push({
            supplyId,
            cups: resolvedCups,
            holderName: holderName || currentJob.clientName || '',
            supplyType: type,
          })
        }
      }

      // Create supply if new — with race-condition protection
      if (!supplyId) {
        const comName = first.comercializadora || ''
        let comId: string | null = null
        if (comName) {
          const { data: coms } = await supabase
            .from('comercializadoras')
            .select('id, name')
            .eq('active', true)
          if (coms) {
            const match = coms.find((c: any) => c.name.toLowerCase().includes(comName.toLowerCase()))
            if (match) comId = match.id
          }
        }

        const { data: newSupply, error: supplyErr } = await supabase
          .from('supplies')
          .insert({
            client_id: groupClientId,
            cups,
            type,
            tariff,
            address: first.supply_address || null,
            comercializadora_id: comId,
            status: 'estudio_en_curso',
          })
          .select('id')
          .single()

        if (supplyErr) {
          // Unique constraint conflict — another process already created this CUPS
          if (cups && (supplyErr.code === '23505' || supplyErr.message?.includes('unique') || supplyErr.message?.includes('duplicate'))) {
            console.log(`[UploadQueue] CUPS ${cups} conflict — looking up existing supply`)
            const { data: existing } = await supabase
              .from('supplies')
              .select('id')
              .eq('cups', cups)
              .limit(1)
              .single()
            if (existing) {
              supplyId = existing.id
            } else {
              console.error(`[UploadQueue] Conflict but supply not found for ${cups}`)
              continue
            }
          } else {
            console.error(`[UploadQueue] Supply creation error for ${cups}:`, supplyErr)
            continue
          }
        } else {
          supplyId = newSupply.id
          // Queue this newly-created supply for background SIPS fetch (only if it has a CUPS)
          if (cups && supplyId) {
            newSuppliesForSips.push({
              supplyId,
              cups,
              holderName: holderName || currentJob.clientName || '',
              supplyType: type,
            })
          }
        }
      }

      // Insert invoices
      const invoices = group.files
        .filter((f) => f.url)
        .map((f) => {
          const eco = f.extractedData?.economics
          return {
            supply_id: supplyId,
            file_url: f.url,
            file_type: f.file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image',
            extracted_data: f.extractedData ? JSON.parse(JSON.stringify(f.extractedData)) : null,
            extraction_status: (f.extractedData?.mode === 'gemini' || f.extractedData?.mode === 'claude') ? 'completed' : 'pending',
            period_start: eco?.fechaInicio ? toIsoDate(eco.fechaInicio) : toIsoDate(f.extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[0]),
            period_end: eco?.fechaFin ? toIsoDate(eco.fechaFin) : toIsoDate(f.extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[1]),
            total_amount: eco?.totalFactura ?? (f.extractedData?.total_amount ? parseFloat(f.extractedData.total_amount) : null),
          }
        })

      if (invoices.length > 0) {
        const { error: invErr } = await supabase.from('invoices').insert(invoices)
        if (invErr) console.error(`[UploadQueue] Invoice insert error for ${cups}:`, invErr)
      }

      // Ensure a pending prescoring row exists for this supply (no-op if already there)
      if (supplyId) {
        await ensurePendingPrescoring(supabase, supplyId, { updateNulls: true }).catch((err) =>
          console.error(`[UploadQueue] ensurePendingPrescoring failed for ${cups}:`, err)
        )
        // Auto-advance pipeline for existing supplies (new ones already start at estudio_en_curso)
        await advanceSupplyPipeline({
          supabase,
          supplyId,
          event: 'invoices_added',
        }).catch((err) =>
          console.error(`[UploadQueue] Pipeline advance failed for ${cups}:`, err)
        )
      }
    }

    // ── Phase 4: SIPS fetch (awaited — runs before job is marked done) ────────
    // We await SIPS so that when the user navigates to the supplies list,
    // consumption_data.totalKwh already has the official annual value from
    // the distributor and not just one invoice's partial consumption.
    const sipsFetchTargets = [
      ...newSuppliesForSips,
      ...allSuppliesForSips.filter(s => !newSuppliesForSips.some(n => n.supplyId === s.supplyId)),
    ]

    if (sipsFetchTargets.length > 0) {
      updateJob(jobId, { status: 'processing', progress: 'Cargando datos de consumo SIPS...' } as any)
      await Promise.allSettled(
        sipsFetchTargets.map(({ supplyId, cups, holderName, supplyType }) =>
          fetchSipsForSupply(supplyId, cups, holderName, supplyType).catch((err) => {
            console.error(`[UploadQueue] SIPS fetch failed for ${cups}:`, err)
          })
        )
      )
    }

    updateJob(jobId, { status: 'done', finishedAt: Date.now() })
  } catch (err: any) {
    console.error('[UploadQueue] Background job error:', err)
    updateJob(jobId, { status: 'error', errorMessage: err.message || 'Error creando suministros', finishedAt: Date.now() })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  BACKGROUND SIPS FETCH                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Fetch SIPS data (Lidera/Greening) for a freshly-created supply and persist
 * it to supplies.consumption_data. Also generates the power study when
 * potenciaContratada + consumptionHistory are available.
 * Runs as fire-and-forget; errors are logged but don't block the user.
 */
async function fetchSipsForSupply(
  supplyId: string,
  cups: string,
  holderName: string,
  supplyType?: string
) {
  const { createClient } = await import('@/lib/supabase/client')
  const supabase = createClient()

  // Detect gas: explicit type, RL tariff, or CUPS suffix heuristic (2 trailing letters)
  const isGas = supplyType === 'gas' || (cups.length >= 22 && /^[A-Z]{2}$/.test(cups.slice(20, 22)))

  // Gas supplies must NOT auto-fetch SIPS — consumption data is entered manually
  // via the GasExcelImport component. Returning here keeps consumption_data empty
  // until the user uploads the distributor Excel.
  if (isGas) return

  // Route to the correct SIPS API (electricity only)
  let d: any = null
  let sipsSource = 'greening_sips'

  if (!d) {
    // Electricity → Greening, or fallback for gas that failed TotalEnergies
    const sipsRes = await fetch('/api/sips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cups, supply_type: isGas ? 'gas' : 'luz' }),
    })
    if (!sipsRes.ok) return
    const sipsResult = await sipsRes.json()
    if (!sipsResult.success || !sipsResult.data) return
    d = sipsResult.data
    sipsSource = sipsResult.source === 'totalenergies' ? 'totalenergies_sips' : 'greening_sips'
  }

  // Normalize tariff from SIPS
  const sipsTariff = d.tariff ? (normalizeTariffCanonical(d.tariff) || d.tariff) : null

  // Build address from SIPS data (municipio + CP)
  const sipsAddress = [d.direccion, d.municipio, d.codigoPostal].filter(Boolean).join(', ') || null

  const consumption_data = {
    source: sipsSource,
    fetched_at: new Date().toISOString(),
    total: d.totalConsumption,
    totalKwh: d.totalConsumptionKwh,
    sips_tariff: sipsTariff,
    consumoPeriodos: d.consumoPeriodos,
    potenciaContratada: d.potenciaContratada,
    history: (d.consumptionHistory || []).map((h: any) => ({
      fecha: h.fecha, fechaInicio: h.fechaInicio, fechaFin: h.fechaFin,
      P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6, total: h.total,
    })),
    maximetroHistory: (d.maximetroHistory || []).map((h: any) => ({
      fecha: h.fecha, fechaInicio: h.fechaInicio, fechaFin: h.fechaFin,
      P1: h.P1, P2: h.P2, P3: h.P3, P4: h.P4, P5: h.P5, P6: h.P6,
    })),
    reactivaHistory: (d.reactivaHistory || []).map((h: any) => ({
      fecha: h.fecha, fechaInicio: h.fechaInicio, fechaFin: h.fechaFin,
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
    // Gas-specific fields from TotalEnergies
    ...(d.direccion ? { direccion: d.direccion } : {}),
    ...(d.presionMedida ? { presionMedida: d.presionMedida } : {}),
    ...(d.caudalMaximoDiario ? { caudalMaximoDiario: d.caudalMaximoDiario } : {}),
  }

  // Build update payload — SIPS is authoritative for estudios de suministros
  const updatePayload: any = {
    consumption_data,
    updated_at: new Date().toISOString(),
  }

  // Update tariff from SIPS (always overwrite for estudios — SIPS is source of truth)
  if (sipsTariff) {
    updatePayload.tariff = sipsTariff
  }

  // Update address from SIPS if we got one (municipio + CP makes it more complete)
  if (sipsAddress && sipsAddress.length > 5) {
    updatePayload.address = sipsAddress
  }

  // Update distribuidora: find or create the comercializadora record
  if (d.distribuidora) {
    try {
      const { data: coms } = await supabase
        .from('comercializadoras')
        .select('id, name')
        .eq('active', true)
      if (coms) {
        const match = coms.find((c: any) =>
          c.name.toLowerCase().includes(d.distribuidora.toLowerCase()) ||
          d.distribuidora.toLowerCase().includes(c.name.toLowerCase())
        )
        if (match) {
          updatePayload.comercializadora_id = match.id
        }
      }
    } catch (err) {
      console.error('[UploadQueue] Error matching distribuidora:', err)
    }
  }

  // Ensure type is correct (gas CUPS should be type=gas)
  if (isGas) {
    updatePayload.type = 'gas'
  }

  await supabase
    .from('supplies')
    .update(updatePayload)
    .eq('id', supplyId)

  console.log(`[UploadQueue] SIPS ${sipsSource} OK for ${cups} — tariff=${sipsTariff}, address=${sipsAddress ? 'yes' : 'no'}`)

  // Auto-generate power study if we have the required data (electricity only)
  if (!isGas && d.consumptionHistory?.length > 0 && d.potenciaContratada) {
    try {
      const studyRes = await fetch('/api/power-study-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cups,
          clientName: holderName,
          potenciaContratada: d.potenciaContratada,
          consumptionHistory: d.consumptionHistory,
          maximetroHistory: d.maximetroHistory || [],
          reactivaHistory: d.reactivaHistory || [],
        }),
      })
      if (studyRes.ok) {
        const studyResult = await studyRes.json()
        await supabase
          .from('supplies')
          .update({ power_study_result: studyResult })
          .eq('id', supplyId)
      }
    } catch (err) {
      console.error('[UploadQueue] Power study auto-generate failed:', err)
    }
  }
}
