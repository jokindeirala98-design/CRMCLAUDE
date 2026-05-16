/**
 * Cliente Gemini text-embedding-004 — embeddings 768-dim.
 *
 * Plan barato: usamos Gemini en lugar de Voyage AI.
 * Free tier: 1500 RPM, sobradísimo para piloto.
 *
 * task_type recomendado por Google:
 *  - RETRIEVAL_DOCUMENT   → al ingestar chunks del corpus
 *  - RETRIEVAL_QUERY      → al buscar (query del comercial)
 *  - SEMANTIC_SIMILARITY  → comparar dos textos sin asimetría
 */

const MODEL = 'text-embedding-004'
const API = 'https://generativelanguage.googleapis.com/v1beta'

export type EmbeddingTaskType =
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION'

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')
  return key
}

/**
 * Embedding único.
 */
export async function embedText(
  text: string,
  taskType: EmbeddingTaskType = 'RETRIEVAL_DOCUMENT',
  title?: string,
): Promise<number[]> {
  const apiKey = getApiKey()
  const url = `${API}/models/${MODEL}:embedContent?key=${apiKey}`
  const body: any = {
    content: { parts: [{ text }] },
    taskType,
  }
  if (title && taskType === 'RETRIEVAL_DOCUMENT') body.title = title

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`embedText ${MODEL} ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  const vec = data?.embedding?.values
  if (!Array.isArray(vec) || vec.length !== 768) {
    throw new Error(`Embedding inválido (length=${vec?.length})`)
  }
  return vec
}

/**
 * Batch — máximo 100 por petición. Útil para la ingesta del corpus.
 */
export async function embedBatch(
  texts: string[],
  taskType: EmbeddingTaskType = 'RETRIEVAL_DOCUMENT',
): Promise<number[][]> {
  if (texts.length === 0) return []
  if (texts.length > 100) {
    // Trocear automáticamente
    const results: number[][] = []
    for (let i = 0; i < texts.length; i += 100) {
      const slice = texts.slice(i, i + 100)
      const sliceRes = await embedBatch(slice, taskType)
      results.push(...sliceRes)
    }
    return results
  }

  const apiKey = getApiKey()
  const url = `${API}/models/${MODEL}:batchEmbedContents?key=${apiKey}`
  const body = {
    requests: texts.map(text => ({
      model: `models/${MODEL}`,
      content: { parts: [{ text }] },
      taskType,
    })),
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`embedBatch ${MODEL} ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  const embeddings = data?.embeddings || []
  if (embeddings.length !== texts.length) {
    throw new Error(`embedBatch devolvió ${embeddings.length} de ${texts.length}`)
  }
  return embeddings.map((e: any) => e.values as number[])
}

/**
 * Helper: similitud coseno entre dos vectores.
 * Util para tests y debug — pgvector calcula esto en SQL en producción.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vectores de distinta dimensión')
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
