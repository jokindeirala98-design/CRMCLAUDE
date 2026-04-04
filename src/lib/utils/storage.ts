/**
 * Generate a view URL for a Supabase Storage file.
 *
 * If the file is already a public Supabase storage URL, return it directly —
 * this avoids the signed-URL flow which requires extra bucket permissions.
 * For other paths, route through /api/storage to generate a signed URL.
 */
export function getViewUrl(fileUrl: string, bucket = 'documents'): string {
  if (!fileUrl) return ''
  // Public Supabase storage URLs are directly accessible — use them as-is
  if (fileUrl.includes('/storage/v1/object/public/')) return fileUrl
  const path = extractPath(fileUrl, bucket)
  return `/api/storage?path=${encodeURIComponent(path)}&action=view&bucket=${bucket}`
}

/**
 * Generate a download URL for a Supabase Storage file.
 * Appends ?download=true which Supabase CDN treats as Content-Disposition: attachment.
 */
export function getDownloadUrl(fileUrl: string, bucket = 'documents'): string {
  if (!fileUrl) return ''
  if (fileUrl.includes('/storage/v1/object/public/')) {
    // Strip any existing query string, then add ?download=true
    return fileUrl.split('?')[0] + '?download=true'
  }
  const path = extractPath(fileUrl, bucket)
  return `/api/storage?path=${encodeURIComponent(path)}&action=download&bucket=${bucket}`
}

/**
 * Extract the storage path from a full Supabase public URL or path string.
 */
function extractPath(fileUrl: string, bucket: string): string {
  if (!fileUrl) return ''

  // If it's already a relative path (no http), use as-is
  if (!fileUrl.startsWith('http')) return fileUrl

  // Extract from full Supabase URL format:
  // https://xxx.supabase.co/storage/v1/object/public/documents/invoices/xxx/file.pdf
  const publicPattern = `/storage/v1/object/public/${bucket}/`
  const idx = fileUrl.indexOf(publicPattern)
  if (idx !== -1) {
    return decodeURIComponent(fileUrl.substring(idx + publicPattern.length))
  }

  // Try signed URL pattern:
  // https://xxx.supabase.co/storage/v1/object/sign/documents/invoices/xxx/file.pdf?token=...
  const signPattern = `/storage/v1/object/sign/${bucket}/`
  const signIdx = fileUrl.indexOf(signPattern)
  if (signIdx !== -1) {
    const pathWithQuery = fileUrl.substring(signIdx + signPattern.length)
    return decodeURIComponent(pathWithQuery.split('?')[0])
  }

  // Fallback: return the URL as-is (maybe it's already a path)
  return fileUrl
}
