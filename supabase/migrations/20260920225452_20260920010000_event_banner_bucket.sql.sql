/*
# Event banner image uploads

1. Purpose
- Lets organizers pick a banner image from their device when creating or
  editing an event, instead of pasting an external URL.
- Uploaded files go to a new public storage bucket named "event-banners".
- The events table already has an `image_url` column; no schema change is
  needed — the uploader stores the resulting public URL there.

2. Storage changes
- New bucket `event-banners` (public read), restricted to raster image types
  (JPEG, PNG, WebP, GIF) with a 5 MB per-file limit, mirroring the existing
  avatars bucket. SVG is excluded because it can carry script and the bucket
  is served publicly.
- Objects are stored under a folder named after the uploading user's id:
  `<user_id>/<random>.<ext>`.

3. Security
- RLS on storage.objects for this bucket:
  - Public read (SELECT) — banners are shown on public event pages.
  - Insert/update/delete only for the authenticated owner of the top-level
    folder (auth.uid() must match the first folder name).
- Event-level permissions (who may create or edit events) continue to be
  enforced by the existing database functions and RLS; the storage rules only
  govern file uploads.
*/

-- Create the bucket (upsert so re-running is safe)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-banners',
  'event-banners',
  true,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Anyone (including signed-out visitors) can view banners
DROP POLICY IF EXISTS "Public read event banners" ON storage.objects;
CREATE POLICY "Public read event banners"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'event-banners');

-- Only the uploader can add, replace or remove files in their own folder
DROP POLICY IF EXISTS "Users can upload own event banners" ON storage.objects;
CREATE POLICY "Users can upload own event banners"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-banners'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update own event banners" ON storage.objects;
CREATE POLICY "Users can update own event banners"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-banners'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'event-banners'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete own event banners" ON storage.objects;
CREATE POLICY "Users can delete own event banners"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-banners'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
