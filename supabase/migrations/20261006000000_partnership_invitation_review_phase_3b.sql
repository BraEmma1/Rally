/*
# Event partnerships phase 3B: safe pre-acceptance review

Two read functions and nothing else. No table, no column, no policy, no grant
on any partnership table.

## The gap this closes
Phase 3A gave the invitee `my_pending_partnership_invitations`, which answers
"who is asking and for what event" but deliberately stops short of the terms:
no commercial value, no obligations, no event location. The invitee also has
no SELECT on `event_partnerships` or `event_partnership_obligations` -- their
policies ask `can_read_partnership`, which requires `can_manage_event` or
membership of a sponsor organization that is only linked AT acceptance.

So the person being asked to commit could not read what they were committing
to. That was the right default -- a projection is the only safe way to widen
it -- and this is that projection.

## What authorizes a read
One predicate, and the invitation's uuid is not part of it:

    i.invited_email = public.current_user_confirmed_email()

`current_user_confirmed_email()` returns `lower(btrim(email))` only when
`email_confirmed_at IS NOT NULL`, so it is NULL for anon, NULL for an
unconfirmed address, and a normalized address otherwise. `invited_email` is
stored normalized and CHECK-constrained to stay that way, so the comparison is
exact on both sides. NULL never equals anything, which is what makes the anon
and unconfirmed cases fall out rather than need their own branch.

A caller who is not the recipient gets ZERO ROWS, not an exception -- the same
answer as a uuid that does not exist. There is nothing to enumerate.

## Why the terms are not shown for a dead invitation
`terms_visible` is `status IN ('pending', 'accepted')`.

The company snapshot, the commercial value and the obligations are MUTABLE and
belong to the organizer. A declined or revoked invitation keeps the recipient's
address forever, so without this rule a dead invitation would stay a live
window onto a deal that has since moved on -- including terms later negotiated
with somebody else. Revoking an invitation sent to the wrong address would not
actually withdraw anything.

The state itself, and the identity of the event, organizer and company, stay
visible so the recipient can be told truthfully what happened to the
invitation they remember receiving. Nothing is hidden that they could not
already have seen while it was live.

## Phase boundaries
No packages, no templates, no documents, no sponsor dashboard. The existing
post-acceptance projection `my_sponsor_partnerships` is untouched and remains
the contract for a linked sponsor.
*/

-- ============================================================================
-- my_partnership_invitation
--
-- One row: the invitation the caller was actually sent, whatever state it is
-- in. Replaces nothing -- my_pending_partnership_invitations still answers
-- "what is waiting for me", and this answers "show me this one".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_partnership_invitation(invitation_id uuid)
RETURNS TABLE (
  invitation_id uuid,
  invitation_status text,
  is_expired boolean,
  invited_email text,
  created_at timestamptz,
  expires_at timestamptz,
  responded_at timestamptz,
  invited_by_name text,

  organizer_organization_name text,

  event_id uuid,
  event_name text,
  event_start_date date,
  event_end_date date,
  event_location text,
  event_archived boolean,

  partnership_id uuid,
  partnership_status text,
  company_name text,
  tier_label text,
  roles text[],

  -- False once the invitation is over; the three fields below and the whole
  -- obligations function follow it.
  terms_visible boolean,
  value_amount numeric,
  value_currency text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    i.id,
    i.status,
    (i.status = 'pending' AND i.expires_at <= now()),
    i.invited_email,
    i.created_at,
    i.expires_at,
    i.responded_at,
    COALESCE(prof.full_name, ''),

    COALESCE(org.name, ''),

    e.id,
    e.name,
    e.start_date,
    e.end_date,
    COALESCE(e.location, ''),
    (e.archived_at IS NOT NULL),

    p.id,
    p.status,
    p.company_name,
    p.tier_label,
    COALESCE(
      (SELECT array_agg(r.role ORDER BY r.role)
       FROM event_partnership_roles r
       WHERE r.partnership_id = p.id),
      ARRAY[]::text[]
    ),

    (i.status IN ('pending', 'accepted')),
    CASE WHEN i.status IN ('pending', 'accepted') THEN p.value_amount END,
    CASE WHEN i.status IN ('pending', 'accepted') THEN p.value_currency END

  FROM event_partnership_invitations i
  JOIN event_partnerships p ON p.id = i.partnership_id
  JOIN events e ON e.id = p.event_id
  LEFT JOIN organizations org ON org.id = e.organization_id
  LEFT JOIN profiles prof ON prof.id = i.invited_by
  WHERE i.id = my_partnership_invitation.invitation_id
    -- The whole authorization rule. NULL on the right (anon, or an
    -- unconfirmed address) matches nothing.
    AND i.invited_email = public.current_user_confirmed_email();
$$;

-- ============================================================================
-- my_partnership_invitation_obligations
--
-- What each side has been asked to provide, for the caller's own invitation.
-- Same predicate, repeated rather than factored out: a security test is
-- easiest to audit where it is used.
--
-- Deliberately NOT returned: status, completed_at, completed_by. Those are
-- fulfillment, which is the organizer's operational record and the sponsor
-- dashboard's business after acceptance -- not part of reviewing an offer.
-- Evidence is not reachable here at all.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_partnership_invitation_obligations(invitation_id uuid)
RETURNS TABLE (
  id uuid,
  direction text,
  title text,
  description text,
  category text,
  quantity integer,
  due_date date,
  display_order integer
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    ob.id, ob.direction, ob.title, ob.description,
    ob.category, ob.quantity, ob.due_date, ob.display_order
  FROM event_partnership_invitations i
  JOIN event_partnership_obligations ob ON ob.partnership_id = i.partnership_id
  WHERE i.id = my_partnership_invitation_obligations.invitation_id
    AND i.invited_email = public.current_user_confirmed_email()
    AND i.status IN ('pending', 'accepted')
  ORDER BY ob.direction, ob.display_order, ob.created_at;
$$;

-- Signed-in only. anon cannot execute either one, so the uuid is useless
-- without a session whose email matches.
REVOKE EXECUTE ON FUNCTION public.my_partnership_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_partnership_invitation_obligations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_partnership_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_partnership_invitation_obligations(uuid) TO authenticated;

/*
## Not exposed, on purpose

- `internal_notes` -- never, by either function. It is not in a SELECT list
  here and the invitee still has no row access to the table that holds it.
- `representative_email` -- the caller already knows their own address, and
  the partnership's recorded representative may legitimately differ from it.
- `sponsor_organization_id`, `created_by`, `acknowledged_at`, `display_order`
  on the partnership -- organizer and lifecycle metadata, not terms.
- obligation `status`, `completed_at`, `completed_by`, and all evidence.
- Anything about any other partnership, invitation or organization: both
  functions are anchored on a single invitation row that the caller owns.
*/
