/*
# My Schedule: session bookmarks

One table and four functions. **No SECURITY DEFINER anywhere in this
migration** — the policies already express every rule, and a definer function
would replace them with a second copy that can drift. Everything below runs as
the caller and is filtered by RLS.

## Visibility is inherited, not restated
The INSERT check is an existence test against `event_sessions`:

    EXISTS (SELECT 1 FROM event_sessions s WHERE s.id = session_id ...)

A subquery inside a policy is subject to the referenced table's policies, and
`event_sessions`'s own SELECT policy is itself an existence test against
`events`. So bookmarking chains through to the three event SELECT policies with
no third definition of visibility: you can save a session exactly when you can
already see it. A change to event visibility propagates here automatically.

## Reading your own bookmarks is unconditional
The SELECT policy is `user_id = auth.uid()` and nothing else. The bookmark is
the user's own record, so archiving an event or cancelling a session never
removes it and never hides the row.

Note what that does and does not buy, because the brief made it conditional:
`get_my_event_schedule` joins `event_sessions`, so once an event is archived it
returns nothing — an attendee cannot see an archived event in Rally at all
today (`read_published_events` and `read_involved_events` both require
`archived_at IS NULL`; only organization members see archived events). The
bookmark rows survive intact and become readable again if the event is
restored. Making archived history visible to attendees would be a change to the
*event* policies, not to this table, and is not made here.

## Archived events take no new bookmarks
The INSERT check requires `e.archived_at IS NULL`. For an attendee this is
already implied — they cannot see the session at all — but an organization
member *can* see their own archived events, and should not be able to add to a
schedule for one.

## Cancelled sessions
Nothing special. `status = 'cancelled'` is returned like any other status and
the bookmark stays; the UI decides how to present it.

## No event_id column
The event is reachable through `event_sessions.event_id`, and duplicating it
would create a second place for the association to be wrong. The one cost is a
join in the two per-event reads, which the `(event_id, start_at)` index on
`event_sessions` already serves.
*/

CREATE TABLE IF NOT EXISTS event_session_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES event_sessions(id) ON DELETE CASCADE,
  -- auth.users, matching event_registrations.user_id and event_team.user_id.
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_session_bookmarks_unique UNIQUE (user_id, session_id)
);

-- "My schedule for this event" reads by user and joins sessions; this serves
-- the user side. The unique constraint's index covers (user_id, session_id)
-- lookups, so no separate index is needed for the existence checks.
CREATE INDEX IF NOT EXISTS idx_event_session_bookmarks_session
  ON event_session_bookmarks (session_id);

ALTER TABLE event_session_bookmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_session_bookmarks FROM anon;

-- ============================================================================
-- RLS: your own bookmarks, and only yours
--
-- There is deliberately no policy granting anyone else access — not the
-- organizer who runs the event, not an event manager, not a platform admin.
-- A personal schedule is the attendee's, and managing an event confers no
-- claim on it.
-- ============================================================================
DROP POLICY IF EXISTS "read_own_session_bookmarks" ON event_session_bookmarks;
CREATE POLICY "read_own_session_bookmarks"
  ON event_session_bookmarks FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "insert_own_session_bookmarks" ON event_session_bookmarks;
CREATE POLICY "insert_own_session_bookmarks"
  ON event_session_bookmarks FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Ownership is not taken from the client: it must equal the caller.
    user_id = auth.uid()
    -- And the session must be one the caller can already see, on an event that
    -- is not archived. Both clauses run through the existing policies.
    AND EXISTS (
      SELECT 1
      FROM event_sessions s
      JOIN events e ON e.id = s.event_id
      WHERE s.id = session_id
        AND e.archived_at IS NULL
    )
  );

DROP POLICY IF EXISTS "delete_own_session_bookmarks" ON event_session_bookmarks;
CREATE POLICY "delete_own_session_bookmarks"
  ON event_session_bookmarks FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE policy: a bookmark has nothing to change. Adding and removing are
-- the whole vocabulary.
REVOKE UPDATE ON public.event_session_bookmarks FROM authenticated;

-- ============================================================================
-- Functions — all SECURITY INVOKER
-- ============================================================================

-- Idempotent by contract: saving something already saved returns the existing
-- bookmark rather than raising, so a double tap is not an error the UI has to
-- explain. Raises only when the session genuinely cannot be saved.
CREATE OR REPLACE FUNCTION public.save_event_session(session_id uuid)
RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT b.id INTO v_id
  FROM event_session_bookmarks b
  WHERE b.user_id = auth.uid() AND b.session_id = save_event_session.session_id;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- user_id comes from auth.uid(); the INSERT policy rejects anything else,
  -- and rejects a session the caller cannot see or whose event is archived.
  INSERT INTO event_session_bookmarks (session_id, user_id)
  VALUES (save_event_session.session_id, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN insufficient_privilege THEN
    -- The policy's own message names the table, which tells the user nothing.
    RAISE EXCEPTION 'That session is not available to save';
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_event_session(session_id uuid)
RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_removed int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM event_session_bookmarks b
  WHERE b.user_id = auth.uid() AND b.session_id = remove_event_session.session_id;

  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Removing something not saved is not an error; the desired state is already
  -- the case. false means there was nothing to remove.
  RETURN v_removed > 0;
END;
$$;

-- The saved schedule for one event, with everything the UI needs to render it.
-- Both the bookmark rows and the session rows are RLS-filtered, so this cannot
-- return another user's saves or a session the caller may not see.
CREATE OR REPLACE FUNCTION public.get_my_event_schedule(target_event_id uuid)
RETURNS TABLE (
  session_id uuid,
  event_id uuid,
  title text,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  location text,
  session_type text,
  status text,
  display_order integer,
  event_timezone text,
  saved_at timestamptz
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    s.id, s.event_id, s.title, s.description,
    s.start_at, s.end_at, s.location, s.session_type, s.status, s.display_order,
    -- Nullable: events.timezone is unset on many events because the organizer
    -- form does not collect one. A substituted default would render a
    -- confidently wrong local schedule.
    e.timezone,
    b.created_at
  FROM event_session_bookmarks b
  JOIN event_sessions s ON s.id = b.session_id
  JOIN events e ON e.id = s.event_id
  WHERE b.user_id = auth.uid()
    AND s.event_id = target_event_id
  ORDER BY s.start_at, s.display_order, s.title;
$$;

-- Just the ids, for the Agenda to mark which rows are saved without pulling
-- every session twice.
CREATE OR REPLACE FUNCTION public.get_my_saved_session_ids(target_event_id uuid)
RETURNS TABLE (session_id uuid)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT b.session_id
  FROM event_session_bookmarks b
  JOIN event_sessions s ON s.id = b.session_id
  WHERE b.user_id = auth.uid()
    AND s.event_id = target_event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.save_event_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.remove_event_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_event_schedule(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_saved_session_ids(uuid) FROM PUBLIC, anon, authenticated;

-- Signed-in users only. A personal schedule has no anonymous meaning.
GRANT EXECUTE ON FUNCTION public.save_event_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_event_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_event_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_saved_session_ids(uuid) TO authenticated;
