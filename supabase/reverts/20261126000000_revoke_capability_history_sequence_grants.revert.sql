/*
# REVERT of migration 20261126000000_revoke_capability_history_sequence_grants.sql

Restores the privileges that migration removed, exactly as they were on rally-dev
before it (checked read-only on 2026-11-23):

    {postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}

**This re-opens Q-18**: anon and authenticated regain USAGE, SELECT and UPDATE on
the capability-history sequence. Run it only with the repository owner's
explicit approval, and only to undo that migration.

## How to run
- As `postgres` (the Supabase SQL editor's role), so the grantor recorded in the
  ACL is `postgres`, as it was before.
- This directory is not a migration directory: the Supabase CLI never applies
  it, and running it records nothing in migration history.
- It does **not** remove the migration's row from
  `supabase_migrations.schema_migrations`. Editing migration history needs
  separate approval (CLAUDE.md rule 1). Re-applying the migration later is safe,
  because it is idempotent.

## What it does not touch
`postgres` and `service_role` were never changed by the migration, and PUBLIC
held nothing before it, so neither appears here. No other object changes.

Tested by `tests/sql/sequence-privileges.test.mjs`: after the migration and this
script, the ACL equals the pre-migration ACL entry for entry (grantee,
privilege, grantor and grant option).
*/

GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.organization_capability_changes_seq_seq TO anon, authenticated;
