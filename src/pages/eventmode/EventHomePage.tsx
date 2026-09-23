import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  ScanLine,
  CalendarRange,
  Users,
  Mic,
  Store,
  CalendarClock,
  Map,
  Radio,
  ArrowRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useEventModeId } from '@/context/EventModeContext'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import EventModeConnectFlow from '@/components/eventmode/EventModeConnectFlow'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

// A feature tile. Tiles without backend support still get an entry point but
// route to the shared coming-soon state instead of fabricating content.
function Tile({ icon: Icon, label, onClick }: { icon: typeof Users; label: string; onClick?: () => void }) {
  const body = (
    <>
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </>
  )
  if (!onClick) {
    return (
      <Link
        to="coming-soon"
        className="flex h-20 flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white transition-colors hover:border-primary-300 hover:bg-primary-50/30"
      >
        {body}
      </Link>
    )
  }
  return (
    <button
      onClick={onClick}
      className="flex h-20 flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white transition-colors hover:border-primary-300 hover:bg-primary-50/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
    >
      {body}
    </button>
  )
}

function ComingSoonNote({ feature }: { feature: string }) {
  return (
    <p className="text-center text-sm text-gray-500">
      {feature} is not available yet for this event.
    </p>
  )
}

export default function EventHomePage() {
  const eventId = useEventModeId()
  const { event, eventBasePath, connectOpen, setConnectOpen } = useEventModeOutlet()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [checkedIn, setCheckedIn] = useState<boolean | null>(null)
  const [myConnectionCount, setMyConnectionCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!user) return
      // Registration + check-in live on the same row; checked_in_at is the
      // authoritative arrival signal. Read-only here: check-in state changes
      // only through the organizer's secure check-in RPCs.
      const { data } = await supabase
        .from('event_registrations')
        .select('id, checked_in_at')
        .eq('event_id', eventId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (cancelled) return
      setCheckedIn(!!data?.checked_in_at)
      setMyConnectionCount(null)

      const { count } = await supabase
        .from('connections')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', user.id)
        .eq('event_id', eventId)
      if (!cancelled) setMyConnectionCount(count ?? 0)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [eventId, user])

  const tiles = [
    { key: 'agenda', label: 'Agenda', icon: CalendarRange },
    { key: 'attendees', label: 'Attendees', icon: Users, onClick: () => navigate(`${eventBasePath}/network`) },
    { key: 'speakers', label: 'Speakers', icon: Mic },
    { key: 'exhibitors', label: 'Exhibitors', icon: Store },
    { key: 'schedule', label: 'My Schedule', icon: CalendarClock },
    { key: 'map', label: 'Map', icon: Map },
  ]

  return (
    <div className="space-y-5">
      {/* 1. Event identity */}
      <section>
        <h1 className="text-2xl font-bold text-gray-900">{event.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
          {event.start_date && (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {new Date(event.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {event.end_date && event.end_date !== event.start_date
                ? ` – ${new Date(event.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : ''}
            </span>
          )}
          {event.location && <span>{event.location}</span>}
        </div>
      </section>

      {/* 2. Check-in status — read-only, driven by the organizer check-in data */}
      <section>
        {checkedIn === null ? (
          <Badge variant="gray">Registration not found</Badge>
        ) : checkedIn ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-700">
            <CheckCircle2 className="h-4 w-4" /> Checked in
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500">
            <Circle className="h-4 w-4" /> Not checked in
          </span>
        )}
      </section>

      {/* 3. CONNECT — the primary action of Event Mode */}
      <section>
        <button
          onClick={() => setConnectOpen(true)}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-[#0A66C2] py-8 text-white shadow-sm transition-colors',
            'hover:bg-[#095cad] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A66C2] focus-visible:ring-offset-2'
          )}
        >
          <ScanLine className="h-7 w-7" aria-hidden="true" />
          <span className="text-lg font-bold tracking-wide">CONNECT</span>
          <span className="text-xs text-white/85">Scan to connect</span>
        </button>
        {myConnectionCount !== null && myConnectionCount > 0 && (
          <p className="mt-2 text-center text-xs text-gray-500">
            You've made {myConnectionCount} connection{myConnectionCount === 1 ? '' : 's'} at {event.name}.
          </p>
        )}
      </section>

      {/* 4. Event navigation tiles */}
      <section>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
          {tiles.map((tile) => (
            <Tile key={tile.key} icon={tile.icon} label={tile.label} onClick={tile.onClick} />
          ))}
        </div>
      </section>

      {/* 5. Happening Now / Next Up — only with real agenda data */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Happening now</h2>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-error-50 text-error-600">
              <Radio className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">No schedule published</p>
              <p className="text-xs text-gray-500">When the organizer publishes an agenda, the current session will appear here.</p>
            </div>
          </CardContent>
        </Card>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Next up</h2>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <ArrowRight className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Nothing scheduled yet</p>
              <p className="text-xs text-gray-500">Upcoming sessions will be listed here once an agenda exists.</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <ComingSoonNote feature="Agenda, speakers, exhibitors, My Schedule and Map" />

      <EventModeConnectFlow
        event={event}
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        userId={user?.id ?? ''}
      />
    </div>
  )
}
