import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BookmarkCheck,
  CalendarPlus,
  CalendarRange,
  Check,
  ChevronRight,
  ExternalLink,
  FileDown,
  MapPin,
  Search,
} from 'lucide-react'
import { supabase, type EventSession } from '@/lib/supabase'
import { SESSION_TYPE_LABELS } from '@/lib/events'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { SessionRow, SessionDetailDialog } from '@/components/eventmode/SessionRow'
import { listMySavedSessionIds, saveEventSession, removeEventSession } from '@/lib/schedule'
import { listSessionSpeakers, type SessionSpeaker } from '@/lib/speakers'
import { buildSessionsIcs, downloadIcs } from '@/lib/ics'
import { dayKey, formatDayHeading, formatRange } from '@/lib/sessionTime'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ComingSoonBadge, ComingSoonButton } from '@/components/events/ComingSoon'
import { cn } from '@/lib/utils'

// Event Mode Agenda: chronological schedule from event_sessions, with the
// attendee's personal "My Schedule" save action on each session. Saved state
// comes from the backend (get_my_saved_session_ids) and is loaded together
// with the sessions themselves, so a saved session never flashes as unsaved.
// Layout follows the Rally Event UI "Agenda & Schedule" design; search and the
// type filter work on the loaded sessions, nothing is invented.

function AgendaSkeleton() {
  return (
    <div className="mt-4 space-y-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-rally-line bg-white p-5">
          <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="h-5 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

// "In 25 mins" / "In 3 hrs" until a moment, for the next-session alert.
function untilLabel(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000))
  return mins >= 120 ? `In ${Math.round(mins / 60)} hrs` : `In ${mins} mins`
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
}

export default function EventAgendaPage({
  switcher,
  onCounts,
}: {
  // The Agenda / Schedule switch, rendered by the page that hosts both views.
  switcher?: ReactNode
  onCounts?: (c: { agenda?: number; saved?: number }) => void
}) {
  const { event, eventBasePath } = useEventModeOutlet()
  const [sessions, setSessions] = useState<EventSession[] | null>(null)
  // null until the backend has answered: action buttons stay hidden so an
  // already-saved session is never shown as "Add to My Schedule" first.
  const [savedIds, setSavedIds] = useState<Set<string> | null>(null)
  const [speakersBySession, setSpeakersBySession] = useState<Record<string, SessionSpeaker[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [detailSession, setDetailSession] = useState<EventSession | null>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

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
      listSessionSpeakers(event.id),
    ]).then(([sessionsRes, savedRes, speakerRes]) => {
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
        setSpeakersBySession(
          speakerRes.data.reduce<Record<string, typeof speakerRes.data>>((acc, s) => {
            ;(acc[s.session_id] ??= []).push(s)
            return acc
          }, {})
        )
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
    const unique = new Map<string, { date: Date; count: number }>()
    for (const s of sessions) {
      const key = dayKey(new Date(s.start_at), timeZone)
      const cur = unique.get(key)
      if (cur) cur.count += 1
      else unique.set(key, { date: new Date(s.start_at), count: 1 })
    }
    return Array.from(unique.entries(), ([key, v]) => ({ key, date: v.date, count: v.count })).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    )
  }, [sessions, timeZone])

  const todayKey = dayKey(new Date(now), timeZone)

  useEffect(() => {
    onCounts?.({ agenda: sessions?.length, saved: savedIds?.size })
  }, [sessions, savedIds, onCounts])

  useEffect(() => {
    if (days.length === 0) {
      setSelectedDay(null)
      return
    }
    if (selectedDay && days.some((d) => d.key === selectedDay)) return
    setSelectedDay(days.some((d) => d.key === todayKey) ? todayKey : days[0].key)
  }, [days, selectedDay, todayKey])

  const typesPresent = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of sessions ?? []) {
      if (s.session_type) counts.set(s.session_type, (counts.get(s.session_type) ?? 0) + 1)
    }
    return Array.from(counts.entries())
  }, [sessions])

  const needle = query.trim().toLowerCase()
  const matches = (s: EventSession) => {
    if (typeFilter !== 'all' && s.session_type !== typeFilter) return false
    if (!needle) return true
    const speakerNames = (speakersBySession[s.id] ?? []).map((sp) => sp.full_name).join(' ')
    return `${s.title} ${s.description} ${s.location} ${speakerNames}`.toLowerCase().includes(needle)
  }

  const daySessions = useMemo(() => {
    if (!sessions || !selectedDay) return []
    return sessions
      .filter((s) => dayKey(new Date(s.start_at), timeZone) === selectedDay)
      .sort((a, b) => {
        const byStart = new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
        return byStart !== 0 ? byStart : a.display_order - b.display_order
      })
  }, [sessions, selectedDay, timeZone])

  const visibleSessions = daySessions.filter(matches)
  const dayDate = days.find((d) => d.key === selectedDay)?.date ?? null

  const savedSessions = useMemo(
    () =>
      (sessions ?? [])
        .filter((s) => savedIds?.has(s.id))
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()),
    [sessions, savedIds]
  )
  const nextSaved = savedSessions.find((s) => new Date(s.end_at ?? s.start_at).getTime() > now)
  const savedToday = savedSessions.filter((s) => dayKey(new Date(s.start_at), timeZone) === selectedDay)

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

  function syncCalendar() {
    const ics = buildSessionsIcs(`${event.name} - My Schedule`, savedSessions)
    if (ics) downloadIcs(`${slug(event.name)}-my-schedule.ics`, ics)
  }

  function saveAction(session: EventSession) {
    if (!savedIds) return null
    const isSaved = savedIds.has(session.id)
    const pending = pendingIds.has(session.id)
    return (
      <Button
        size="lg"
        variant={isSaved ? 'primary' : 'outline'}
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
        className="whitespace-nowrap rounded-xl"
      >
        {isSaved ? <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> : null}
        {pending ? 'Saving…' : isSaved ? 'In your schedule' : '+ Add to Schedule'}
      </Button>
    )
  }

  const mapsUrl = event.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`
    : null

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6">
      {/* Header card */}
      <div className="rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {event.location && (
              <p className="hidden items-center md:flex gap-2 text-xs font-semibold uppercase tracking-wider text-primary-700">
                <span className="h-2 w-2 rounded-full bg-primary-600" aria-hidden="true" />
                <span className="truncate">{event.location}</span>
              </p>
            )}
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-rally-navy md:text-3xl">
              Agenda &amp; Schedule
            </h1>
            <p className="mt-1.5 hidden max-w-xl md:block text-sm text-rally-muted md:text-base">
              {sessions && sessions.length > 0
                ? `Explore ${sessions.length} session${sessions.length === 1 ? '' : 's'} across ${days.length} day${days.length === 1 ? '' : 's'} at ${event.name}.`
                : event.name}
            </p>
            {!event.timezone && (
              <p className="mt-1 text-xs text-slate-400">
                Event timezone not set — times shown in your device's timezone.
              </p>
            )}
          </div>
          <div className="hidden flex-wrap md:flex gap-2 lg:justify-end">
            <ComingSoonButton size="lg" variant="secondary">
              <FileDown className="h-4 w-4" aria-hidden="true" /> Download PDF Program
            </ComingSoonButton>
            <Button
              size="lg"
              className="rounded-xl"
              onClick={syncCalendar}
              disabled={savedSessions.length === 0}
              title={savedSessions.length === 0 ? 'Save sessions first, then add them to your calendar' : undefined}
            >
              <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Sync Calendar
            </Button>
          </div>
        </div>

        {switcher}

        {/* Day selector: "Day 1" and its session count. The full date is the heading above the list. */}
        {days.length > 0 && (
          <div
            className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Agenda days"
          >
            {days.map(({ key, count }, i) => {
              const isSel = key === selectedDay
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={isSel}
                  onClick={() => setSelectedDay(key)}
                  className={cn(
                    'flex min-h-[64px] min-w-[7rem] flex-1 shrink-0 flex-col items-center justify-center rounded-2xl border px-4 py-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                    isSel
                      ? 'border-primary-600 bg-primary-600 text-white shadow-card'
                      : 'border-rally-line bg-white text-rally-navy hover:border-primary-300'
                  )}
                >
                  <span className="font-display text-base font-bold leading-tight">Day {i + 1}</span>
                  <span className={cn('mt-0.5 text-xs', isSel ? 'text-white/85' : 'text-slate-500')}>
                    {count} session{count === 1 ? '' : 's'}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Search + type filter */}
        {sessions && sessions.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative block lg:w-72">
              <span className="sr-only">Search sessions</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sessions, topics, speakers…"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-rally-tint"
              />
            </label>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-1 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden" role="group" aria-label="Session type">
              {[['all', 'All sessions', sessions.length] as const, ...typesPresent.map(([t, n]) => [t, SESSION_TYPE_LABELS[t] ?? t, n] as const)].map(
                ([t, label, n]) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={typeFilter === t}
                    onClick={() => setTypeFilter(t)}
                    className={cn(
                      'min-h-[44px] shrink-0 rounded-xl border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                      typeFilter === t
                        ? 'border-primary-600 bg-primary-600 text-white'
                        : 'border-rally-line bg-white text-rally-muted hover:border-primary-300 hover:text-rally-navy'
                    )}
                  >
                    {label} <span className={typeFilter === t ? 'text-white/80' : 'text-slate-400'}>({n})</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {actionError && (
        <p className="mt-4 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700" role="alert">
          {actionError}
        </p>
      )}

      {loading && <AgendaSkeleton />}

      {!loading && error && (
        <div className="mt-4 rounded-2xl border border-rally-line bg-white shadow-card">
          <ErrorState message={error} onRetry={() => window.location.reload()} />
        </div>
      )}

      {!loading && !error && sessions && sessions.length === 0 && (
        <div className="mt-4 rounded-2xl border border-rally-line bg-white shadow-card">
          <EmptyState
            icon={<CalendarRange className="h-10 w-10" />}
            title="No sessions yet"
            description="No sessions have been added to this event yet."
            action={
              <Link to={`${eventBasePath}/home`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary-700 hover:text-primary-800">
                Back to event home
              </Link>
            }
          />
        </div>
      )}

      {!loading && !error && sessions && sessions.length > 0 && (
        <div className="mt-5 grid gap-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
            {dayDate && (
              <h2 className="mb-3 font-display text-lg font-semibold text-rally-navy">
                {formatDayHeading(dayDate, timeZone)}
              </h2>
            )}
            {visibleSessions.length === 0 ? (
              <div className="rounded-2xl border border-rally-line bg-white shadow-card">
                <EmptyState
                  title={daySessions.length === 0 ? 'Nothing scheduled' : 'No sessions match'}
                  description={
                    daySessions.length === 0
                      ? 'No sessions scheduled for this day.'
                      : 'Try a different search or session type.'
                  }
                  action={
                    daySessions.length > 0 ? (
                      <Button
                        variant="secondary"
                        className="rounded-xl"
                        onClick={() => {
                          setQuery('')
                          setTypeFilter('all')
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <ol className="space-y-4">
                {visibleSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    timeZone={timeZone}
                    now={now}
                    speakers={speakersBySession[session.id]}
                    onOpen={() => setDetailSession(session)}
                    action={saveAction(session)}
                  />
                ))}
              </ol>
            )}
          </div>

          {/* Right rail (large screens) */}
          <aside className="hidden min-w-0 space-y-6 lg:col-span-4 lg:block">
            <section className="rounded-2xl border border-rally-line bg-white p-5 shadow-card">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-rally-navy">
                  <BookmarkCheck className="h-5 w-5 text-primary-600" aria-hidden="true" /> My Schedule
                </h2>
                <span className="rounded-full bg-primary-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                  {savedSessions.length} saved
                </span>
              </div>
              {nextSaved ? (
                <div className="rounded-xl border border-primary-200 bg-rally-tint p-4">
                  <p className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-primary-700">
                    Next session
                    <span>
                      {new Date(nextSaved.start_at).getTime() <= now
                        ? 'Happening now'
                        : untilLabel(new Date(nextSaved.start_at).getTime() - now)}
                    </span>
                  </p>
                  <p className="mt-1.5 font-semibold leading-snug text-rally-navy">{nextSaved.title}</p>
                  <p className="mt-1 text-sm text-rally-muted">
                    {formatRange(new Date(nextSaved.start_at), nextSaved.end_at ? new Date(nextSaved.end_at) : null, timeZone)}
                    {nextSaved.location ? ` · ${nextSaved.location}` : ''}
                  </p>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-500">
                  Nothing saved yet. Use "Add to Schedule" on a session to build your own timetable.
                </p>
              )}
              {savedToday.length > 0 && (
                <>
                  <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Saved this day</p>
                  <ul className="space-y-2">
                    {savedToday.map((s) => (
                      <li key={s.id} className="rounded-xl border border-rally-line px-3 py-2">
                        <p className="text-sm font-semibold text-rally-navy">{s.title}</p>
                        <p className="text-xs text-slate-500">
                          {formatRange(new Date(s.start_at), s.end_at ? new Date(s.end_at) : null, timeZone)}
                          {s.location ? ` · ${s.location}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="mt-4 flex flex-col gap-2">
                <Button className="w-full rounded-xl" onClick={syncCalendar} disabled={savedSessions.length === 0}>
                  <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Sync all {savedSessions.length} to calendar
                </Button>
                <Link
                  to={`${eventBasePath}/schedule`}
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-rally-line text-sm font-semibold text-primary-700 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                >
                  Open My Schedule <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </section>

            <section className="rounded-2xl border border-rally-line bg-white p-5 shadow-card">
              <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-rally-navy">
                <MapPin className="h-5 w-5 text-primary-600" aria-hidden="true" /> Venue
              </h2>
              <p className="text-sm font-semibold text-rally-navy">{event.location || 'Venue to be announced'}</p>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus-visible:underline"
                >
                  Open in Maps <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
              <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                Help desk &amp; Wi-Fi details <ComingSoonBadge />
              </div>
            </section>
          </aside>
        </div>
      )}

      {detailSession && (
        <SessionDetailDialog
          session={detailSession}
          timeZone={timeZone}
          eventName={event.name}
          onClose={() => setDetailSession(null)}
          speakers={speakersBySession[detailSession.id] ?? []}
          speakerLink={(speakerId) => `${eventBasePath}/speakers/${speakerId}`}
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
                  size="lg"
                  className="w-full rounded-xl"
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
