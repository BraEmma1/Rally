/*
# Lock down legacy demo tables and handle_new_user function

## Overview
A QA security audit found a set of legacy demo tables from an earlier
prototype (account, identifier, profile, organizer, event, participation,
connection — singular names) still exposed through the Data API with no
Row Level Security. They contain no real user data (rows are not linked to
any auth users) and the application never reads or writes them.

## Security changes
- Revoke ALL privileges on the legacy tables from anon and authenticated
  roles, so they are no longer reachable through the public API.
  (Non-destructive: no data is dropped; only API access is removed.)
- Revoke EXECUTE on public.handle_new_user() from anon and authenticated.
  This function is a trigger function intended to run only on user signup
  (as the table owner); it does not need to be callable via RPC.

## Important notes
- The real application tables (profiles, connections, events,
  event_registrations, event_invitations, follow_ups, notes, opportunities,
  notifications) already have RLS enabled and are unaffected.
- Leaked-password protection is an Auth dashboard setting and cannot be
  enabled via migration SQL; recommended to enable in the Supabase
  dashboard under Authentication > Policies.
*/

-- The legacy tables are a leftover from an earlier prototype. They exist in
-- the database this migration was first written against, but nothing in this
-- repository creates them — so on a database built only from this source they
-- are absent, and an unconditional REVOKE aborts the deploy on the first one
-- (42P01: relation "public.account" does not exist). That is finding F-01 of
-- the fresh-database validation, which stopped a clean rebuild at file 11 of
-- 68.
--
-- Revoking per table, only where the table is present, keeps the original
-- semantics exactly where they matter and makes the statement a no-op where
-- the table was never created. to_regclass() returns NULL for an unknown
-- relation instead of raising, which is what makes the test safe.
DO $$
DECLARE
  legacy_table text;
BEGIN
  FOREACH legacy_table IN ARRAY ARRAY[
    'account', 'identifier', 'profile', 'organizer',
    'event', 'participation', 'connection'
  ] LOOP
    IF to_regclass('public.' || quote_ident(legacy_table)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', legacy_table);
    END IF;
  END LOOP;
END
$$;

-- Unconditional: handle_new_user() is created by this repository, so it is
-- always present here and must always lose its API grants.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
