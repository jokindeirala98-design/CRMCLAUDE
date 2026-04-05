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
  status: 'pending' | 'analyzing' | 'done' | 'error'
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

  // Actions
  addJob: (job: UploadJob) => void
  updateJob: (jobId: string, patch: Partial<UploadJob>) => void
  updateFile: (jobId: string, fileId: string, patch: Partial<QueuedFile>) => void
  removeJob: (jobId: string) => void
  toggleExpanded: () => void
  setExpanded: (v: boolean) => void
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  STORE                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

export const useUploadQueue = create<UploadQueueState>((set) => ({
  jobs: [],
  expanded: true,

  addJob: (job) => set((s) => ({ jobs: [...s.jobs, job], expanded: true })),

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
}))

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  BACKGROUND PROCESSOR                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

const CONCURRENCY = 3

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
 * Processes an entire upload job in the background:
 *  1. Analyze each file with Gemini (parallel, CONCURRENCY at a time)
 *  2. Group by CUPS
 *  3. Create supplies + invoices
 *
 * Call this AFTER adding the job to the store — it reads/writes via the store.
 */
export async function processJobInBackground(jobId: string): Promise<void> {
  const { updateJob, updateFile } = useUploadQueue.getState()

  const getJob = () => useUploadQueue.getState().jobs.find((j) => j.id === jobId)
  const job = getJob()
  if (!job) return

  // ── Phase 1: Analyze files ──
  updateJob(jobId, { status: 'analyzing' })

  const queue = [...job.files.filter((f) => f.status === 'pending')]

  const analyzeOne = async (item: QueuedFile): Promise<void> => {
    updateFile(jobId, item.id, { status: 'analyzing' })

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = () => reject(new Error('Error leyendo archivo'))
        reader.readAsDataURL(item.file)
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 120_000)
      const fileType = item.file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'

      const response = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_base64: base64, file_type: fileType, file_name: item.file.name }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) throw new Error(`Error ${response.status}`)

      const result = await response.json()
      updateFile(jobId, item.id, {
        status: 'done',
        extractedData: result,
        error: result.mode === 'manual' && result.error ? result.error : undefined,
      })
    } catch (err: any) {
      updateFile(jobId, item.id, {
        status: 'error',
        error: err.name === 'AbortError' ? 'Timeout' : err.message || 'Error',
      })
    }
  }

  // Run with concurrency limit
  const runNext = async (): Promise<void> => {
    const next = queue.shift()
    if (!next) return
    await analyzeOne(next)
    await runNext()
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => runNext()))

  // ── Phase 2: Group by CUPS ──
  updateJob(jobId, { status: 'grouping' })

  const currentJob = getJob()!
  const analyzed = currentJob.files.filter((f) => f.status === 'done' && f.extractedData?.mode === 'gemini')

  const cupsMap = new Map<string, QueuedFile[]>()
  const noCupsFiles: QueuedFile[] = []

  for (const f of analyzed) {
    const cups = normalizeCups(f.extractedData?.cups || '')
    if (cups) {
      if (!cupsMap.has(cups)) cupsMap.set(cups, [])
      cupsMap.get(cups)!.push(f)
    } else {
      noCupsFiles.push(f)
    }
  }

  // ── Phase 3: Create supplies + invoices ──
  updateJob(jobId, { status: 'creating' })

  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()

    const allGroups = [
      ...Array.from(cupsMap.entries()).map(([cups, files]) => ({ cups, files })),
      ...noCupsFiles.map((f) => ({ cups: '', files: [f] })),
    ]

    for (const group of allGroups) {
      const first = group.files[0].extractedData!
      const cups = group.cups || null
      const type = first.type || 'luz'
      const tariff = normalizeTariff(first.tariff || '2.0')

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
            const match = coms.find((c) => c.name.toLowerCase().includes(comName.toLowerCase()))
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
            status: 'facturas_recibidas',
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
