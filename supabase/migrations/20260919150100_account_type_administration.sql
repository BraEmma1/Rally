/*
# Admin-gated account type administration

The only way an account type or status changes after signup. Both functions
refuse unless the caller is an active platform admin, and both refuse to let a
caller act on their own account — the same no-self-escalation rule already used
for organizations.

## No platform admin is created here
Deliberately. The first platform admin cannot be created by these functions,
because they require an existing one. It must be inserted by a trusted operator
running SQL directly, which is the point: there is no code path, reachable with
any user's token, that mints the first admin.

Until that is done the approval workflow is inert — nobody can activate a
pending organizer. That is the intended state for this phase. To bootstrap,
a trusted operator runs:

    UPDATE user_accounts
    SET account_type = 'platform_admin', status = 'active', updated_at = now()
    WHERE user_id = '<uuid of the intended admin>';

The existing attendee account is deliberately NOT promoted.
*/

-- ============================================================================
-- set_account_type
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_account_type(
  target_user_id uuid,
  new_type account_type,
  reason text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_type account_type;
  v_prev_status account_status;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may change account types';
  END IF;

  -- An admin must not be able to change their own type, in either direction.
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own account type';
  END IF;

  SELECT a.account_type, a.status INTO v_prev_type, v_prev_status
  FROM user_accounts a WHERE a.user_id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No account record for that user';
  END IF;

  UPDATE user_accounts
  SET account_type = new_type,
      updated_at = now(),
      approved_by = auth.uid(),
      approved_at = now()
  WHERE user_id = target_user_id;

  INSERT INTO account_type_changes
    (user_id, changed_by, previous_type, new_type, previous_status, new_status, reason)
  VALUES
    (target_user_id, auth.uid(), v_prev_type, new_type, v_prev_status, v_prev_status, reason);
END;
$$;

-- ============================================================================
-- set_account_status — this is how a pending organizer is approved
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_account_status(
  target_user_id uuid,
  new_status account_status,
  reason text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_type account_type;
  v_prev_status account_status;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may change account status';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own account status';
  END IF;

  SELECT a.account_type, a.status INTO v_prev_type, v_prev_status
  FROM user_accounts a WHERE a.user_id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No account record for that user';
  END IF;

  UPDATE user_accounts
  SET status = new_status,
      updated_at = now(),
      approved_by = CASE WHEN new_status = 'active' THEN auth.uid() ELSE approved_by END,
      approved_at = CASE WHEN new_status = 'active' THEN now() ELSE approved_at END
  WHERE user_id = target_user_id;

  INSERT INTO account_type_changes
    (user_id, changed_by, previous_type, new_type, previous_status, new_status, reason)
  VALUES
    (target_user_id, auth.uid(), v_prev_type, v_prev_type, v_prev_status, new_status, reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_account_type(uuid, account_type, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_account_status(uuid, account_status, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_account_type(uuid, account_type, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_account_status(uuid, account_status, text) TO authenticated;
