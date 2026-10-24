/*
# Event registration flow

Turns "insert a row" into a real registration flow: an organizer-defined
registration form, capacity with a waitlist that promotes automatically, and
cancellation that keeps a record.

## What exists before this
- A client INSERT / DELETE on event_registrations (policies insert_own_registration
  and delete_own_registration).
- enforce_registration_rules(): a BEFORE INSERT trigger that rejects drafts,
  archived and finished events, and a full event. It takes no lock, so two people
  registering at once can both pass the count; and a full event is a hard error
  with nowhere to go.
- status values 'registered' | 'waitlisted' | 'cancelled' | 'checked_in' already
  exist and the organizer analytics already treat cancelled / waitlisted as not
  attending. Nothing ever set waitlisted or cancelled.

## What this adds
- tables event_registration_questions and event_registration_answers
  (RLS on, no grants: reachable only through the functions below)
- register_for_event(event, answers)      validates, locks, registers or waitlists
- cancel_event_registration(event)        status -> cancelled, keeps the row
- my_event_registration(event)            my status, waitlist position, my answers
- get_event_registration_form(event)      the questions an attendee must answer
- set_event_registration_questions(event, questions)   organizer: edit the form
- get_event_registration_answers(event, limit, offset) organizer: read the answers
- promote_event_waitlist(event)           internal; fills freed seats, oldest first
- triggers: promote on cancel / delete / capacity increase; refuse to check in a
  waitlisted person
- two notification types: registration_waitlisted, registration_promoted

## Who can do what
- Registering: an active account, for an event that is not archived, draft or
  finished. The event row is locked FOR UPDATE for the duration, so capacity
  cannot be oversold. Required questions must be answered and every answer is
  checked against its question (type, length, allowed options).
- Cancelling: only your own registration, only before the event has finished,
  and not after check-in.
- Form: anyone signed in can read the questions of a published or unlisted event
  (they need them to register); only people who can manage the event can change
  them. Removing a question archives it, so answers already given are kept.
- Answers: the attendee reads their own; people who can manage the event read
  their event's. Platform admins get nothing: this is attendee data the
  organizer collected, and admins see counts only.

## Behaviour that changes for existing code
- The client can no longer INSERT or DELETE event_registrations directly (the
  grants are revoked); that is what makes the form and the waitlist impossible to
  bypass. The app is changed in the same release.
- A cancelled registration now stays as a row (status 'cancelled'). Anything that
  read "has a row" as "is registered" must look at status; the app is updated.
- is_registered_for_event() now means an *active* registration (registered or
  checked_in). It backs the attendee-directory read and the networking
  functions, which are for people actually attending. A waitlisted person keeps
  seeing the event itself through a new is_waitlisted_for_event() policy on events.
- A RESTRICTIVE SELECT policy hides other people's cancelled and waitlisted rows
  from fellow attendees. Your own row, and the organizer's view, are unchanged.
- get_event_registration_counts() counts active registrations only.

## Not changed
connect_with_event_attendee / send_connection_request still treat any
non-cancelled registration as registered, so a waitlisted person can connect at
the venue. The attendee directory is closed to them (above); QR connect is not.
Left alone here on purpose; it deserves its own change.

## Reversal
Forward-only. To retire: DROP the six functions, the triggers and the two
tables, re-grant INSERT/DELETE if wanted, and re-create the previous
enforce_registration_rules, is_registered_for_event and
get_event_registration_counts bodies from their original migrations.
*/

-- ============================================================================
-- Tables
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_registration_questions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  label      text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  help_text  text CHECK (help_text IS NULL OR char_length(help_text) <= 300),
  kind       text NOT NULL CHECK (kind IN ('short_text', 'long_text', 'single_choice', 'multi_choice', 'yes_no')),
  options    jsonb,
  required   boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_question_options_shape CHECK (
    (kind IN ('single_choice', 'multi_choice')
       AND jsonb_typeof(options) = 'array'
       AND jsonb_array_length(options) BETWEEN 2 AND 20)
    OR (kind NOT IN ('single_choice', 'multi_choice') AND options IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_registration_questions_event
  ON public.event_registration_questions (event_id, position) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.event_registration_answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.event_registrations(id) ON DELETE CASCADE,
  question_id     uuid NOT NULL REFERENCES public.event_registration_questions(id) ON DELETE CASCADE,
  answer          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, question_id)
);

-- RLS on and no policies: nothing reads or writes these except the functions.
ALTER TABLE public.event_registration_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registration_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_registration_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.event_registration_answers FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Notification types
-- ============================================================================
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_allowed;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_allowed CHECK (type = ANY (ARRAY[
    'new_connection', 'event_invitation', 'invitation_accepted', 'invitation_declined',
    'follow_up_due', 'follow_up_overdue', 'opportunity_stage_changed', 'event_registration',
    'upcoming_event', 'new_message', 'connection_request', 'connection_accepted',
    'registration_waitlisted', 'registration_promoted'
  ])) NOT VALID;

-- ============================================================================
-- Who counts as registered
-- ============================================================================
-- Active = registered or checked in. Cancelled and waitlisted people are not
-- attending, so they do not get the attendee directory or the networking reads.
CREATE OR REPLACE FUNCTION public.is_registered_for_event(target_event_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_registrations r
    WHERE r.event_id = target_event_id
      AND r.user_id = auth.uid()
      AND r.status IN ('registered', 'checked_in')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_waitlisted_for_event(target_event_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_registrations r
    WHERE r.event_id = target_event_id
      AND r.user_id = auth.uid()
      AND r.status = 'waitlisted'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_waitlisted_for_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_waitlisted_for_event(uuid) TO authenticated;

-- A waitlisted person can still open the event they are waiting for (the
-- existing read_involved_events policy now needs an active registration).
DROP POLICY IF EXISTS "read_waitlisted_events" ON public.events;
CREATE POLICY "read_waitlisted_events"
  ON public.events FOR SELECT
  TO authenticated
  USING (
    archived_at IS NULL
    AND visibility <> 'draft'
    AND public.is_waitlisted_for_event(id)
  );

-- Other people's cancelled / waitlisted rows are nobody's business but their own
-- and the organizer's. RESTRICTIVE, so it narrows the existing permissive
-- policies instead of replacing them.
DROP POLICY IF EXISTS "hide_inactive_registrations_from_others" ON public.event_registrations;
CREATE POLICY "hide_inactive_registrations_from_others"
  ON public.event_registrations AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR status IN ('registered', 'checked_in')
    OR public.can_manage_event(event_id)
  );

-- Public "N registered" counts attending people only.
CREATE OR REPLACE FUNCTION public.get_event_registration_counts(event_ids uuid[])
RETURNS TABLE (
  event_id uuid,
  registration_count bigint
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT r.event_id, count(*)::bigint AS registration_count
  FROM event_registrations r
  WHERE r.event_id = ANY(COALESCE(event_ids, ARRAY[]::uuid[]))
    AND r.status IN ('registered', 'checked_in')
  GROUP BY r.event_id;
$$;

-- ============================================================================
-- Insert rule: same checks as before, waitlist-aware
-- ============================================================================
-- Only active registrations take a seat. A 'waitlisted' insert is the
-- register_for_event function's decision, made under the event lock, so it is
-- not re-judged here; a plain 'registered' insert still has to fit.
CREATE OR REPLACE FUNCTION public.enforce_registration_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_taken int;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = NEW.event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;

  IF v_event.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'That event is no longer available';
  END IF;

  IF v_event.visibility = 'draft' THEN
    RAISE EXCEPTION 'That event is not open for registration';
  END IF;

  IF v_event.status = 'past' THEN
    RAISE EXCEPTION 'That event has already finished';
  END IF;

  IF v_event.capacity IS NOT NULL AND NEW.status <> 'waitlisted' THEN
    SELECT count(*) INTO v_taken
    FROM event_registrations r
    WHERE r.event_id = NEW.event_id AND r.status NOT IN ('cancelled', 'waitlisted');

    IF v_taken >= v_event.capacity THEN
      RAISE EXCEPTION 'That event is full';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Nobody is checked in off the waitlist; they must be promoted first.
CREATE OR REPLACE FUNCTION public.guard_registration_status_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'waitlisted' AND NEW.status = 'checked_in' THEN
    RAISE EXCEPTION 'That person is on the waitlist and has no seat yet';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_registration_status_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_registration_status_change ON public.event_registrations;
CREATE TRIGGER check_registration_status_change
  BEFORE UPDATE OF status ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.guard_registration_status_change();

-- ============================================================================
-- Waitlist promotion
-- ============================================================================
-- Fills free seats from the waitlist, oldest first. Called with the event row
-- locked (register / cancel hold the lock; the triggers below take it).
CREATE OR REPLACE FUNCTION public.promote_event_waitlist(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_event events%ROWTYPE;
  v_next record;
  v_taken int;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.archived_at IS NOT NULL OR v_event.status = 'past' THEN
    RETURN;
  END IF;

  LOOP
    IF v_event.capacity IS NOT NULL THEN
      SELECT count(*) INTO v_taken
      FROM event_registrations r
      WHERE r.event_id = p_event_id AND r.status NOT IN ('cancelled', 'waitlisted');
      EXIT WHEN v_taken >= v_event.capacity;
    END IF;

    SELECT r.id, r.user_id INTO v_next
    FROM event_registrations r
    WHERE r.event_id = p_event_id AND r.status = 'waitlisted'
    ORDER BY r.created_at, r.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    EXIT WHEN NOT FOUND;

    UPDATE event_registrations SET status = 'registered' WHERE id = v_next.id;

    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (v_next.user_id, 'registration_promoted', 'You''re in!',
            'A place opened up and you are now registered for ' || v_event.name || '.',
            '/events/' || p_event_id);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_event_waitlist(uuid) FROM PUBLIC, anon, authenticated;

-- A seat is freed when an attending registration is cancelled or removed.
CREATE OR REPLACE FUNCTION public.promote_waitlist_on_seat_freed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('cancelled', 'waitlisted') THEN
      PERFORM public.promote_event_waitlist(OLD.event_id);
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status NOT IN ('cancelled', 'waitlisted') AND NEW.status IN ('cancelled', 'waitlisted') THEN
    PERFORM public.promote_event_waitlist(NEW.event_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_waitlist_on_seat_freed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS promote_waitlist_after_update ON public.event_registrations;
CREATE TRIGGER promote_waitlist_after_update
  AFTER UPDATE OF status ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.promote_waitlist_on_seat_freed();

DROP TRIGGER IF EXISTS promote_waitlist_after_delete ON public.event_registrations;
CREATE TRIGGER promote_waitlist_after_delete
  AFTER DELETE ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.promote_waitlist_on_seat_freed();

-- Raising (or removing) the capacity opens seats too.
CREATE OR REPLACE FUNCTION public.promote_waitlist_on_capacity_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.capacity IS DISTINCT FROM OLD.capacity THEN
    PERFORM public.promote_event_waitlist(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_waitlist_on_capacity_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS promote_waitlist_on_capacity ON public.events;
CREATE TRIGGER promote_waitlist_on_capacity
  AFTER UPDATE OF capacity ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.promote_waitlist_on_capacity_change();

-- ============================================================================
-- Answer validation (internal)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_registration_answers(p_event_id uuid, p_answers jsonb)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  q record;
  k text;
  v jsonb;
  elem jsonb;
  v_text text;
  v_empty boolean;
  v_seen text[];
BEGIN
  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Your answers could not be read';
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_answers) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM event_registration_questions x
      WHERE x.event_id = p_event_id AND x.archived_at IS NULL AND x.id::text = k
    ) THEN
      RAISE EXCEPTION 'Your answers do not match this event''s form';
    END IF;
  END LOOP;

  FOR q IN
    SELECT * FROM event_registration_questions x
    WHERE x.event_id = p_event_id AND x.archived_at IS NULL
    ORDER BY x.position
  LOOP
    v := p_answers -> q.id::text;
    v_empty := v IS NULL
      OR v = 'null'::jsonb
      OR v = '[]'::jsonb
      OR (jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') = '');

    IF v_empty THEN
      IF q.required THEN
        RAISE EXCEPTION 'Please answer all required questions';
      END IF;
      CONTINUE;
    END IF;

    IF q.kind = 'short_text' THEN
      IF jsonb_typeof(v) <> 'string' OR char_length(v #>> '{}') > 500 THEN
        RAISE EXCEPTION 'An answer is too long (limit 500 characters)';
      END IF;
    ELSIF q.kind = 'long_text' THEN
      IF jsonb_typeof(v) <> 'string' OR char_length(v #>> '{}') > 2000 THEN
        RAISE EXCEPTION 'An answer is too long (limit 2000 characters)';
      END IF;
    ELSIF q.kind = 'yes_no' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN
        RAISE EXCEPTION 'Your answers do not match this event''s form';
      END IF;
    ELSIF q.kind = 'single_choice' THEN
      IF jsonb_typeof(v) <> 'string' OR NOT (q.options @> jsonb_build_array(v #>> '{}')) THEN
        RAISE EXCEPTION 'Your answers do not match this event''s form';
      END IF;
    ELSIF q.kind = 'multi_choice' THEN
      IF jsonb_typeof(v) <> 'array' THEN
        RAISE EXCEPTION 'Your answers do not match this event''s form';
      END IF;
      v_seen := ARRAY[]::text[];
      FOR elem IN SELECT * FROM jsonb_array_elements(v) LOOP
        v_text := elem #>> '{}';
        IF jsonb_typeof(elem) <> 'string' OR NOT (q.options @> jsonb_build_array(v_text)) OR v_text = ANY (v_seen) THEN
          RAISE EXCEPTION 'Your answers do not match this event''s form';
        END IF;
        v_seen := v_seen || v_text;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_registration_answers(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- get_event_registration_form
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_event_registration_form(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  "position" integer,
  label text,
  help_text text,
  kind text,
  options jsonb,
  required boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.can_manage_event(p_event_id) AND NOT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id AND e.archived_at IS NULL AND e.visibility IN ('published', 'unlisted')
  ) THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;

  RETURN QUERY
  SELECT x.id, x.position, x.label, x.help_text, x.kind, x.options, x.required
  FROM event_registration_questions x
  WHERE x.event_id = p_event_id AND x.archived_at IS NULL
  ORDER BY x.position, x.created_at;
END;
$$;

-- ============================================================================
-- register_for_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid, p_answers jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  registration_id uuid,
  registration_status text,
  waitlist_position integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_event events%ROWTYPE;
  v_existing event_registrations%ROWTYPE;
  v_had_row boolean;
  v_taken int;
  v_status text;
  v_id uuid;
  v_pos int := NULL;
  v_answers jsonb := COALESCE(p_answers, '{}'::jsonb);
  k text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  -- The event row is the lock every registration change queues behind, so the
  -- seat count below cannot change under us.
  SELECT * INTO v_event FROM events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;
  IF v_event.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'That event is no longer available';
  END IF;
  IF v_event.visibility = 'draft' THEN
    RAISE EXCEPTION 'That event is not open for registration';
  END IF;
  IF v_event.status = 'past' THEN
    RAISE EXCEPTION 'That event has already finished';
  END IF;

  SELECT * INTO v_existing FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.user_id = v_me FOR UPDATE;
  v_had_row := FOUND;
  IF v_had_row AND v_existing.status <> 'cancelled' THEN
    RAISE EXCEPTION 'You are already registered for this event';
  END IF;

  PERFORM public.validate_registration_answers(p_event_id, v_answers);

  SELECT count(*) INTO v_taken FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.status NOT IN ('cancelled', 'waitlisted');
  v_status := CASE WHEN v_event.capacity IS NULL OR v_taken < v_event.capacity THEN 'registered' ELSE 'waitlisted' END;

  IF v_had_row THEN
    -- Registering again after cancelling reuses the row. created_at moves to now
    -- so a returning person joins the back of the waitlist, not their old place.
    UPDATE event_registrations r
       SET status = v_status, cancelled_at = NULL, checked_in_at = NULL, created_at = now()
     WHERE r.id = v_existing.id
     RETURNING r.id INTO v_id;
    DELETE FROM event_registration_answers a WHERE a.registration_id = v_id;
  ELSE
    INSERT INTO event_registrations (event_id, user_id, status)
    VALUES (p_event_id, v_me, v_status)
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO event_registration_answers (registration_id, question_id, answer)
  SELECT v_id, x.id, v_answers -> k2
  FROM event_registration_questions x, LATERAL (SELECT x.id::text AS k2) s
  WHERE x.event_id = p_event_id AND x.archived_at IS NULL
    AND v_answers ? k2
    AND NOT (v_answers -> k2 = 'null'::jsonb OR v_answers -> k2 = '[]'::jsonb OR v_answers -> k2 = '""'::jsonb
             OR (jsonb_typeof(v_answers -> k2) = 'string' AND btrim(v_answers -> k2 #>> '{}') = ''));

  IF v_status = 'waitlisted' THEN
    SELECT count(*)::int INTO v_pos FROM event_registrations r
     WHERE r.event_id = p_event_id AND r.status = 'waitlisted'
       AND (r.created_at, r.id) <= (SELECT r2.created_at, r2.id FROM event_registrations r2 WHERE r2.id = v_id);
    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (v_me, 'registration_waitlisted', 'You''re on the waitlist',
            v_event.name || ' is full. You are number ' || v_pos || ' on the waitlist; we will register you if a place opens.',
            '/events/' || p_event_id);
  ELSE
    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (v_me, 'event_registration', 'Registration confirmed',
            'You are registered for ' || v_event.name || '.',
            '/events/' || p_event_id);
  END IF;

  RETURN QUERY SELECT v_id, v_status, v_pos;
END;
$$;

-- ============================================================================
-- cancel_event_registration
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
     SET status = 'cancelled', cancelled_at = now()
   WHERE r.id = v_reg.id;

  RETURN v_reg.status;
END;
$$;

-- ============================================================================
-- my_event_registration
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_event_registration(p_event_id uuid)
RETURNS TABLE (
  registration_id uuid,
  registration_status text,
  registered_at timestamptz,
  waitlist_position integer,
  answers jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT r.id,
         r.status,
         r.created_at,
         CASE WHEN r.status = 'waitlisted' THEN
           (SELECT count(*)::int FROM event_registrations w
             WHERE w.event_id = r.event_id AND w.status = 'waitlisted'
               AND (w.created_at, w.id) <= (r.created_at, r.id))
         END,
         COALESCE((SELECT jsonb_object_agg(a.question_id::text, a.answer)
                     FROM event_registration_answers a WHERE a.registration_id = r.id), '{}'::jsonb)
  FROM event_registrations r
  WHERE r.event_id = p_event_id AND r.user_id = auth.uid();
END;
$$;

-- ============================================================================
-- set_event_registration_questions (organizer)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_event_registration_questions(p_event_id uuid, p_questions jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  item jsonb;
  idx int := 0;
  v_id uuid;
  v_old_kind text;
  v_label text;
  v_help text;
  v_kind text;
  v_required boolean;
  v_opts jsonb;
  v_opt_texts text[];
  kept uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;
  IF NOT public.can_manage_event(p_event_id) THEN
    RAISE EXCEPTION 'You do not have access to this event';
  END IF;
  IF jsonb_typeof(p_questions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'The form could not be read';
  END IF;
  IF jsonb_array_length(p_questions) > 20 THEN
    RAISE EXCEPTION 'A registration form can have at most 20 questions';
  END IF;

  PERFORM 1 FROM events e WHERE e.id = p_event_id FOR UPDATE;

  FOR item IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    idx := idx + 1;
    v_label := btrim(COALESCE(item ->> 'label', ''));
    IF char_length(v_label) < 1 OR char_length(v_label) > 200 THEN
      RAISE EXCEPTION 'Every question needs a label (up to 200 characters)';
    END IF;
    v_help := NULLIF(btrim(COALESCE(item ->> 'help_text', '')), '');
    IF v_help IS NOT NULL AND char_length(v_help) > 300 THEN
      RAISE EXCEPTION 'Help text can be at most 300 characters';
    END IF;
    v_kind := item ->> 'kind';
    IF v_kind IS NULL OR v_kind NOT IN ('short_text', 'long_text', 'single_choice', 'multi_choice', 'yes_no') THEN
      RAISE EXCEPTION 'Unknown question type';
    END IF;
    v_required := COALESCE((item ->> 'required')::boolean, false);

    v_opts := NULL;
    IF v_kind IN ('single_choice', 'multi_choice') THEN
      IF jsonb_typeof(item -> 'options') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Choice questions need between 2 and 20 options';
      END IF;
      SELECT array_agg(btrim(o #>> '{}')) INTO v_opt_texts FROM jsonb_array_elements(item -> 'options') o
       WHERE jsonb_typeof(o) = 'string';
      IF v_opt_texts IS NULL
         OR cardinality(v_opt_texts) <> jsonb_array_length(item -> 'options')
         OR cardinality(v_opt_texts) NOT BETWEEN 2 AND 20
         OR EXISTS (SELECT 1 FROM unnest(v_opt_texts) t WHERE char_length(t) < 1 OR char_length(t) > 100)
         OR (SELECT count(DISTINCT t) FROM unnest(v_opt_texts) t) <> cardinality(v_opt_texts) THEN
        RAISE EXCEPTION 'Choice questions need between 2 and 20 different options (up to 100 characters each)';
      END IF;
      v_opts := to_jsonb(v_opt_texts);
    END IF;

    v_id := NULLIF(item ->> 'id', '')::uuid;
    IF v_id IS NOT NULL THEN
      SELECT x.kind INTO v_old_kind FROM event_registration_questions x
       WHERE x.id = v_id AND x.event_id = p_event_id AND x.archived_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That question does not belong to this event';
      END IF;
      IF v_old_kind <> v_kind AND EXISTS (SELECT 1 FROM event_registration_answers a WHERE a.question_id = v_id) THEN
        RAISE EXCEPTION 'A question''s type cannot change once people have answered it';
      END IF;
      UPDATE event_registration_questions x
         SET position = idx, label = v_label, help_text = v_help, kind = v_kind,
             options = v_opts, required = v_required, updated_at = now()
       WHERE x.id = v_id;
    ELSE
      INSERT INTO event_registration_questions (event_id, position, label, help_text, kind, options, required)
      VALUES (p_event_id, idx, v_label, v_help, v_kind, v_opts, v_required)
      RETURNING id INTO v_id;
    END IF;
    kept := kept || v_id;
  END LOOP;

  -- Anything not sent back is archived, not deleted: answers already given stay.
  UPDATE event_registration_questions x
     SET archived_at = now(), updated_at = now()
   WHERE x.event_id = p_event_id AND x.archived_at IS NULL AND NOT (x.id = ANY (kept));
END;
$$;

-- ============================================================================
-- get_event_registration_answers (organizer)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_event_registration_answers(
  p_event_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  registration_id uuid,
  user_id uuid,
  full_name text,
  job_title text,
  company text,
  registration_status text,
  registered_at timestamptz,
  answers jsonb,
  total bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.account_is_active() OR NOT public.can_manage_event(p_event_id) THEN
    RAISE EXCEPTION 'You do not have access to this event';
  END IF;

  RETURN QUERY
  SELECT r.id,
         r.user_id,
         COALESCE(NULLIF(btrim(p.full_name), ''), 'Rally member'),
         COALESCE(p.job_title, ''),
         COALESCE(p.company, ''),
         r.status,
         r.created_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'question_id', x.id,
                    'label', x.label,
                    'kind', x.kind,
                    'archived', x.archived_at IS NOT NULL,
                    'answer', a.answer) ORDER BY x.position, x.created_at)
             FROM event_registration_answers a
             JOIN event_registration_questions x ON x.id = a.question_id
            WHERE a.registration_id = r.id
         ), '[]'::jsonb),
         count(*) OVER ()
  FROM event_registrations r
  LEFT JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = p_event_id
    AND r.status <> 'cancelled'
  ORDER BY r.created_at DESC, r.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

-- ============================================================================
-- Grants
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.get_event_registration_form(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_for_event(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_event_registration(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_event_registration(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_event_registration_questions(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_event_registration_answers(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_registration_form(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_registration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_event_registration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_registration_questions(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_registration_answers(uuid, integer, integer) TO authenticated;

-- Registering and cancelling now go through the functions above, so the form and
-- the waitlist cannot be skipped by writing the table directly.
REVOKE INSERT ON TABLE public.event_registrations FROM authenticated;
REVOKE INSERT (event_id, user_id) ON TABLE public.event_registrations FROM authenticated;
REVOKE DELETE ON TABLE public.event_registrations FROM authenticated;
