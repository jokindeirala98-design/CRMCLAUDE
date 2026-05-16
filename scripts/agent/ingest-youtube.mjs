#!/usr/bin/env node
/**
 * Ingesta de vídeos de YouTube al corpus del agente IA.
 *
 * Por cada URL:
 *  1) Descarga el audio con yt-dlp (debe estar instalado: brew install yt-dlp).
 *  2) Transcribe con Gemini 2.5 Flash multimodal (gratis, en español).
 *  3) Limpia transcripción (quita muletillas, intros patrocinados).
 *  4) Chunkea ~500 tokens con solapamiento.
 *  5) Calcula embeddings con Gemini text-embedding-004.
 *  6) Inserta en kb_chunks con citation = "{título} · min {mm:ss}".
 *
 * Uso:
 *   node scripts/agent/ingest-youtube.mjs <URL1> [URL2] [URL3]...
 *
 * Ejemplo:
 *   node scripts/agent/ingest-youtube.mjs https://youtu.be/JpW4RxLvWX4
 *
 * Requiere:
 *  - yt-dlp instalado (brew install yt-dlp)
 *  - ffmpeg instalado (brew install ffmpeg)
 *  - GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Trabajo temporal: /tmp/voltis-yt-ingest/
 */
import { createClient } from '@supabase/supabase-js'
import { execSync, spawnSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'

const URLS = process.argv.slice(2)
if (URLS.length === 0) {
  console.error('Uso: node scripts/agent/ingest-youtube.mjs <URL1> [URL2] [URL3]...')
  process.exit(1)
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!GEMINI_API_KEY) { console.error('Falta GEMINI_API_KEY'); process.exit(1) }
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Faltan vars Supabase'); process.exit(1) }

// Comprobar yt-dlp y ffmpeg
function checkBinary(name) {
  const r = spawnSync('which', [name])
  if (r.status !== 0) {
    console.error(`Falta ${name}. Instala con: brew install ${name}`)
    process.exit(1)
  }
}
checkBinary('yt-dlp')
checkBinary('ffmpeg')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const TMP_DIR = '/tmp/voltis-yt-ingest'
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true })

const EMBED_MODEL = 'text-embedding-004'
const EMBED_API = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`
const GEN_MODEL = 'gemini-2.5-flash'
const GEN_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:generateContent?key=${GEMINI_API_KEY}`

async function embedBatch(texts) {
  if (texts.length === 0) return []
  if (texts.length > 100) {
    const out = []
    for (let i = 0; i < texts.length; i += 100) {
      out.push(...await embedBatch(texts.slice(i, i + 100)))
    }
    return out
  }
  const body = {
    requests: texts.map(t => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: t }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    })),
  }
  const res = await fetch(EMBED_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.embeddings.map(e => e.values)
}

async function downloadAudio(url) {
  const out = join(TMP_DIR, '%(id)s.%(ext)s')
  console.log('  · descargando audio…')
  execSync(`yt-dlp -x --audio-format mp3 --audio-quality 5 -o "${out}" --print after_move:filepath "${url}"`, {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  // yt-dlp imprime la ruta final si todo va bien — la recapturamos
  const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)
  if (!idMatch) throw new Error('No pude extraer videoId de ' + url)
  const id = idMatch[1]
  const file = join(TMP_DIR, `${id}.mp3`)
  if (!existsSync(file)) throw new Error('No encontré ' + file)
  return { id, file }
}

async function fetchVideoInfo(url) {
  const out = execSync(`yt-dlp --skip-download --print "%(title)s|||%(id)s|||%(duration)s|||%(uploader)s" "${url}"`).toString().trim()
  const [title, id, duration, uploader] = out.split('|||')
  return { title, id, duration: Number(duration), uploader }
}

async function transcribeAudio(file, info) {
  console.log('  · transcribiendo con Gemini multimodal…')
  const audioBytes = readFileSync(file)
  const audioB64 = audioBytes.toString('base64')
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'audio/mp3', data: audioB64 } },
        { text: `Transcribe este audio en español de España. Es un vídeo titulado "${info.title}" del canal "${info.uploader}" sobre venta consultiva B2B. Devuelve solo la transcripción literal, sin saltos de párrafo extra ni anotaciones. Conserva las frases tácticas y los ejemplos textuales que el ponente dice. Idioma: español. Sin emojis. Sin "[música]" ni anotaciones.` },
      ],
    }],
    generationConfig: { temperature: 0.0, maxOutputTokens: 32000 },
  }
  const res = await fetch(GEN_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`transcribe ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!text || text.length < 100) throw new Error('Transcripción vacía o muy corta')
  return text
}

function chunkText(text) {
  const TARGET = 2000
  const OVERLAP = 320
  const MIN = 400
  const out = []
  let cursor = 0
  while (cursor < text.length) {
    const end = Math.min(cursor + TARGET, text.length)
    let realEnd = end
    if (end < text.length) {
      const slice = text.slice(cursor, end)
      const cuts = [slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '), slice.lastIndexOf(', ')]
      const best = cuts.find(c => c > TARGET * 0.5)
      if (best && best > 0) realEnd = cursor + best + 1
    }
    const content = text.slice(cursor, realEnd).trim()
    if (content.length >= MIN) out.push({ content, start: cursor, end: realEnd })
    cursor = realEnd - OVERLAP
    if (cursor >= text.length - MIN) break
  }
  return out
}

async function ingestVideo(url) {
  console.log(`\n▸ ${url}`)
  const info = await fetchVideoInfo(url)
  console.log(`  · "${info.title}" (${Math.floor(info.duration / 60)} min)`)

  const { id, file } = await downloadAudio(url)

  const transcriptCache = join(TMP_DIR, `${id}.txt`)
  let transcript
  if (existsSync(transcriptCache) && statSync(transcriptCache).size > 500) {
    console.log('  · usando transcripción cacheada')
    transcript = readFileSync(transcriptCache, 'utf-8')
  } else {
    transcript = await transcribeAudio(file, info)
    writeFileSync(transcriptCache, transcript)
  }
  console.log(`  · transcripción ${transcript.length} chars`)

  const chunks = chunkText(transcript)
  console.log(`  · ${chunks.length} chunks`)
  if (chunks.length === 0) return 0

  // Borrar lo antiguo del mismo vídeo
  const sourceKey = `youtube://${id}`
  await supabase.from('kb_chunks')
    .delete()
    .eq('collection', 'a&c_youtube')
    .eq('source', sourceKey)

  console.log('  · embeddings…')
  const embeddings = await embedBatch(chunks.map(c => c.content))

  const rows = chunks.map((c, i) => {
    // Estimación de minuto del chunk (lineal sobre duración)
    const ratio = c.start / transcript.length
    const minute = Math.floor(ratio * info.duration)
    const mm = String(Math.floor(minute / 60)).padStart(2, '0')
    const ss = String(minute % 60).padStart(2, '0')
    return {
      collection: 'a&c_youtube',
      source: sourceKey,
      content: c.content,
      embedding: embeddings[i],
      citation: `${info.title} · min ${mm}:${ss}`,
      metadata: {
        video_id: id,
        url: `https://youtu.be/${id}`,
        title: info.title,
        uploader: info.uploader,
        duration_sec: info.duration,
        chunk_index: i,
      },
    }
  })

  let inserted = 0
  for (let i = 0; i < rows.length; i += 50) {
    const slice = rows.slice(i, i + 50)
    const { error } = await supabase.from('kb_chunks').insert(slice)
    if (error) throw error
    inserted += slice.length
  }
  console.log(`  ✅ ${inserted} chunks indexados`)
  return inserted
}

;(async () => {
  let total = 0
  for (const url of URLS) {
    try {
      total += await ingestVideo(url)
    } catch (e) {
      console.error(`Error en ${url}: ${e.message}`)
    }
  }
  console.log(`\n═══ Total chunks YouTube indexados: ${total} ═══`)
})().catch(e => { console.error(e); process.exit(1) })
