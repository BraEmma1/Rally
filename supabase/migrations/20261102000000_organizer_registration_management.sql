/*
# Organizer registration management

Lets the people who run an event inspect one registration, cancel it, and move
a waitlisted person into a free place, from the Attendees tab.

## What already exists (reused, not duplicated)
- register_for_event / cancel_event_registration (20261026000000): the event row
  is the lock every registration change queues behind; capacity counts
  registered + checked_in; a cancellation keeps the row.
- promote_event_waitlist and its triggers: a freed seat (cancel, delete,
  capacity change) goes to the waitlist automatically, oldest first.
- guard_registration_status_change: nobody is checked in off the waitlist.
- check_in_event_attendee / undo_event_check_in: arrival is checked_in_at; undo
  clears the timestamp and leaves status alone.
- get_event_registration_answers: organizers already read answers, paged, for
  non-cancelled registrations.
- The organizer gate everywhere: can_manage_event(event) AND account_is_active()
  (owners and admins of the organization, and managers assigned to the event).

## What this adds
- event_registrations.cancelled_by: who cancelled (the attendee or an
  organizer). Not granted to clients; read through the detail function only.
- event_registration_detail(event, user): one registration for the organizer:
  status, dates, waitlist position, capacity, the answers (including those of a
  cancelled registration) and whether cancel / promote are currently allowed.
- organizer_cancel_event_registration(event, user): cancel someone else's
  registration (or waitlist place). The freed seat is handed on by the existing
  trigger, in order. The attendee is notified.
- organizer_promote_waitlisted_registration(event, user): move a waitlisted
  person to registered, only when a seat is free and nobody has waited longer,
  i.e. exactly what automatic promotion would do. It exists for a waitlist that
  automatic promotion did not reach (seats freed while the event was archived,
  then restored). It never exceeds capacity and never jumps the queue.
- event_attendee_page_rows: each attendee object gains waitlist_position.

## Transitions allowed to organizers (and nothing else)
- registered | waitlisted | checked_in-without-arrival -> cancelled
  Refused once the person has arrived (checked_in_at set: undo the check-in
  first), for a finished event, and for an archived event.
- waitlisted -> registered, under the rules above.
There is no free-form status edit, no re-instating a cancelled registration
(the attendee registers again, through the form), and no new insert path, so
duplicates remain impossible (unique (event_id, user_id)). check_in data is
never written here.

## Changed for existing code
cancel_event_registration also records cancelled_by = the attendee, so a later
organizer view never shows a stale "cancelled by organizer". Same signature,
rules and grants.

Forward-only. Do not edit once applied.
*/

-- ============================================================================
-- Who cancelled
-- ============================================================================
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- event_registrations uses column grants; a new column is unreadable by clients
-- unless granted. Made explicit so a later blanket grant is a visible decision.
REVOKE SELECT (cancelled_by), INSERT (cancelled_by), UPDATE (cancelled_by)
  ON public.event_registrations FROM anon, authenticated;

-- ============================================================================
-- cancel_event_registration: unchanged apart from recording cancelled_by
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_event_registration(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_event events%ROWTYPE;
  v_reg event_registrations%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_event FROM events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;
  IF v_event.status = 'past' THEN
    RAISE EXCEPTION 'That event has already finished';
  END IF;

  SELECT * INTO v_reg FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.user_id = v_me FOR UPDATE;
  IF NOT FOUND OR v_reg.status = 'cancelled' THEN
    RAISE EXCEPTION 'You are not registered for this event';
  END IF;
  IF v_reg.status = 'checked_in' THEN
    RAISE EXCEPTION 'You have already checked in to this event';
  END IF;

  -- The AFTER UPDATE trigger hands a freed seat to the next waitlisted person.
  UPDATE event_registrations r
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_me
   WHERE r.id = v_reg.id;

  RETURN v_reg.status;
END;
$$;

-- ============================================================================
-- event_registration_detail (organizer)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_registration_detail(p_event_id uuid, p_user_id uuid)
RETURNS TABLE (
  registration_id        uuid,
  user_id                uuid,
  full_name              text,
  status                 text,
  registered_at          timestamptz,
  checked_in_at          timestamptz,
  cancelled_at           timestamptz,
  cancelled_by_organizer boolean,
  waitlist_position      integer,
  waitlist_length        integer,
  capacity               integer,
  seats_taken            integer,
  event_open             boolean,
  can_cancel             boolean,
  can_promote            boolean,
  answers                jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_event events%ROWTYPE;
  v_reg event_registrations%ROWTYPE;
  v_open boolean;
  v_taken int;
  v_wait_len int;
  v_pos int := NULL;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_manage_event(p_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  SELECT * INTO v_event FROM events e WHERE e.id = p_event_id;
  SELECT * INTO v_reg FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That person is not registered for this event';
  END IF;

  v_open := v_event.archived_at IS NULL AND v_event.status <> 'past';

  SELECT count(*) FILTER (WHERE r.status IN ('registered', 'checked_in'))::int,
         count(*) FILTER (WHERE r.status = 'waitlisted')::int
    INTO v_taken, v_wait_len
    FROM event_registrations r WHERE r.event_id = p_event_id;

  IF v_reg.status = 'waitlisted' THEN
    SELECT count(*)::int INTO v_pos FROM event_registrations w
     WHERE w.event_id = p_event_id AND w.status = 'waitlisted'
       AND (w.created_at, w.id) <= (v_reg.created_at, v_reg.id);
  END IF;

  RETURN QUERY
  SELECT v_reg.id,
         v_reg.user_id,
         COALESCE(NULLIF(btrim(p.full_name), ''), 'Rally member'),
         v_reg.status,
         v_reg.created_at,
         v_reg.checked_in_at,
         v_reg.cancelled_at,
         v_reg.status = 'cancelled' AND v_reg.cancelled_by IS NOT NULL AND v_reg.cancelled_by <> v_reg.user_id,
         v_pos,
         v_wait_len,
         v_event.capacity,
         v_taken,
         v_open,
         v_open AND v_reg.status <> 'cancelled' AND v_reg.checked_in_at IS NULL,
         v_open AND v_reg.status = 'waitlisted' AND v_pos = 1
           AND (v_event.capacity IS NULL OR v_taken < v_event.capacity),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'question_id', x.id,
                    'label', x.label,
                    'kind', x.kind,
                    'archived', x.archived_at IS NOT NULL,
                    'answer', a.answer) ORDER BY x.position, x.created_at)
             FROM event_registration_answers a
             JOIN event_registration_questions x ON x.id = a.question_id
            WHERE a.registration_id = v_reg.id
         ), '[]'::jsonb)
  FROM (SELECT 1) one
  LEFT JOIN profiles p ON p.id = v_reg.user_id;
END;
$$;

-- ============================================================================
-- organizer_cancel_event_registration
-- ============================================================================
CREATE OR REPLACE FUNCTION public.organizer_cancel_event_registration(p_event_id uuid, p_user_id uuid)
RETURNS TABLE (
  previous_status text,
  promoted        integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_event events%ROWTYPE;
  v_reg event_registrations%ROWTYPE;
  v_wait_before int;
  v_wait_after int;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_manage_event(p_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  -- Same lock order as register / cancel / promotion: event, then registration.
  SELECT * INTO v_event FROM events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;
  IF v_event.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived; its registrations cannot be changed';
  END IF;
  IF v_event.status = 'past' THEN
    RAISE EXCEPTION 'This event has finished; its registrations are kept as they are';
  END IF;

  SELECT * INTO v_reg FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That person is not registered for this event';
  END IF;
  IF v_reg.status = 'cancelled' THEN
    RAISE EXCEPTION 'That registration is already cancelled';
  END IF;
  -- Arrival is a record of what happened; cancelling must not rewrite it.
  IF v_reg.checked_in_at IS NOT NULL THEN
    RAISE EXCEPTION 'That person has checked in. Undo the check-in first if they did not attend';
  END IF;

  SELECT count(*)::int INTO v_wait_before FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.status = 'waitlisted' AND r.id <> v_reg.id;

  -- The AFTER UPDATE trigger hands a freed seat to the waitlist, oldest first.
  UPDATE event_registrations r
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_me
   WHERE r.id = v_reg.id;

  SELECT count(*)::int INTO v_wait_after FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.status = 'waitlisted';

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (v_reg.user_id, 'event_registration',
          CASE WHEN v_reg.status = 'waitlisted' THEN 'Removed from the waitlist' ELSE 'Registration cancelled' END,
          CASE WHEN v_reg.status = 'waitlisted'
               THEN 'The organizer of ' || v_event.name || ' removed you from the waitlist.'
               ELSE 'The organizer of ' || v_event.name || ' cancelled your registration.' END,
          '/events/' || p_event_id);

  RETURN QUERY SELECT v_reg.status, GREATEST(v_wait_before - v_wait_after, 0);
END;
$$;

-- ============================================================================
-- organizer_promote_waitlisted_registration
-- ============================================================================
CREATE OR REPLACE FUNCTION public.organizer_promote_waitlisted_registration(p_event_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_event events%ROWTYPE;
  v_reg event_registrations%ROWTYPE;
  v_taken int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_manage_event(p_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  SELECT * INTO v_event FROM events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;
  IF v_event.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived; its registrations cannot be changed';
  END IF;
  IF v_event.status = 'past' THEN
    RAISE EXCEPTION 'This event has finished; its registrations are kept as they are';
  END IF;

  SELECT * INTO v_reg FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_reg.status <> 'waitlisted' THEN
    RAISE EXCEPTION 'That person is not on the waitlist';
  END IF;

  IF v_event.capacity IS NOT NULL THEN
    SELECT count(*)::int INTO v_taken FROM event_registrations r
     WHERE r.event_id = p_event_id AND r.status IN ('registered', 'checked_in');
    IF v_taken >= v_event.capacity THEN
      RAISE EXCEPTION 'The event is full. Raise the capacity to open places; the waitlist then moves up in order';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM event_registrations w
     WHERE w.event_id = p_event_id AND w.status = 'waitlisted'
       AND (w.created_at, w.id) < (v_reg.created_at, v_reg.id)
  ) THEN
    RAISE EXCEPTION 'Someone has been waiting longer. Places go to the waitlist in order';
  END IF;

  UPDATE event_registrations r SET status = 'registered' WHERE r.id = v_reg.id;

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (v_reg.user_id, 'registration_promoted', 'You''re in!',
          'A place opened up and you are now registered for ' || v_event.name || '.',
          '/events/' || p_event_id);

  RETURN 'registered';
END;
$$;

-- ============================================================================
-- event_attendee_page_rows (internal): add waitlist_position
-- ============================================================================
-- Same signature, order and keys as 20261101000000, plus waitlist_position
-- (null unless waitlisted), computed for the rows on this page only.
CREATE OR REPLACE FUNCTION public.event_attendee_page_rows(
  target_event_id uuid,
  search text,
  status_filter text,
  page_size integer,
  page_offset integer
)
RETURNS TABLE (
  total_count bigint,
  attendees jsonb
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  WITH matched AS (
    SELECT * FROM public.event_attendee_rows(target_event_id, search, status_filter)
  ),
  page AS (
    SELECT m.*
    FROM matched m
    ORDER BY lower(m.full_name), m.full_name, m.registered_at, m.reg_id
    LIMIT page_size OFFSET page_offset
  )
  SELECT
    (SELECT count(*) FROM matched)::bigint,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'user_id',              pg.user_id,
                  'full_name',            pg.full_name,
                  'job_title',            pg.job_title,
                  'company',              pg.company,
                  'photo_url',            pg.photo_url,
                  'email',                pg.email,
                  'phone',                pg.phone,
                  'status',               pg.status,
                  'registered_at',        pg.registered_at,
                  'checked_in_at',        pg.checked_in_at,
                  'marketing_consent',    pg.marketing_consent,
                  'marketing_consent_at', pg.marketing_consent_at,
                  'waitlist_position',
                    CASE WHEN pg.status = 'waitlisted' THEN
                      (SELECT count(*)::int FROM event_registrations w
                        WHERE w.event_id = target_event_id AND w.status = 'waitlisted'
                          AND (w.created_at, w.id) <= (pg.registered_at, pg.reg_id))
                    END
                )
                ORDER BY lower(pg.full_name), pg.full_name, pg.registered_at, pg.reg_id
              )
         FROM page pg),
      '[]'::jsonb
    );
$$;

REVOKE EXECUTE ON FUNCTION public.event_attendee_page_rows(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Grants
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.cancel_event_registration(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_registration_detail(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organizer_cancel_event_registration(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organizer_promote_waitlisted_registration(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_registration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_registration_detail(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_cancel_event_registration(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_promote_waitlisted_registration(uuid, uuid) TO authenticated;
