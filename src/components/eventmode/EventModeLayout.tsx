import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useOutletContext, useLocation } from 'react-router-dom'
import { ArrowLeft, MoreVertical, Calendar, MapPin } from 'lucide-react'
import { supabase, type EventRow } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useEventModeId } from '@/context/EventModeContext'
import { useNotifications } from '@/context/NotificationContext'
import EventModeBottomNav from '@/components/eventmode/EventModeBottomNav'
import EventModeDrawer from '@/components/eventmode/EventModeDrawer'
import EventConnectSheet from '@/components/eventmode/EventConnectSheet'
import EventModeConnectFlow from '@/components/eventmode/EventModeConnectFlow'
import { LoadingState, ErrorState } from '@/components/ui/States'
import { formatDate } from '@/lib/utils'

// Event Mode shell. The Event Home page renders its own hero (branding, event
// identity, notification bell), so the compact header only appears on the
// inner pages. The bottom-nav CONNECT action opens a two-option sheet
// (Scan QR Code / My QR Code); scanning hands off to the existing connect flow.
export default function EventModeLayout() {
  const eventId = useEventModeId()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { unreadCount } = useNotifications()
  const [event, setEvent] = useState<EventRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setError('Event not found.')
          setLoading(false)
          return
        }
        setEvent(data as EventRow)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [eventId])

  if (loading) return <div className="flex min-h-screen items-center justify-center"><LoadingState message="Opening event…" /></div>
  if (error || !event) return <ErrorState message={error || 'Event not found.'} />

  const eventBasePath = `/events/${eventId}`
  const onHome = location.pathname === `${eventBasePath}/home` || location.pathname === eventBasePath
  const dateLabel = event.start_date
    ? `${formatDate(event.start_date)}${event.end_date && event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ''}`
    : 'Dates to be announced'

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 supports-[height:100dvh]:min-h-[100dvh]">
      {/* Compact header for inner pages only; the home page's hero carries the
          event identity and bell itself. */}
      {!onHome && (
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
          <div className="flex h-14 items-center gap-2 px-3">
            <button
              onClick={() => navigate(`${eventBasePath}/home`)}
              aria-label="Back to event home"
              className="rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold leading-tight text-gray-900">{event.name}</p>
              <p className="flex items-center gap-2 truncate text-xs text-gray-500">
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{dateLabel}</span>
                {event.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{event.location}</span>}
              </p>
            </div>
            <button
              onClick={() => setMoreOpen(true)}
              aria-label="More menu"
              aria-haspopup="dialog"
              className="relative rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <MoreVertical className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error-600" />
              )}
            </button>
          </div>
        </header>
      )}

      <main className="flex-1 pb-24">
        <Outlet context={{ event, eventBasePath, openScan: () => setScanOpen(true) }} />
      </main>

      <EventModeBottomNav
        eventBasePath={eventBasePath}
        onConnect={() => setSheetOpen(true)}
        onMore={() => setMoreOpen(true)}
      />
      <EventConnectSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onScan={() => {
          setSheetOpen(false)
          setScanOpen(true)
        }}
        event={event}
      />
      <EventModeConnectFlow
        event={event}
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        userId={user?.id ?? ''}
      />
      <EventModeDrawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        eventBasePath={eventBasePath}
        eventName={event.name}
      />
    </div>
  )
}

// Re-export for pages to type the Outlet context without importing the layout.
export type EventModeOutletContext = {
  event: EventRow
  eventBasePath: string
  openScan: () => void
}

export function useEventModeOutlet(): EventModeOutletContext {
  return useOutletContext<EventModeOutletContext>()
}
