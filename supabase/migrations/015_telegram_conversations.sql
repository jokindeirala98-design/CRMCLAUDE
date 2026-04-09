-- ============================================
-- telegram_conversations: Telegram bot conversation state
-- Stores debounce timers and multi-step conversation context
-- ============================================

CREATE TABLE IF NOT EXISTS telegram_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id BIGINT UNIQUE NOT NULL,
  step TEXT NOT NULL DEFAULT 'idle',
  data JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookup by chat_id
CREATE INDEX IF NOT EXISTS idx_telegram_conversations_chat_id ON telegram_conversations(chat_id);

-- RLS: service role only (bot operates with service key)
ALTER TABLE telegram_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to telegram_conversations"
  ON telegram_conversations FOR ALL
  USING (true)
  WITH CHECK (true);
