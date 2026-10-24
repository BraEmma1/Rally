import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BookmarkCheck,
  BookmarkX,
  CalendarPlus,

  CheckCircle2,
  Clock,
  FileDown,
  Footprints,
  Share2,
  Utensils,
} from 'lucide-react'
import { SessionRow, SessionDetailDialog } from '@/components/eventmode/SessionRow'
import { listMyEventSchedule, removeEventSession, scheduleEntryToSession, type ScheduleEntry } from '@/lib/schedule'
import { listSessionSpeakers, type SessionSpeaker } from '@/lib/speakers'
import { buildSessionsIcs, downloadIcs } from '@/lib/ics'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ComingSoonBlock, ComingSoonButton } from '@/components/events/ComingSoon'
import { dayKey, formatDayHeading, formatRange, formatTime } from '@/lib/sessionTime'
import { cn } from '@/lib/utils'

// Event Mode "My Schedule": the attendee's personally saved sessions, loaded
// through get_my_event_schedule. Personal by contract — the RPC derives the
// user server-side, so no other attendee's bookmarks can ever appear here.
// Layout follows the Rally Event UI "My Schedule" design. Every figure is
// computed from the saved sessions (including overlap detection); the design's
// bilateral meetings, deal rooms and walking guide have no data yet.

function endOf(e: ScheduleEntry): number {
  return new Date(e.end_at ?? e.start_at).getTime()
}

export default function EventMySchedulePage({
  switcher,
  onCounts,
  onBrowseAgenda,
}: {
  switcher?: React.ReactNode
  onCounts?: (c: { agenda?: number; saved?: number }) => void
  onBrowseAgenda?: () => void
}) {
  const { event, eventBasePath } = useEventModeOutlet()
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [detailSession, setDetailSession] = useState<ScheduleEntry | null>(null)
  const [speakersBySession, setSpeakersBySession] = useState<Record<string, SessionSpeaker[]>>({})
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const timeZone = event.timezone || undefined

  useEffect(() => {
    onCounts?.({ saved: entries?.length })
  }, [entries, onCounts])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [{ data, error: err }, speakerResult] = await Promise.all([
      listMyEventSchedule(event.id),
      listSessionSpeakers(event.id),
    ])
    if (err) {
      setError(err)
      setEntries(null)
    } else {
      setEntries(data)
    }
    setSpeakersBySession(
      (speakerResult.data ?? []).reduce<Record<string, SessionSpeaker[]>>((acc, s) => {
        ;(acc[s.session_id] ??= []).push(s)
        return acc
      }, {})
    )
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
    const unique = new Map<string, { date: Date; count: number }>()
    for (const e of entries) {
      const key = dayKey(new Date(e.start_at), timeZone)
      const cur = unique.get(key)
      if (cur) cur.count += 1
      else unique.set(key, { date: new Date(e.start_at), count: 1 })
    }
    return Array.from(unique.entries(), ([key, v]) => ({ key, date: v.date, count: v.count })).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    )
  }, [entries, timeZone])

  const todayKey = dayKey(new Date(now), timeZone)

  useEffect(() => {
    if (days.length === 0) {
      setSelectedDay(null)
      return
    }
    if (selectedDay && days.some((d) => d.key === selectedDay)) return
    setSelectedDay(days.some((d) => d.key === todayKey) ? todayKey : days[0].key)
  }, [days, selectedDay, todayKey])

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

  // Two saved sessions conflict when their time ranges genuinely overlap
  // (back-to-back is fine). Cancelled sessions cannot conflict.
  const conflicts = useMemo(() => {
    const live = (entries ?? [])
      .filter((e) => e.status !== 'cancelled')
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    const pairs: [ScheduleEntry, ScheduleEntry][] = []
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        if (new Date(live[j].start_at).getTime() >= endOf(live[i])) break
        pairs.push([live[i], live[j]])
      }
    }
    const ids = new Set(pairs.flatMap(([a, b]) => [a.session_id, b.session_id]))
    return { pairs, ids }
  }, [entries])

  const dayEntries = selectedDay ? (byDay.get(selectedDay) ?? []) : []
  const mealsCount = (entries ?? []).filter((e) => e.session_type === 'networking' || e.session_type === 'break').length
  const daySpan =
    dayEntries.length > 0
      ? `${formatTime(new Date(dayEntries[0].start_at), timeZone)} – ${formatTime(new Date(Math.max(...dayEntries.map(endOf))), timeZone)}`
      : '—'

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

  function syncCalendar() {
    const ics = buildSessionsIcs(
      `${event.name} - My Schedule`,
      (entries ?? []).map((e) => ({ id: e.session_id, title: e.title, description: e.description, location: e.location, start_at: e.start_at, end_at: e.end_at }))
    )
    if (!ics) return
    const name = event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
    downloadIcs(`${name}-my-schedule.ics`, ics)
  }

  const stat = (icon: React.ReactNode, label: string, value: React.ReactNode, hint?: string) => (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="mt-1 font-display text-2xl font-bold text-rally-navy">{value}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rally-tint text-primary-600">{icon}</span>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6">
      <div className="rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="hidden text-xs md:block font-semibold uppercase tracking-wider text-primary-700">Personal itinerary</p>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-rally-navy md:text-3xl">My Schedule</h1>
            <p className="mt-1.5 hidden max-w-xl md:block text-sm text-rally-muted md:text-base">
              The sessions you saved for {event.name}.
            </p>
            {!event.timezone && (
              <p className="mt-1 text-xs text-slate-400">Event timezone not set — times shown in your device's timezone.</p>
            )}
          </div>
          <div className="hidden flex-wrap md:flex gap-2 lg:justify-end">
            <Button size="lg" className="rounded-xl" onClick={syncCalendar} disabled={!entries || entries.length === 0}>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Sync Calendar
            </Button>
            <ComingSoonButton size="lg" variant="secondary">
              <FileDown className="h-4 w-4" aria-hidden="true" /> Export PDF Agenda
            </ComingSoonButton>
            <ComingSoonButton size="lg" variant="secondary">
              <Share2 className="h-4 w-4" aria-hidden="true" /> Share Itinerary
            </ComingSoonButton>
          </div>
        </div>
        {switcher}
      </div>

      {actionError && (
        <p className="mt-4 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700" role="alert">
          {actionError}
        </p>
      )}

      {loading && (
        <div className="mt-4 space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-2xl border border-rally-line bg-white p-5">
              <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
              <div className="h-5 w-2/3 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="mt-4 rounded-2xl border border-rally-line bg-white shadow-card">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      )}

      {!loading && !error && entries && entries.length === 0 && (
        <div className="mt-4 rounded-2xl border border-rally-line bg-white shadow-card">
          <EmptyState
            icon={<BookmarkX className="h-10 w-10" />}
            title="Your schedule is empty"
            description="Save sessions from the Agenda to build your personal event schedule."
            action={
              onBrowseAgenda ? (
                <button type="button" onClick={onBrowseAgenda} className="min-h-[44px] text-sm font-semibold text-primary-700 hover:text-primary-800">
                  Browse Agenda
                </button>
              ) : (
                <Link to={`${eventBasePath}/agenda`} className="text-sm font-semibold text-primary-700 hover:text-primary-800">
                  Browse Agenda
                </Link>
              )
            }
          />
        </div>
      )}

      {!loading && !error && entries && entries.length > 0 && (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stat(<BookmarkCheck className="h-5 w-5" aria-hidden="true" />, 'Saved sessions', entries.length, `across ${days.length} day${days.length === 1 ? '' : 's'}`)}
            {stat(<Utensils className="h-5 w-5" aria-hidden="true" />, 'Networking & meals', mealsCount, 'saved')}
            {stat(
              conflicts.pairs.length === 0 ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
              'Schedule conflicts',
              conflicts.pairs.length === 0 ? 'None' : conflicts.pairs.length,
              conflicts.pairs.length === 0 ? 'no overlaps' : 'overlapping sessions'
            )}
            {stat(<Clock className="h-5 w-5" aria-hidden="true" />, 'Selected day', <span className="text-lg">{daySpan}</span>, selectedDay === todayKey ? 'today' : undefined)}
          </div>

          {days.length > 1 && (
            <div
              className="mt-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="tablist"
              aria-label="Schedule days"
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

          <div className="mt-5 grid gap-6 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-8">
              {selectedDay && (
                <h2 className="mb-3 font-display text-lg font-semibold text-rally-navy">
                  {formatDayHeading(days.find((d) => d.key === selectedDay)?.date ?? new Date(), timeZone)}
                </h2>
              )}
              <ol className="space-y-4">
                {dayEntries.map((entry) => (
                  <SessionRow
                    key={entry.session_id}
                    session={scheduleEntryToSession(entry)}
                    timeZone={timeZone}
                    now={now}
                    speakers={speakersBySession[entry.session_id]}
                    onOpen={() => setDetailSession(entry)}
                    notice={
                      conflicts.ids.has(entry.session_id) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Overlaps another session
                        </span>
                      ) : undefined
                    }
                    action={
                      <Button
                        size="lg"
                        variant="ghost"
                        className="rounded-xl text-slate-600"
                        disabled={removingId === entry.session_id}
                        onClick={() => void handleRemove(entry)}
                        aria-label={`Remove ${entry.title} from My Schedule`}
                      >
                        {removingId === entry.session_id ? 'Removing…' : 'Remove from Schedule'}
                      </Button>
                    }
                  />
                ))}
              </ol>
            </div>

            <aside className="min-w-0 space-y-6 lg:col-span-4">
              <section className="rounded-2xl border border-rally-line bg-white p-5 shadow-card">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="font-display text-lg font-semibold text-rally-navy">Conflict Assistant</h2>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      conflicts.pairs.length === 0 ? 'bg-accent-50 text-accent-700' : 'bg-amber-50 text-amber-800'
                    )}
                  >
                    {conflicts.pairs.length === 0 ? 'All clear' : `${conflicts.pairs.length} to review`}
                  </span>
                </div>
                {conflicts.pairs.length === 0 ? (
                  <div className="flex items-start gap-3 rounded-xl bg-rally-tint p-4">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-rally-navy">No scheduling conflicts detected</p>
                      <p className="text-sm text-rally-muted">None of your saved sessions overlap.</p>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {conflicts.pairs.map(([a, b]) => (
                      <li key={`${a.session_id}-${b.session_id}`} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
                        <p className="font-semibold text-rally-navy">{a.title}</p>
                        <p className="text-xs text-slate-500">{formatRange(new Date(a.start_at), a.end_at ? new Date(a.end_at) : null, timeZone)}</p>
                        <p className="my-1 text-xs font-semibold uppercase tracking-wide text-amber-800">overlaps</p>
                        <p className="font-semibold text-rally-navy">{b.title}</p>
                        <p className="text-xs text-slate-500">{formatRange(new Date(b.start_at), b.end_at ? new Date(b.end_at) : null, timeZone)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl bg-primary-600 p-5 text-white shadow-card">
                <h2 className="font-display text-lg font-semibold">Discover more programming</h2>
                <p className="mt-1 text-sm text-white/85">Add sessions to your schedule before they fill up.</p>
                <Link
                  to={`${eventBasePath}/agenda`}
                  className="mt-4 flex min-h-[44px] items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-primary-700 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-600"
                >
                  Browse the agenda
                </Link>
              </section>

              <ComingSoonBlock
                icon={<Footprints className="h-5 w-5" aria-hidden="true" />}
                title="Walking guide between sessions"
                description="Directions and transit times will appear here."
              />
            </aside>
          </div>
        </>
      )}

      {detailSession && (
        <SessionDetailDialog
          session={scheduleEntryToSession(detailSession)}
          timeZone={timeZone}
          eventName={event.name}
          speakers={speakersBySession[detailSession.session_id] ?? []}
          speakerLink={(speakerId) => `${eventBasePath}/speakers/${speakerId}`}
          onClose={() => setDetailSession(null)}
          footer={
            <Button
              variant="secondary"
              size="lg"
              className="w-full rounded-xl"
              disabled={removingId === detailSession.session_id}
              onClick={() => void handleRemove(detailSession)}
            >
              {removingId === detailSession.session_id ? 'Removing…' : 'Remove from My Schedule'}
            </Button>
          }
        />
      )}
    </div>
  )
}
