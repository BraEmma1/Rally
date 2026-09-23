/*
# Revoke TRUNCATE from client roles, and let anon read a public agenda

Two fixes. The second is unrelated to the agenda and is here because it was
found while building it.

## 1. The agenda must actually be readable when signed out
`20260929000000` revoked every grant on `event_sessions` from `anon` while its
SELECT policy targets `anon`. A policy cannot grant what the table privilege
withholds, so the policy was dead and a signed-out visitor saw no agenda for a
published event. `events` grants `anon` SELECT; sessions now match, and only
SELECT — not the INSERT/UPDATE that `events` also carries by default and that
only its policies happen to block.

## 2. TRUNCATE bypasses row-level security
Supabase's default privileges grant the full set on new public-schema tables to
`anon` and `authenticated`, and that set includes TRUNCATE. TRUNCATE is not a
DELETE: **no RLS policy is consulted**, so a policy that permits deleting
nothing at all does not stop it.

Verified against this database before writing: signed in as an ordinary
attendee,

    TRUNCATE TABLE events CASCADE;

succeeded. At the time of writing `authenticated` could truncate 20 tables —
including events, connections, messages, organizations, profiles and
user_accounts — and `anon` could truncate 7. Any signed-in user could have
emptied the application, and the cascade would have taken registrations,
check-ins and agendas with it.

Nothing in Rally truncates from the client; every deletion path is a DELETE
policy or a soft delete. So the privilege has no legitimate caller and is
withdrawn from both roles across the schema. ALTER DEFAULT PRIVILEGES stops it
coming back on the next table someone creates.

This is a pre-existing hole, not one introduced by the agenda work, and it is
the reason this migration exists separately from it.
*/

-- 1. The published agenda is as public as the published event.
GRANT SELECT ON public.event_sessions TO anon;

-- 2. No client role may truncate anything.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- And not on tables created from here on either. Both role sets are covered:
-- the default privileges that ship with Supabase are attached to the postgres
-- and supabase_admin roles depending on who creates the table.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
