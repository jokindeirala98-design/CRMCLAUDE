/**
 * Herramientas (tools / function calling) que el agente comercial puede invocar.
 *
 * Cada herramienta tiene:
 *   - definition: el esquema JSON que se le pasa a Gemini para que sepa cuándo
 *     y cómo llamarla.
 *   - execute: la función real que se ejecuta cuando el LLM la llama.
 *
 * Reglas de seguridad:
 *   - Ninguna tool inventa datos. Si no encuentra nada, devuelve { found: false }.
 *   - Las tools de escritura (registrar_actividad) requieren confirmación
 *     explícita del comercial — el endpoint de chat las marca como "pending"
 *     hasta confirmación.
 */
import { createClient } from '@supabase/supabase-js'
import { ragSearchAandC, ragSearchVoltis } from './rag'
import type { ToolDefinition } from './llm'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

// ───────────────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS — schemas que ve el LLM
// ───────────────────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'rag_search_aandc',
    description:
      'Busca en el corpus de Alfonso & Cristian frameworks de venta consultiva (objeciones, primera llamada, descubrimiento, cierre, follow-up). Úsala cuando el comercial pide consejo táctico, ayuda con una objeción, o quiere preparar una situación específica de venta. Devuelve los fragmentos más relevantes con cita.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Pregunta o tema a buscar en el corpus de A&C, en español. Ejemplos: "cómo manejo objeción de precio", "qué decir en primera llamada en frío", "frameworks de descubrimiento de necesidades".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'rag_search_voltis',
    description:
      'Busca en el conocimiento interno de Voltis (ICP, propuesta de valor, pricing, casos de éxito, objeciones específicas del sector energético, procesos comerciales). Úsala cuando necesitas datos concretos sobre Voltis o el sector.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Tema a buscar en el knowledge de Voltis. Ejemplos: "qué ahorro generamos en ayuntamientos", "pricing por tarifa eléctrica", "objeciones típicas y respuestas".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'crm_buscar_cliente',
    description:
      'Busca un cliente en el CRM de Voltis por nombre, CIF, NIF, dominio de email, o texto libre. Devuelve hasta 5 candidatos con sus IDs para que el agente pueda referenciarlos. Si encuentra exactamente 1, ese es el cliente referido en la conversación.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Texto de búsqueda: nombre del cliente, CIF, dominio (ej. "iberdrola.es"), o frase descriptiva ("el ayuntamiento de Estella").',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'crm_historial_cliente',
    description:
      'Obtiene el contexto del cliente: suministros activos, facturas recientes, ahorro estimado, etapa del pipeline, próximas acciones. Úsala SIEMPRE antes de redactar un correo o preparar una reunión con un cliente concreto.',
    parameters: {
      type: 'object',
      properties: {
        client_id: {
          type: 'string',
          description: 'UUID del cliente. Obtenlo primero con crm_buscar_cliente.',
        },
      },
      required: ['client_id'],
    },
  },
]

// ───────────────────────────────────────────────────────────────────────────
// TOOL EXECUTORS
// ───────────────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, any>,
): Promise<{ ok: boolean; result?: any; error?: string }> {
  try {
    switch (name) {
      case 'rag_search_aandc': {
        const r = await ragSearchAandC(args.query, { matchCount: 6, similarityThreshold: 0.5 })
        return {
          ok: true,
          result: {
            found: r.chunks.length > 0,
            chunks: r.chunks.map(c => ({
              cita: c.citation,
              colección: c.collection,
              similitud: c.similarity?.toFixed(2),
              contenido: c.content.slice(0, 1200),
            })),
            instrucciones: r.chunks.length > 0
              ? 'Usa estos fragmentos como base. Cita la fuente cuando aplique una idea ("según la tarjeta de objeción de precio...").'
              : 'No encontré nada relevante en el corpus A&C. Responde con criterio general o pide más contexto al comercial.',
          },
        }
      }

      case 'rag_search_voltis': {
        const r = await ragSearchVoltis(args.query, { matchCount: 5, similarityThreshold: 0.5 })
        return {
          ok: true,
          result: {
            found: r.chunks.length > 0,
            chunks: r.chunks.map(c => ({
              cita: c.citation,
              contenido: c.content.slice(0, 1200),
            })),
          },
        }
      }

      case 'crm_buscar_cliente': {
        const sb = admin()
        const q = String(args.query || '').trim()
        if (!q) return { ok: true, result: { found: false, candidatos: [] } }

        // Búsqueda por nombre fiscal o comercial, cif_nif, email
        const { data, error } = await sb
          .from('clients')
          .select('id, fiscal_name, commercial_name, cif_nif, email, type, status')
          .or(`fiscal_name.ilike.%${q}%,commercial_name.ilike.%${q}%,cif_nif.ilike.%${q}%,email.ilike.%${q}%`)
          .limit(5)

        if (error) return { ok: false, error: error.message }
        return {
          ok: true,
          result: {
            found: (data?.length || 0) > 0,
            candidatos: (data || []).map(c => ({
              id: c.id,
              nombre: c.commercial_name || c.fiscal_name,
              cif_nif: c.cif_nif,
              email: c.email,
              tipo: c.type,
              estado: c.status,
            })),
            instrucciones: (data?.length || 0) > 1
              ? 'Hay varios candidatos. Pregunta al comercial cuál es para desambiguar antes de actuar.'
              : (data?.length === 1 ? 'Cliente identificado unívocamente.' : 'No encontré ningún cliente con esa búsqueda.'),
          },
        }
      }

      case 'crm_historial_cliente': {
        const sb = admin()
        const clientId = args.client_id
        if (!clientId) return { ok: false, error: 'client_id requerido' }

        const [clientRes, suppliesRes] = await Promise.all([
          sb.from('clients').select('id, fiscal_name, commercial_name, cif_nif, email, phone, type, status, ahorro_sugerido, notes, created_at')
            .eq('id', clientId).maybeSingle(),
          sb.from('supplies').select('id, type, cups, name, tariff, status, comercializadora_actual, consumption_data')
            .eq('client_id', clientId),
        ])

        if (clientRes.error) return { ok: false, error: clientRes.error.message }
        if (!clientRes.data) return { ok: true, result: { found: false } }

        const cli = clientRes.data
        const supplies = suppliesRes.data || []

        // Facturas recientes de cualquier supply
        let invoices: any[] = []
        if (supplies.length > 0) {
          const supplyIds = supplies.map(s => s.id)
          const { data: invs } = await sb.from('invoices')
            .select('id, supply_id, source, period_start, period_end, total_amount, extracted_data')
            .in('supply_id', supplyIds)
            .order('period_end', { ascending: false })
            .limit(8)
          invoices = invs || []
        }

        // Resumen compacto para no inundar el prompt
        return {
          ok: true,
          result: {
            cliente: {
              id: cli.id,
              nombre: cli.commercial_name || cli.fiscal_name,
              cif_nif: cli.cif_nif,
              email: cli.email,
              telefono: cli.phone,
              tipo: cli.type,
              estado_pipeline: cli.status,
              ahorro_sugerido_anual_eur: cli.ahorro_sugerido,
              notas: cli.notes?.slice(0, 500),
              dado_alta: cli.created_at,
            },
            suministros: supplies.map(s => ({
              id: s.id,
              tipo: s.type,
              cups: s.cups,
              nombre: s.name,
              tarifa: s.tariff,
              estado_pipeline: s.status,
              comercializadora_actual: s.comercializadora_actual,
              consumo_anual_kwh: s.consumption_data?.totalKwh,
            })),
            facturas_recientes: invoices.map(inv => ({
              periodo: `${inv.period_start || '?'} → ${inv.period_end || '?'}`,
              importe_eur: Number(inv.total_amount) || 0,
              comercializadora: inv.extracted_data?.economics?.comercializadora,
              consumo_kwh: inv.extracted_data?.economics?.consumoTotalKwh,
              fuente: inv.source,
            })),
            resumen: `${supplies.length} suministros · ${invoices.length} facturas recientes`,
          },
        }
      }

      default:
        return { ok: false, error: `Herramienta desconocida: ${name}` }
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error desconocido' }
  }
}
