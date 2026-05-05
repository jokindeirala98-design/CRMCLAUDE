-- Deduplication table for Telegram webhook updates.
-- Prevents double-processing when Telegram retries due to slow responses.
create table if not exists public.telegram_processed_updates (
  update_id   bigint primary key,
  processed_at timestamptz not null default now()
);

-- Auto-clean records older than 7 days to keep the table small.
-- Telegram only retries for a few hours so 7 days is more than enough.
create index if not exists idx_telegram_processed_updates_at
  on public.telegram_processed_updates (processed_at);

-- RLS: only service role can insert/select (webhook uses service key)
alter table public.telegram_processed_updates enable row level security;
