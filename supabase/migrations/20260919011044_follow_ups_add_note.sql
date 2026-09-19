/*
# Follow-ups: add note column

The existing follow_ups table has: id, connection_id, owner_id, title,
due_date, completed, completed_at, created_at.

This migration adds a `note` column so follow-ups can carry a
free-text note (the context/description of the follow-up), which is
needed by the dedicated Follow-ups page.

No RLS changes needed — existing owner-scoped CRUD policies on
follow_ups already enforce that users can only access their own
follow-ups.
*/

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS note text DEFAULT '';
