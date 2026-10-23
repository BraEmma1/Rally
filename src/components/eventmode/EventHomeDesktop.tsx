import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  CalendarDays,
  CalendarRange,
  Check,
  Download,
  Headphones,
  Megaphone,
  MapPin,
  Maximize2,
  MessagesSquare,
  QrCode,
  Radio,
  ScanLine,
  Search,
  Handshake,
  Users,
  Wifi,
  X,
  LifeBuoy,
  UsersRound,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getEventAgenda, type OrganizerSession } from '@/lib/events'
import { listMyEventSchedule, saveEventSession, type ScheduleEntry } from '@/lib/schedule'
import { listSessionSpeakers, type SessionSpeaker } from '@/lib/speakers'
import { dayKey, formatDayHeading, formatRange, formatTime, isSessionLive } from '@/lib/sessionTime'
import { useAuth } from '@/context/AuthContext'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ComingSoonBadge, ComingSoonBlock, ComingSoonButton } from '@/components/events/ComingSoon'
import { cn } from '@/lib/utils'

// Event Home for tablets and desktops, after the Rally Event UI "Event Mode Home"
// design. Phones keep their own layout (EventHomePage). Everything here is read
// from the event: its agenda, the person's saved sessions, their registration and
// their own connections. Presence of other attendees ("delegates in your room"),
// live announcements, streaming, bilateral meetings and the help desk have no data
// yet, so they are marked rather than invented.

function utcDay(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000))
}

function Panel({
  icon,
  title,
  aside,
  children,
  className,
}: {
  icon?: ReactNode
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-rally-navy">
          {icon && <span className="text-primary-600">{icon}</span>}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export default function EventHomeDesktop() {
  const { event, eventBasePath, openScan } = useEventModeOutlet()
  const { user, profile } = useAuth()
  const tz = event.timezone || undefined

  const [sessions, setSessions] = useState<OrganizerSession[]>([])
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [speakersBySession, setSpeakersBySession] = useState<Record<string, SessionSpeaker[]>>({})
  const [registration, setRegistration] = useState<{ id: string; checked_in_at: string | null } | null>(null)
  const [registeredCount, setRegisteredCount] = useState<number | null>(null)
  const [contactsToday, setContactsToday] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [qr, setQr] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void Promise.all([
      getEventAgenda(event.id),
      listMyEventSchedule(event.id),
      listSessionSpeakers(event.id),
      supabase.from('event_registrations').select('id, checked_in_at').eq('event_id', event.id).eq('user_id', user.id).maybeSingle(),
      supabase.rpc('get_event_registration_counts', { event_ids: [event.id] }),
      supabase.from('connections').select('created_at').eq('owner_id', user.id).eq('event_id', event.id),
    ]).then(([agenda, mine, spk, reg, counts, conns]) => {
      if (cancelled) return
      setSessions(agenda.data)
      setEntries(mine.data)
      setSpeakersBySession(
        spk.data.reduce<Record<string, SessionSpeaker[]>>((acc, s) => {
          ;(acc[s.session_id] ??= []).push(s)
          return acc
        }, {})
      )
      setRegistration((reg.data as { id: string; checked_in_at: string | null } | null) ?? null)
      const row = (counts.data as { event_id: string; registration_count: number }[] | null)?.[0]
      setRegisteredCount(row ? Number(row.registration_count) || 0 : null)
      const todayLocal = new Date().toDateString()
      setContactsToday(
        ((conns.data as { created_at: string }[] | null) ?? []).filter((c) => new Date(c.created_at).toDateString() === todayLocal).length
      )
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [event.id, user])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    QRCode.toDataURL(`${window.location.origin}/p/${user.id}`, { width: 512, margin: 2, color: { dark: '#0A66C2', light: '#ffffff' } })
      .then((url) => { if (!cancelled) setQr(url) })
      .catch(() => { if (!cancelled) setQr('') })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!qrOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setQrOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [qrOpen])

  // ---- derived -----------------------------------------------------------
  const live = useMemo(() => sessions.filter((s) => s.status !== 'cancelled'), [sessions])
  const liveNow = live.find((s) => isSessionLive(s, now))
  const upNext = live
    .filter((s) => new Date(s.start_at).getTime() > now)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0]
  const savedIds = new Set(entries.map((e) => e.session_id))

  const todayKey = dayKey(new Date(now), tz)
  const firstDay = live[0] ? dayKey(new Date(live[0].start_at), tz) : null
  const snapshotDay = live.some((s) => dayKey(new Date(s.start_at), tz) === todayKey) ? todayKey : firstDay
  const snapshot = live.filter((s) => dayKey(new Date(s.start_at), tz) === snapshotDay)

  const bookedUpcoming = entries
    .filter((e) => e.status !== 'cancelled' && new Date(e.end_at ?? e.start_at).getTime() > now)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())

  // Where "now" sits against the event's own dates (compared in the event's zone).
  const dayStatus = (() => {
    if (!event.start_date) return { text: 'Dates to be announced', tone: 'slate' as const }
    const start = utcDay(event.start_date)
    const end = utcDay(event.end_date || event.start_date)
    const today = utcDay(todayKey)
    const total = Math.round((end - start) / 86_400_000) + 1
    if (today < start) {
      const n = Math.round((start - today) / 86_400_000)
      return { text: n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`, tone: 'blue' as const }
    }
    if (today > end) return { text: 'Event ended', tone: 'slate' as const }
    return { text: `Day ${Math.round((today - start) / 86_400_000) + 1} of ${total}`, tone: 'green' as const }
  })()

  async function addToSchedule(sessionId: string) {
    if (saving) return
    setSaving(true)
    setActionError(null)
    const { error } = await saveEventSession(sessionId)
    if (error) {
      setActionError('Could not add that session. Please try again.')
    } else {
      const mine = await listMyEventSchedule(event.id)
      setEntries(mine.data)
    }
    setSaving(false)
  }

  const featuring = (id: string) => {
    const list = speakersBySession[id] ?? []
    return list.length === 0 ? null : (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="flex -space-x-2">
          {list.slice(0, 3).map((sp) => (
            <Avatar key={sp.speaker_id} name={sp.full_name} src={sp.photo_url || null} size="sm" className="ring-2 ring-white" />
          ))}
        </span>
        <span>
          Featuring <strong className="text-rally-navy">{list.slice(0, 2).map((s) => s.full_name).join(' & ')}</strong>
          {list.length > 2 ? ` +${list.length - 2}` : ''}
        </span>
      </div>
    )
  }

  const mapsUrl = event.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}` : null

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <Link
        to={eventBasePath}
        className="mb-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl text-sm font-semibold text-rally-muted hover:text-rally-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Event details
      </Link>

      {/* Context ribbon */}
      <section className="rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider',
                  dayStatus.tone === 'green' && 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
                  dayStatus.tone === 'blue' && 'bg-rally-tint text-primary-700 ring-1 ring-primary-200',
                  dayStatus.tone === 'slate' && 'bg-slate-100 text-slate-600'
                )}
              >
                {dayStatus.tone === 'green' && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />}
                Event Mode
              </span>
              <span className="text-sm font-semibold text-rally-muted">{dayStatus.text}</span>
              {event.timezone && <span className="text-sm text-slate-500">· {event.timezone}</span>}
              {registration?.checked_in_at && (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700">
                  <Check className="h-4 w-4" aria-hidden="true" /> Checked in
                </span>
              )}
            </div>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-rally-navy md:text-3xl">{event.name}</h1>
            {event.location && (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-rally-muted md:text-base">
                <MapPin className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" /> {event.location}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-stretch gap-3">
            <Button size="lg" className="rounded-xl" onClick={() => setQrOpen(true)} disabled={!qr}>
              <QrCode className="h-4 w-4" aria-hidden="true" /> My Badge QR
            </Button>
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2 text-sm text-slate-500">
              <Wifi className="h-4 w-4" aria-hidden="true" /> Wi-Fi details <ComingSoonBadge />
            </div>
            <ComingSoonButton size="lg" variant="secondary">
              <MapPin className="h-4 w-4" aria-hidden="true" /> Venue Map &amp; Desk
            </ComingSoonButton>
          </div>
        </div>
      </section>

      {actionError && (
        <p className="mt-4 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700" role="alert">
          {actionError}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        {/* Main column */}
        <div className="min-w-0 space-y-6 lg:col-span-8">
          <Panel
            icon={<Radio className="h-5 w-5" aria-hidden="true" />}
            title="Live Stage Tracker"
            aside={
              liveNow ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" /> A session is on now
                </span>
              ) : undefined
            }
          >
            {!loaded ? (
              <div className="h-32 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />
            ) : liveNow ? (
              <div className="rounded-xl border border-primary-200 bg-gradient-to-br from-rally-tint to-white p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-error-600 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-white">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" /> Happening now
                    </span>
                    <span className="text-sm font-semibold text-primary-700">
                      {formatRange(new Date(liveNow.start_at), liveNow.end_at ? new Date(liveNow.end_at) : null, tz)}
                      {` (${minutes(now - new Date(liveNow.start_at).getTime())} mins elapsed)`}
                    </span>
                  </div>
                  {liveNow.location && (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-rally-navy">
                      <MapPin className="h-4 w-4 text-primary-600" aria-hidden="true" /> {liveNow.location}
                    </span>
                  )}
                </div>
                <h3 className="mt-3 font-display text-xl font-bold leading-snug text-rally-navy">{liveNow.title}</h3>
                {featuring(liveNow.id)}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rally-line pt-4">
                  <ComingSoonButton size="lg" variant="secondary">
                    <Headphones className="h-4 w-4" aria-hidden="true" /> Audio stream
                  </ComingSoonButton>
                  <ComingSoonButton size="lg" variant="secondary">
                    <MessagesSquare className="h-4 w-4" aria-hidden="true" /> Live Q&amp;A
                  </ComingSoonButton>
                  <Link
                    to={`${eventBasePath}/agenda`}
                    className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus-visible:underline"
                  >
                    Open in agenda <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-500">
                {live.length === 0 ? 'No sessions have been added to this event yet.' : 'No session is on right now.'}
              </p>
            )}

            {loaded && upNext && (
              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-rally-line p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                      Up next · starts in {(() => { const m = minutes(new Date(upNext.start_at).getTime() - now); return m >= 120 ? `${Math.round(m / 60)} hrs` : `${m} mins` })()}
                    </span>
                    <span className="text-sm text-slate-500">
                      {formatRange(new Date(upNext.start_at), upNext.end_at ? new Date(upNext.end_at) : null, tz)}
                    </span>
                  </div>
                  <p className="mt-1 font-semibold leading-snug text-rally-navy">{upNext.title}</p>
                  {upNext.location && <p className="text-sm text-slate-500">{upNext.location}</p>}
                </div>
                {savedIds.has(upNext.id) ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary-700">
                    <Check className="h-4 w-4" aria-hidden="true" /> In your schedule
                  </span>
                ) : (
                  <Button size="lg" variant="secondary" className="shrink-0 rounded-xl" onClick={() => void addToSchedule(upNext.id)} disabled={saving}>
                    <BookmarkPlus className="h-4 w-4" aria-hidden="true" /> {saving ? 'Adding…' : 'Add to My Schedule'}
                  </Button>
                )}
              </div>
            )}
          </Panel>

          <Panel
            icon={<UsersRound className="h-5 w-5" aria-hidden="true" />}
            title="Fast On-Site Networking"
            aside={
              registeredCount !== null ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{registeredCount} registered</span>
              ) : undefined
            }
          >
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                { icon: <QrCode className="h-5 w-5" />, label: 'Show My Badge QR', sub: 'Quick badge swap', onClick: () => setQrOpen(true) },
                { icon: <ScanLine className="h-5 w-5" />, label: 'Scan Badge', sub: 'Instant lead capture', onClick: openScan },
                { icon: <Handshake className="h-5 w-5" />, label: 'Book 1-on-1 Slot', sub: 'Deal room reservations', soon: true },
                { icon: <Search className="h-5 w-5" />, label: 'Explore Attendees', sub: 'Browse the directory', to: `${eventBasePath}/network` },
              ].map((a) => {
                const inner = (
                  <>
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-rally-tint text-primary-600">{a.icon}</span>
                    <span className="mt-3 block text-sm font-semibold text-rally-navy">{a.label}</span>
                    <span className="block text-xs text-slate-500">{a.soon ? 'Coming soon' : a.sub}</span>
                  </>
                )
                const base = 'flex min-h-[44px] flex-col items-start rounded-xl border border-rally-line bg-white p-4 text-left transition-colors'
                if (a.soon) {
                  return (
                    <div key={a.label} aria-disabled="true" title="Coming soon" className={cn(base, 'cursor-not-allowed opacity-60')}>
                      {inner}
                    </div>
                  )
                }
                if (a.to) {
                  return (
                    <Link key={a.label} to={a.to} className={cn(base, 'hover:border-primary-300 hover:bg-rally-tint/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600')}>
                      {inner}
                    </Link>
                  )
                }
                return (
                  <button key={a.label} type="button" onClick={a.onClick} className={cn(base, 'hover:border-primary-300 hover:bg-rally-tint/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600')}>
                    {inner}
                  </button>
                )
              })}
            </div>
          </Panel>

          <Panel icon={<Megaphone className="h-5 w-5" aria-hidden="true" />} title="Live Announcements">
            <ComingSoonBlock
              title="Announcements from the organizers"
              description="Room changes, catering and schedule updates will appear here."
            />
          </Panel>

          <Panel
            icon={<CalendarRange className="h-5 w-5" aria-hidden="true" />}
            title="Today's Agenda Snapshot"
            aside={
              <Link
                to={`${eventBasePath}/agenda`}
                className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus-visible:underline"
              >
                Full Program <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            }
          >
            {!loaded ? (
              <div className="h-24 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />
            ) : snapshot.length === 0 ? (
              <p className="text-sm text-rally-muted">No sessions to show yet.</p>
            ) : (
              <>
                <p className="-mt-2 mb-3 text-sm text-rally-muted">
                  {snapshotDay === todayKey ? 'Today' : formatDayHeading(new Date(snapshot[0].start_at), tz)} · {snapshot.length} session{snapshot.length === 1 ? '' : 's'}
                </p>
                <ol className="divide-y divide-rally-line">
                  {snapshot.slice(0, 6).map((s) => {
                    const isLive = isSessionLive(s, now)
                    const mins = s.end_at ? minutes(new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) : null
                    return (
                      <li key={s.id} className="flex gap-4 py-3 first:pt-0 last:pb-0">
                        <div className="w-20 shrink-0 text-right">
                          <p className={cn('text-sm font-bold tabular-nums', isLive ? 'text-primary-700' : 'text-rally-navy')}>
                            {formatTime(new Date(s.start_at), tz)}
                          </p>
                          {isLive ? (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">LIVE</span>
                          ) : (
                            mins !== null && <p className="text-[11px] text-slate-500">{mins} mins</p>
                          )}
                        </div>
                        <span className={cn('w-1 shrink-0 rounded-full', isLive ? 'bg-primary-600' : 'bg-slate-200')} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold leading-snug text-rally-navy">{s.title}</p>
                          {s.location && <p className="text-sm text-slate-500">{s.location}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
                {snapshot.length > 6 && <p className="mt-3 text-sm text-rally-muted">+ {snapshot.length - 6} more on the full program</p>}
              </>
            )}
          </Panel>
        </div>

        {/* Right column */}
        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <section className="rounded-2xl bg-gradient-to-br from-rally-ink to-primary-700 p-5 text-white shadow-float md:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="inline-block rounded bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">Delegate</span>
                <p className="mt-2 truncate font-display text-xl font-bold">{profile?.full_name || 'Attendee'}</p>
                <p className="truncate text-sm text-white/80">
                  {[profile?.job_title, profile?.company].filter(Boolean).join(' · ') || 'Registered attendee'}
                </p>
              </div>
              {qr ? (
                <img src={qr} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-white p-1" />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-white/10" aria-hidden="true">
                  <QrCode className="h-7 w-7" />
                </div>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/20 pt-4 text-sm">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Registration ID</dt>
                <dd className="font-mono font-bold">{registration ? registration.id.slice(0, 8).toUpperCase() : '—'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Status</dt>
                <dd className="font-semibold">{registration?.checked_in_at ? 'Checked in' : registration ? 'Registered' : '—'}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              disabled={!qr}
              className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold text-rally-ink hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-700 disabled:opacity-60"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" /> Tap to expand QR
            </button>
          </section>

          <Panel
            icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
            title={`My Booked Sessions (${entries.length})`}
            aside={
              <Link to={`${eventBasePath}/schedule`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus-visible:underline">
                Manage
              </Link>
            }
          >
            {bookedUpcoming.length === 0 ? (
              <p className="text-sm text-rally-muted">
                {entries.length === 0 ? 'You have not saved any sessions yet. ' : 'No upcoming saved sessions. '}
                <Link to={`${eventBasePath}/agenda`} className="font-semibold text-primary-700 hover:underline">Browse the agenda</Link>
              </p>
            ) : (
              <ul className="space-y-2.5">
                {bookedUpcoming.slice(0, 3).map((e) => {
                  const isLive = isSessionLive(e, now)
                  return (
                    <li key={e.session_id} className={cn('flex items-start gap-3 rounded-xl border p-3', isLive ? 'border-primary-200 bg-rally-tint' : 'border-rally-line')}>
                      <span className={cn('shrink-0 rounded px-2 py-1 text-center text-[10px] font-bold leading-tight', isLive ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700')}>
                        {formatTime(new Date(e.start_at), tz)}
                        {isLive && <><br />NOW</>}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-rally-navy">{e.title}</p>
                        {e.location && <p className="truncate text-xs text-slate-500">{e.location}</p>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Panel icon={<Users className="h-5 w-5" aria-hidden="true" />} title="Your Networking Pulse">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-rally-tint p-4">
                <p className="font-display text-3xl font-bold text-primary-700">{contactsToday ?? '—'}</p>
                <p className="text-xs font-medium text-rally-muted">New contacts logged today</p>
              </div>
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
                <p className="font-display text-3xl font-bold text-slate-300">—</p>
                <p className="text-xs font-medium text-slate-500">Bilateral syncs</p>
                <ComingSoonBadge className="mt-1" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-rally-line pt-3 text-sm text-slate-500">
              <span className="inline-flex items-center gap-2"><Download className="h-4 w-4" aria-hidden="true" /> Export vCards to CRM</span>
              <ComingSoonBadge />
            </div>
          </Panel>

          <Panel icon={<LifeBuoy className="h-5 w-5" aria-hidden="true" />} title="Concierge & Help Desk">
            <ComingSoonBlock title="Help desk" description="Contact details and opening hours will appear here." />
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus-visible:underline"
              >
                Open venue in Maps <ArrowRight className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </Panel>
        </aside>
      </div>

      {qrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="My badge QR code">
          <button className="absolute inset-0 bg-rally-ink/70" aria-hidden="true" tabIndex={-1} onClick={() => setQrOpen(false)} />
          <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <button
              type="button"
              onClick={() => setQrOpen(false)}
              aria-label="Close QR code"
              className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <X className="h-5 w-5" />
            </button>
            <p className="font-display text-lg font-bold text-rally-navy">{profile?.full_name || 'My badge'}</p>
            <p className="text-sm text-rally-muted">Others scan this to connect with you.</p>
            {qr && <img src={qr} alt="Your Rally QR code" className="mx-auto mt-4 h-64 w-64 rounded-xl" />}
          </div>
        </div>
      )}
    </div>
  )
}
