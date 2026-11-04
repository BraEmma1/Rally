import type { OrganizerEvent } from './supabase'

// Which events a manager's access can be changed on, and how. The database is
// the authority (assign_event_manager refuses archived events and non-managers);
// this only decides what the Team page offers, so it never shows a button that
// is certain to fail.

export type EventAssignmentRow = {
  event: OrganizerEvent
  assigned: boolean
  // New assignments are refused for archived events.
  canAssign: boolean
  // Removal is always allowed, including on an archived event, so a manager is
  // never stuck with access to something frozen.
  canRemove: boolean
}

// Assigned events first, then the rest by start date. An archived event is only
// listed while the manager still holds it, so the list never offers a dead end.
export function eventAssignmentRows(
  events: OrganizerEvent[],
  assignedEventIds: ReadonlySet<string>
): EventAssignmentRow[] {
  const rows: EventAssignmentRow[] = []
  for (const event of events) {
    const assigned = assignedEventIds.has(event.id)
    const archived = event.archived_at !== null
    if (archived && !assigned) continue
    rows.push({ event, assigned, canAssign: !archived && !assigned, canRemove: assigned })
  }
  return rows.sort((a, b) => {
    if (a.assigned !== b.assigned) return a.assigned ? -1 : 1
    return (a.event.start_date ?? '9999-12-31').localeCompare(b.event.start_date ?? '9999-12-31')
  })
}
