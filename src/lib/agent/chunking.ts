/**
 * Chunking de texto para RAG.
 *
 * Estrategia: chunks de ~500 tokens (~2000 chars en español) con solapamiento
 * de ~80 tokens (~320 chars). Cortamos preferentemente por límite de párrafo
 * o frase para no partir ideas.
 *
 * Aproximación: 1 token ≈ 4 caracteres en español/inglés mixto. No usamos
 * tokenizer real porque el modelo de Gemini interno es distinto y el coste
 * de invocarlo es excesivo para chunking.
 */

const TARGET_CHARS = 2000   // ~500 tokens
const OVERLAP_CHARS = 320   // ~80 tokens
const MIN_CHARS = 400       // chunks menores se descartan o concatenan

export interface Chunk {
  index: number
  content: string
  startChar: number
  endChar: number
}

/**
 * Divide texto en chunks aproximados, cortando en límites naturales.
 */
export function chunkText(raw: string): Chunk[] {
  const text = normalize(raw)
  if (text.length <= TARGET_CHARS) {
    return text.length >= MIN_CHARS
      ? [{ index: 0, content: text, startChar: 0, endChar: text.length }]
      : []
  }

  const chunks: Chunk[] = []
  let cursor = 0
  let index = 0

  while (cursor < text.length) {
    const end = Math.min(cursor + TARGET_CHARS, text.length)

    // Si no es el final del texto, buscar un mejor punto de corte hacia atrás
    let realEnd = end
    if (end < text.length) {
      const slice = text.slice(cursor, end)
      // Prioridad de cortes: \n\n > . ! ? > , > espacio
      const cuts = [
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf(', '),
        slice.lastIndexOf(' '),
      ]
      const bestCut = cuts.find(c => c > TARGET_CHARS * 0.5)
      if (bestCut !== undefined && bestCut > 0) {
        realEnd = cursor + bestCut + 1
      }
    }

    const content = text.slice(cursor, realEnd).trim()
    if (content.length >= MIN_CHARS) {
      chunks.push({ index: index++, content, startChar: cursor, endChar: realEnd })
    }

    // Avanzar restando el solapamiento
    cursor = realEnd - OVERLAP_CHARS
    if (cursor <= chunks[chunks.length - 1]?.startChar) {
      // Evitar bucles si el chunk fue muy pequeño
      cursor = realEnd
    }
  }

  return chunks
}

/**
 * Normaliza el texto: colapsa espacios, elimina muletillas excesivas,
 * normaliza saltos de línea.
 */
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\s+\n/g, '\n')
    // Colapsa más de 2 saltos en exactamente 2 (separador de párrafo)
    .replace(/\n{3,}/g, '\n\n')
    // Colapsa múltiples espacios
    .replace(/[ \t]+/g, ' ')
    // Quita muletillas repetidas comunes en transcripciones
    .replace(/\b(eh|em|este|o sea|vale)(\s+\1)+\b/gi, '$1')
    .trim()
}
