/**
 * Download all invoices for a client as a ZIP file.
 *
 * Structure:
 *   {ClientName}_facturas/
 *     {SupplyName_or_CUPS}/
 *       {ClientName}_{last4CUPS}_{month}.pdf
 *
 * Month is derived from the billing period end date.
 * If period spans multiple months, a range is used (e.g. "ene-mar").
 * Duplicate filenames get a suffix (_2, _3, etc.).
 */

import { createClient } from '@/lib/supabase/client'
import { getViewUrl } from '@/lib/utils/storage'

// Spanish month abbreviations
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
]
const MONTH_SHORT = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
]

/**
 * Derive the billing month label from period_start and period_end.
 *
 * Rules:
 *   - If period_end exists, the month of the end date is the billing month
 *     (e.g. 30/04 → 01/05 → mayo)
 *   - If the period spans >45 days, we show a range ("ene-mar")
 *   - Fallback: created_at month, or "sin_periodo"
 */
function deriveBillingMonth(periodStart: string | null, periodEnd: string | null, createdAt: string | null): string {
  if (periodEnd) {
    const end = new Date(periodEnd)
    if (!isNaN(end.getTime())) {
      if (periodStart) {
        const start = new Date(periodStart)
        if (!isNaN(start.getTime())) {
          const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
          // If more than ~45 days, it spans multiple months → show range
          if (daysDiff > 45) {
            // Use the month AFTER start, to the month of end
            const startMonth = start.getMonth()
            const endMonth = end.getMonth()
            if (startMonth !== endMonth) {
              return `${MONTH_SHORT[startMonth]}-${MONTH_SHORT[endMonth]}`
            }
          }
        }
      }
      // Normal case: the billing month is the end date's month
      return MONTH_NAMES[end.getMonth()]
    }
  }
  // Fallback to created_at
  if (createdAt) {
    const d = new Date(createdAt)
    if (!isNaN(d.getTime())) return MONTH_NAMES[d.getMonth()]
  }
  return 'sin_periodo'
}

/**
 * Sanitize a string for use as a filename/folder name.
 */
function sanitize(s: string): string {
  return s
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 100)
}

/**
 * Get the last 4 characters of a CUPS code.
 */
function last4Cups(cups: string | null): string {
  if (!cups) return '0000'
  const clean = cups.replace(/\s/g, '')
  return clean.length >= 4 ? clean.slice(-4) : clean
}

export interface DownloadProgress {
  total: number
  downloaded: number
  currentFile: string
  phase: 'fetching' | 'downloading' | 'zipping' | 'done' | 'error'
  error?: string
}

/**
 * Main function: fetch all invoices for a client and download as ZIP.
 */
export async function downloadClientInvoicesZip(
  clientId: string,
  clientName: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const report = (partial: Partial<DownloadProgress>) => {
    if (onProgress) onProgress({ total: 0, downloaded: 0, currentFile: '', phase: 'fetching', ...partial })
  }

  try {
    report({ phase: 'fetching', currentFile: 'Cargando datos...' })

    const supabase = createClient()

    // 1. Fetch all supplies for this client
    const { data: supplies, error: supError } = await supabase
      .from('supplies')
      .select('id, name, cups, type, tariff')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })

    if (supError || !supplies || supplies.length === 0) {
      report({ phase: 'error', error: 'No se encontraron suministros para este cliente' })
      return
    }

    // 2. Fetch all invoices for these supplies
    const supplyIds = supplies.map(s => s.id)
    const { data: invoices, error: invError } = await supabase
      .from('invoices')
      .select('id, supply_id, file_url, file_type, period_start, period_end, extracted_data, created_at')
      .in('supply_id', supplyIds)
      .order('period_start', { ascending: true })

    if (invError || !invoices || invoices.length === 0) {
      report({ phase: 'error', error: 'No se encontraron facturas para descargar' })
      return
    }

    // Group invoices by supply
    const invoicesBySupply = new Map<string, typeof invoices>()
    for (const inv of invoices) {
      const list = invoicesBySupply.get(inv.supply_id) || []
      list.push(inv)
      invoicesBySupply.set(inv.supply_id, list)
    }

    // Build supply lookup
    const supplyMap = new Map(supplies.map(s => [s.id, s]))

    // 3. Dynamic import JSZip (tree-shake friendly)
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    const safeClientName = sanitize(clientName)
    const rootFolder = zip.folder(`${safeClientName}_facturas`)!
    const totalInvoices = invoices.length
    let downloaded = 0

    report({ phase: 'downloading', total: totalInvoices, downloaded: 0, currentFile: '' })

    // 4. Download each invoice and add to ZIP
    const usedNames = new Map<string, number>() // track duplicate filenames per folder

    for (const [supplyId, supInvoices] of invoicesBySupply) {
      const supply = supplyMap.get(supplyId)
      if (!supply) continue

      // Folder name: supply name if set, otherwise CUPS
      const folderName = sanitize(supply.name || supply.cups || supplyId)
      const supplyFolder = rootFolder.folder(folderName)!
      const folderUsed = new Map<string, number>()

      for (const inv of supInvoices) {
        if (!inv.file_url) {
          downloaded++
          report({ phase: 'downloading', total: totalInvoices, downloaded, currentFile: 'Saltando (sin archivo)' })
          continue
        }

        // Derive the filename
        const cups4 = last4Cups(supply.cups)
        const month = deriveBillingMonth(inv.period_start, inv.period_end, inv.created_at)
        const ext = inv.file_type === 'image' ? 'jpg' : 'pdf'
        let baseName = `${safeClientName}_${cups4}_${month}`

        // Handle duplicates
        const count = folderUsed.get(baseName) || 0
        folderUsed.set(baseName, count + 1)
        if (count > 0) {
          baseName = `${baseName}_${count + 1}`
        }

        const fileName = `${baseName}.${ext}`

        report({
          phase: 'downloading',
          total: totalInvoices,
          downloaded,
          currentFile: fileName
        })

        try {
          // Fetch the file
          const url = getViewUrl(inv.file_url)
          const response = await fetch(url)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const blob = await response.blob()
          supplyFolder.file(fileName, blob)
        } catch (err) {
          console.warn(`[download-zip] Failed to download ${inv.file_url}:`, err)
          // Add a placeholder text file so user knows something failed
          supplyFolder.file(`${baseName}_ERROR.txt`, `No se pudo descargar esta factura.\nURL: ${inv.file_url}\n`)
        }

        downloaded++
        report({ phase: 'downloading', total: totalInvoices, downloaded, currentFile: fileName })
      }
    }

    // 5. Generate ZIP
    report({ phase: 'zipping', total: totalInvoices, downloaded: totalInvoices, currentFile: 'Generando ZIP...' })

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })

    // 6. Trigger download
    const downloadUrl = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = `${safeClientName}_facturas.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(downloadUrl)

    report({ phase: 'done', total: totalInvoices, downloaded: totalInvoices, currentFile: 'Descarga completada' })
  } catch (err: any) {
    console.error('[download-zip] Error:', err)
    report({ phase: 'error', total: 0, downloaded: 0, currentFile: '', error: err.message || 'Error desconocido' })
  }
}
