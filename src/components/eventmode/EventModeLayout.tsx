import { useEffect, useState } from 'react'
import { Link, Outlet, useNavigate, useOutletContext, useLocation } from 'react-router-dom'
import { ArrowLeft, Bell, MoreVertical } from 'lucide-react'
import { supabase, type EventRow } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useEventModeId } from '@/context/EventModeContext'
import { useNotifications } from '@/context/NotificationContext'
import EventModeBottomNav from '@/components/eventmode/EventModeBottomNav'
import EventModeDrawer from '@/components/eventmode/EventModeDrawer'
import EventModeSidebar from '@/components/eventmode/EventModeSidebar'
import EventConnectSheet from '@/components/eventmode/EventConnectSheet'
import EventModeConnectFlow from '@/components/eventmode/EventModeConnectFlow'
import { LoadingState, ErrorState } from '@/components/ui/States'
import { cn } from '@/lib/utils'

// Event Mode shell. The Event Home page renders its own hero (branding, event
// identity, notification bell), so the compact header only appears on the
// inner pages. The bottom-nav CONNECT action opens a two-option sheet
// (Scan QR Code / My QR Code); scanning hands off to the existing connect flow.
// From md up the bottom bar gives way to a sidebar with the same destinations;
// phones keep the bottom bar and the More drawer.
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
  // Tablet sidebar: icon rail by default, full sidebar when opened.
  const [tabletOpen, setTabletOpen] = useState(false)
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
  // A conversation renders its own header -- the other person's name, avatar
  // and a back arrow -- so the generic event header would be a second, less
  // useful one stacked above it.
  const onConversation = location.pathname.startsWith(`${eventBasePath}/messages/`)
  // Connection detail also renders its own header (the person's name, a back
  // arrow and an options menu), so the generic event header would stack a
  // second, less useful one above it -- same reasoning as a conversation.
  const onConnection = location.pathname.startsWith(`${eventBasePath}/connections/`)

  return (
    <div className={cn('flex min-h-screen flex-col bg-rally-canvas supports-[height:100dvh]:min-h-[100dvh] lg:pl-64', tabletOpen ? 'md:pl-64' : 'md:pl-[4.5rem]')}>
      <EventModeSidebar
        event={event}
        eventBasePath={eventBasePath}
        unreadCount={unreadCount}
        onConnect={() => setSheetOpen(true)}
        tabletOpen={tabletOpen}
        onTabletOpenChange={setTabletOpen}
      />

      {/* Compact header for inner pages only; the home page's hero carries the
          event identity and bell itself. */}
      {!onHome && !onConversation && !onConnection && (
        <header className="sticky top-0 z-30 border-b border-rally-line bg-white">
          <div className="flex h-14 items-center gap-2 px-3">
            <button
              onClick={() => navigate(`${eventBasePath}/home`)}
              aria-label="Back to event home"
              className="rounded-xl p-2.5 text-slate-600 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 md:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-bold leading-tight text-rally-navy md:text-lg">{event.name}</p>
            </div>
            <button
              onClick={() => setMoreOpen(true)}
              aria-label="More menu"
              aria-haspopup="dialog"
              className="relative rounded-xl p-2.5 text-slate-600 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 md:hidden"
            >
              <MoreVertical className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error-600" />
              )}
            </button>
            {/* Desktop: the sidebar replaces the More menu, so the bell lives here. */}
            <Link
              to="/notifications"
              aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
              className="relative hidden rounded-xl p-2.5 text-slate-600 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 md:block"
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-600 px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          </div>
        </header>
      )}

      <main className="flex-1 pb-24 md:pb-8">
        <Outlet context={{ event, eventBasePath, openScan: () => setScanOpen(true), openConnect: () => setSheetOpen(true) }} />
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
        onSendRequest={() => {
          setSheetOpen(false)
          navigate(`${eventBasePath}/network`)
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
  // Opens the QR scanner directly.
  openScan: () => void
  // Opens the Connect sheet (Scan QR Code / My QR Code), same as the bottom-bar button.
  openConnect: () => void
}

export function useEventModeOutlet(): EventModeOutletContext {
  return useOutletContext<EventModeOutletContext>()
}
