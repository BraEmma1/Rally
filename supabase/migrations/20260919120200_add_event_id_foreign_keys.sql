/*
# PHASE 1 (additive) — link connections and opportunities to events by id

Fully additive: new nullable columns plus a backfill. The previous frontend
ignores them and keeps matching on event_name, so this is safe to apply at any
time.

## Problem
"Which event did this come from" was free text in `connections.event_name` and
`opportunities.event_name`, matched with `.eq('event_name', event.name)`.
Renaming an event, a typo in a hand-typed name, or two events sharing a name
silently breaks the association and any event-level reporting built on it.

## Backfill
Matches event_name against events.name, case- and whitespace-insensitive, with
ties broken deterministically by created_at then id. Opportunities that still
have no match inherit event_id from their parent connection.
(Verified before writing: all 7 connections and all 7 opportunities carrying an
event_name match exactly one event, and no two events share a name.)

## event_name is kept
It still carries hand-typed event names for contacts added manually, where no
catalog event exists to point at.
*/

ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE SET NULL;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_connections_event_id ON connections(event_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_event_id ON opportunities(event_id);

UPDATE connections c
SET event_id = (
  SELECT e.id FROM events e
  WHERE lower(btrim(e.name)) = lower(btrim(c.event_name))
  ORDER BY e.created_at ASC, e.id ASC
  LIMIT 1
)
WHERE c.event_id IS NULL
  AND COALESCE(btrim(c.event_name), '') <> '';

UPDATE opportunities o
SET event_id = (
  SELECT e.id FROM events e
  WHERE lower(btrim(e.name)) = lower(btrim(o.event_name))
  ORDER BY e.created_at ASC, e.id ASC
  LIMIT 1
)
WHERE o.event_id IS NULL
  AND COALESCE(btrim(o.event_name), '') <> '';

UPDATE opportunities o
SET event_id = c.event_id
FROM connections c
WHERE o.connection_id = c.id
  AND o.event_id IS NULL
  AND c.event_id IS NOT NULL;
