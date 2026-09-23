import { NavLink } from 'react-router-dom'
import { Home, Users, ScanLine, MessagesSquare, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'

// Event Mode's own bottom navigation: Home | Network | CONNECT | Messages | More.
// The center CONNECT item keeps the same lifted circular-button pattern as the
// main app's BottomNav, but opens the Event Mode connect sheet via onConnect.
// Rendered at every viewport size: inside Event Mode this bar (and only this
// bar) is the navigation, including on desktop.
export default function EventModeBottomNav({
  eventBasePath,
  onConnect,
  onMore,
}: {
  eventBasePath: string
  onConnect: () => void
  onMore: () => void
}) {
  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors motion-reduce:transition-none',
      isActive ? 'text-primary-600' : 'text-gray-500 hover:text-gray-700'
    )

  return (
    <nav
      aria-label="Event navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <NavLink to={`${eventBasePath}/home`} className={itemClass} aria-label="Event home">
        {({ isActive }) => (
          <>
            <Home className={cn('h-5 w-5', isActive && 'fill-primary-100')} aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Home</span>
          </>
        )}
      </NavLink>

      <NavLink to={`${eventBasePath}/network`} className={itemClass} aria-label="Event network">
        {({ isActive }) => (
          <>
            <Users className="h-5 w-5" aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Network</span>
          </>
        )}
      </NavLink>

      <div className="flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center px-1">
        <button
          onClick={onConnect}
          aria-label="Connect"
          aria-haspopup="dialog"
          className="-mt-6 mb-1 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white shadow-md transition-colors motion-reduce:transition-none hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
        >
          <ScanLine className="h-6 w-6" aria-hidden="true" />
        </button>
        <span className="text-[11px] font-medium text-gray-500">Connect</span>
      </div>

      <NavLink
        to={`${eventBasePath}/messages`}
        className={itemClass}
        aria-label="Messages"
      >
        {({ isActive }) => (
          <>
            <MessagesSquare className="h-5 w-5" aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Messages</span>
          </>
        )}
      </NavLink>

      <button
        onClick={onMore}
        aria-label="More menu"
        aria-haspopup="dialog"
        className="flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:text-gray-700 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
        More
      </button>
    </nav>
  )
}
