import { NavLink } from 'react-router-dom'
import { Home, Calendar, Users, MessagesSquare, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUnreadMessages } from '@/lib/useUnreadMessages'

// Fixed attendee bottom navigation. "More" is a button that opens the side
// drawer rather than a route, so it is rendered separately from the NavLinks.
// No CONNECT item here: QR connecting is an Event Mode action and lives in the
// Event Mode navigation only.
export default function BottomNav({ onMore }: { onMore: () => void }) {
  const unread = useUnreadMessages()
  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors motion-reduce:transition-none',
      isActive ? 'text-primary-600' : 'text-slate-500 hover:text-slate-700'
    )

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-rally-line bg-white/95 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <NavLink to="/dashboard" className={itemClass} aria-label="Home">
        {({ isActive }) => (
          <>
            <Home className={cn('h-5 w-5', isActive && 'fill-primary-100')} aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Home</span>
          </>
        )}
      </NavLink>

      <NavLink to="/events" className={itemClass} aria-label="Events">
        {({ isActive }) => (
          <>
            <Calendar className="h-5 w-5" aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Events</span>
          </>
        )}
      </NavLink>

      <NavLink to="/connections" className={itemClass} aria-label="Network">
        {({ isActive }) => (
          <>
            <Users className="h-5 w-5" aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Network</span>
          </>
        )}
      </NavLink>

      <NavLink
        to="/messages"
        className={itemClass}
        aria-label={`Messages${unread > 0 ? `, ${unread} unread` : ''}`}
      >
        {({ isActive }) => (
          <>
            <span className="relative">
              <MessagesSquare className="h-5 w-5" aria-hidden="true" />
              {unread > 0 && (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error-600 px-1 text-[10px] font-semibold leading-none text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
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
