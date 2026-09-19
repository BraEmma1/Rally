/*
# Link connections and opportunities to events by id, not by name

## Problem
"Which event did this connection come from" was stored as free text in
`connections.event_name` and `opportunities.event_name`, and matched with
`.eq('event_name', event.name)`. Renaming an event, a typo in a manually typed
name, or two events sharing a name silently breaks the association — and any
event-level reporting built on top of it.

## Changes
1. Add nullable `event_id uuid REFERENCES events(id) ON DELETE SET NULL` to
   `connections` and `opportunities`, with indexes.
2. Backfill:
   a. Match `event_name` against `events.name`, case- and whitespace-insensitive.
      Ties are broken deterministically by `created_at`, then `id`.
   b. For opportunities still unmatched, inherit `event_id` from their parent
      connection.
3. `event_name` is retained. It still carries manually typed event names for
   contacts added by hand (no catalog event exists for those), and keeps older
   rows rendering while data is migrated.

## Security
No policy changes needed: both tables are already owner-scoped, and `event_id`
only ever points at rows in the publicly readable `events` catalog.
*/

-- ============================================================================
-- 1. Columns
-- ============================================================================
ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE SET NULL;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_connections_event_id ON connections(event_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_event_id ON opportunities(event_id);

-- ============================================================================
-- 2a. Backfill from event_name
-- ============================================================================
UPDATE connections c
SET event_id = (
  SELECT e.id
  FROM events e
  WHERE lower(btrim(e.name)) = lower(btrim(c.event_name))
  ORDER BY e.created_at ASC, e.id ASC
  LIMIT 1
)
WHERE c.event_id IS NULL
  AND COALESCE(btrim(c.event_name), '') <> '';

UPDATE opportunities o
SET event_id = (
  SELECT e.id
  FROM events e
  WHERE lower(btrim(e.name)) = lower(btrim(o.event_name))
  ORDER BY e.created_at ASC, e.id ASC
  LIMIT 1
)
WHERE o.event_id IS NULL
  AND COALESCE(btrim(o.event_name), '') <> '';

-- ============================================================================
-- 2b. Opportunities inherit from their connection where still unresolved
-- ============================================================================
UPDATE opportunities o
SET event_id = c.event_id
FROM connections c
WHERE o.connection_id = c.id
  AND o.event_id IS NULL
  AND c.event_id IS NOT NULL;
