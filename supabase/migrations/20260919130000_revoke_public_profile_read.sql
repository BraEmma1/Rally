/*
# PHASE 2 (breaking) — close the public read on profiles

DO NOT APPLY until the frontend that uses get_public_profile /
get_public_profiles / get_connect_profile (phase 1, 20260919120000) is deployed.
The previous bundle reads `profiles` directly and will show empty public
profiles and empty attendee lists once this lands.

## What this closes
`public_read_profiles` granted anon an unfiltered SELECT. RLS filters rows, not
columns, so any unauthenticated caller could run
`GET /rest/v1/profiles?select=email,phone,full_name` with no filter and walk away
with every user's contact details. This removes that policy and the anon table
grant entirely; cross-user reads now go only through the phase 1 functions, which
each require explicit ids.

Owner-scoped policies (select/insert/update/delete_own_profile) are untouched, so
a user keeps full access to their own row.
*/

DROP POLICY IF EXISTS "public_read_profiles" ON profiles;

REVOKE ALL ON public.profiles FROM anon;
