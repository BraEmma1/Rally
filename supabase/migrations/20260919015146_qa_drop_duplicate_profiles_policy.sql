/*
# QA cleanup: drop redundant duplicate SELECT policy on profiles

The profiles table had two overlapping SELECT policies:
- "profiles_select" (authenticated)
- "public_read_profiles" (anon, authenticated)
The public-read policy already covers authenticated users, so the
authenticated-only one is redundant. Behavior is unchanged.
*/

DROP POLICY IF EXISTS "profiles_select" ON profiles;
