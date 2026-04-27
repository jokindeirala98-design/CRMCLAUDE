-- ============================================================
-- Weekly Plan system
-- Adds: weeks, objectives, task_log tables
-- Extends: tasks table with weekly plan columns
-- ============================================================

-- ── 1. weeks ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weeks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at   DATE NOT NULL,
  ends_at     DATE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
  created_by  UUID NOT NULL REFERENCES users_profile(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active week per period
CREATE UNIQUE INDEX IF NOT EXISTS weeks_active_unique
  ON weeks (starts_at)
  WHERE status = 'active';

-- ── 2. objectives ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS objectives (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id     UUID NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'advancing', 'done')),
  tag         TEXT NOT NULL DEFAULT 'interno',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS objectives_week_id_idx ON objectives (week_id);

-- ── 3. task_log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  changed_by  UUID REFERENCES users_profile(id),
  change_type TEXT NOT NULL,           -- 'zone_change', 'status_change', 'pin', etc.
  old_value   JSONB,
  new_value   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_log_task_id_idx ON task_log (task_id);

-- ── 4. Extend tasks table ─────────────────────────────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS week_id        UUID REFERENCES weeks(id),
  ADD COLUMN IF NOT EXISTS zone           TEXT CHECK (zone IN ('director', 'mine', 'inbox')),
  ADD COLUMN IF NOT EXISTS is_pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_focus_today BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS origin         TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS pinned_by      UUID REFERENCES users_profile(id),
  ADD COLUMN IF NOT EXISTS pinned_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_day   DATE;

-- Index for fetching tasks by week + user efficiently
CREATE INDEX IF NOT EXISTS tasks_week_user_idx ON tasks (week_id, assigned_to)
  WHERE week_id IS NOT NULL;

-- ── 5. Add telegram_chat_id to users_profile ─────────────────
-- (needed for daily briefing cron)
ALTER TABLE users_profile
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

-- ── 6. RLS policies ──────────────────────────────────────────

-- weeks: authenticated users can read; admins can write
ALTER TABLE weeks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weeks_select" ON weeks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "weeks_insert" ON weeks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users_profile
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "weeks_update" ON weeks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users_profile
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- objectives: authenticated users can read/write
ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "objectives_select" ON objectives
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "objectives_insert" ON objectives
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users_profile
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "objectives_update" ON objectives
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users_profile
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- task_log: anyone can insert, only admins/owners can read
ALTER TABLE task_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_log_select" ON task_log
  FOR SELECT TO authenticated
  USING (
    changed_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users_profile
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "task_log_insert" ON task_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ── 7. Sync telegram_chat_id from telegram_links ─────────────
-- Run once to backfill existing linked users
UPDATE users_profile up
SET telegram_chat_id = tl.telegram_chat_id::TEXT
FROM telegram_links tl
WHERE tl.user_id = up.id
  AND tl.status = 'active'
  AND up.telegram_chat_id IS NULL;
