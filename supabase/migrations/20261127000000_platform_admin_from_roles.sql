/*
# Platform-admin authorization reads platform_roles (identity PR-2, decision D-43 / Q-31)

`is_platform_admin()` decides from the dedicated `platform_roles` table instead of
`user_accounts.account_type`. The owner approved option 1 of the PR-2 brief
(RALLY_PR2_BRIEF.md): an active account AND an active `platform_admin` grant. No
second gate on `account_type`.

## Before
    SELECT EXISTS (SELECT 1 FROM user_accounts a
                   WHERE a.user_id = auth.uid()
                     AND a.account_type = 'platform_admin'
                     AND a.status = 'active')

## After
    account_is_active()                           -- same status test as before
    AND an unrevoked platform_roles row (user = auth.uid(), role = 'platform_admin')

## Why the answers do not change
Identity stage S1 (20261125000000) mirrors every write of `account_type` into
`platform_roles` through the `sync_platform_role` trigger, so "active grant" and
"account_type = platform_admin" agree for every write path. `identity_s1_drift()`
checks exactly that. If they ever disagree:
- a missing or revoked grant DENIES (fails closed), whatever `account_type` says;
- an extra grant can only be written by the database owner. Clients hold no
  privilege on `platform_roles` (S1); `identity_s1_drift()` reports such a row.

## What does not change
- The signature, owner (postgres), SECURITY DEFINER, STABLE, pinned search_path and
  EXECUTE grants: `CREATE OR REPLACE` keeps them (authenticated may execute; anon and
  PUBLIC may not, as before).
- The 10 functions and 2 policies that call `is_platform_admin()`: not edited.
- How platform admins are WRITTEN: still `set_account_type` -> `account_type`,
  mirrored by the S1 `sync_platform_role` trigger, which stays in place until the
  separately approved platform-role write switch (PR-12). Nothing else writes
  `platform_roles`.
- Organization membership rules (a platform admin joins no organization) still read
  `account_type` until PR-3.
- No row in any table is inserted, updated or deleted.

## Ordering guard
`identity-s1-expand.test.mjs` replays every later migration before S1 to
characterize S1 on its own. When `platform_roles` does not exist yet, this
migration is a no-op with a WARNING instead of an error, as 20261126000000 is for
the history sequence. In every real environment S1 (20261125000000) is applied
first, and the post-apply verification checks the function body.

Revert (owner approval only): supabase/reverts/20261127000000_platform_admin_from_roles.revert.sql
*/

DO $$
BEGIN
  IF to_regclass('public.platform_roles') IS NULL THEN
    RAISE WARNING 'public.platform_roles does not exist (identity stage S1 not applied); is_platform_admin() left unchanged';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.is_platform_admin()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT public.account_is_active()
       AND EXISTS (
         SELECT 1 FROM public.platform_roles r
         WHERE r.user_id = auth.uid()
           AND r.role = 'platform_admin'
           AND r.revoked_at IS NULL
       );
  $fn$;

  COMMENT ON FUNCTION public.is_platform_admin() IS
    'True when the caller''s account is active and holds an unrevoked platform_admin grant in platform_roles (identity PR-2). platform_roles is written only through the S1 sync from user_accounts.account_type until the platform-role write switch (PR-12).';
END
$$;
