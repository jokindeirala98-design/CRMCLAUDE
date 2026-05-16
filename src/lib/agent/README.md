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
- **Fase 2 — Ingesta corpus A&C** ✅ Scripts Node de ingesta markdown + YouTube
- **Fase 3 — Endpoint /chat con tool calling** ✅ rag_search + crm_buscar + crm_historial + gmail_preview
- **Fase 4 — Bot Telegram con whitelist** ✅ Webhook diferenciado + procesado de voz
- **Fase 5 — Gmail OAuth + envío con preview** ✅ Solo con confirmación explícita "Sí"

## Endpoints HTTP

| Endpoint | Método | Propósito |
|---|---|---|
| `/api/agent/chat` | POST | Conversación principal con tool calling |
| `/api/agent/telegram` | POST | Webhook del bot (mensajes + callbacks) |
| `/api/agent/telegram/setup` | GET | Registrar webhook con Telegram (una vez) |
| `/api/agent/gmail/connect?u={uid}` | GET | Inicia OAuth flow Gmail |
| `/api/agent/gmail/callback` | GET | Recibe el código de Google y guarda tokens |
| `/api/agent/gmail/send` | POST | Envía correo (solo desde el handler de Telegram) |

## Cómo poner en marcha (paso a paso)

### 1. Aplicar migration en Supabase (ya hecho ✓)

### 2. Ingestar conocimiento inicial

```bash
cd "/Users/jokindeirala/Desktop/VOLTIS CRM/voltis-crm"
npm run agent:ingest-voltis
npm run agent:ingest-tarjetas
```

### 3. Crear el bot de Telegram dedicado al agente

1. En Telegram, escribe a `@BotFather`.
2. `/newbot` → nombre: `Voltis Agente Comercial` → username: `voltis_agente_bot` (o el que esté libre).
3. Guarda el token que te da.

### 4. Configurar variables de entorno en Vercel

```
TELEGRAM_AGENT_BOT_TOKEN=el_token_del_bot_nuevo
TELEGRAM_AGENT_WEBHOOK_SECRET=<aleatorio, 32 chars>
TELEGRAM_AGENT_AUTHORIZED_IDS=<tu_telegram_id,...>  # fallback opcional
AGENT_INTERNAL_TOKEN=<aleatorio, 32 chars>          # protege /chat de uso externo
AGENT_ENCRYPTION_KEY=<32 bytes hex>                 # para cifrar refresh_token Gmail
GMAIL_OAUTH_CLIENT_ID=...                           # Google Cloud Console
GMAIL_OAUTH_CLIENT_SECRET=...
AGENT_API_BASE_URL=https://voltis-crm-bueno.vercel.app  # opcional, autodetecta si no
```

Para generar `AGENT_ENCRYPTION_KEY`: `openssl rand -hex 32`
Para `AGENT_INTERNAL_TOKEN` y `TELEGRAM_AGENT_WEBHOOK_SECRET`: `openssl rand -hex 16`

### 5. Configurar OAuth de Google

1. Entra en https://console.cloud.google.com/apis/credentials
2. Crea un proyecto si no tienes, o usa el de Voltis.
3. Habilita "Gmail API".
4. Crea OAuth client ID tipo "Web application".
5. Redirect URI: `https://voltis-crm-bueno.vercel.app/api/agent/gmail/callback`
6. Copia Client ID y Client Secret a las vars de Vercel.
7. En "OAuth consent screen": modo Internal o Testing con los emails del piloto añadidos.

### 6. Registrar webhook Telegram

Una vez deployado:

```
GET https://voltis-crm-bueno.vercel.app/api/agent/telegram/setup?token=<AGENT_INTERNAL_TOKEN>
```

Deberías ver `{"setWebhook":{"ok":true,...}}`.

### 7. Añadirte a la whitelist

En Supabase SQL Editor:

```sql
insert into agent_authorized_users (telegram_user_id, name, role)
values (<TU_TELEGRAM_ID>, 'Nicolás', 'admin');
```

### 8. Probar

1. Escribe `/start` al bot nuevo.
2. Pregunta: "Cómo manejo objeción de precio".
3. Conecta Gmail con `/conectar_gmail`.
4. Pídele redactar un correo: "Redacta correo a juan@ejemplo.com para hacer follow-up del estudio que le pasé la semana pasada".
5. El bot mostrará preview con botones [Enviar] [Editar] [Cancelar].

## Reglas inquebrantables del agente

1. Nunca inventa datos del CRM. Si no tiene un dato, pide permiso para consultarlo.
2. Nunca envía un correo sin confirmación explícita "Sí" del comercial.
3. Cuando usa una idea de A&C, la identifica con su cita.
4. Tono profesional y directo. Tuteo. Sin emojis salvo informales.
5. Solo responde a Telegram IDs en `agent_authorized_users`.

## Cómo ingestar el corpus (Fase 2)

Los scripts de ingesta corren **desde tu Mac** (no desde el sandbox), porque acceden a Supabase y a binarios del sistema (yt-dlp/ffmpeg).

### 1) Voltis Knowledge Base — ICP, pricing, objeciones, casos

```bash
cd "/Users/jokindeirala/Desktop/VOLTIS CRM/voltis-crm"
npm run agent:ingest-voltis
```

Lee `content/agent-kb/voltis-kb.md`, lo trocea por secciones `##`, calcula embeddings con Gemini y lo indexa en colección `voltis_kb`.

### 2) Tarjetas técnicas A&C — frameworks de venta consultiva

```bash
npm run agent:ingest-tarjetas
```

Lee `content/agent-kb/tarjetas-tecnicas.md`, lo indexa en colección `voltis_tarjetas_tecnicas`. Estas tarjetas se inyectan con prioridad en el system prompt.

> **IMPORTANTE**: edita primero ambos ficheros con tu contenido real (los esqueletos actuales tienen placeholders `[completar]`). Los scripts son **idempotentes**: borran los chunks anteriores del mismo fichero antes de re-indexar.

### 3) Vídeos de YouTube A&C

Requiere `yt-dlp` y `ffmpeg` instalados:

```bash
brew install yt-dlp ffmpeg
```

Ejecutar con URLs:

```bash
npm run agent:ingest-youtube -- https://youtu.be/JpW4RxLvWX4 https://youtu.be/XXXX
```

Por cada vídeo: descarga audio → transcribe con Gemini multimodal → chunkea → embeddings → indexa en `a&c_youtube` con cita `{título} · min {mm:ss}`. La transcripción se cachea en `/tmp/voltis-yt-ingest/{id}.txt` para no re-transcribir si vuelves a ejecutar.

### Verificar lo indexado

En Supabase SQL Editor:

```sql
select collection, count(*) as chunks, count(distinct source) as fuentes
from kb_chunks
group by collection
order by collection;
```

### Probar el RAG manualmente (desde el CRM o Node REPL)

```ts
import { ragSearchAandC } from '@/lib/agent/rag'
const r = await ragSearchAandC('cómo manejo objeción de precio')
console.log(r.formattedContext)
```

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
