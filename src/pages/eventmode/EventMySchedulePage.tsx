import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookmarkX } from 'lucide-react'
import {
  listMyEventSchedule,
  removeEventSession,
  scheduleEntryToSession,
  type ScheduleEntry,
} from '@/lib/schedule'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { SessionRow, SessionDetailDialog } from '@/components/eventmode/SessionRow'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { dayKey, formatDayHeading } from '@/lib/sessionTime'

// Event Mode "My Schedule": the attendee's personally saved sessions, loaded
// through get_my_event_schedule. Personal by contract — the RPC derives the
// user server-side, so no other attendee's bookmarks can ever appear here.

export default function EventMySchedulePage() {
  const { event } = useEventModeOutlet()
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [detailSession, setDetailSession] = useState<ScheduleEntry | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const timeZone = event.timezone || undefined

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await listMyEventSchedule(event.id)
    if (err) {
      setError(err)
      setEntries(null)
    } else {
      setEntries(data)
    }
    setLoading(false)
  }, [event.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const days = useMemo(() => {
    if (!entries) return []
    const unique = new Map<string, Date>()
    for (const e of entries) {
      const key = dayKey(new Date(e.start_at), timeZone)
      if (!unique.has(key)) unique.set(key, new Date(e.start_at))
    }
    return Array.from(unique.entries(), ([key, date]) => ({ key, date })).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    )
  }, [entries, timeZone])

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>()
    for (const e of entries ?? []) {
      const key = dayKey(new Date(e.start_at), timeZone)
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const byStart = new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
        return byStart !== 0 ? byStart : a.display_order - b.display_order
      })
    }
    return map
  }, [entries, timeZone])

  async function handleRemove(entry: ScheduleEntry) {
    setRemovingId(entry.session_id)
    setActionError(null)
    const { error: err } = await removeEventSession(entry.session_id)
    setRemovingId(null)
    if (err) {
      // Server stays authoritative: on failure the row remains listed.
      setActionError(err)
      return
    }
    setEntries((prev) => (prev ? prev.filter((e) => e.session_id !== entry.session_id) : prev))
    if (detailSession?.session_id === entry.session_id) setDetailSession(null)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6 md:py-6">
      <h1 className="text-xl font-bold text-gray-900 md:text-2xl">My Schedule</h1>
      <p className="mt-0.5 text-sm text-gray-500">{event.name}</p>
      {!event.timezone && (
        <p className="mt-1 text-xs text-gray-400">
          Event timezone not set — times shown in your device's timezone.
        </p>
      )}

      {actionError && (
        <p className="mt-3 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {actionError}
        </p>
      )}

      {loading && (
        <div className="mt-4 space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4">
              <div className="h-10 w-20 shrink-0 animate-pulse rounded bg-gray-100" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="mt-4">
          <Card>
            <CardContent>
              <ErrorState message={error} onRetry={() => void load()} />
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && !error && entries && entries.length === 0 && (
        <div className="mt-4">
          <Card>
            <CardContent>
              <EmptyState
                icon={<BookmarkX className="h-10 w-10" />}
                title="Your schedule is empty"
                description="Save sessions from the Agenda to build your personal event schedule."
                action={
                  <Link
                    to="agenda"
                    relative="path"
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    Browse Agenda
                  </Link>
                }
              />
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && !error && entries && entries.length > 0 && (
        <div className="mt-4 space-y-5">
          {days.map(({ key, date }) => (
            <section key={key}>
              {days.length > 1 && (
                <h2 className="text-sm font-semibold text-gray-900">
                  {formatDayHeading(date, timeZone)}
                </h2>
              )}
              <ol className={days.length > 1 ? 'mt-2 space-y-2' : 'space-y-2'}>
                {(byDay.get(key) ?? []).map((entry) => (
                  <SessionRow
                    key={entry.session_id}
                    session={scheduleEntryToSession(entry)}
                    timeZone={timeZone}
                    now={now}
                    onOpen={() => setDetailSession(entry)}
                    action={
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={removingId === entry.session_id}
                        onClick={() => void handleRemove(entry)}
                        aria-label={`Remove ${entry.title} from My Schedule`}
                      >
                        {removingId === entry.session_id ? 'Removing…' : 'Remove'}
                      </Button>
                    }
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {detailSession && (
        <SessionDetailDialog
          session={scheduleEntryToSession(detailSession)}
          timeZone={timeZone}
          eventName={event.name}
          onClose={() => setDetailSession(null)}
          footer={
            <Button
              variant="secondary"
              className="w-full"
              disabled={removingId === detailSession.session_id}
              onClick={() => void handleRemove(detailSession)}
            >
              {removingId === detailSession.session_id
                ? 'Removing…'
                : 'Remove from My Schedule'}
            </Button>
          }
        />
      )}
    </div>
  )
}
