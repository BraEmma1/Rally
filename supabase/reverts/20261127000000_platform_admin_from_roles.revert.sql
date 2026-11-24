/*
# Revert identity PR-2: is_platform_admin() reads user_accounts.account_type again

Owner approval required before running this anywhere. Not a migration: it lives
outside supabase/migrations so the CLI never applies it.

Restores the definition from 20260919150000_account_type_foundation.sql (with the
search_path pinned as every later migration left it). Only the function body and
its comment change. Grants, owner, SECURITY DEFINER and the S1 tables and triggers
are untouched, and no row changes, so behaviour returns exactly to what it was
before PR-2.

Note: on rally-dev the original body was stored with CRLF line endings. This
restores the same SQL with LF line endings; the logic is identical.
*/

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_accounts a
    WHERE a.user_id = auth.uid()
      AND a.account_type = 'platform_admin'
      AND a.status = 'active'
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS NULL;
