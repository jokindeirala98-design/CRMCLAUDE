import { NextRequest, NextResponse } from 'next/server'
import { normalizeCups, isValidCups, extractCups } from '@/lib/utils/cups'

/**
 * POST /api/bandeja-ai
 *
 * Natural language command processor for the Bandeja (inbox).
 * Uses Gemini to interpret user intent and returns structured actions.
 *
 * Supported intents:
 * - create_supply: "Crea suministro para CUPS ES00210000170723..."
 * - search_client: "Busca cliente Juan Perez"
 * - check_cups: "Comprueba CUPS ES00210000170723..."
 * - update_status: "Marca suministro X como presentado"
 * - query_info: "¿Cuantos suministros tengo pendientes?"
 * - help: General questions about how to use the app
 */

interface AIAction {
  intent: string
  confidence: number
  params: Record<string, any>
  message: string // Human-readable response
  actions?: Array<{
    type: 'navigate' | 'create' | 'update' | 'search' | 'info'
    label: string
    data: Record<string, any>
  }>
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY

export async function POST(request: NextRequest) {
  try {
    const { message, context } = await request.json()

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Mensaje requerido' }, { status: 400 })
    }

    // Quick pattern matching for common actions (no API call needed)
    const quickAction = matchQuickAction(message, context)
    if (quickAction) {
      return NextResponse.json(quickAction)
    }

    // Use Gemini for complex interpretation
    if (!GEMINI_API_KEY) {
      // Fallback without Gemini
      return NextResponse.json(fallbackParse(message, context))
    }

    const systemPrompt = `Eres un asistente de un CRM de energia (Voltis). Interpretas comandos en español del comercial.

Contexto del usuario:
- Rol: ${context?.role || 'commercial'}
- Suministros activos: ${context?.supplyCount || 'desconocido'}
- Clientes: ${context?.clientCount || 'desconocido'}

Responde SIEMPRE en JSON con esta estructura:
{
  "intent": "create_supply|search_client|check_cups|update_status|query_info|create_client|help",
  "confidence": 0.0-1.0,
  "params": { ...parametros extraidos... },
  "message": "respuesta al usuario",
  "actions": [
    {
      "type": "navigate|create|update|search|info",
      "label": "texto del boton",
      "data": { ...datos de la accion... }
    }
  ]
}

Ejemplos:
- "dame info del cups ES0021000017072361EX" → intent: "check_cups", params: {cups: "ES0021000017072361EX"}
- "crea cliente empresa ABC SL" → intent: "create_client", params: {name: "ABC SL", type: "empresa"}
- "cuantos suministros tengo pendientes" → intent: "query_info", params: {query: "supplies_pending"}
- "busca a Garcia" → intent: "search_client", params: {query: "Garcia"}
- "marca el suministro como presentado" → intent: "update_status", params: {status: "presentado"}

Solo responde con el JSON, sin texto adicional.`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `${systemPrompt}\n\nComando del usuario: "${message}"` }] },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
          },
        }),
      }
    )

    if (!res.ok) {
      console.error('[bandeja-ai] Gemini error:', res.status)
      return NextResponse.json(fallbackParse(message, context))
    }

    const data = await res.json()
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    try {
      // Parse Gemini response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as AIAction
        // Enrich with extracted CUPS if present
        const cupsMention = extractCups(message)
        if (cupsMention && !parsed.params?.cups) {
          parsed.params = { ...parsed.params, cups: cupsMention }
        }
        return NextResponse.json(parsed)
      }
    } catch (e) {
      console.error('[bandeja-ai] Parse error:', e)
    }

    return NextResponse.json(fallbackParse(message, context))
  } catch (err: any) {
    console.error('[bandeja-ai] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Error procesando comando' },
      { status: 500 }
    )
  }
}

/**
 * Quick pattern matching for common commands without calling Gemini
 */
function matchQuickAction(message: string, context?: any): AIAction | null {
  const msg = message.toLowerCase().trim()

  // CUPS check / info
  const cupsMatch = extractCups(message)
  if (cupsMatch) {
    return {
      intent: 'check_cups',
      confidence: 0.95,
      params: { cups: cupsMatch },
      message: `Buscando informacion del CUPS ${cupsMatch}...`,
      actions: [
        { type: 'search', label: 'Comprobar CUPS', data: { cups: cupsMatch } },
        { type: 'create', label: 'Crear suministro', data: { cups: cupsMatch } },
      ],
    }
  }

  // Create client
  if (msg.startsWith('crear cliente') || msg.startsWith('nuevo cliente') || msg.startsWith('crea cliente')) {
    const name = message.replace(/^(crear|nuevo|crea)\s+cliente\s*/i, '').trim()
    return {
      intent: 'create_client',
      confidence: 0.9,
      params: { name: name || undefined },
      message: name ? `Crear cliente "${name}"?` : 'Que nombre tiene el nuevo cliente?',
      actions: name
        ? [{ type: 'create', label: `Crear "${name}"`, data: { name, type: 'empresa' } }]
        : [],
    }
  }

  // Search
  if (msg.startsWith('busca') || msg.startsWith('buscar') || msg.startsWith('encuentra')) {
    const query = message.replace(/^(busca|buscar|encuentra)\s*/i, '').trim()
    return {
      intent: 'search_client',
      confidence: 0.9,
      params: { query },
      message: `Buscando "${query}"...`,
      actions: [
        { type: 'search', label: `Buscar clientes`, data: { query } },
        { type: 'search', label: `Buscar suministros`, data: { query, scope: 'supplies' } },
      ],
    }
  }

  // Status queries
  if (msg.includes('pendiente') || msg.includes('cuantos') || msg.includes('cuántos') || msg.includes('resumen')) {
    return {
      intent: 'query_info',
      confidence: 0.8,
      params: { query: msg },
      message: 'Consultando tus datos...',
      actions: [
        { type: 'info', label: 'Ver resumen', data: { type: 'dashboard_summary' } },
      ],
    }
  }

  // Help
  if (msg.includes('ayuda') || msg.includes('help') || msg === '?') {
    return {
      intent: 'help',
      confidence: 1.0,
      params: {},
      message: 'Puedes escribirme comandos como:\n• Pegar un CUPS para consultarlo\n• "Crear cliente Empresa SL"\n• "Buscar Garcia"\n• Adjuntar facturas para crear suministros\n• "¿Cuantos pendientes tengo?"',
      actions: [],
    }
  }

  return null
}

/**
 * Fallback parsing when Gemini is unavailable
 */
function fallbackParse(message: string, context?: any): AIAction {
  const quick = matchQuickAction(message, context)
  if (quick) return quick

  return {
    intent: 'unknown',
    confidence: 0.3,
    params: { raw: message },
    message: 'No he entendido el comando. Prueba con:\n• Pegar un CUPS\n• "Crear cliente [nombre]"\n• "Buscar [nombre]"\n• Adjuntar facturas',
    actions: [],
  }
}
