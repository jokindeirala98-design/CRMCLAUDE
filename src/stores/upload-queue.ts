import { create } from 'zustand'
import { normalizeCups } from '@/lib/utils/cups'

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

function normalizeTariff(raw: string): string {
  const s = raw.replace(/\s+/g, '').toUpperCase()
  const map: Record<string, string> = {
    '2.0': '2.0', '20TD': '2.0', '2.0TD': '2.0', '2.0A': '2.0',
    '3.0': '3.0', '30TD': '3.0', '3.0TD': '3.0', '3.0A': '3.0',
    '6.1': '6.1', '61TD': '6.1', '6.1TD': '6.1', '6.1A': '6.1',
    '6.2': '6.1', '62TD': '6.1', '6.2TD': '6.1',
    'RL1': 'RL1', 'RL.1': 'RL1', 'RL2': 'RL2', 'RL.2': 'RL2',
    'RL3': 'RL3', 'RL.3': 'RL3', 'RL4': 'RL4', 'RL.4': 'RL4',
  }
  return map[s] || raw
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

    const analyzedFiles = currentJob.files.filter(f => f.status === 'done' && f.extractedData?.mode === 'gemini')

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
  const clientDocs = currentJob.files.filter((f) => 
    f.status === 'done' && 
    f.extractedData?.mode === 'gemini' && 
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

  const analyzedInvoices = currentJob.files.filter((f) => 
    f.status === 'done' && 
    f.extractedData?.mode === 'gemini' &&
    f.extractedData?.documentType === 'factura'
  )

  const cupsMap = new Map<string, QueuedFile[]>()
  const noCupsFiles: QueuedFile[] = []

  for (const f of analyzedInvoices) {
    const cups = normalizeCups(f.extractedData?.cups || '')
    if (cups) {
      if (!cupsMap.has(cups)) cupsMap.set(cups, [])
      cupsMap.get(cups)!.push(f)
    } else {
      noCupsFiles.push(f)
    }
  }

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

      // Check if supply already exists
      let supplyId: string | null = null
      if (cups) {
        const { data: existing } = await supabase
          .from('supplies')
          .select('id')
          .eq('cups', cups)
          .limit(1)
          .single()
        if (existing) supplyId = existing.id
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
            client_id: currentJob.clientId,
            cups,
            type,
            tariff,
            address: first.supply_address || null,
            comercializadora_id: comId,
            status: 'esperando_informes',
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
            extraction_status: f.extractedData?.mode === 'gemini' ? 'completed' : 'pending',
            period_start: eco?.fechaInicio ? toIsoDate(eco.fechaInicio) : toIsoDate(f.extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[0]),
            period_end: eco?.fechaFin ? toIsoDate(eco.fechaFin) : toIsoDate(f.extractedData?.billing_period?.split(/\s*[-–]\s*/)?.[1]),
            total_amount: eco?.totalFactura ?? (f.extractedData?.total_amount ? parseFloat(f.extractedData.total_amount) : null),
          }
        })

      if (invoices.length > 0) {
        const { error: invErr } = await supabase.from('invoices').insert(invoices)
        if (invErr) console.error(`[UploadQueue] Invoice insert error for ${cups}:`, invErr)
      }
    }

    updateJob(jobId, { status: 'done', finishedAt: Date.now() })
  } catch (err: any) {
    console.error('[UploadQueue] Background job error:', err)
    updateJob(jobId, { status: 'error', errorMessage: err.message || 'Error creando suministros', finishedAt: Date.now() })
  }
}
