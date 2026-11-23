/*
# Remove client privileges from the capability-history sequence (Q-18, stage S2-0)

Supabase's default privileges for objects created in `public` give `anon`,
`authenticated` and `service_role` USAGE, SELECT and UPDATE on every new
sequence. Identity stage S1 (20261125000000) revoked client access to its three
tables and six functions, but not to the identity sequence behind
`organization_capability_changes.seq`. On rally-dev (checked read-only on
2026-11-23) it reads:

    {postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}

With those privileges a client that reached SQL could read the sequence,
advance it (`nextval`) or reset it (`setval`). A reset would make the next
history insert collide on the UNIQUE `seq`, so the sync trigger, and the
organization change that fired it, would fail. It cannot read or write history
rows. No exposed function calls `nextval` or `setval`, so there is no known path
today; this closes it before stage S2 makes the capability tables authoritative
(decision log D-33, Q-18).

## Why nothing legitimate needs these privileges
- `seq` is `GENERATED ALWAYS AS IDENTITY`. Postgres checks no sequence
  privilege when it generates an identity value (verified on PG 16: an identity
  insert by a role with no sequence privilege succeeds; a `serial` one fails).
- The only writer of the history is `sync_organization_capability()`, a
  SECURITY DEFINER trigger owned by `postgres`.
- No client may read or write the history table (S1). `src/`, the Edge Function
  and the SQL suites never reference the sequence.

## What changes
`REVOKE ALL` on that one sequence from PUBLIC, anon and authenticated. PUBLIC
held nothing; naming it keeps it that way.

## What does not change
- `postgres` (the owner) and `service_role` keep USAGE, SELECT and UPDATE.
  `service_role` is the internal role the Edge Function uses, and it keeps the
  same access it already has to the history table.
- No table, function, policy, trigger, default privilege or row changes.
- Supabase's default privileges still grant clients access to any *future*
  sequence in `public`. `tests/sql/sequence-privileges.test.mjs` fails until
  such a grant is revoked or allow-listed with a reason.

## Safety
Forward-only and safe to re-run. The `to_regclass` guard makes this a no-op if
the sequence does not exist yet, which only happens when a test replays S1 out
of order (`identity-s1-expand.test.mjs` applies S1 after every later migration).
Revert (owner approval only): `supabase/reverts/20261126000000_revoke_capability_history_sequence_grants.revert.sql`.
*/

DO $$
BEGIN
  IF to_regclass('public.organization_capability_changes_seq_seq') IS NULL THEN
    RAISE NOTICE 'public.organization_capability_changes_seq_seq does not exist; nothing to revoke';
    RETURN;
  END IF;

  REVOKE ALL ON SEQUENCE public.organization_capability_changes_seq_seq FROM PUBLIC, anon, authenticated;
END
$$;
