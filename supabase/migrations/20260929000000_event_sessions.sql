/*
# Event agenda: sessions

One table, inheriting the event's authorization rather than restating it.

## Nothing existing was duplicated
Checked first: there is no sessions, agenda, schedule, talk or speaker table
anywhere in the schema. Sessions are genuinely new. Everything else —
visibility, who may manage, archived behaviour — is reused, not reimplemented.

## Visibility inherits the event's, by construction
The SELECT policy is a bare existence check against `events`:

    EXISTS (SELECT 1 FROM events e WHERE e.id = event_id)

A subquery inside a policy is itself subject to the referenced table's policies,
so this resolves through the three existing event SELECT policies —
`read_published_events`, `read_own_organization_events`, `read_involved_events`.
That means a session is visible exactly when its event is: public for a
published event, team-only for a draft, registered-or-invited for an unlisted
one, and hidden from the public once archived. It also means any future change
to event visibility applies to agendas automatically, with no second definition
to drift out of step.

## Writes reuse can_manage_event
The same predicate that governs editing the event, checking attendees in and
reading the attendee list: organization owners and admins organization-wide,
event managers only for events they are assigned to. Attendees get SELECT and
nothing else — there is no INSERT, UPDATE or DELETE policy that could match
them.

## Timezone
`start_at` and `end_at` are `timestamptz`: an absolute instant, so ordering,
"what is on now" and attendees in other timezones are all correct without
special cases.

Display needs the event's local zone, which lives in `events.timezone` — and
that column is **populated for only half the events**, because the organizer
event form does not collect it. `get_event_agenda` therefore returns
`event_timezone` as a nullable field rather than substituting a default: a
guessed zone would render a confidently wrong schedule. The frontend should
fall back to the viewer's local zone and say which it is using. Filling that
column properly is an organizer-form change, noted rather than done here.

## Deletion is allowed here, unlike events
An event is archived rather than deleted because registrations, check-ins and
connections hang off it. A session is a schedule entry with nothing hanging off
it, so an agenda item added by mistake can be removed. `status = 'cancelled'`
exists for the case where attendees have already seen it and it should stay
visible as cancelled.
*/

CREATE TABLE IF NOT EXISTS event_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- Absolute instants. The client converts from the event's local time on the
  -- way in and back again on the way out.
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  -- Room, stage or hall *within* the event. events.location is the venue.
  location text NOT NULL DEFAULT '',
  session_type text NOT NULL DEFAULT 'session',
  status text NOT NULL DEFAULT 'scheduled',
  -- Manual ordering for sessions that share a start time; the agenda sorts by
  -- (start_at, display_order) so a deliberate order survives equal timestamps.
  display_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_sessions_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT event_sessions_title_length CHECK (length(title) <= 200),
  CONSTRAINT event_sessions_time_order CHECK (end_at IS NULL OR end_at >= start_at),
  CONSTRAINT event_sessions_type_allowed CHECK (
    session_type IN ('session', 'keynote', 'panel', 'workshop', 'break', 'networking')
  ),
  CONSTRAINT event_sessions_status_allowed CHECK (
    status IN ('scheduled', 'live', 'ended', 'cancelled')
  )
);

-- The agenda is always read for one event, in time order. This composite
-- serves that and, as a leftmost prefix, plain event_id lookups too — a
-- separate event_id index would be redundant and cost writes for nothing.
CREATE INDEX IF NOT EXISTS idx_event_sessions_event_start
  ON event_sessions (event_id, start_at);

-- Reordering and the tie-break within a start time. Named display_order
-- because `position` is a reserved word in Postgres and cannot be used as a
-- function output parameter without quoting.
CREATE INDEX IF NOT EXISTS idx_event_sessions_event_order
  ON event_sessions (event_id, display_order);

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE event_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_sessions FROM anon;

-- Read: exactly as visible as the event itself. See the header — this
-- deliberately delegates to the events policies instead of copying them.
DROP POLICY IF EXISTS "read_visible_event_sessions" ON event_sessions;
CREATE POLICY "read_visible_event_sessions"
  ON event_sessions FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_sessions.event_id));

DROP POLICY IF EXISTS "insert_event_sessions_as_manager" ON event_sessions;
CREATE POLICY "insert_event_sessions_as_manager"
  ON event_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_manage_event(event_id)
    AND public.account_is_active()
  );

DROP POLICY IF EXISTS "update_event_sessions_as_manager" ON event_sessions;
CREATE POLICY "update_event_sessions_as_manager"
  ON event_sessions FOR UPDATE
  TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "delete_event_sessions_as_manager" ON event_sessions;
CREATE POLICY "delete_event_sessions_as_manager"
  ON event_sessions FOR DELETE
  TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active());

-- ============================================================================
-- What a write may contain
--
-- The policies decide who may write; this decides what. A policy cannot pin a
-- column, so without this a manager of two events could move a session between
-- them, and an archived event's agenda would still be editable.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_session_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'A session cannot be moved to another event';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'The creator of a session cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;

  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its agenda.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_session_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_session_rules ON event_sessions;
CREATE TRIGGER check_event_session_rules
  BEFORE INSERT OR UPDATE ON event_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_session_rules();

-- Deleting from an archived event's agenda is blocked for the same reason.
CREATE OR REPLACE FUNCTION public.enforce_event_session_delete_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = OLD.event_id;

  -- The event itself being deleted cascades here; that is not an edit.
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its agenda.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_session_delete_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_session_delete_rules ON event_sessions;
CREATE TRIGGER check_event_session_delete_rules
  BEFORE DELETE ON event_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_session_delete_rules();

-- ============================================================================
-- Read: the agenda, with the context needed to render it
--
-- SECURITY INVOKER, deliberately: the RLS policy above already says who may
-- see this, and a definer function would replace that rule with a second one.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_event_agenda(target_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  title text,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  location text,
  session_type text,
  status text,
  display_order integer,
  -- Nullable on purpose: events.timezone is unset for half the events, and a
  -- substituted default would render a confidently wrong local schedule.
  event_timezone text
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    s.id, s.event_id, s.title, s.description,
    s.start_at, s.end_at, s.location, s.session_type, s.status, s.display_order,
    e.timezone
  FROM event_sessions s
  JOIN events e ON e.id = s.event_id
  WHERE s.event_id = target_event_id
  ORDER BY s.start_at, s.display_order, s.title;
$$;

-- ============================================================================
-- Reorder, in one statement
--
-- Individual position updates are N round trips and race each other. This takes
-- the intended order and applies it atomically.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reorder_event_sessions(
  target_event_id uuid,
  session_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
  v_count int;
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = target_event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its agenda.';
  END IF;

  -- Every id must belong to this event. Without this a caller could pass a
  -- session from an event they also manage and renumber it from here.
  SELECT count(*) INTO v_count
  FROM unnest(session_ids) AS sid
  WHERE NOT EXISTS (
    SELECT 1 FROM event_sessions s
    WHERE s.id = sid AND s.event_id = target_event_id
  );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Those sessions do not all belong to this event';
  END IF;

  UPDATE event_sessions s
  SET display_order = ordered.ord
  FROM (SELECT sid, (ordinality - 1)::int AS ord
        FROM unnest(session_ids) WITH ORDINALITY AS t(sid, ordinality)) ordered
  WHERE s.id = ordered.sid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_agenda(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reorder_event_sessions(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- The agenda of a published event is public, like the event itself.
GRANT EXECUTE ON FUNCTION public.get_event_agenda(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_event_sessions(uuid, uuid[]) TO authenticated;
