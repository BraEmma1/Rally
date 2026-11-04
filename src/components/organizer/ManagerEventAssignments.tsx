import { useMemo, useState } from 'react'
import { CalendarRange, Check } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { assignEventManager, unassignEventManager } from '@/lib/organizer'
import { eventAssignmentRows } from '@/lib/eventAssignment'
import { eventLifecycle, formatEventDate, LIFECYCLE_BADGE, LIFECYCLE_LABELS } from '@/lib/events'
import type { OrganizerEvent } from '@/lib/supabase'

// Which events one manager can work on. A manager reaches exactly the events
// listed here, so this is the only way to give them any access. Rendered only
// for members whose role is "manager" and only to callers who manage the team;
// the database refuses everyone else regardless.
export function ManagerEventAssignments({
  userId,
  memberName,
  events,
  assignedEventIds,
  eventsError,
  onChanged,
}: {
  userId: string
  memberName: string
  events: OrganizerEvent[]
  // null: the assignments themselves could not be loaded.
  assignedEventIds: string[] | null
  eventsError: string | null
  onChanged: () => Promise<void>
}) {
  const [busyEventId, setBusyEventId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rows = useMemo(
    () => eventAssignmentRows(events, new Set(assignedEventIds ?? [])),
    [events, assignedEventIds]
  )

  const unavailable = eventsError !== null || assignedEventIds === null
  const who = memberName || 'This member'

  async function change(event: OrganizerEvent, assign: boolean) {
    setBusyEventId(event.id)
    setError(null)
    setNotice(null)
    const { error: changeError } = assign
      ? await assignEventManager(event.id, userId)
      : await unassignEventManager(event.id, userId)
    if (changeError) {
      setError(changeError)
    } else {
      setNotice(assign ? `${who} can now manage ${event.name}.` : `${who} no longer manages ${event.name}.`)
      await onChanged()
    }
    setBusyEventId(null)
  }

  return (
    <section aria-labelledby="event-access-heading" className="border-t border-gray-200 pt-4">
      <h3 id="event-access-heading" className="text-sm font-semibold text-gray-900">
        Event access
      </h3>
      <p className="mt-0.5 text-xs text-gray-500">
        {who} can only open the events assigned here. Archived events cannot be assigned.
      </p>

      {error && (
        <div className="mt-3 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-success-50 px-3 py-2 text-sm text-success-700" role="status">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          {notice}
        </div>
      )}

      {unavailable ? (
        <p className="mt-3 text-sm text-gray-500">
          {eventsError ?? 'Event assignments could not be loaded. Close this and try again.'}
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
          <CalendarRange className="h-4 w-4 shrink-0" aria-hidden="true" />
          No events to assign yet. Create an event first.
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-200">
          {rows.map(({ event, assigned, canAssign, canRemove }) => {
            const lifecycle = eventLifecycle(event)
            const busy = busyEventId === event.id
            return (
              <li key={event.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{event.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-500">{formatEventDate(event)}</span>
                    <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
                    {assigned && <Badge variant="success">Assigned</Badge>}
                  </div>
                </div>
                {canRemove ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyEventId !== null}
                    onClick={() => void change(event, false)}
                    aria-label={`Remove ${who} from ${event.name}`}
                  >
                    {busy ? 'Removing…' : 'Remove'}
                  </Button>
                ) : canAssign ? (
                  <Button
                    size="sm"
                    disabled={busyEventId !== null}
                    onClick={() => void change(event, true)}
                    aria-label={`Assign ${who} to ${event.name}`}
                  >
                    {busy ? 'Assigning…' : 'Assign'}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
