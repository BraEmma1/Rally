import { NavLink } from 'react-router-dom'
import { CalendarRange, Home, Menu, UserCircle, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

// Fixed organizer bottom navigation, distinct from the attendee bar so neither
// experience leaks into the other. "More" opens the organizer drawer instead of
// routing, so it is a button rendered alongside the NavLinks.
export default function OrganizerBottomNav({ onMore }: { onMore: () => void }) {
  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-[48px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors motion-reduce:transition-none',
      isActive ? 'text-primary-600' : 'text-gray-500 hover:text-gray-700'
    )

  return (
    <nav
      aria-label="Organizer"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <NavLink to="/organizer" end className={itemClass} aria-label="Home">
        {({ isActive }) => (
          <>
            <Home className={cn('h-5 w-5', isActive && 'fill-primary-100')} aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Home</span>
          </>
        )}
      </NavLink>

      <NavLink to="/organizer/events" className={itemClass} aria-label="Events">
        {({ isActive }) => (
          <>
            <CalendarRange className="h-5 w-5" aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Events</span>
          </>
        )}
      </NavLink>

      <NavLink to="/organizer/people" className={itemClass} aria-label="People">
        {({ isActive }) => (
          <>
            <UserCircle className="h-5 w-5" aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>People</span>
          </>
        )}
      </NavLink>

      <NavLink to="/organizer/team" className={itemClass} aria-label="Team">
        {({ isActive }) => (
          <>
            <Users className="h-5 w-5" aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Team</span>
          </>
        )}
      </NavLink>

      <button
        onClick={onMore}
        aria-label="More menu"
        aria-haspopup="dialog"
        className="flex min-h-[48px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:text-gray-700 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
        More
      </button>
    </nav>
  )
}
