/*
# Restrict the avatars bucket to real image types

## Problem
The `avatars` bucket is public and its storage policies only checked that the
object path starts with the uploader's user id. Nothing validated content type,
so any file — including an SVG carrying script, served inline from the storage
origin — could be uploaded and linked as a "photo". The client-side
`file.type.startsWith('image/')` check is trivially bypassed by calling the
Storage API directly.

## Changes
1. Set `allowed_mime_types` and a 5 MB `file_size_limit` on the bucket. Supabase
   Storage enforces these server-side on every upload. SVG is deliberately
   excluded: it is an active content type, not a safe raster image.
2. Tighten the insert/update policies to also require an image file extension,
   so the stored object name cannot misrepresent its type.
*/

-- ============================================================================
-- 1. Bucket-level content restrictions
-- ============================================================================
UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ],
  file_size_limit = 5242880
WHERE id = 'avatars';

-- ============================================================================
-- 2. Path/extension checks alongside the existing owner-folder check
-- ============================================================================
DROP POLICY IF EXISTS "avatar_insert" ON storage.objects;
CREATE POLICY "avatar_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
  );

DROP POLICY IF EXISTS "avatar_update" ON storage.objects;
CREATE POLICY "avatar_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
  );

-- avatar_select and avatar_delete are unchanged.
