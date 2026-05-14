-- ── Google Calendar: columnas en appointments ─────────────────────────────────
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS google_event_id TEXT,
  ADD COLUMN IF NOT EXISTS is_group_event  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attendees       TEXT[];  -- emails de asistentes

-- ── Google Calendar: columnas en users_profile ────────────────────────────────
ALTER TABLE users_profile
  ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_id   TEXT;

-- ── app_settings: configuración global del CRM ────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed con el calendar ID del calendario compartido de Voltis CRM
INSERT INTO app_settings (key, value)
VALUES (
  'shared_calendar_id',
  'c_08886e8a66e76930333685015c3b0e439c868d017f96fb258aaa5025f00c48c1@group.calendar.google.com'
)
ON CONFLICT (key) DO NOTHING;

-- RLS: solo admins pueden leer/escribir app_settings
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_admin_all" ON app_settings
  USING (
    EXISTS (
      SELECT 1 FROM users_profile
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
