/*
# Message replies and delete-for-everyone

Two chat features: reply to a specific message, and delete a message you sent.

## What this adds
- column messages.reply_to_id (nullable, the message being replied to)
- send_message_reply(conversation_id, body, reply_to_id)  -> uuid
- get_conversation_thread(conversation_id, before_created_at, page_size)
    the same page as get_conversation_messages plus a small preview of the
    message each row replies to
- delete_message(message_id)  -> void
- two triggers keeping reply_to_id honest (same conversation; never changes)

## Why new functions instead of changing the existing ones
get_conversation_messages returns a fixed column list. Postgres cannot add
columns to a function's result with CREATE OR REPLACE, only by dropping and
re-creating it, and this repository does not drop functions without approval.
So the existing send_message and get_conversation_messages are left exactly as
they are (older app builds keep working) and the new behaviour lives in new
functions. The old pair can be retired in a later migration once nothing calls
them.

## Who can do what
- Replying: a member of the conversation, to a message in that same
  conversation that has not been deleted. Enforced twice: in send_message_reply,
  and by a trigger, because the INSERT policy also lets a member insert a row
  directly.
- Deleting: only the sender of the message, only once. It is the existing soft
  delete (deleted_at); the body is never returned to anyone afterwards, and a
  reply to it shows "Message deleted" instead of a quote.
- Reading a reply preview: a reply preview is only built when the quoted message
  is in the same conversation as the reply, so a forged reply_to_id pointing at
  somebody else's conversation reveals nothing.

## What does not change
No existing column, policy, grant or function is altered. The immutability
trigger function is replaced (CREATE OR REPLACE) with the same checks plus one:
reply_to_id cannot change after the message is written.

## Reversal
Forward-only. To retire: DROP the three functions and two triggers, then the
column.
*/

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL: messages are soft-deleted, never removed, but if a row is
-- ever purged the reply should survive it.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON public.messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- A reply must point into its own conversation (covers direct INSERTs too)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_reply_same_conversation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM messages r
    WHERE r.id = NEW.reply_to_id AND r.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'You can only reply to a message in the same conversation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_reply_same_conversation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_reply_same_conversation ON public.messages;
CREATE TRIGGER check_reply_same_conversation
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reply_same_conversation();

-- ---------------------------------------------------------------------------
-- Immutability: the existing checks, plus reply_to_id is fixed once written
-- ---------------------------------------------------------------------------
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
  IF NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id THEN
    RAISE EXCEPTION 'A message cannot change which message it replies to';
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

-- ---------------------------------------------------------------------------
-- send_message_reply
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_message_reply(
  conversation_id uuid,
  body text,
  reply_to_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_body text := btrim(COALESCE(body, ''));
  v_target_deleted timestamptz;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_conversation_member(send_message_reply.conversation_id) THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  IF v_body = '' THEN
    RAISE EXCEPTION 'Write something before sending';
  END IF;

  IF length(v_body) > 4000 THEN
    RAISE EXCEPTION 'That message is too long (limit 4000 characters)';
  END IF;

  IF send_message_reply.reply_to_id IS NOT NULL THEN
    SELECT m.deleted_at INTO v_target_deleted
    FROM messages m
    WHERE m.id = send_message_reply.reply_to_id
      AND m.conversation_id = send_message_reply.conversation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'You can only reply to a message in the same conversation';
    END IF;
    IF v_target_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'You cannot reply to a deleted message';
    END IF;
  END IF;

  -- sender_id comes from auth.uid(), never from the caller.
  INSERT INTO messages (conversation_id, sender_id, body, reply_to_id)
  VALUES (send_message_reply.conversation_id, auth.uid(), v_body, send_message_reply.reply_to_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- delete_message: the sender removes their own message for everyone
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_message(message_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE messages m
     SET deleted_at = now()
   WHERE m.id = delete_message.message_id
     AND m.sender_id = auth.uid()
     AND m.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That message cannot be deleted';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_conversation_thread: get_conversation_messages plus reply previews
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_conversation_thread(
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
  is_mine boolean,
  reply_to_id uuid,
  reply_to_sender_id uuid,
  reply_to_body text,
  reply_to_deleted boolean
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(page_size, 50), 1), 200);
BEGIN
  IF NOT public.is_conversation_member(get_conversation_thread.conversation_id) THEN
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
    (m.sender_id = auth.uid()),
    -- A deleted message carries no reply quote either.
    CASE WHEN m.deleted_at IS NULL THEN r.id END,
    CASE WHEN m.deleted_at IS NULL THEN r.sender_id END,
    CASE WHEN m.deleted_at IS NULL AND r.deleted_at IS NULL THEN left(r.body, 200) END,
    CASE WHEN m.deleted_at IS NULL AND r.id IS NOT NULL THEN (r.deleted_at IS NOT NULL) END
  FROM messages m
  -- Same-conversation guard: a forged reply_to_id aimed at another
  -- conversation joins to nothing.
  LEFT JOIN messages r
    ON r.id = m.reply_to_id AND r.conversation_id = m.conversation_id
  WHERE m.conversation_id = get_conversation_thread.conversation_id
    AND (before_created_at IS NULL OR m.created_at < before_created_at)
  ORDER BY m.created_at DESC
  LIMIT v_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.send_message_reply(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_message(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_conversation_thread(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_message_reply(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_thread(uuid, timestamptz, integer) TO authenticated;
