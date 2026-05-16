-- ════════════════════════════════════════════════════════════════════════════
-- AGENTE IA COMERCIAL — CIMIENTOS
-- Fase 1: pgvector + tablas base + RLS + tipos
--
-- Stack: Gemini 2.5 Flash (LLM + multimodal voz) + Gemini text-embedding-004
-- Vector store: pgvector dentro del mismo Supabase (sin Qdrant)
-- Bot Telegram: nuevo endpoint /api/agent/telegram diferenciado del actual
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Habilitar pgvector (Supabase Free Tier soporta esto)
create extension if not exists vector;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) kb_chunks — corpus indexado (A&C + Voltis interno)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.kb_chunks (
  id          uuid primary key default gen_random_uuid(),
  -- Colección lógica: 'a&c_youtube', 'a&c_linkedin', 'a&c_instagram',
  -- 'voltis_kb', 'voltis_tarjetas_tecnicas'
  collection  text not null,
  -- Identificador de la fuente (URL del vídeo, slug del doc, etc.)
  source      text not null,
  -- Texto del chunk (después de limpieza)
  content     text not null,
  -- Embedding 768-dim (Gemini text-embedding-004)
  embedding   vector(768),
  -- Metadata libre: timestamps, capítulo, tags, etc.
  metadata    jsonb default '{}'::jsonb,
  -- Para citar al usuario: "según vídeo X minuto Y"
  citation    text,
  created_at  timestamptz default now()
);

-- Índice IVFFlat para búsqueda aproximada (ANN). Lists=100 es bueno para
-- corpus medianos (<100k chunks). Para piloto (~5k chunks) está sobrado.
create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index if not exists kb_chunks_collection_idx on public.kb_chunks (collection);
create index if not exists kb_chunks_source_idx on public.kb_chunks (source);

comment on table public.kb_chunks is
  'Corpus indexado del agente IA: chunks de Alfonso & Cristian + conocimiento Voltis. Embeddings con Gemini text-embedding-004 (768-dim).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) agent_conversations — sesión por comercial+cliente referido
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_conversations (
  id              uuid primary key default gen_random_uuid(),
  -- Comercial (Telegram user id numérico)
  telegram_user_id bigint not null,
  -- Nombre humano del comercial (para logs)
  commercial_name text,
  -- Cliente referido en la conversación (si aplica)
  referenced_client_id uuid references public.clients(id) on delete set null,
  -- Resumen breve de la conversación (para memoria a medio plazo)
  summary         text,
  -- Última actividad
  last_message_at timestamptz default now(),
  created_at      timestamptz default now()
);

create index if not exists agent_conv_user_idx on public.agent_conversations (telegram_user_id, last_message_at desc);
create index if not exists agent_conv_client_idx on public.agent_conversations (referenced_client_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4) agent_messages — historial completo (request + response + tools)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.agent_conversations(id) on delete cascade,
  -- Quien habla: 'user' (comercial), 'assistant' (LLM), 'tool' (resultado tool)
  role            text not null check (role in ('user','assistant','tool','system')),
  -- Texto plano del mensaje
  content         text,
  -- Si fue audio, URL al fichero original en Storage
  audio_url       text,
  -- Si fue audio, transcripción
  transcript      text,
  -- Para mensajes 'assistant' que disparan herramientas
  tool_calls      jsonb,
  -- Para mensajes 'tool' que devuelven resultado
  tool_name       text,
  tool_result     jsonb,
  -- Métricas
  tokens_in       int,
  tokens_out      int,
  latency_ms      int,
  model_used      text,
  cost_estimate_usd numeric(10,6),
  -- Feedback humano (thumbs up/down)
  user_rating     int check (user_rating in (-1, 0, 1)),
  user_feedback   text,
  created_at      timestamptz default now()
);

create index if not exists agent_msg_conv_idx on public.agent_messages (conversation_id, created_at);
create index if not exists agent_msg_rating_idx on public.agent_messages (user_rating) where user_rating is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) gmail_credentials — OAuth tokens por comercial (cifrados)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.gmail_credentials (
  id              uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  gmail_address   text not null,
  -- Refresh token cifrado (lo cifra/descifra la app, no la BD)
  refresh_token_encrypted text not null,
  -- Access token cacheado (se renueva con refresh)
  access_token    text,
  access_token_expires_at timestamptz,
  -- Scopes concedidos
  scopes          text[] default array['gmail.send','gmail.compose','gmail.readonly'],
  -- Estado de la conexión
  status          text default 'active' check (status in ('active','revoked','error')),
  last_used_at    timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists gmail_creds_user_idx on public.gmail_credentials (telegram_user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6) agent_authorized_users — whitelist de comerciales con acceso
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_authorized_users (
  telegram_user_id bigint primary key,
  name            text not null,
  email           text,
  -- Rol: 'piloto' inicialmente, luego 'comercial', 'admin'
  role            text default 'piloto' check (role in ('piloto','comercial','admin')),
  -- Vinculado a un comercial del CRM si aplica
  commercial_id   uuid references public.users_profile(id) on delete set null,
  active          boolean default true,
  added_at        timestamptz default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 7) Función RPC: búsqueda vectorial sobre kb_chunks
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.kb_search(
  query_embedding vector(768),
  match_collection text default null,
  match_count int default 10,
  similarity_threshold float default 0.0
)
returns table (
  id uuid,
  collection text,
  source text,
  content text,
  citation text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.collection,
    c.source,
    c.content,
    c.citation,
    c.metadata,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_chunks c
  where (match_collection is null or c.collection = match_collection)
    and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8) RLS — todo el módulo del agente es interno (solo service role lo toca)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.kb_chunks enable row level security;
alter table public.agent_conversations enable row level security;
alter table public.agent_messages enable row level security;
alter table public.gmail_credentials enable row level security;
alter table public.agent_authorized_users enable row level security;

-- Service role (API routes con SUPABASE_SERVICE_ROLE_KEY) tiene acceso total.
-- Los clientes anon/authenticated NO ven nada de estas tablas (módulo interno).
create policy "service_role_all_kb_chunks" on public.kb_chunks
  for all to service_role using (true) with check (true);
create policy "service_role_all_agent_conv" on public.agent_conversations
  for all to service_role using (true) with check (true);
create policy "service_role_all_agent_msg" on public.agent_messages
  for all to service_role using (true) with check (true);
create policy "service_role_all_gmail" on public.gmail_credentials
  for all to service_role using (true) with check (true);
create policy "service_role_all_authorized" on public.agent_authorized_users
  for all to service_role using (true) with check (true);

-- Admins del CRM pueden ver los logs del agente (no datos sensibles del Gmail)
create policy "admin_read_agent_conv" on public.agent_conversations
  for select to authenticated using (
    exists (select 1 from public.users_profile u where u.id = auth.uid() and u.role = 'admin')
  );
create policy "admin_read_agent_msg" on public.agent_messages
  for select to authenticated using (
    exists (select 1 from public.users_profile u where u.id = auth.uid() and u.role = 'admin')
  );
create policy "admin_read_authorized" on public.agent_authorized_users
  for select to authenticated using (
    exists (select 1 from public.users_profile u where u.id = auth.uid() and u.role = 'admin')
  );

-- ════════════════════════════════════════════════════════════════════════════
-- FIN — Fase 1 cimientos
-- ════════════════════════════════════════════════════════════════════════════
