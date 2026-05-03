-- ── Google Auth & User Initials ──────────────────────────────────────────────
-- Adds initials and google_id to users_profile for Google Workspace login

ALTER TABLE users_profile
  ADD COLUMN IF NOT EXISTS initials    TEXT,
  ADD COLUMN IF NOT EXISTS google_id   TEXT;

-- Unique index on google_id (one Google account per CRM user)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_profile_google_id
  ON users_profile(google_id) WHERE google_id IS NOT NULL;

-- Auto-generate initials for existing users that don't have them
UPDATE users_profile
SET initials = (
  SELECT string_agg(upper(left(part, 1)), '')
  FROM (
    SELECT unnest(string_to_array(trim(full_name), ' ')) AS part
    LIMIT 2
  ) parts
  WHERE part <> ''
)
WHERE initials IS NULL;

-- Comment
COMMENT ON COLUMN users_profile.initials IS 'Two-letter initials shown in avatars (e.g. NV for Nicolás Voltis)';
COMMENT ON COLUMN users_profile.google_id IS 'Google sub identifier — set on first Google OAuth login';
