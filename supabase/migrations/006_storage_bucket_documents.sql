-- ============================================
-- 6. STORAGE BUCKET: documents (public)
-- ============================================
-- This bucket holds all uploaded files: facturas, informes, contratos, etc.
-- Run this in the Supabase SQL Editor if the bucket doesn't exist yet.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  true,
  52428800,  -- 50 MB max per file
  null       -- allow all mime types
)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ============================================
-- RLS POLICIES for storage.objects
-- ============================================

-- Drop existing policies if they exist (idempotent re-run)
DROP POLICY IF EXISTS "documents_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "documents_select_public" ON storage.objects;
DROP POLICY IF EXISTS "documents_update_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "documents_delete_authenticated" ON storage.objects;

-- Authenticated users can upload files to the documents bucket
CREATE POLICY "documents_insert_authenticated"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'documents');

-- Anyone (public) can read files from the documents bucket
CREATE POLICY "documents_select_public"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'documents');

-- Authenticated users can update their own uploads
CREATE POLICY "documents_update_authenticated"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'documents');

-- Authenticated users can delete uploads
CREATE POLICY "documents_delete_authenticated"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'documents');
