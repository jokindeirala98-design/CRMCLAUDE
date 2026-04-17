-- ─────────────────────────────────────────────────────────────────────────
-- external_sessions
-- Guarda tokens de sesión de portales externos (TotalEnergies, ADX, …).
-- El bookmarklet que captura el token en el navegador hace upsert aquí
-- vía /api/external-session/upsert, y las integraciones server-side
-- leen `token` + `expires_at` en vez de tirar de env vars.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.external_sessions (
  provider    text primary key,           -- 'totalenergies', 'adx', …
  token       text not null,
  expires_at  timestamptz not null,
  raw         jsonb,                      -- opcional: payload completo capturado (debug)
  updated_at  timestamptz not null default now()
);

-- Trigger para mantener updated_at
create or replace function public.set_external_sessions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_external_sessions_updated_at on public.external_sessions;
create trigger trg_external_sessions_updated_at
  before update on public.external_sessions
  for each row execute procedure public.set_external_sessions_updated_at();

-- RLS: solo service-role puede leer/escribir. Las rutas API usan service key.
alter table public.external_sessions enable row level security;

-- Sin policies → bloqueado para anon/auth; solo service_role lo toca.
