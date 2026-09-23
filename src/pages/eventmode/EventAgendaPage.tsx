import { useEffect, useMemo, useState } from 'react'
import { CalendarRange, MapPin, X } from 'lucide-react'
import { supabase, type EventSession } from '@/lib/supabase'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { cn } from '@/lib/utils'

// Event Mode Agenda: read-only chronological schedule from event_sessions.
// Times render in the event's timezone when set; when it is not, times are
// shown without any timezone label and the page says so rather than guessing.

const DAY_KEY_TZ_FALLBACK = undefined

function dayKey(date: Date, timeZone: string | undefined): string {
  // en-CA gives a stable YYYY-MM-DD wall-clock date for grouping.
  return date.toLocaleDateString('en-CA', { timeZone })
}

function formatTime(date: Date, timeZone: string | undefined): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
}

function formatRange(start: Date, end: Date | null, timeZone: string | undefined): string {
  if (!end || end.getTime() === start.getTime()) return formatTime(start, timeZone)
  return `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)}`
}

function formatDayChip(date: Date, timeZone: string | undefined): { weekday: string; day: string } {
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'short', timeZone }),
    day: date.toLocaleDateString('en-US', { day: 'numeric', timeZone }),
  }
}

function formatDayHeading(date: Date, timeZone: string | undefined): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  })
}

function isSessionLive(session: EventSession, now: number): boolean {
  if (session.status === 'cancelled') return false
  if (!session.end_at) return false
  const start = new Date(session.start_at).getTime()
  const end = new Date(session.end_at).getTime()
  return now >= start && now < end
}

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

function SessionDetail({
  session,
  timeZone,
  eventName,
  onClose,
}: {
  session: EventSession
  timeZone: string | undefined
  eventName: string
  onClose: () => void
}) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const start = new Date(session.start_at)
  const end = session.end_at ? new Date(session.end_at) : null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={session.title}>
      <button className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[80vh] md:w-[32rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 md:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold leading-snug text-gray-900">{session.title}</h2>
          <button
            onClick={onClose}
            aria-label="Close session details"
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-400">{eventName}</p>

        <dl className="mt-4 space-y-2.5 border-t border-gray-200 pt-4 text-sm">
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-gray-500">Time</dt>
            <dd className="font-medium text-gray-900">
              {formatRange(start, end, timeZone)}
              {end ? '' : ' (start time)'}
            </dd>
          </div>
          {session.location && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-gray-500">Venue</dt>
              <dd className="text-gray-900">{session.location}</dd>
            </div>
          )}
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-gray-500">Day</dt>
            <dd className="text-gray-900">{formatDayHeading(start, timeZone)}</dd>
          </div>
          {session.session_type && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-gray-500">Type</dt>
              <dd className="capitalize text-gray-900">{session.session_type}</dd>
            </div>
          )}
        </dl>

        {session.description && (
          <p className="mt-4 whitespace-pre-wrap border-t border-gray-200 pt-4 text-sm leading-relaxed text-gray-600">
            {session.description}
          </p>
        )}
      </div>
    </div>
  )
}

export default function EventAgendaPage() {
  const { event, eventBasePath } = useEventModeOutlet()
  const [sessions, setSessions] = useState<EventSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [detailSession, setDetailSession] = useState<EventSession | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // The timezone the agenda is presented in. Undefined means the browser's
  // default zone — used only when the event has no timezone set, which the
  // page then discloses instead of inventing an abbreviation.
  const timeZone = event.timezone || DAY_KEY_TZ_FALLBACK

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase
      .from('event_sessions')
      .select('*')
      .eq('event_id', event.id)
      .order('start_at', { ascending: true })
      .order('display_order', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError('Could not load the agenda. Please try again.')
          setSessions(null)
        } else {
          setSessions((data ?? []) as EventSession[])
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6 md:py-6">
      <h1 className="text-xl font-bold text-gray-900 md:text-2xl">Agenda</h1>
      <p className="mt-0.5 text-sm text-gray-500">{event.name}</p>
      {!event.timezone && (
        <p className="mt-1 text-xs text-gray-400">
          Event timezone not set — times shown in your device's timezone.
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
              {daySessions.map((session) => {
                const live = isSessionLive(session, now)
                const cancelled = session.status === 'cancelled'
                const start = new Date(session.start_at)
                const end = session.end_at ? new Date(session.end_at) : null
                return (
                  <li key={session.id}>
                    <button
                      onClick={() => setDetailSession(session)}
                      aria-label={`Session details: ${session.title}`}
                      className={cn(
                        'flex w-full items-stretch gap-4 rounded-lg border bg-white p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                        live ? 'border-primary-600' : 'border-gray-200 hover:border-primary-300'
                      )}
                    >
                      <div className="w-24 shrink-0">
                        <p className={cn('text-sm font-semibold', live ? 'text-primary-600' : 'text-gray-900')}>
                          {formatTime(start, timeZone)}
                        </p>
                        {end && end.getTime() !== start.getTime() && (
                          <p className="text-xs text-gray-400">{formatTime(end, timeZone)}</p>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 border-l border-gray-100 pl-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3
                            className={cn(
                              'text-sm font-semibold leading-snug text-gray-900',
                              cancelled && 'text-gray-400 line-through'
                            )}
                          >
                            {session.title}
                          </h3>
                          {live && (
                            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-700">
                              Now
                            </span>
                          )}
                          {cancelled && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                              Cancelled
                            </span>
                          )}
                          {!live && !cancelled && session.session_type && session.session_type !== 'session' && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium capitalize text-gray-600">
                              {session.session_type}
                            </span>
                          )}
                        </div>
                        {session.location && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{session.location}</span>
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </>
      )}

      {detailSession && (
        <SessionDetail
          session={detailSession}
          timeZone={timeZone}
          eventName={event.name}
          onClose={() => setDetailSession(null)}
        />
      )}
    </div>
  )
}
