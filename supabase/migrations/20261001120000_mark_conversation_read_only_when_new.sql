/*
# mark_conversation_read: write only when the marker actually moves

## Why
Read receipts are driven by `conversation_members.last_read_at`, and that table
is now in the `supabase_realtime` publication, so **every** write to it is
broadcast to the other member of the conversation.

The client now advances the marker whenever the thread is genuinely being
looked at — on open, on each incoming message, on reply, and when a hidden tab
comes back — which is what makes the second tick appear live. The cost of that
is a lot of calls, and in the previous form each one wrote `now()`
unconditionally: a WAL record, a logical-replication row and a realtime event
delivered to the other person, for a read that had already been recorded.

So the write is now conditional. The function keeps the same name, signature,
return type, privileges and authorization check; only the UPDATE gains a
predicate.

## Why this predicate is exactly right, and not merely cheaper
The condition is "there exists a message from somebody else that is newer than
my marker". That is the same set the ticks are computed from: the sender's
ticks compare *their* messages against *my* marker. So

  - if some message of theirs is newer than my marker, the marker must move,
    and it does;
  - if none is, then every message of theirs is already <= my marker, their
    ticks already read as double, and moving the marker would change nothing
    anyone can observe.

`get_my_conversations.unread_count` counts the same set, so a skipped write can
never leave a stale unread badge either — the count is already zero in exactly
the cases the write is skipped.

## Not changed
No table, column, policy, grant or trigger. `last_read_at` remains the single
authoritative read model; nothing here introduces a second one.
*/

CREATE OR REPLACE FUNCTION public.mark_conversation_read(conversation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_conversation_member(mark_conversation_read.conversation_id) THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  UPDATE conversation_members cm
  SET last_read_at = now()
  WHERE cm.conversation_id = mark_conversation_read.conversation_id
    AND cm.user_id = auth.uid()
    -- Only when there is something of someone else's that this marker does not
    -- already cover. Without this, an active conversation broadcasts a read
    -- receipt on every keystroke-driven call that changes nothing.
    AND EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.conversation_id = mark_conversation_read.conversation_id
        AND m.sender_id <> auth.uid()
        AND m.deleted_at IS NULL
        AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
    );
END;
$$;
