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
  Sparkles,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { useEventModeId } from '@/context/EventModeContext'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { Avatar } from '@/components/ui/Avatar'
import { formatDate } from '@/lib/utils'

// Event Home, following the reference layout: event hero (branding, name,
// dates, location, cover image, notification bell), an overlapping greeting
// card, a 3-column feature grid, and the "You're at {event}" context card.
// QR actions live only in the bottom-nav CONNECT sheet, not on this page.
function Tile({ icon: Icon, label, to }: { icon: typeof Users; label: string; to: string }) {
  return (
    <Link
      to={to}
      className="flex h-20 flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-100 transition-colors hover:border-primary-300 hover:bg-primary-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
    >
      <Icon className="h-5 w-5 text-gray-800" aria-hidden="true" />
      <span className="text-xs font-medium text-gray-800">{label}</span>
    </Link>
  )
}

export default function EventHomePage() {
  const eventId = useEventModeId()
  const { event, eventBasePath } = useEventModeOutlet()
  const { profile } = useAuth()
  const { unreadCount } = useNotifications()
  const [checkedIn, setCheckedIn] = useState(false)

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

  return (
    <div>
      {/* Event hero — full-bleed, edge to edge, no side margins */}
      <div className="relative h-80 md:h-96">
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

        <div className="relative px-4 pb-12 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
                  <Users className="h-5 w-5 text-white" aria-hidden="true" />
                </div>
                <span className="text-xl font-bold text-white">Rally</span>
              </div>
              <Link
                to="/notifications"
                aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
                className="relative rounded-full bg-white/15 p-2.5 text-white transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-600 px-1 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
            </div>

            <div className="mt-7">
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
        <div className="mx-auto max-w-5xl px-4 pt-6 md:px-8">
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

          {/* Feature grid */}
          <div className="mt-5 grid grid-cols-3 gap-2.5">
            <Tile icon={CalendarRange} label="Agenda" to={`${eventBasePath}/agenda`} />
            <Tile icon={Users} label="Attendees" to={`${eventBasePath}/network`} />
            <Tile icon={MapPin} label="Map" to={`${eventBasePath}/map`} />
            <Tile icon={Mic} label="Speakers" to={`${eventBasePath}/speakers`} />
            <Tile icon={Store} label="Exhibitors" to={`${eventBasePath}/exhibitors`} />
            <Tile icon={Briefcase} label="Deal Room" to={`${eventBasePath}/deal-room`} />
          </div>

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
