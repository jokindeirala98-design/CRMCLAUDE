/**
 * Orquestador del agente: loop de tool calling con Gemini.
 *
 * Flujo:
 *  1) Cargar/crear conversación y cargar historial.
 *  2) Construir system prompt según contexto (comercial + cliente referido).
 *  3) Loop: llamar al LLM → si pide tools, ejecutarlas → realimentar → repetir
 *     hasta que devuelva texto plano (sin tool_calls) o se llegue al límite.
 *  4) Persistir todos los mensajes (user, assistant, tool) en agent_messages.
 *  5) Devolver respuesta + meta (tokens, coste, intent estimado).
 */
import { createClient } from '@supabase/supabase-js'
import { geminiCall, type GeminiMessage } from './llm'
import { TOOL_DEFINITIONS, executeTool } from './tools'
import { buildSystemPrompt } from './prompt'

const MAX_TOOL_ITERATIONS = 6

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

// ───────────────────────────────────────────────────────────────────────────
// TYPES
// ───────────────────────────────────────────────────────────────────────────

export interface ChatRequest {
  telegramUserId: number
  commercialName?: string | null
  /** Texto del mensaje del usuario. */
  message: string
  /** Si el mensaje viene de un audio, transcripción ya hecha. */
  transcript?: string | null
  /** Si quieres continuar una conversación existente. */
  conversationId?: string | null
  /** Cliente referido (opcional, se identifica solo si no se pasa). */
  referencedClientId?: string | null
}

export interface ChatResponse {
  conversationId: string
  text: string
  toolsUsed: string[]
  totalTokens: number
  totalCostUsd: number
  totalLatencyMs: number
  modelUsed: string
}

// ───────────────────────────────────────────────────────────────────────────
// CONVERSATION HELPERS
// ───────────────────────────────────────────────────────────────────────────

async function getOrCreateConversation(
  telegramUserId: number,
  conversationId: string | null | undefined,
  commercialName?: string | null,
  referencedClientId?: string | null,
): Promise<{ id: string; isNew: boolean }> {
  const sb = admin()

  if (conversationId) {
    const { data } = await sb
      .from('agent_conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle()
    if (data) return { id: data.id, isNew: false }
  }

  // Si no hay conversationId, reutilizar la más reciente de hace <2h (para que
  // si el comercial sigue hablando en la misma sesión no perdamos contexto)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await sb
    .from('agent_conversations')
    .select('id')
    .eq('telegram_user_id', telegramUserId)
    .gte('last_message_at', twoHoursAgo)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recent) {
    if (referencedClientId) {
      await sb.from('agent_conversations').update({ referenced_client_id: referencedClientId, last_message_at: new Date().toISOString() }).eq('id', recent.id)
    } else {
      await sb.from('agent_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', recent.id)
    }
    return { id: recent.id, isNew: false }
  }

  const { data: created, error } = await sb
    .from('agent_conversations')
    .insert({
      telegram_user_id: telegramUserId,
      commercial_name: commercialName,
      referenced_client_id: referencedClientId,
    })
    .select('id')
    .single()
  if (error || !created) throw new Error(`No pude crear conversación: ${error?.message}`)
  return { id: created.id, isNew: true }
}

async function loadHistory(conversationId: string, limit = 20): Promise<GeminiMessage[]> {
  const sb = admin()
  const { data } = await sb
    .from('agent_messages')
    .select('role, content, tool_calls, tool_name, tool_result')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit)

  const msgs: GeminiMessage[] = []
  for (const row of data || []) {
    if (row.role === 'user') {
      msgs.push({ role: 'user', parts: [{ text: row.content || '' }] })
    } else if (row.role === 'assistant') {
      const parts: any[] = []
      if (row.content) parts.push({ text: row.content })
      if (row.tool_calls && Array.isArray(row.tool_calls)) {
        for (const tc of row.tool_calls) parts.push({ functionCall: tc })
      }
      if (parts.length > 0) msgs.push({ role: 'model', parts })
    } else if (row.role === 'tool') {
      msgs.push({
        role: 'user',
        parts: [{ functionResponse: { name: row.tool_name || '', response: row.tool_result || {} } }],
      })
    }
  }
  return msgs
}

async function logMessage(
  conversationId: string,
  msg: Partial<{
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string | null
    transcript: string | null
    toolCalls: any[] | null
    toolName: string | null
    toolResult: any
    tokensIn: number
    tokensOut: number
    latencyMs: number
    modelUsed: string
    costEstimateUsd: number
  }>,
) {
  const sb = admin()
  await sb.from('agent_messages').insert({
    conversation_id: conversationId,
    role: msg.role,
    content: msg.content,
    transcript: msg.transcript,
    tool_calls: msg.toolCalls,
    tool_name: msg.toolName,
    tool_result: msg.toolResult,
    tokens_in: msg.tokensIn,
    tokens_out: msg.tokensOut,
    latency_ms: msg.latencyMs,
    model_used: msg.modelUsed,
    cost_estimate_usd: msg.costEstimateUsd,
  })
  // Actualizar last_message_at de la conversación
  await sb
    .from('agent_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ───────────────────────────────────────────────────────────────────────────

export async function runChat(req: ChatRequest): Promise<ChatResponse> {
  const { telegramUserId, commercialName, message, transcript, referencedClientId } = req

  // 1) Conversación
  const conv = await getOrCreateConversation(
    telegramUserId,
    req.conversationId,
    commercialName,
    referencedClientId,
  )

  // 2) Cargar historial (últimas N) y buscar nombre del cliente referido si aplica
  let referencedClientName: string | null = null
  if (referencedClientId) {
    const sb = admin()
    const { data } = await sb.from('clients').select('commercial_name, fiscal_name').eq('id', referencedClientId).maybeSingle()
    referencedClientName = data?.commercial_name || data?.fiscal_name || null
  }

  const history = await loadHistory(conv.id)

  // 3) Insertar el mensaje del user en el historial actual y en BBDD
  const userMsg: GeminiMessage = { role: 'user', parts: [{ text: message }] }
  await logMessage(conv.id, { role: 'user', content: message, transcript: transcript || null })

  const systemInstruction = buildSystemPrompt({ commercialName, referencedClientName })

  // 4) Loop de tool calling
  const contents: GeminiMessage[] = [...history, userMsg]
  const toolsUsed: string[] = []
  let totalTokens = 0
  let totalCostUsd = 0
  let totalLatencyMs = 0
  let modelUsed = ''
  let assistantText = ''

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const llmRes = await geminiCall({
      systemInstruction,
      contents,
      tools: TOOL_DEFINITIONS,
      toolChoice: 'AUTO',
      temperature: 0.4,
    })

    totalTokens += llmRes.usage.totalTokens
    totalCostUsd += llmRes.costUsd
    totalLatencyMs += llmRes.latencyMs
    modelUsed = llmRes.modelUsed

    // Persistir el turno del assistant (texto + tool_calls si los hubiera)
    await logMessage(conv.id, {
      role: 'assistant',
      content: llmRes.text || null,
      toolCalls: llmRes.toolCalls.length > 0 ? llmRes.toolCalls : null,
      tokensIn: llmRes.usage.promptTokens,
      tokensOut: llmRes.usage.completionTokens,
      latencyMs: llmRes.latencyMs,
      modelUsed: llmRes.modelUsed,
      costEstimateUsd: llmRes.costUsd,
    })

    // Si no hay tool calls → respuesta final
    if (llmRes.toolCalls.length === 0) {
      assistantText = llmRes.text
      break
    }

    // Reflejar el turno del assistant en `contents` para que Gemini sepa
    // que llamó a esas tools
    const assistantParts: any[] = []
    if (llmRes.text) assistantParts.push({ text: llmRes.text })
    for (const tc of llmRes.toolCalls) assistantParts.push({ functionCall: tc })
    contents.push({ role: 'model', parts: assistantParts })

    // Ejecutar todas las tools en paralelo
    const toolResults = await Promise.all(
      llmRes.toolCalls.map(async tc => {
        const result = await executeTool(tc.name, tc.args)
        toolsUsed.push(tc.name)
        await logMessage(conv.id, {
          role: 'tool',
          toolName: tc.name,
          toolResult: result,
        })
        return { name: tc.name, response: result.ok ? result.result : { error: result.error } }
      }),
    )

    // Reflejar las respuestas de las tools en `contents`
    contents.push({
      role: 'user',
      parts: toolResults.map(tr => ({ functionResponse: { name: tr.name, response: tr.response } })),
    })

    // Loop again
  }

  if (!assistantText) {
    assistantText = 'Disculpa, no he conseguido responder. ¿Puedes reformular la pregunta?'
  }

  return {
    conversationId: conv.id,
    text: assistantText,
    toolsUsed,
    totalTokens,
    totalCostUsd,
    totalLatencyMs,
    modelUsed,
  }
}
