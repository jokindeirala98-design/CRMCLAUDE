#!/usr/bin/env node
/**
 * Ingesta de ficheros markdown al corpus del agente IA.
 *
 * Cada fichero `.md` se divide en chunks (separados por `## ` headers o por
 * tamaño), se le calcula un embedding con Gemini text-embedding-004, y se
 * indexa en la tabla `kb_chunks` con la colección indicada.
 *
 * Uso:
 *   node scripts/agent/ingest-markdown.mjs <colección> <ruta_md> [...más rutas]
 *
 * Ejemplos:
 *   node scripts/agent/ingest-markdown.mjs voltis_kb content/agent-kb/voltis-kb.md
 *   node scripts/agent/ingest-markdown.mjs voltis_tarjetas_tecnicas content/agent-kb/tarjetas-tecnicas.md
 *
 * Requiere variables de entorno: GEMINI_API_KEY (o GOOGLE_GEMINI_API_KEY),
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { basename } from 'path'

const COLLECTION = process.argv[2]
const FILES = process.argv.slice(3)

if (!COLLECTION || FILES.length === 0) {
  console.error('Uso: node scripts/agent/ingest-markdown.mjs <colección> <ruta_md> [...más rutas]')
  console.error('Colecciones válidas: a&c_youtube, a&c_linkedin, a&c_instagram, voltis_kb, voltis_tarjetas_tecnicas')
  process.exit(1)
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!GEMINI_API_KEY) { console.error('Falta GEMINI_API_KEY'); process.exit(1) }
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Faltan vars Supabase'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const EMBED_MODEL = 'text-embedding-004'
const EMBED_API = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`
const BATCH_API = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`

async function embedBatch(texts) {
  if (texts.length === 0) return []
  if (texts.length > 100) {
    const out = []
    for (let i = 0; i < texts.length; i += 100) {
      const slice = await embedBatch(texts.slice(i, i + 100))
      out.push(...slice)
    }
    return out
  }
  const body = {
    requests: texts.map(text => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    })),
  }
  const res = await fetch(BATCH_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`embedBatch ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return (data.embeddings || []).map(e => e.values)
}

/**
 * Divide markdown en chunks usando los headers `## ` como separadores
 * principales. Si una sección supera 2000 chars, se sub-divide por tamaño.
 */
function splitMarkdown(md, sourceFile) {
  // Quitar frontmatter (--- ... ---)
  md = md.replace(/^---\n[\s\S]*?\n---\n/m, '')

  // Dividir por headers ##
  const sections = []
  const lines = md.split('\n')
  let current = { title: '', body: [] }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current.body.length > 0 || current.title) sections.push(current)
      current = { title: line.replace(/^##\s+/, '').trim(), body: [] }
    } else {
      current.body.push(line)
    }
  }
  if (current.body.length > 0 || current.title) sections.push(current)

  const chunks = []
  for (const sec of sections) {
    const text = sec.body.join('\n').trim()
    if (!text || text.length < 100) continue

    if (text.length <= 2000) {
      chunks.push({
        title: sec.title,
        content: sec.title ? `## ${sec.title}\n\n${text}` : text,
        citation: `${basename(sourceFile)}${sec.title ? ' · ' + sec.title : ''}`,
      })
    } else {
      // Sub-dividir secciones grandes en chunks de ~1500 chars
      let cursor = 0
      let idx = 0
      while (cursor < text.length) {
        const end = Math.min(cursor + 1500, text.length)
        // Buscar último punto/párrafo antes del fin
        let realEnd = end
        if (end < text.length) {
          const slice = text.slice(cursor, end)
          const cut = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '))
          if (cut > 500) realEnd = cursor + cut + 1
        }
        const piece = text.slice(cursor, realEnd).trim()
        if (piece.length > 200) {
          chunks.push({
            title: sec.title + (idx > 0 ? ` (${idx + 1})` : ''),
            content: sec.title ? `## ${sec.title}${idx > 0 ? ' (parte ' + (idx + 1) + ')' : ''}\n\n${piece}` : piece,
            citation: `${basename(sourceFile)}${sec.title ? ' · ' + sec.title : ''}${idx > 0 ? ' (parte ' + (idx + 1) + ')' : ''}`,
          })
          idx++
        }
        cursor = realEnd
      }
    }
  }

  return chunks
}

async function ingestFile(file) {
  console.log(`\n▸ ${file}`)
  const md = readFileSync(file, 'utf-8')
  const chunks = splitMarkdown(md, file)
  console.log(`  ${chunks.length} chunks generados`)

  if (chunks.length === 0) return { file, ingested: 0 }

  // Borrar chunks anteriores del mismo fichero (para que la ingesta sea idempotente)
  const sourceName = basename(file)
  const { error: delErr } = await supabase
    .from('kb_chunks')
    .delete()
    .eq('collection', COLLECTION)
    .eq('source', sourceName)
  if (delErr) console.warn(`  aviso al borrar antiguos: ${delErr.message}`)

  console.log(`  calculando embeddings (Gemini text-embedding-004)…`)
  const embeddings = await embedBatch(chunks.map(c => c.content))
  console.log(`  ${embeddings.length} embeddings ok`)

  const rows = chunks.map((c, i) => ({
    collection: COLLECTION,
    source: sourceName,
    content: c.content,
    embedding: embeddings[i],
    citation: c.citation,
    metadata: { title: c.title, file },
  }))

  // Insert en lotes de 50 para evitar payloads grandes
  let inserted = 0
  for (let i = 0; i < rows.length; i += 50) {
    const slice = rows.slice(i, i + 50)
    const { error } = await supabase.from('kb_chunks').insert(slice)
    if (error) {
      console.error(`  error en lote ${i}: ${error.message}`)
      throw error
    }
    inserted += slice.length
    process.stdout.write(`  insertados ${inserted}/${rows.length}\r`)
  }
  console.log(`  ✅ ${inserted} chunks indexados`)
  return { file, ingested: inserted }
}

;(async () => {
  console.log(`Ingesta a colección: ${COLLECTION}`)
  console.log(`Ficheros: ${FILES.length}`)

  let total = 0
  for (const f of FILES) {
    try {
      const r = await ingestFile(f)
      total += r.ingested
    } catch (e) {
      console.error(`Error en ${f}:`, e.message)
    }
  }
  console.log(`\n═══ Total chunks indexados: ${total} ═══`)
})().catch(e => { console.error(e); process.exit(1) })
