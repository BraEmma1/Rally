/*
# Organizer Phase C — event people: attendees and invitations

Two reads and one write that cross a privacy boundary, so each goes through a
definer function rather than a widened policy.

## No contact details, at all
`event_attendee_list` returns the same public professional card the rest of
Rally shows and nothing else. The consent columns on `event_registrations`
(share_contact, contact_email, contact_phone) stay unreachable: 20260919150400
granted `authenticated` an explicit column list that excludes them, and this
migration does not widen it. There is no attendee-facing consent control yet,
so there is nothing an organizer could legitimately be shown — building the
read before the consent it depends on is how that column set leaks.

## Inviting by email
Events invite *attendees*, so the lookup is restricted to attendee accounts.
The failure message is identical for an unregistered address and for an address
belonging to some other account type, so the invite box cannot be used to probe
who has a Rally account.

The existing invitation vocabulary is kept verbatim — status is 'Pending',
'Accepted' or 'Declined', capitalised, because that is what the attendee Events
page already reads and writes.
*/

ALTER TABLE event_invitations
  ADD COLUMN IF NOT EXISTS invited_email text;

-- ============================================================================
-- Who is coming
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_attendee_list(target_event_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  job_title text,
  company text,
  photo_url text,
  registered_at timestamptz,
  status text,
  checked_in_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  RETURN QUERY
  SELECT
    r.user_id,
    COALESCE(p.full_name, '') AS full_name,
    COALESCE(p.job_title, '') AS job_title,
    COALESCE(p.company, '')   AS company,
    COALESCE(p.photo_url, '') AS photo_url,
    r.created_at              AS registered_at,
    r.status,
    r.checked_in_at
  FROM event_registrations r
  LEFT JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = target_event_id
  ORDER BY r.created_at;
END;
$$;

-- ============================================================================
-- Who has been invited
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_invitation_list(target_event_id uuid)
RETURNS TABLE (
  id uuid,
  invited_user_id uuid,
  invited_email text,
  full_name text,
  status text,
  created_at timestamptz,
  responded_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.invited_user_id,
    COALESCE(i.invited_email, '') AS invited_email,
    COALESCE(p.full_name, '')     AS full_name,
    i.status,
    i.created_at,
    i.responded_at
  FROM event_invitations i
  LEFT JOIN profiles p ON p.id = i.invited_user_id
  WHERE i.event_id = target_event_id
  ORDER BY
    CASE i.status WHEN 'Pending' THEN 0 ELSE 1 END,
    i.created_at DESC;
END;
$$;

-- ============================================================================
-- Invite an attendee by email
-- ============================================================================
CREATE OR REPLACE FUNCTION public.invite_event_attendee(
  target_event_id uuid,
  invitee_email text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(invitee_email));
  v_target uuid;
  v_event events%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;

  SELECT * INTO v_event FROM events WHERE id = target_event_id;

  IF v_event.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived';
  END IF;

  IF v_event.visibility = 'draft' THEN
    RAISE EXCEPTION 'Publish this event before inviting people to it';
  END IF;

  SELECT u.id INTO v_target
  FROM auth.users u
  JOIN user_accounts a ON a.user_id = u.id
  WHERE lower(u.email) = v_email
    AND a.account_type = 'attendee'
    AND a.status = 'active';

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'No Rally attendee account with that email address.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM event_registrations r
    WHERE r.event_id = target_event_id AND r.user_id = v_target AND r.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'That person is already registered for this event';
  END IF;

  INSERT INTO event_invitations (event_id, invited_user_id, invited_email, invited_by, status)
  VALUES (target_event_id, v_target, v_email, auth.uid(), 'Pending')
  ON CONFLICT (event_id, invited_user_id) DO UPDATE
    SET status        = 'Pending',
        invited_email = EXCLUDED.invited_email,
        invited_by    = EXCLUDED.invited_by,
        created_at    = now(),
        responded_at  = NULL
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- Grants: authenticated only, never anon
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.event_attendee_list(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_invitation_list(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invite_event_attendee(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.event_attendee_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_invitation_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_event_attendee(uuid, text) TO authenticated;
