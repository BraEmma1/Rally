/*
# PHASE 2 (breaking) — restrict the avatars bucket to raster image types

DO NOT APPLY until the frontend that derives the upload extension from the
detected MIME type is deployed. The previous bundle takes the extension from the
supplied filename, so a file with no extension (or an unusual one) would be
rejected by the new policy.

## What this closes
The avatars bucket is public and its policies only checked that the object path
starts with the uploader's user id — nothing validated content. The client-side
`file.type.startsWith('image/')` check is bypassed entirely by calling the
Storage API directly, so any file, including an SVG carrying script served inline
from the storage origin, could be uploaded and linked as a "photo".

SVG is deliberately not in the allowlist: it is an active content type, not a
safe raster image.

Note for existing users: HEIC uploads (common from iPhones) are not in the
allowlist and will be rejected. The frontend now states the accepted formats up
front rather than failing at upload time.
*/

UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  file_size_limit = 5242880
WHERE id = 'avatars';

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
