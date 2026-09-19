/*
# Public profile read + avatars storage bucket

## 1. Public read policy on profiles
- Adds a SELECT policy allowing anyone (anon + authenticated) to read profiles
  by id, so public profile pages at /p/:id work without a session.
- Existing owner-scoped CRUD policies remain unchanged.

## 2. Avatars storage bucket
- Creates a public storage bucket named "avatars" for profile photo uploads.
- Adds storage policies allowing authenticated users to upload/read/delete
  their own avatar files (path-prefixed by their user id).

## Security notes
- The public SELECT policy is intentionally broad: profiles are professional
  networking data meant to be shared. Sensitive fields (email, phone) are
  included because the profile owner chooses to display them.
- Storage policies scope uploads to paths starting with the user's own id,
  preventing overwriting another user's avatar.
*/

-- Public read on profiles (for /p/:id)
DROP POLICY IF EXISTS "public_read_profiles" ON profiles;
CREATE POLICY "public_read_profiles"
  ON profiles FOR SELECT
  TO anon, authenticated
  USING (true);

-- Create avatars bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars
DROP POLICY IF EXISTS "avatar_select" ON storage.objects;
CREATE POLICY "avatar_select"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_insert" ON storage.objects;
CREATE POLICY "avatar_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatar_update" ON storage.objects;
CREATE POLICY "avatar_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatar_delete" ON storage.objects;
CREATE POLICY "avatar_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
