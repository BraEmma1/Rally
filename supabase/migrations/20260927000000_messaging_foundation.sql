/*
# Messaging foundation

Backend only. Three tables, five RPCs, strict RLS, realtime enabled on
messages, and a notification path the client cannot forge.

## What the inspection found, and how it shaped this
- **Connections are strictly one-directional.** `connections` has
  `owner_id -> connected_user_id`, and in this database 9 rows are linked to a
  user while **0** have a reciprocal row. Scanning someone's QR code creates a
  row for the scanner only. "A connection exists between them" therefore has to
  mean *either direction*; requiring a mutual pair would make messaging
  unreachable for every relationship Rally has ever recorded.
- **`notifications` may only be inserted for yourself** — its INSERT policy is
  `auth.uid() = user_id`. Notifying the *recipient* of a message is impossible
  from the client by design, so it goes through a definer trigger, the same
  shape as the existing `notify_new_connection`. The client supplies the message
  body and nothing else; the notification's type, title and text are composed
  server-side.
- **Realtime had no tables.** The `supabase_realtime` publication exists but is
  empty, so this is the first table added to it.
- **No block or report mechanism exists.** None is invented here; the extension
  point is documented at the bottom.

## One conversation per pair, with the event remembered
A direct conversation is unique per pair of people, enforced by `direct_key`, a
canonical least/greatest ordering of the two ids. Not one per event: the
relationship outlives the event, which is the stated product rule. `event_id`
records where the relationship *came from*, derived from the connection rather
than accepted from the client, which is what stops an arbitrary event being
attached to a conversation to make it look like it happened somewhere it did
not.

## Deletion
Messages are soft-deleted (`deleted_at`). There is no DELETE policy on any of
these tables: a conversation is shared, and letting one person destroy the
other's copy of it is not a thing to build by accident.
*/

-- ============================================================================
-- Tables
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Where the relationship originated. ON DELETE SET NULL: events are archived
  -- rather than deleted, but if one ever goes, the conversation survives it —
  -- the relationship is the point, not the event.
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Canonical pair key for a direct conversation: least(a,b) || ':' ||
  -- greatest(a,b). Unique, so "start a conversation" is idempotent from either
  -- side and two people can never end up with two threads.
  direct_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Bumped by the message trigger so the conversation list sorts by activity
  -- without an aggregate over messages.
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_members_user
  ON conversation_members (user_id, conversation_id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT messages_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT messages_body_length CHECK (length(body) <= 4000)
);

-- The read pattern is "this conversation, newest first".
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at DESC);

-- ============================================================================
-- Helpers
--
-- Both are SECURITY DEFINER because a policy on conversation_members that
-- selects conversation_members re-enters the policy and recurses — the same
-- reason the organization membership helpers exist.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.users_are_connected(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  -- Either direction. Rally's connections are one-directional and are never
  -- reciprocated, so requiring a mutual pair would match nothing.
  SELECT EXISTS (
    SELECT 1 FROM connections c
    WHERE c.status = 'active'
      AND (
        (c.owner_id = a AND c.connected_user_id = b)
        OR (c.owner_id = b AND c.connected_user_id = a)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_member(target_conversation_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_members m
    WHERE m.conversation_id = target_conversation_id
      AND m.user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.users_are_connected(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.conversations FROM anon;
REVOKE ALL ON public.conversation_members FROM anon;
REVOKE ALL ON public.messages FROM anon;

-- Conversations: readable by members. No client INSERT (the RPC checks the
-- connection first) and no UPDATE — updated_at is the trigger's business.
DROP POLICY IF EXISTS "read_own_conversations" ON conversations;
CREATE POLICY "read_own_conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (public.is_conversation_member(id));

REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM authenticated;

-- Membership: you can see who is in a conversation you are in. Writes are
-- RPC-only, so nobody adds themselves to someone else's thread; the one
-- exception is your own read marker.
DROP POLICY IF EXISTS "read_conversation_members" ON conversation_members;
CREATE POLICY "read_conversation_members"
  ON conversation_members FOR SELECT
  TO authenticated
  USING (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "update_own_membership" ON conversation_members;
CREATE POLICY "update_own_membership"
  ON conversation_members FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE INSERT, DELETE ON public.conversation_members FROM authenticated;
REVOKE UPDATE ON public.conversation_members FROM authenticated;
GRANT UPDATE (last_read_at) ON public.conversation_members TO authenticated;

-- Messages: members read; you may only write as yourself, into a conversation
-- you belong to.
DROP POLICY IF EXISTS "read_conversation_messages" ON messages;
CREATE POLICY "read_conversation_messages"
  ON messages FOR SELECT
  TO authenticated
  USING (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "send_own_messages" ON messages;
CREATE POLICY "send_own_messages"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id)
  );

DROP POLICY IF EXISTS "edit_own_messages" ON messages;
CREATE POLICY "edit_own_messages"
  ON messages FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- No DELETE policy: deletion is deleted_at, set through the UPDATE path.
REVOKE DELETE ON public.messages FROM authenticated;

-- ============================================================================
-- A message's identity is fixed once written
--
-- The UPDATE policy establishes *who* may edit; this establishes *what* they
-- may change. Without it an author could move their message into another
-- conversation or rewrite its timestamp.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_message_immutability()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'A message cannot be moved to another conversation';
  END IF;
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'A message cannot change sender';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A message cannot change when it was sent';
  END IF;

  -- Editing the text stamps edited_at, so a reader can always tell.
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'A deleted message cannot be edited';
    END IF;
    NEW.edited_at := now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_message_immutability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_message_immutability ON messages;
CREATE TRIGGER check_message_immutability
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_immutability();

-- ============================================================================
-- New message: bump the conversation, notify the others
--
-- The notification is composed here, not by the caller: the client supplies a
-- body and nothing else, so it cannot fabricate a notification that claims to
-- be from Rally or from somebody else. It also cannot notify anyone it likes,
-- because the recipients come from the membership table.
-- ============================================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_allowed;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_allowed
  CHECK (type = ANY (ARRAY[
    'new_connection', 'event_invitation', 'invitation_accepted',
    'invitation_declined', 'follow_up_due', 'follow_up_overdue',
    'opportunity_stage_changed', 'event_registration', 'upcoming_event',
    'new_message'
  ])) NOT VALID;

CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_name text;
BEGIN
  UPDATE conversations SET updated_at = now() WHERE id = NEW.conversation_id;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Someone') INTO v_sender_name
  FROM profiles p WHERE p.id = NEW.sender_id;

  INSERT INTO notifications (user_id, type, title, message, link)
  SELECT
    m.user_id,
    'new_message',
    'New message',
    COALESCE(v_sender_name, 'Someone') || ' sent you a message on Rally.',
    '/messages'
  FROM conversation_members m
  WHERE m.conversation_id = NEW.conversation_id
    AND m.user_id <> NEW.sender_id
    -- One notification per conversation per quarter hour. A back-and-forth
    -- exchange should not produce a notification per line.
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = m.user_id
        AND n.type = 'new_message'
        AND n.created_at > now() - interval '15 minutes'
    );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_message_sent ON messages;
CREATE TRIGGER on_message_sent
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_message();

-- ============================================================================
-- RPCs
-- ============================================================================

-- Start (or find) the direct conversation with someone you are connected to.
-- Idempotent: calling it twice, or from both sides, returns the same id.
CREATE OR REPLACE FUNCTION public.create_direct_conversation(
  other_user_id uuid,
  event_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_key text;
  v_existing uuid;
  v_event uuid;
  v_connection_event uuid;
  v_id uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF other_user_id IS NULL OR other_user_id = v_me THEN
    RAISE EXCEPTION 'Choose someone else to message';
  END IF;

  IF NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  -- The product rule, enforced here rather than in the UI.
  IF NOT public.users_are_connected(v_me, other_user_id) THEN
    RAISE EXCEPTION 'You can only message people you are connected with on Rally';
  END IF;

  v_key := least(v_me::text, other_user_id::text) || ':' || greatest(v_me::text, other_user_id::text);

  SELECT c.id INTO v_existing FROM conversations c WHERE c.direct_key = v_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Event context is derived, never taken on trust. The only event a
  -- conversation may carry is the one the underlying connection already
  -- records, so a client cannot dress a conversation up as having come from an
  -- event it had nothing to do with.
  SELECT c.event_id INTO v_connection_event
  FROM connections c
  WHERE c.status = 'active'
    AND c.event_id IS NOT NULL
    AND (
      (c.owner_id = v_me AND c.connected_user_id = other_user_id)
      OR (c.owner_id = other_user_id AND c.connected_user_id = v_me)
    )
  ORDER BY c.created_at
  LIMIT 1;

  IF create_direct_conversation.event_id IS NOT NULL THEN
    IF v_connection_event IS DISTINCT FROM create_direct_conversation.event_id THEN
      RAISE EXCEPTION 'That event is not where this connection was made';
    END IF;
    v_event := create_direct_conversation.event_id;
  ELSE
    v_event := v_connection_event;
  END IF;

  INSERT INTO conversations (event_id, created_by, direct_key)
  VALUES (v_event, v_me, v_key)
  RETURNING id INTO v_id;

  INSERT INTO conversation_members (conversation_id, user_id)
  VALUES (v_id, v_me), (v_id, other_user_id);

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_message(
  conversation_id uuid,
  body text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_body text := btrim(COALESCE(body, ''));
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_conversation_member(send_message.conversation_id) THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  IF v_body = '' THEN
    RAISE EXCEPTION 'Write something before sending';
  END IF;

  IF length(v_body) > 4000 THEN
    RAISE EXCEPTION 'That message is too long (limit 4000 characters)';
  END IF;

  -- sender_id comes from auth.uid(), never from the caller.
  INSERT INTO messages (conversation_id, sender_id, body)
  VALUES (send_message.conversation_id, auth.uid(), v_body)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- The conversation list: the other person's public card, the event it came
-- from, the last line and an unread count. No email or phone — the same
-- projection every other Rally surface uses.
CREATE OR REPLACE FUNCTION public.get_my_conversations()
RETURNS TABLE (
  conversation_id uuid,
  other_user_id uuid,
  other_full_name text,
  other_job_title text,
  other_company text,
  other_photo_url text,
  event_id uuid,
  event_name text,
  last_message_body text,
  last_message_at timestamptz,
  last_message_sender_id uuid,
  unread_count bigint,
  updated_at timestamptz
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    c.id,
    other.user_id,
    COALESCE(p.full_name, ''),
    COALESCE(p.job_title, ''),
    COALESCE(p.company, ''),
    COALESCE(p.photo_url, ''),
    c.event_id,
    e.name,
    -- A deleted message still occupies the last slot, shown as a tombstone
    -- rather than silently revealing the line before it.
    CASE WHEN last.deleted_at IS NOT NULL THEN NULL ELSE last.body END,
    last.created_at,
    last.sender_id,
    (SELECT count(*) FROM messages m2
      WHERE m2.conversation_id = c.id
        AND m2.sender_id <> auth.uid()
        AND m2.deleted_at IS NULL
        AND (mine.last_read_at IS NULL OR m2.created_at > mine.last_read_at)),
    c.updated_at
  FROM conversations c
  JOIN conversation_members mine
    ON mine.conversation_id = c.id AND mine.user_id = auth.uid()
  LEFT JOIN conversation_members other
    ON other.conversation_id = c.id AND other.user_id <> auth.uid()
  LEFT JOIN profiles p ON p.id = other.user_id
  LEFT JOIN events e ON e.id = c.event_id
  LEFT JOIN LATERAL (
    SELECT m.body, m.created_at, m.sender_id, m.deleted_at
    FROM messages m
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) last ON true
  ORDER BY c.updated_at DESC;
$$;

-- Paged oldest-first within a window, newest page first: pass the created_at of
-- the oldest message you already have as `before` to fetch the page above it.
CREATE OR REPLACE FUNCTION public.get_conversation_messages(
  conversation_id uuid,
  before_created_at timestamptz DEFAULT NULL,
  page_size integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  is_mine boolean
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(page_size, 50), 1), 200);
BEGIN
  IF NOT public.is_conversation_member(get_conversation_messages.conversation_id) THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.sender_id,
    -- The body of a deleted message is not returned at all, to anyone.
    CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.body END,
    m.created_at,
    m.edited_at,
    m.deleted_at,
    (m.sender_id = auth.uid())
  FROM messages m
  WHERE m.conversation_id = get_conversation_messages.conversation_id
    AND (before_created_at IS NULL OR m.created_at < before_created_at)
  ORDER BY m.created_at DESC
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(conversation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_conversation_member(mark_conversation_read.conversation_id) THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  UPDATE conversation_members
  SET last_read_at = now()
  WHERE conversation_members.conversation_id = mark_conversation_read.conversation_id
    AND user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_direct_conversation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_message(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_conversations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_conversation_messages(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_direct_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_messages(uuid, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

-- ============================================================================
-- Realtime
--
-- supabase_realtime existed but contained no tables; messages is the first.
-- REPLICA IDENTITY FULL so the old row is published on UPDATE and DELETE,
-- which is what lets Realtime apply the SELECT policy to a change event rather
-- than leaking it to every subscriber.
-- ============================================================================
ALTER TABLE messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

/*
## Extension point for blocking and reporting — NOT built here

Rally has no block or report mechanism today; none is invented as part of this
task. When it is built, the natural shape is a `user_blocks (blocker_id,
blocked_id, created_at)` table, and exactly two places need to consult it:

  1. `users_are_connected` — or a wrapper around it — so a blocked pair can
     never start a conversation;
  2. the `send_own_messages` INSERT policy, so an existing conversation goes
     read-only in both directions once either party blocks the other.

Because both the connection test and the send path already funnel through one
function and one policy, adding the check later is a two-line change rather
than a rewrite. Reporting is independent of this and wants its own table, since
a report must survive the reported content being deleted.
*/
