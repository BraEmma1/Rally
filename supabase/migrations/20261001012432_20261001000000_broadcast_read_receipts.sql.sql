/*
# Broadcast message read receipts in realtime

## Summary
The chat now shows delivery ticks on the sender's messages: one tick once the
message is recorded, a second tick once the other person opens the
conversation. The data to drive this already exists — `conversation_members`
stores each person's `last_read_at`, and `mark_conversation_read` updates it
when someone opens a thread. What was missing is the live broadcast of those
updates to the other person's open chat window.

## Changes
1. Modified tables
   - `conversation_members`: set `REPLICA IDENTITY FULL` and added to the
     `supabase_realtime` publication, exactly as `messages` already is. This
     makes Postgres broadcast UPDATE events on membership rows (the read
     marker) to realtime subscribers.

## Security
- No policies, privileges, or functions change. Realtime already enforces each
  subscriber's row visibility using the table's SELECT policy: a user only ever
  receives read-marker updates for conversations they are a member of, and only
  sees the member rows that policy already allows. `REPLICA IDENTITY FULL` is
  what allows that policy check to run against the full row.

## Notes
- The client listens for UPDATE events on this table and compares the other
  person's `last_read_at` against message timestamps to decide one tick vs two.
- Idempotent: re-adding a table to the publication raises `duplicate_object`,
  which is caught and ignored.
*/

ALTER TABLE conversation_members REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE conversation_members;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
