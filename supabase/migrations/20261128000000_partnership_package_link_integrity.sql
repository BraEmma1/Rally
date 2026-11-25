/*
# Spec A: a partnership's package link is set once, and only to an active package

`event_partnerships.package_id` records which package a partnership started
from (phase 5A). Until now the database checked only that the package belongs
to the same event (the composite foreign key). Three things were left to the
callers:

  - linking an ARCHIVED package: `apply_partnership_package` refuses it, but a
    plain INSERT or UPDATE did not (PR-B's wizard checks before saving, and its
    SQL suite pinned the gap so this migration would close it on purpose);
  - REPLACING the link with another package;
  - CLEARING the link.

This migration adds one BEFORE INSERT OR UPDATE trigger that decides all three
from the data alone:

    INSERT with a package       allowed if the package is active
    UPDATE NULL -> package      allowed if the package is active
                                (this is what apply_partnership_package does)
    UPDATE package -> other     refused
    UPDATE package -> NULL      refused
    any other write             unaffected, even when the linked package has
                                since been archived

## No exception, and why none is needed
Nothing here reads a session setting, a role name or the trigger depth, so no
caller can switch it off. The obvious exception -- "allow clearing when the
package row no longer exists, because that is the foreign key's ON DELETE SET
NULL" -- is deliberately NOT made, because that path never runs successfully:

  - `check_partnership_package_delete_rules` (phase 5A) refuses to delete any
    package a partnership points at, before the foreign key's action runs. It
    takes the package's row lock first and counts with a fresh snapshot, so a
    link committed concurrently is counted too.
  - Deleting an event removes its partnerships before its packages (the
    partnerships foreign key's cascade trigger fires first; checked on a PGlite
    replay and read-only on rally-dev). Those partnership rows are DELETED, not
    updated, so this trigger is not involved. Their packages are then unused.
  - In the opposite cascade order, the package delete guard above would refuse
    first, so the SET NULL action could not run either.

So the SET NULL action is unreachable on every successful path, and this
trigger refusing it changes no outcome: it only makes the link fail closed if
the delete guard is ever relaxed. That is the intended behaviour -- relaxing it
would be a decision about history, and should have to change this rule too.

## Concurrency: archive racing a link
The package row is read `FOR SHARE`, which conflicts with any UPDATE of it.

  - Archive first: the link waits for the archive to commit, then reads the
    archived row (READ COMMITTED follows the update) and is refused.
    Under REPEATABLE READ it fails with a serialization error instead.
  - Link first: the archive waits for the link to commit, then archives a
    package that was active when it was linked -- exactly like archiving any
    used package, which has always been allowed.

The lock lasts only until the linking transaction ends.

## Errors
An archived package is reported as a foreign-key violation (23503) naming the
package. That is the same signal a missing package gives, and both mean "this
package cannot be linked now"; PR-B's wizard already turns that signal into
"The package you chose is no longer available" and keeps the organizer's edits.
A package that does not exist, or belongs to another event, is still reported
by the foreign key itself: this trigger lets it through to that check.

## Not changed
No policy, grant, column, constraint or existing row. Existing links, including
any to packages archived after linking, are kept as they are. The
`rally.allow_partnership_link` and `rally.allow_org_authority_write` session
flags are untouched (recorded for a separate security review).

Revert: supabase/reverts/20261128000000_partnership_package_link_integrity.revert.sql
Tests:  tests/sql/package-link-integrity.test.mjs (PGlite) and
        tests/sql/package-link-concurrency.pg.mjs (real PostgreSQL, two sessions)
*/

CREATE OR REPLACE FUNCTION public.enforce_partnership_package_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_old uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD.package_id END;
  v_archived timestamptz;
BEGIN
  -- Unchanged (including a partnership without a package): nothing to decide.
  -- This is what keeps ordinary edits working on a partnership whose package
  -- has been archived since it was linked.
  IF NEW.package_id IS NOT DISTINCT FROM v_old THEN
    RETURN NEW;
  END IF;

  IF v_old IS NOT NULL THEN
    IF NEW.package_id IS NULL THEN
      RAISE EXCEPTION 'The package a partnership started from cannot be removed';
    END IF;
    RAISE EXCEPTION 'The package a partnership started from cannot be changed';
  END IF;

  -- NULL -> package, on INSERT or UPDATE. SECURITY DEFINER so the read cannot
  -- be hidden by RLS; FOR SHARE so a concurrent archive is serialized with it.
  SELECT k.archived_at INTO v_archived
  FROM event_partnership_packages k
  WHERE k.id = NEW.package_id AND k.event_id = NEW.event_id
  FOR SHARE;

  -- Missing, or another event's: the composite foreign key reports it.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'That package is archived, so a partnership cannot be linked to it'
      USING ERRCODE = 'foreign_key_violation',
            HINT = 'Restore the package first, or save the partnership without a package.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_partnership_package_link() IS
  'Spec A: event_partnerships.package_id may be set once (INSERT, or NULL to a package) and only to an active package of the same event; it can never be replaced or cleared. Decided from the data alone, with no session flag.';

REVOKE EXECUTE ON FUNCTION public.enforce_partnership_package_link() FROM PUBLIC, anon, authenticated;

-- Named to sort after check_event_partnership_rules, so it sees the row as that
-- trigger leaves it. No column list: a column list only reacts to the columns
-- named in the UPDATE's SET clause, not to a change another trigger makes.
DROP TRIGGER IF EXISTS check_partnership_package_link ON event_partnerships;
CREATE TRIGGER check_partnership_package_link
  BEFORE INSERT OR UPDATE ON event_partnerships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_package_link();
