# Agente IA Comercial — Voltis

Asistente IA accesible desde Telegram que ayuda a los comerciales de Voltis a vender mejor combinando tres fuentes:

1. **Metodología comercial de Alfonso & Cristian** (extraída de su contenido público)
2. **Información interna de Voltis** (ICP, pricing, objeciones, casos de éxito)
3. **Datos vivos del CRM** (clientes, oportunidades, historial)

## Stack (gratis — free tier)

| Componente | Implementación | Coste |
|---|---|---|
| LLM | Gemini 2.5 Flash (`@/lib/gemini`) | 0€ free tier |
| Transcripción voz | Gemini multimodal (mismo modelo) | 0€ |
| Embeddings | Gemini `text-embedding-004` (768-dim) | 0€ |
| Vector DB | `pgvector` en Supabase | 0€ Free tier |
| Postgres | Supabase actual | 0€ |
| Bot Telegram | Endpoint `/api/agent/telegram` | 0€ |
| Gmail | Gmail API + OAuth por comercial | 0€ |
| Hosting | Vercel Hobby (mismo proyecto CRM) | 0€ |

**Total piloto: 0€/mes.**

## Estructura de archivos

```
src/lib/agent/
  README.md            ← este archivo
  types.ts             ← interfaces TypeScript
  embeddings.ts        ← cliente Gemini text-embedding-004
  chunking.ts          ← divide texto en chunks de ~500 tokens
  rag.ts               ← búsqueda vectorial + formato de contexto

src/app/api/agent/     ← (futuro, fase 3+)
  chat/route.ts        ← endpoint principal de conversación
  telegram/route.ts    ← webhook del bot
  gmail/*              ← OAuth + send

supabase/migrations/
  20260516_agent_ia_foundation.sql   ← cimientos: pgvector + tablas
```

## Tablas en Supabase

- `kb_chunks` — corpus indexado con embedding(768)
- `agent_conversations` — sesión por comercial+cliente
- `agent_messages` — historial completo con métricas
- `gmail_credentials` — OAuth tokens por comercial
- `agent_authorized_users` — whitelist de comerciales del piloto

### Colecciones del corpus (`kb_chunks.collection`)

- `a&c_youtube` — transcripciones de vídeos
- `a&c_linkedin` — posts y artículos
- `a&c_instagram` — captions y transcripciones reels
- `voltis_kb` — ICP, pricing, casos, objeciones
- `voltis_tarjetas_tecnicas` — frameworks curados a mano (gold standard)

## Función RPC `kb_search`

Llamada desde TypeScript con `supabase.rpc('kb_search', ...)`. Devuelve los
top-K chunks más similares al embedding de la query con su score coseno.

```ts
import { ragSearchAandC, ragSearchVoltis } from '@/lib/agent/rag'

const { chunks, formattedContext } = await ragSearchAandC(
  'cómo manejo objeción de precio'
)
// formattedContext es un string listo para inyectar en el system prompt
```

## Roadmap (fases)

- **Fase 1 — Cimientos DB** ✅ pgvector + tablas + tipos + RAG helpers
- **Fase 2 — Ingesta corpus A&C** Script Node que descarga, transcribe, chunkea e indexa
- **Fase 3 — Endpoint /chat con tool calling** rag_search + crm_buscar_cliente + crm_historial
- **Fase 4 — Bot Telegram con whitelist** Webhook diferenciado del actual
- **Fase 5 — Gmail OAuth + envío con preview** Solo con confirmación explícita "Sí"

## Reglas inquebrantables del agente

1. Nunca inventa datos del CRM. Si no tiene un dato, pide permiso para consultarlo.
2. Nunca envía un correo sin confirmación explícita "Sí" del comercial.
3. Cuando usa una idea de A&C, la identifica con su cita.
4. Tono profesional y directo. Tuteo. Sin emojis salvo informales.
5. Solo responde a Telegram IDs en `agent_authorized_users`.

## Cómo aplicar la migration

Desde Supabase Dashboard → SQL Editor:

```sql
-- pega el contenido completo de:
--   supabase/migrations/20260516_agent_ia_foundation.sql
```

O desde la CLI de Supabase (si está configurada):

```bash
supabase db push
```

## Variables de entorno necesarias

Ya existen:
- `GEMINI_API_KEY` (LLM + embeddings + voz)
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`

Nuevas (cuando lleguemos a fase 4+):
- `TELEGRAM_AGENT_AUTHORIZED_IDS` — CSV de Telegram user IDs (fallback si la tabla está vacía)
- `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET` — OAuth de usuario para enviar correos
- `AGENT_ENCRYPTION_KEY` — clave 32 bytes para cifrar refresh tokens
