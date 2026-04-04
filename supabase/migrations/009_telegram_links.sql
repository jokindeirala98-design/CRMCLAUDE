-- Telegram bot linking table
-- Connects CRM users to their Telegram chat IDs for notifications & invoice upload

CREATE TABLE IF NOT EXISTS telegram_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users_profile(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT,
  telegram_user_id BIGINT,
  link_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unlinked')),
  linked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_telegram_links_user_id ON telegram_links(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_links_chat_id ON telegram_links(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_links_code ON telegram_links(link_code) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_links_active_user ON telegram_links(user_id) WHERE status = 'active';

-- RLS
ALTER TABLE telegram_links ENABLE ROW LEVEL SECURITY;

-- Users can read their own links
CREATE POLICY telegram_links_select ON telegram_links
  FOR SELECT USING (true);

-- Users can insert their own links
CREATE POLICY telegram_links_insert ON telegram_links
  FOR INSERT WITH CHECK (true);

-- Users can update their own links
CREATE POLICY telegram_links_update ON telegram_links
  FOR UPDATE USING (true);

-- Users can delete their own pending links
CREATE POLICY telegram_links_delete ON telegram_links
  FOR DELETE USING (true);
