import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarRange, Check, ChevronRight } from 'lucide-react'
import { supabase, type EventSession } from '@/lib/supabase'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { SessionRow, SessionDetailDialog } from '@/components/eventmode/SessionRow'
import { listMySavedSessionIds, saveEventSession, removeEventSession } from '@/lib/schedule'
import {
  dayKey,
  formatDayChip,
  formatDayHeading,
} from '@/lib/sessionTime'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { cn } from '@/lib/utils'

// Event Mode Agenda: chronological schedule from event_sessions, with the
// attendee's personal "My Schedule" save action on each session. Saved state
// comes from the backend (get_my_saved_session_ids) and is loaded together
// with the sessions themselves, so a saved session never flashes as unsaved.

function AgendaSkeleton() {
  return (
    <div className="mt-4 space-y-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="h-10 w-20 shrink-0 animate-pulse rounded bg-gray-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function EventAgendaPage() {
  const { event, eventBasePath } = useEventModeOutlet()
  const [sessions, setSessions] = useState<EventSession[] | null>(null)
  // null until the backend has answered: action buttons stay hidden so an
  // already-saved session is never shown as "Add to My Schedule" first.
  const [savedIds, setSavedIds] = useState<Set<string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [detailSession, setDetailSession] = useState<EventSession | null>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // The timezone the agenda is presented in. Undefined means the browser's
  // default zone — used only when the event has no timezone set, which the
  // page then discloses instead of inventing an abbreviation.
  const timeZone = event.timezone || undefined

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setActionError(null)
    Promise.all([
      supabase
        .from('event_sessions')
        .select('*')
        .eq('event_id', event.id)
        .order('start_at', { ascending: true })
        .order('display_order', { ascending: true }),
      listMySavedSessionIds(event.id),
    ]).then(([sessionsRes, savedRes]) => {
      if (cancelled) return
      if (sessionsRes.error) {
        setError('Could not load the agenda. Please try again.')
        setSessions(null)
        setSavedIds(null)
      } else if (savedRes.error) {
        setError(savedRes.error)
        setSessions(null)
        setSavedIds(null)
      } else {
        setSessions((sessionsRes.data ?? []) as EventSession[])
        setSavedIds(savedRes.data)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [event.id])

  // The NOW marker only needs minute-level freshness.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const days = useMemo(() => {
    if (!sessions) return []
    const unique = new Map<string, Date>()
    for (const s of sessions) {
      const key = dayKey(new Date(s.start_at), timeZone)
      if (!unique.has(key)) unique.set(key, new Date(s.start_at))
    }
    return Array.from(unique.entries(), ([key, date]) => ({ key, date })).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    )
  }, [sessions, timeZone])

  useEffect(() => {
    if (days.length === 0) {
      setSelectedDay(null)
      return
    }
    if (selectedDay && days.some((d) => d.key === selectedDay)) return
    const todayKey = dayKey(new Date(), timeZone)
    setSelectedDay(days.some((d) => d.key === todayKey) ? todayKey : days[0].key)
  }, [days, selectedDay, timeZone])

  const daySessions = useMemo(() => {
    if (!sessions || !selectedDay) return []
    return sessions
      .filter((s) => dayKey(new Date(s.start_at), timeZone) === selectedDay)
      .sort((a, b) => {
        const byStart = new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
        return byStart !== 0 ? byStart : a.display_order - b.display_order
      })
  }, [sessions, selectedDay, timeZone])

  const dayDate = days.find((d) => d.key === selectedDay)?.date ?? null

  // Optimistic toggle with server authority: the state changes immediately,
  // and a failed call reverts it so a session is never falsely marked Saved.
  // The pending set also swallows rapid double taps.
  async function toggleSaved(session: EventSession) {
    if (!savedIds || pendingIds.has(session.id)) return
    const wasSaved = savedIds.has(session.id)
    setPendingIds((prev) => new Set(prev).add(session.id))
    setActionError(null)
    setSavedIds((prev) => {
      const next = new Set(prev ?? [])
      if (wasSaved) next.delete(session.id)
      else next.add(session.id)
      return next
    })
    const { error: err } = wasSaved
      ? await removeEventSession(session.id)
      : await saveEventSession(session.id)
    setPendingIds((prev) => {
      const next = new Set(prev)
      next.delete(session.id)
      return next
    })
    if (err) {
      setSavedIds((prev) => {
        const next = new Set(prev ?? [])
        if (wasSaved) next.add(session.id)
        else next.delete(session.id)
        return next
      })
      setActionError(
        wasSaved
          ? 'Could not remove that session. Please try again.'
          : 'Could not save that session. Please try again.'
      )
    }
  }

  function saveAction(session: EventSession) {
    if (!savedIds) return null
    const isSaved = savedIds.has(session.id)
    const pending = pendingIds.has(session.id)
    return (
      <Button
        size="sm"
        variant={isSaved ? 'outline' : 'secondary'}
        disabled={pending}
        onClick={(e) => {
          e.stopPropagation()
          void toggleSaved(session)
        }}
        aria-label={
          isSaved
            ? `Remove "${session.title}" from My Schedule`
            : `Add "${session.title}" to My Schedule`
        }
        className={cn('whitespace-nowrap', isSaved && 'text-primary-700')}
      >
        {pending ? 'Saving…' : isSaved ? '✓ Saved' : '+ My Schedule'}
      </Button>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6 md:py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 md:text-2xl">Agenda</h1>
          <p className="mt-0.5 text-sm text-gray-500">{event.name}</p>
        </div>
        <Link
          to={`${eventBasePath}/schedule`}
          className="mt-1 flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
        >
          My Schedule
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
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

      {loading && <AgendaSkeleton />}

      {!loading && error && (
        <div className="mt-4">
          <Card>
            <CardContent>
              <ErrorState message={error} onRetry={() => window.location.reload()} />
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && !error && sessions && sessions.length === 0 && (
        <div className="mt-4">
          <Card>
            <CardContent>
              <EmptyState
                icon={<CalendarRange className="h-10 w-10" />}
                title="No sessions yet"
                description="No sessions have been added to this event yet."
                action={
                  <a
                    href={eventBasePath}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    Back to event home
                  </a>
                }
              />
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && !error && sessions && sessions.length > 0 && (
        <>
          {days.length > 1 && (
            <div
              className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
              role="tablist"
              aria-label="Agenda days"
            >
              {days.map(({ key, date }) => {
                const chip = formatDayChip(date, timeZone)
                const isSel = key === selectedDay
                return (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={isSel}
                    onClick={() => setSelectedDay(key)}
                    className={cn(
                      'flex min-h-[44px] shrink-0 flex-col items-center justify-center rounded-lg border px-4 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                      isSel
                        ? 'border-primary-600 bg-primary-600 text-white'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-primary-300 hover:text-gray-900'
                    )}
                  >
                    <span className={cn('text-[11px] font-medium uppercase', isSel ? 'text-primary-100' : 'text-gray-400')}>
                      {chip.weekday}
                    </span>
                    <span className={cn('text-sm font-semibold', isSel ? 'text-white' : 'text-gray-900')}>
                      {chip.day}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {dayDate && (
            <h2 className="mt-4 text-sm font-semibold text-gray-900">
              {formatDayHeading(dayDate, timeZone)}
            </h2>
          )}

          {daySessions.length === 0 ? (
            <div className="mt-2">
              <Card>
                <CardContent>
                  <EmptyState
                    title="Nothing scheduled"
                    description="No sessions scheduled for this day."
                  />
                </CardContent>
              </Card>
            </div>
          ) : (
            <ol className="mt-3 space-y-2">
              {daySessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  timeZone={timeZone}
                  now={now}
                  onOpen={() => setDetailSession(session)}
                  action={saveAction(session)}
                />
              ))}
            </ol>
          )}
        </>
      )}

      {detailSession && (
        <SessionDetailDialog
          session={detailSession}
          timeZone={timeZone}
          eventName={event.name}
          onClose={() => setDetailSession(null)}
          footer={
            savedIds ? (
              <div className="space-y-2">
                {savedIds.has(detailSession.id) && (
                  <p className="flex items-center gap-1.5 text-sm font-medium text-primary-700">
                    <Check className="h-4 w-4" aria-hidden="true" /> Saved to My Schedule
                  </p>
                )}
                <Button
                  variant={savedIds.has(detailSession.id) ? 'secondary' : 'primary'}
                  className="w-full"
                  disabled={pendingIds.has(detailSession.id)}
                  onClick={() => void toggleSaved(detailSession)}
                  aria-label={
                    savedIds.has(detailSession.id)
                      ? `Remove "${detailSession.title}" from My Schedule`
                      : `Add "${detailSession.title}" to My Schedule`
                  }
                >
                  {pendingIds.has(detailSession.id)
                    ? 'Saving…'
                    : savedIds.has(detailSession.id)
                      ? 'Remove from My Schedule'
                      : 'Add to My Schedule'}
                </Button>
              </div>
            ) : null
          }
        />
      )}
    </div>
  )
}
