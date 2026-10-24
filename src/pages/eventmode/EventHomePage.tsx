import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  Bell,
  CalendarRange,
  MapPin,
  Mic,
  Store,
  Briefcase,
  CheckCircle2,
  BookmarkCheck,
  ChevronRight,
  Sparkles,
  ArrowLeft,
  MessagesSquare,
  Info,
  Megaphone,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { useEventModeId } from '@/context/EventModeContext'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import EventHomeDesktop from '@/components/eventmode/EventHomeDesktop'
import { Avatar } from '@/components/ui/Avatar'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { getEventAgenda, type OrganizerSession } from '@/lib/events'
import { dayKey, formatTime, formatDayHeading, isSessionLive } from '@/lib/sessionTime'
import { ComingSoonBlock } from '@/components/events/ComingSoon'
import { formatDate, cn } from '@/lib/utils'

// Event Home. Two layouts, chosen by width:
//  - phones (below md): the layout people already know -- event hero, greeting,
//    a grid of feature tiles and the "You're at {event}" card. Kept as it was,
//    plus an explicit "Event details" way back and tiles wired to every
//    available feature of this event.
//  - tablets and desktops (md and up, where the Event Mode sidebar appears): the
//    Rally Event UI Event Home design (EventHomeDesktop).
// The breakpoint is md because below it there is no room for the two-column
// design next to the sidebar; at md the design stacks to one column.

type TileProps = { icon: typeof Users; label: string } & (
  | { to: string; onClick?: never; soon?: never }
  | { onClick: () => void; to?: never; soon?: never }
  | { soon: true; to?: never; onClick?: never }
)

function Tile(props: TileProps) {
  const { icon: Icon, label } = props
  const base =
    'flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 transition-colors'
  const content = (
    <>
      <Icon className="h-5 w-5 text-gray-800" aria-hidden="true" />
      <span className="text-xs font-medium text-gray-800">{label}</span>
    </>
  )
  if (props.soon) {
    // Not built yet: visible so people know it is planned, but it does nothing.
    return (
      <div aria-disabled="true" title="Coming soon" className={cn(base, 'cursor-not-allowed opacity-60')}>
        <Icon className="h-5 w-5 text-gray-800" aria-hidden="true" />
        <span className="text-xs font-medium text-gray-800">{label}</span>
        <span className="-mt-0.5 text-[10px] font-medium leading-none text-gray-500">Coming soon</span>
      </div>
    )
  }
  const interactive = cn(base, 'hover:border-primary-300 hover:bg-primary-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600')
  if (props.to) {
    return (
      <Link to={props.to} className={interactive}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" onClick={props.onClick} className={interactive}>
      {content}
    </button>
  )
}

function EventHomeMobile() {
  const eventId = useEventModeId()
  const { event, eventBasePath } = useEventModeOutlet()
  const { profile } = useAuth()
  const { unreadCount } = useNotifications()
  const [checkedIn, setCheckedIn] = useState(false)
  // null while loading; the agenda is public event data (get_event_agenda).
  const [agenda, setAgenda] = useState<OrganizerSession[] | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    void getEventAgenda(eventId).then(({ data }) => {
      if (!cancelled) setAgenda(data)
    })
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [eventId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: session } = await supabase.auth.getSession()
      const userId = session.session?.user.id
      if (!userId) return
      const { data } = await supabase
        .from('event_registrations')
        .select('id, checked_in_at')
        .eq('event_id', eventId)
        .eq('user_id', userId)
        .in('status', ['registered', 'checked_in'])
        .maybeSingle()
      if (!cancelled) setCheckedIn(!!data?.checked_in_at)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [eventId])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const displayName = profile?.full_name || 'Welcome'

  const dateLabel = event.start_date
    ? `${formatDate(event.start_date)}${event.end_date && event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ''}`
    : 'Dates to be announced'

  // Today's sessions; before or after the event, the nearest day that has any.
  const tz = event.timezone || undefined
  const liveSessions = (agenda ?? []).filter((x) => x.status !== 'cancelled')
  const todayKey = dayKey(new Date(now), tz)
  const dayKeys = [...new Set(liveSessions.map((x) => dayKey(new Date(x.start_at), tz)))].sort()
  const shownDay = dayKeys.includes(todayKey) ? todayKey : dayKeys.find((k) => k > todayKey) ?? dayKeys[dayKeys.length - 1]
  const daySessions = liveSessions.filter((x) => dayKey(new Date(x.start_at), tz) === shownDay)

  return (
    <div>
      {/* Event hero — full-bleed, edge to edge, no side margins */}
      <div className="relative min-h-[22rem]">
        {event.image_url ? (
          <img
            src={event.image_url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-primary-700" aria-hidden="true" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/40 to-black/70" aria-hidden="true" />

        <div className="relative px-4 pb-12 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="mx-auto max-w-5xl">
            {/* Arrow on the left, notifications on the right. The arrow uses an
                explicit destination, not browser history, so it also works when
                Event Home is opened directly (a shared link, a refresh). */}
            <div className="flex items-center justify-between">
              <Link
                to={eventBasePath}
                aria-label="Back to event details"
                title="Event details"
                className="-ml-1 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </Link>
              <Link
                to="/notifications"
                aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
                className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-600 px-1 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
            </div>

            <div className="mt-14">
              <h1 className="text-3xl font-bold leading-tight text-white">{event.name}</h1>
              <p className="mt-1.5 text-sm text-white/90">
                {dateLabel}
                {event.location ? ` | ${event.location}` : ''}
              </p>
              {checkedIn && (
                <span className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Checked in
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full-width white sheet overlapping the hero: greeting, feature grid,
          context card. Internal padding only — no outer margins. */}
      <div className="relative -mt-9 rounded-t-2xl bg-gray-50 pb-8 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
        <div className="mx-auto max-w-5xl px-4 pt-6">
          {/* Personal greeting card */}
          <div className="flex items-center gap-4">
            <Avatar name={displayName} src={profile?.photo_url} size="lg" />
            <div className="min-w-0">
              <p className="text-sm text-gray-500">{greeting},</p>
              <p className="truncate text-lg font-bold text-gray-900">{displayName}</p>
              <p className="mt-0.5 text-xs leading-snug text-gray-500">
                Great connections
                <br />
                lead to greater opportunities.
              </p>
            </div>
          </div>

          {/* Feature grid. Every tile goes to a route that exists for this event,
              or is plainly marked as not available yet. */}
          <div className="mt-5 grid grid-cols-3 gap-2.5">
            <Tile icon={CalendarRange} label="Agenda" to={`${eventBasePath}/agenda`} />
            <Tile icon={Users} label="Attendees" to={`${eventBasePath}/network`} />
            <Tile icon={MapPin} label="Map" soon />
            <Tile icon={Mic} label="Speakers" to={`${eventBasePath}/speakers`} />
            <Tile icon={Store} label="Exhibitors" to={`${eventBasePath}/exhibitors`} />
            <Tile icon={Briefcase} label="Deal Room" soon />
            <Tile icon={MessagesSquare} label="Messages" to={`${eventBasePath}/messages`} />
            <Tile icon={BookmarkCheck} label="Schedule" to={`${eventBasePath}/schedule`} />
            <Tile icon={Info} label="Event Info" soon />
          </div>

          {/* Live announcements: no announcements backend yet, so a plain marker. */}
          <section className="mt-5" aria-labelledby="home-announcements">
            <h2 id="home-announcements" className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-900">
              <Megaphone className="h-4 w-4 text-primary-600" aria-hidden="true" /> Live Announcements
            </h2>
            <ComingSoonBlock
              title="Announcements from the organizers"
              description="Room changes, catering and schedule updates will appear here."
            />
          </section>

          {/* Agenda, so the programme is visible without leaving Event Home. */}
          <section className="mt-5" aria-labelledby="home-agenda">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="home-agenda" className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <CalendarRange className="h-4 w-4 text-primary-600" aria-hidden="true" />
                {shownDay === todayKey ? "Today's Agenda" : 'Agenda'}
              </h2>
              <Link
                to={`${eventBasePath}/agenda`}
                className="inline-flex min-h-[44px] items-center gap-0.5 text-sm font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:underline"
              >
                Full agenda <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            {agenda === null ? (
              <div className="h-24 animate-pulse rounded-xl bg-gray-100" aria-hidden="true" />
            ) : daySessions.length === 0 ? (
              <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
                No sessions have been added to this event yet.
              </p>
            ) : (
              <>
                {shownDay !== todayKey && (
                  <p className="mb-2 text-xs text-gray-500">{formatDayHeading(new Date(daySessions[0].start_at), tz)}</p>
                )}
                <ol className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                  {daySessions.slice(0, 5).map((x) => {
                    const live = isSessionLive(x, now)
                    return (
                      <li key={x.id}>
                        <Link
                          to={`${eventBasePath}/agenda`}
                          className="flex min-h-[44px] gap-3 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
                        >
                          <div className="w-16 shrink-0">
                            <p className={cn('text-sm font-semibold tabular-nums', live ? 'text-primary-600' : 'text-gray-900')}>
                              {formatTime(new Date(x.start_at), tz)}
                            </p>
                            {live && <span className="text-[10px] font-bold uppercase text-primary-600">Live now</span>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug text-gray-900">{x.title}</p>
                            {x.location && <p className="mt-0.5 truncate text-xs text-gray-500">{x.location}</p>}
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ol>
                {daySessions.length > 5 && (
                  <p className="mt-2 text-xs text-gray-500">+ {daySessions.length - 5} more in the full agenda</p>
                )}
              </>
            )}
          </section>

          {/* Event context card */}
          <div className="mt-5 flex items-center gap-3 rounded-xl bg-primary-50 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-primary-600">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-gray-900">You're at {event.name}</p>
              <p className="text-sm text-gray-500">Let's make it count.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function EventHomePage() {
  const wide = useMediaQuery('(min-width: 768px)')
  return wide ? <EventHomeDesktop /> : <EventHomeMobile />
}
