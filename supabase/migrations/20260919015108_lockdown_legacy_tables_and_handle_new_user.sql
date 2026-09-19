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

REVOKE ALL ON public.account FROM anon, authenticated;
REVOKE ALL ON public.identifier FROM anon, authenticated;
REVOKE ALL ON public.profile FROM anon, authenticated;
REVOKE ALL ON public.organizer FROM anon, authenticated;
REVOKE ALL ON public.event FROM anon, authenticated;
REVOKE ALL ON public.participation FROM anon, authenticated;
REVOKE ALL ON public.connection FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
