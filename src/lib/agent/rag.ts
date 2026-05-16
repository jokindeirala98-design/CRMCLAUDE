/**
 * RAG — búsqueda vectorial sobre kb_chunks (pgvector en Supabase).
 *
 * Flujo: query → embedding → SQL `kb_search` → top-K → contexto formateado.
 *
 * Usado por:
 *  - rag_search_aandc  → colección a&c_*
 *  - rag_search_voltis → colección voltis_kb
 */
import { createClient } from '@supabase/supabase-js'
import { embedText } from './embeddings'
import type { KbChunk, RagResult, KbCollection } from './types'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export interface RagSearchOpts {
  /** Filtrar por colección específica. Si no se indica, busca en todas. */
  collection?: KbCollection | null
  /** Top-K a devolver (default 10). */
  matchCount?: number
  /** Umbral de similitud coseno [0..1]. Default 0.55 — descarta resultados pobres. */
  similarityThreshold?: number
}

/**
 * Busca chunks relevantes para una query natural.
 */
export async function ragSearch(
  query: string,
  opts: RagSearchOpts = {},
): Promise<RagResult> {
  const {
    collection = null,
    matchCount = 10,
    similarityThreshold = 0.55,
  } = opts

  const queryEmbedding = await embedText(query, 'RETRIEVAL_QUERY')
  const sb = admin()

  const { data, error } = await sb.rpc('kb_search', {
    query_embedding: queryEmbedding as any,
    match_collection: collection,
    match_count: matchCount,
    similarity_threshold: similarityThreshold,
  })

  if (error) {
    console.error('[ragSearch] RPC error:', error)
    return { chunks: [], formattedContext: '' }
  }

  const chunks: KbChunk[] = (data || []).map((row: any) => ({
    id: row.id,
    collection: row.collection,
    source: row.source,
    content: row.content,
    citation: row.citation,
    metadata: row.metadata,
    similarity: row.similarity,
  }))

  return {
    chunks,
    formattedContext: formatContextForPrompt(chunks),
  }
}

/**
 * Búsqueda específica en el corpus de Alfonso & Cristian.
 */
export async function ragSearchAandC(query: string, opts: Omit<RagSearchOpts, 'collection'> = {}) {
  // Buscar primero en tarjetas técnicas (curadas a mano, gold standard)
  // y luego en el resto del corpus A&C combinado.
  const tarjetas = await ragSearch(query, {
    ...opts,
    collection: 'voltis_tarjetas_tecnicas',
    matchCount: 3,
  })

  const colecciones: KbCollection[] = ['a&c_youtube', 'a&c_linkedin', 'a&c_instagram']
  const aacResults = await Promise.all(
    colecciones.map(c => ragSearch(query, { ...opts, collection: c, matchCount: 4 })),
  )

  const allChunks = [
    ...tarjetas.chunks,
    ...aacResults.flatMap(r => r.chunks),
  ]
  // Deduplicar por id y ordenar por similitud
  const seen = new Set<string>()
  const deduped = allChunks
    .filter(c => {
      if (seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, opts.matchCount || 10)

  return {
    chunks: deduped,
    formattedContext: formatContextForPrompt(deduped),
  }
}

/**
 * Búsqueda específica en el conocimiento interno de Voltis.
 */
export async function ragSearchVoltis(query: string, opts: Omit<RagSearchOpts, 'collection'> = {}) {
  return ragSearch(query, { ...opts, collection: 'voltis_kb' })
}

/**
 * Convierte chunks en un bloque de texto inyectable en el prompt del LLM.
 * Cada chunk lleva su cita y similitud para que el modelo decida confianza.
 */
function formatContextForPrompt(chunks: KbChunk[]): string {
  if (chunks.length === 0) return ''
  return chunks
    .map((c, i) => {
      const sim = c.similarity ? `${(c.similarity * 100).toFixed(0)}%` : '?'
      const cita = c.citation ? ` · ${c.citation}` : ''
      return `[${i + 1}] (${c.collection} · similitud ${sim}${cita})\n${c.content}`
    })
    .join('\n\n---\n\n')
}
