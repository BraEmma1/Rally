/*
# REVERT of migration 20261128000000_partnership_package_link_integrity.sql

Removes the package-link trigger and its function, which is everything that
migration created. Afterwards the database behaves exactly as it did before it:

  - a plain INSERT or UPDATE may again link an ARCHIVED package
    (`apply_partnership_package` still refuses, as it always did);
  - an ordinary UPDATE may again replace or clear `package_id`.

**This re-opens the Spec A gap.** Run it only with the repository owner's
explicit approval, and only to undo that migration.

## How to run
- As `postgres` (the Supabase SQL editor's role), in one transaction.
- This directory is not a migration directory: the Supabase CLI never applies
  it, and running it records nothing in migration history.
- It does **not** remove the migration's row from
  `supabase_migrations.schema_migrations`. Editing migration history needs
  separate approval (CLAUDE.md rule 1). Re-applying the migration later is safe,
  because it is idempotent.

## What it does not touch
No data. The migration changed no row, so there is nothing to restore: every
`package_id` keeps the value it has. No policy, grant, constraint or other
function changes.

Tested by `tests/sql/package-link-integrity.test.mjs`: after the migration and
this script, the catalog (functions, triggers, constraints, policies, grants)
is identical to a replay that stops before the migration, and the old
behaviour is back.
*/

BEGIN;

DROP TRIGGER IF EXISTS check_partnership_package_link ON public.event_partnerships;
DROP FUNCTION IF EXISTS public.enforce_partnership_package_link();

COMMIT;
