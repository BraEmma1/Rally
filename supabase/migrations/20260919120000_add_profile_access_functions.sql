/*
# PHASE 1 (additive) — scoped read paths for profiles

Part one of the profiles fix. This migration only ADDS functions, so it is safe
to apply while the previous frontend is still deployed. The companion migration
20260919130000 removes the blanket public read and must not run until the new
frontend is live.

## Why these exist
`public_read_profiles` grants anon an unfiltered SELECT on `profiles`. RLS
filters rows, not columns, so anyone can dump every user's email and phone.
Replacing it requires read paths that take explicit ids, so no caller can
enumerate the table:

- `get_public_profile(uuid)`    — anon + authenticated. Public professional card.
                                  No email, no phone. Powers /p/:id.
- `get_public_profiles(uuid[])` — authenticated. Batch form, capped at 500.
                                  Powers attendee lists and inviter names.
- `get_connect_profile(uuid)`   — authenticated. Card plus email and phone, for
                                  the QR / share-link flow where exchanging
                                  contact details is the point of the action.

Possession of a profile id is the authorisation signal for the contact card:
that id is exactly what a user hands out via their QR code or share link.
*/

CREATE OR REPLACE FUNCTION public.get_public_profile(profile_id uuid)
RETURNS TABLE (
  id uuid, full_name text, photo_url text, job_title text, company text,
  industry text, location text, bio text, looking_for text, can_offer text,
  linkedin text, website text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.photo_url, p.job_title, p.company,
         p.industry, p.location, p.bio, p.looking_for, p.can_offer,
         p.linkedin, p.website
  FROM profiles p
  WHERE p.id = profile_id;
$$;

CREATE OR REPLACE FUNCTION public.get_public_profiles(profile_ids uuid[])
RETURNS TABLE (
  id uuid, full_name text, photo_url text, job_title text, company text,
  industry text, location text, bio text, looking_for text, can_offer text,
  linkedin text, website text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.photo_url, p.job_title, p.company,
         p.industry, p.location, p.bio, p.looking_for, p.can_offer,
         p.linkedin, p.website
  FROM profiles p
  WHERE p.id = ANY(COALESCE(profile_ids, ARRAY[]::uuid[]))
  LIMIT 500;
$$;

CREATE OR REPLACE FUNCTION public.get_connect_profile(profile_id uuid)
RETURNS TABLE (
  id uuid, full_name text, photo_url text, job_title text, company text,
  industry text, location text, bio text, looking_for text, can_offer text,
  linkedin text, website text, email text, phone text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.photo_url, p.job_title, p.company,
         p.industry, p.location, p.bio, p.looking_for, p.can_offer,
         p.linkedin, p.website, p.email, p.phone
  FROM profiles p
  WHERE p.id = profile_id
    AND auth.uid() IS NOT NULL;
$$;

-- Revoke from anon and authenticated explicitly, not just PUBLIC: Supabase's
-- default privileges grant EXECUTE on new public-schema functions to both roles,
-- and revoking PUBLIC alone leaves those direct grants in place.
REVOKE EXECUTE ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_connect_profile(uuid) FROM PUBLIC, anon, authenticated;

-- /p/:id must work logged out, so the no-contact-details card is the only
-- function anon may call.
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_connect_profile(uuid) TO authenticated;
