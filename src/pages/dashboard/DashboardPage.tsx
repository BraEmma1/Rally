import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lightbulb,
  MapPin,
  Target,
  Users,
} from 'lucide-react'
import { supabase, type Connection, type FollowUp, type EventRow, type Opportunity } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { cn, formatDateRange, formatRelativeDate } from '@/lib/utils'

// Attendee home, following the Rally Event UI dashboard. Every number and list
// comes from the same queries as before (connections, follow-ups, events,
// registrations, opportunities). The design's meetings, priority tiers,
// networking-velocity targets and Pro upsell have no data, so they are not shown.

const card = 'rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6'

// "YYYY-MM-DD" as a local calendar date, so it does not slip a day by time zone.
function localDay(value: string | null | undefined): Date | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

function SectionHeader({ title, to, linkLabel }: { title: string; to?: string; linkLabel?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="font-display text-lg font-semibold tracking-tight text-rally-navy">{title}</h2>
      {to && (
        <Link
          to={to}
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus-visible:underline"
        >
          {linkLabel ?? 'See all'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}

function MonthCalendar({ eventDays, dueDays, label }: { eventDays: Set<string>; dueDays: Set<string>; label: string }) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const first = cursor.getDay()
  const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)]
  const today = new Date()
  const btn = 'flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600'
  return (
    <section className={card} aria-label={label}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-rally-navy">
          {cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex">
          <button type="button" className={btn} aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" className={btn} aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs" role="grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="py-1 font-semibold text-slate-400">{d}</span>
        ))}
        {cells.map((n, i) => {
          if (n === null) return <span key={`b${i}`} />
          const d = new Date(cursor.getFullYear(), cursor.getMonth(), n)
          const k = dayKey(d)
          const isEvent = eventDays.has(k)
          const isDue = dueDays.has(k)
          const isToday = dayKey(today) === k
          return (
            <span
              key={n}
              className={cn(
                'relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm',
                isEvent ? 'bg-primary-600 font-semibold text-white' : isToday ? 'font-bold text-primary-700 ring-1 ring-primary-600' : 'text-slate-700'
              )}
              title={[isEvent && 'Event day', isDue && 'Follow-up due', isToday && 'Today'].filter(Boolean).join(' · ') || undefined}
            >
              {n}
              {isDue && <span className={cn('absolute bottom-0.5 h-1 w-1 rounded-full', isEvent ? 'bg-white' : 'bg-warning-500')} aria-hidden="true" />}
            </span>
          )
        })}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-rally-line pt-3 text-xs text-slate-500">
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary-600" aria-hidden="true" /> Your events</li>
        <li className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-warning-500" aria-hidden="true" /> Follow-up due</li>
      </ul>
    </section>
  )
}

export default function DashboardPage() {
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [followUps, setFollowUps] = useState<(FollowUp & { connection?: Connection })[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [registeredEventIds, setRegisteredEventIds] = useState<Set<string>>(new Set())
  const [totalConnections, setTotalConnections] = useState(0)
  const [pendingFollowUps, setPendingFollowUps] = useState(0)
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [activeOppCount, setActiveOppCount] = useState(0)

  async function loadData() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [connRes, followRes, eventRes, regRes, oppRes] = await Promise.all([
        supabase
          .from('connections')
          .select('*')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('follow_ups')
          .select('*')
          .eq('owner_id', user.id)
          .eq('completed', false)
          .order('due_date', { ascending: true })
          .limit(10),
        supabase
          .from('events')
          .select('*')
          .order('start_date', { ascending: true }),
        supabase
          .from('event_registrations')
          .select('event_id')
          .eq('user_id', user.id),
        supabase
          .from('opportunities')
          .select('*')
          .eq('owner_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(5),
      ])

      if (connRes.error) throw connRes.error
      if (followRes.error) throw followRes.error
      if (eventRes.error) throw eventRes.error
      if (regRes.error) throw regRes.error
      if (oppRes.error) throw oppRes.error

      setConnections(connRes.data as Connection[])
      const fuList = (followRes.data as FollowUp[]) || []
      setEvents(eventRes.data as EventRow[])
      setRegisteredEventIds(new Set((regRes.data || []).map((r: { event_id: string }) => r.event_id)))
      setOpportunities((oppRes.data as Opportunity[]) || [])

      // Enrich follow-ups with connection data
      if (fuList.length > 0) {
        const connIds = [...new Set(fuList.map((f) => f.connection_id))]
        const { data: fuConns } = await supabase
          .from('connections')
          .select('*')
          .eq('owner_id', user.id)
          .in('id', connIds)
        const connMap = new Map<string, Connection>()
        for (const c of (fuConns as Connection[]) || []) {
          connMap.set(c.id, c)
        }
        setFollowUps(fuList.map((f) => ({ ...f, connection: connMap.get(f.connection_id) })))
      } else {
        setFollowUps([])
      }

      const countRes = await supabase
        .from('connections')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', user.id)
      setTotalConnections(countRes.count ?? 0)

      const followCountRes = await supabase
        .from('follow_ups')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', user.id)
        .eq('completed', false)
      setPendingFollowUps(followCountRes.count ?? 0)

      const oppCountRes = await supabase
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', user.id)
        .not('stage', 'in', '("Won","Lost")')
      setActiveOppCount(oppCountRes.count ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [user])

  const today = new Date(new Date().toDateString())
  const upcomingEvents = events.filter((e) => e.start_date && (localDay(e.end_date ?? e.start_date) ?? today) >= today)
  const myUpcomingEvents = upcomingEvents.filter((e) => registeredEventIds.has(e.id))
  const nextEvent = myUpcomingEvents[0]

  const eventDays = useMemo(() => {
    const out = new Set<string>()
    for (const e of events.filter((x) => registeredEventIds.has(x.id))) {
      const s = localDay(e.start_date)
      const end = localDay(e.end_date ?? e.start_date)
      if (!s || !end) continue
      for (let d = new Date(s); d <= end && out.size < 400; d.setDate(d.getDate() + 1)) out.add(dayKey(d))
    }
    return out
  }, [events, registeredEventIds])
  const dueDays = useMemo(() => new Set(followUps.map((f) => localDay(f.due_date)).filter((d): d is Date => !!d).map(dayKey)), [followUps])

  if (loading) return <LoadingState message="Loading your dashboard…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />

  const overdue = followUps.filter((f) => (localDay(f.due_date) ?? today) < today).length
  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0]
  const daysToNext = nextEvent?.start_date
    ? Math.round(((localDay(nextEvent.start_date) ?? today).getTime() - today.getTime()) / 86_400_000)
    : null

  const stats = [
    { label: 'Connections', value: totalConnections, hint: 'in your network', icon: Users, tone: 'bg-rally-tint text-primary-600', to: '/connections' },
    { label: 'Follow-ups', value: pendingFollowUps, hint: overdue > 0 ? `${overdue} overdue` : 'pending', icon: CalendarClock, tone: 'bg-warning-50 text-warning-600', to: '/follow-ups' },
    { label: 'Opportunities', value: activeOppCount, hint: 'active', icon: Target, tone: 'bg-accent-50 text-accent-600', to: '/opportunities' },
    { label: 'My events', value: myUpcomingEvents.length, hint: 'upcoming', icon: Calendar, tone: 'bg-slate-100 text-slate-600', to: '/events' },
  ]

  // Suggested next steps come from what is actually pending, never invented.
  const steps: { label: string; to: string }[] = []
  if (overdue > 0) steps.push({ label: `Catch up on ${overdue} overdue follow-up${overdue === 1 ? '' : 's'}`, to: '/follow-ups' })
  else if (pendingFollowUps > 0) steps.push({ label: `Review ${pendingFollowUps} pending follow-up${pendingFollowUps === 1 ? '' : 's'}`, to: '/follow-ups' })
  if (activeOppCount > 0) steps.push({ label: `Move ${activeOppCount} active opportunit${activeOppCount === 1 ? 'y' : 'ies'} forward`, to: '/opportunities' })
  if (nextEvent) steps.push({ label: `Plan your time at ${nextEvent.name}`, to: `/events/${nextEvent.id}` })
  else steps.push({ label: 'Find an event to attend', to: '/events' })
  if (totalConnections === 0) steps.push({ label: 'Scan a QR code to make your first connection', to: '/scan' })

  return (
    <div className="space-y-6">
      {/* Welcome / next event */}
      <section className="relative overflow-hidden rounded-2xl bg-primary-900 text-white shadow-card">
        {nextEvent?.image_url && (
          <img src={nextEvent.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {/* Brand dark-blue overlay: a flat scrim so even a white or very bright
            photo cannot wash out the text, then a gradient from deep navy-blue
            into the brand blue. The text never sits on the raw image. */}
        <div className="absolute inset-0 bg-primary-900/80" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-r from-primary-900/95 via-primary-800/75 to-primary-600/55" aria-hidden="true" />
        <div className="relative p-5 md:p-8">
          <div className="flex flex-wrap items-center gap-2">
            {nextEvent ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-500/20 px-3 py-1 text-xs font-semibold text-accent-100 ring-1 ring-accent-400/40">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-400" aria-hidden="true" /> Registered
                </span>
                {daysToNext !== null && (
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90">
                    {daysToNext <= 0 ? 'Happening now' : daysToNext === 1 ? 'Starts tomorrow' : `Starts in ${daysToNext} days`}
                  </span>
                )}
              </>
            ) : (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90">No upcoming events yet</span>
            )}
          </div>
          <h1 className="mt-4 max-w-2xl font-display text-2xl font-bold leading-tight tracking-tight [text-shadow:0_1px_14px_rgba(0,0,0,0.4)] md:text-4xl md:leading-tight">
            {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
            {nextEvent && <span className="block text-white/90">{nextEvent.name}</span>}
          </h1>
          {nextEvent ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/80">
              <span className="inline-flex items-center gap-1.5"><Calendar className="h-4 w-4" aria-hidden="true" /> {formatDateRange(nextEvent.start_date, nextEvent.end_date)}</span>
              {nextEvent.location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden="true" /> {nextEvent.location}</span>}
            </p>
          ) : (
            <p className="mt-3 text-sm text-white/80">Browse events and register to start building your network.</p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to={nextEvent ? `/events/${nextEvent.id}` : '/events'}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white hover:bg-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {nextEvent ? 'View event details' : 'Browse events'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            {nextEvent && (
              <Link
                to={`/events/${nextEvent.id}/home`}
                className="inline-flex min-h-[44px] items-center rounded-xl bg-white/10 px-5 text-sm font-semibold text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Enter Event Mode
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className="flex items-start justify-between gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card transition-shadow hover:shadow-float focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 md:p-5"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-500 md:text-sm">{s.label}</p>
              <p className="mt-1 font-display text-3xl font-bold text-rally-navy">{s.value}</p>
              <p className={cn('text-xs', s.hint.includes('overdue') ? 'font-semibold text-error-600' : 'text-slate-500')}>{s.hint}</p>
            </div>
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', s.tone)}>
              <s.icon className="h-5 w-5" aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="min-w-0 space-y-6 xl:col-span-8">
          {/* People to follow up with */}
          <section className={card}>
            <SectionHeader title="People to follow up with" to="/follow-ups" linkLabel={pendingFollowUps > 0 ? `See all (${pendingFollowUps})` : 'See all'} />
            {followUps.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-10 w-10" />}
                title="No pending follow-ups"
                description="Schedule follow-ups with your connections to stay in touch."
                action={<Link to="/follow-ups" className="text-sm font-semibold text-primary-700 hover:text-primary-800">View follow-ups</Link>}
              />
            ) : (
              <ul className="divide-y divide-rally-line">
                {followUps.slice(0, 5).map((fu) => {
                  const due = localDay(fu.due_date) ?? today
                  const isOverdue = due < today
                  const isToday = due.toDateString() === today.toDateString()
                  const conn = fu.connection
                  return (
                    <li key={fu.id}>
                      <Link
                        to={conn ? `/connections/${conn.id}` : '/follow-ups'}
                        className="flex min-h-[56px] items-center gap-3 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                      >
                        <Avatar name={conn?.full_name || '?'} src={conn?.photo_url} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-rally-navy">{fu.title}</p>
                          <p className="truncate text-xs text-slate-500">
                            {conn?.full_name || 'Unknown'}
                            {conn?.company ? ` · ${conn.company}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {isOverdue ? (
                            <Badge variant="error"><AlertCircle className="mr-1 h-3 w-3" aria-hidden="true" />Overdue</Badge>
                          ) : isToday ? (
                            <Badge variant="warning"><Clock className="mr-1 h-3 w-3" aria-hidden="true" />Today</Badge>
                          ) : null}
                          <p className="mt-0.5 text-xs text-slate-500">{formatRelativeDate(fu.due_date)}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Recent connections */}
          <section className={card}>
            <SectionHeader title="Recent connections" to="/connections" linkLabel={totalConnections > 0 ? `View all ${totalConnections}` : 'View all'} />
            {connections.length === 0 ? (
              <EmptyState
                icon={<Users className="h-10 w-10" />}
                title="No connections yet"
                description="Add people you meet at events to start building your network."
                action={<Link to="/connections" className="text-sm font-semibold text-primary-700 hover:text-primary-800">Add your first connection</Link>}
              />
            ) : (
              <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
                {connections.map((conn) => (
                  <li key={conn.id} className="w-64 shrink-0 sm:w-auto">
                    <Link
                      to={`/connections/${conn.id}`}
                      className="flex min-h-[64px] items-center gap-3 rounded-xl border border-rally-line bg-rally-canvas p-3 transition-colors hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    >
                      <Avatar name={conn.full_name} src={conn.photo_url} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-rally-navy">{conn.full_name}</p>
                        <p className="truncate text-xs text-slate-500">{conn.company || conn.job_title || conn.relationship_type}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Opportunities */}
          <section className={card}>
            <SectionHeader title="Active opportunities" to="/opportunities" />
            {opportunities.length === 0 ? (
              <EmptyState
                icon={<Target className="h-10 w-10" />}
                title="No opportunities yet"
                description="Create opportunities from your connections to track deals and partnerships."
                action={<Link to="/opportunities" className="text-sm font-semibold text-primary-700 hover:text-primary-800">View opportunities</Link>}
              />
            ) : (
              <ul className="divide-y divide-rally-line">
                {opportunities.slice(0, 4).map((opp) => (
                  <li key={opp.id}>
                    <Link to={`/opportunities/${opp.id}`} className="flex min-h-[56px] items-center gap-3 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-600">
                        <Target className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-rally-navy">{opp.title}</p>
                        <p className="truncate text-xs text-slate-500">
                          {opp.type}
                          {opp.value > 0 ? ` · ${opp.value.toLocaleString()}` : ''}
                        </p>
                      </div>
                      <Badge variant={opp.stage === 'Won' ? 'success' : opp.stage === 'Lost' ? 'error' : 'primary'}>{opp.stage}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6 xl:col-span-4">
          {/* Your events */}
          <section className={card}>
            <SectionHeader title="My upcoming events" to="/events" />
            {myUpcomingEvents.length === 0 ? (
              <EmptyState
                icon={<Calendar className="h-10 w-10" />}
                title="No upcoming events"
                description="Browse and register for events to plan your networking."
                action={<Link to="/events" className="text-sm font-semibold text-primary-700 hover:text-primary-800">Browse events</Link>}
              />
            ) : (
              <ul className="space-y-3">
                {myUpcomingEvents.slice(0, 3).map((event) => {
                  const s = localDay(event.start_date)
                  return (
                    <li key={event.id}>
                      <Link to={`/events/${event.id}`} className="flex min-h-[56px] items-center gap-3 rounded-xl p-2 -m-2 hover:bg-rally-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
                        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-rally-tint text-primary-700">
                          <span className="text-[11px] font-semibold uppercase">{s ? s.toLocaleDateString('en-US', { month: 'short' }) : '?'}</span>
                          <span className="font-display text-base font-bold leading-none">{s ? s.getDate() : '—'}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-rally-navy">{event.name}</p>
                          <p className="truncate text-xs text-slate-500">{event.location || formatDateRange(event.start_date, event.end_date)}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <MonthCalendar eventDays={eventDays} dueDays={dueDays} label="Calendar of your events and follow-ups" />

          <section className={card}>
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-rally-navy">
              <Lightbulb className="h-5 w-5 text-warning-500" aria-hidden="true" /> Recommended next steps
            </h2>
            <ul className="space-y-1">
              {steps.map((st) => (
                <li key={st.label}>
                  <Link
                    to={st.to}
                    className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-rally-tint hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  >
                    {st.label} <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
