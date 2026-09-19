/*
# Secure profiles: remove blanket public read, expose profiles through scoped RPCs

## Problem
The `public_read_profiles` policy granted `SELECT` on `profiles` to `anon` and
`authenticated` with `USING (true)`. RLS filters rows, not columns, so this
allowed ANY unauthenticated caller to run an unfiltered `SELECT` against the
REST API and dump every user's full_name, email, phone, company, bio and links.
That is a bulk PII leak, not the scoped "view one shared profile" behaviour the
/p/:id page needs.

## Changes
1. Drop `public_read_profiles`. Direct table access to `profiles` is now
   owner-only (the pre-existing `select_own_profile` policy).
2. Revoke the default `anon` table grants on `profiles` so the table is not
   reachable at all through the anonymous REST role.
3. Add three SECURITY DEFINER functions as the only cross-user read paths.
   Each one takes explicit profile id(s), so no caller can enumerate the table:
   - `get_public_profile(uuid)`      — anon + authenticated. Public professional
                                        card only. Deliberately excludes email
                                        and phone. Powers /p/:id.
   - `get_public_profiles(uuid[])`   — authenticated. Batch form of the above,
                                        capped at 500 ids. Powers the event
                                        attendee list and inviter names.
   - `get_connect_profile(uuid)`     — authenticated. Public card PLUS email and
                                        phone, for the QR / share-link connect
                                        flow where exchanging contact details is
                                        the whole point of the interaction.

## Access model
Possession of a profile id is the authorisation signal for the contact card:
the id is what a user hands out via their QR code or share link. Because every
entry point now requires an explicit id and the table itself is no longer
readable, there is no path to enumerate users or harvest contact details in bulk.
*/

-- ============================================================================
-- 1. Remove the blanket public read policy
-- ============================================================================
DROP POLICY IF EXISTS "public_read_profiles" ON profiles;

-- Owner-scoped policies from the initial schema remain in force:
--   select_own_profile / insert_own_profile / update_own_profile / delete_own_profile

-- ============================================================================
-- 2. Remove anonymous table-level access entirely
-- ============================================================================
REVOKE ALL ON public.profiles FROM anon;

-- ============================================================================
-- 3. Scoped read functions
-- ============================================================================

-- Public professional card: no email, no phone.
CREATE OR REPLACE FUNCTION public.get_public_profile(profile_id uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  photo_url text,
  job_title text,
  company text,
  industry text,
  location text,
  bio text,
  looking_for text,
  can_offer text,
  linkedin text,
  website text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.photo_url,
    p.job_title,
    p.company,
    p.industry,
    p.location,
    p.bio,
    p.looking_for,
    p.can_offer,
    p.linkedin,
    p.website
  FROM profiles p
  WHERE p.id = profile_id;
$$;

-- Batch public cards for known ids (attendee lists, inviter names).
CREATE OR REPLACE FUNCTION public.get_public_profiles(profile_ids uuid[])
RETURNS TABLE (
  id uuid,
  full_name text,
  photo_url text,
  job_title text,
  company text,
  industry text,
  location text,
  bio text,
  looking_for text,
  can_offer text,
  linkedin text,
  website text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.photo_url,
    p.job_title,
    p.company,
    p.industry,
    p.location,
    p.bio,
    p.looking_for,
    p.can_offer,
    p.linkedin,
    p.website
  FROM profiles p
  WHERE p.id = ANY(COALESCE(profile_ids, ARRAY[]::uuid[]))
  LIMIT 500;
$$;

-- Contact card for the connect flow: adds email + phone, authenticated only.
CREATE OR REPLACE FUNCTION public.get_connect_profile(profile_id uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  photo_url text,
  job_title text,
  company text,
  industry text,
  location text,
  bio text,
  looking_for text,
  can_offer text,
  linkedin text,
  website text,
  email text,
  phone text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.photo_url,
    p.job_title,
    p.company,
    p.industry,
    p.location,
    p.bio,
    p.looking_for,
    p.can_offer,
    p.linkedin,
    p.website,
    p.email,
    p.phone
  FROM profiles p
  WHERE p.id = profile_id
    AND auth.uid() IS NOT NULL;
$$;

-- ============================================================================
-- 4. Grants: explicit, least privilege
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_connect_profile(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_connect_profile(uuid) TO authenticated;
