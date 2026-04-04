-- ============================================
-- telegram_inbox: Telegram file forwarding queue
-- Run this in Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS telegram_inbox (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id BIGINT NOT NULL,
  sender_name TEXT,                              -- Telegram user name who sent it
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'pdf',          -- 'pdf' | 'image'
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',          -- 'pending' | 'processed' | 'dismissed'
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_telegram_inbox_status ON telegram_inbox(status);
CREATE INDEX idx_telegram_inbox_created ON telegram_inbox(created_at DESC);
CREATE INDEX idx_telegram_inbox_user_status ON telegram_inbox(user_id, status);

-- RLS policies
ALTER TABLE telegram_inbox ENABLE ROW LEVEL SECURITY;

-- ALL authenticated users can read telegram_inbox (admins need to see everything)
CREATE POLICY "Authenticated users can view telegram inbox"
  ON telegram_inbox FOR SELECT
  USING (auth.role() = 'authenticated');

-- ALL authenticated users can update (admin marks as processed/dismissed)
CREATE POLICY "Authenticated users can update telegram inbox"
  ON telegram_inbox FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ALL authenticated users can delete (admin can remove files)
CREATE POLICY "Authenticated users can delete telegram inbox"
  ON telegram_inbox FOR DELETE
  USING (auth.role() = 'authenticated');

-- Service role can insert (from webhook)
CREATE POLICY "Service role can insert telegram inbox"
  ON telegram_inbox FOR INSERT
  WITH CHECK (true);
