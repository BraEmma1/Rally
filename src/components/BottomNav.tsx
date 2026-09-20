import { NavLink } from 'react-router-dom'
import { Home, Users, ScanLine, Target, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'

// Fixed attendee bottom navigation. "More" is a button that opens the side
// drawer rather than a route, so it is rendered separately from the NavLinks.
export default function BottomNav({
  onMore,
  connectActive,
  onConnect,
}: {
  onMore: () => void
  connectActive: boolean
  onConnect: () => void
}) {
  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors',
      isActive ? 'text-primary-600' : 'text-gray-500 hover:text-gray-700'
    )

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <NavLink to="/dashboard" className={itemClass} aria-label="Home">
        {({ isActive }) => (
          <>
            <Home className={cn('h-5 w-5', isActive && 'fill-primary-100')} aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Home</span>
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

      {/* Elevated center Connect action */}
      <div className="relative flex flex-1 items-start justify-center">
        <button
          onClick={onConnect}
          aria-label="Connect"
          aria-expanded={connectActive}
          className={cn(
            '-mt-5 flex h-14 w-14 flex-col items-center justify-center rounded-full text-white shadow-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2',
            connectActive ? 'bg-primary-700' : 'bg-primary-600 hover:bg-primary-700'
          )}
        >
          <ScanLine className="h-6 w-6" aria-hidden="true" />
        </button>
        <span className="mt-9 text-[11px] font-medium text-gray-500">Connect</span>
      </div>

      <NavLink to="/opportunities" className={itemClass} aria-label="Pipeline">
        {({ isActive }) => (
          <>
            <Target className="h-5 w-5" aria-hidden="true" />
            <span className={isActive ? 'font-semibold' : undefined}>Pipeline</span>
          </>
        )}
      </NavLink>

      <button
        onClick={onMore}
        aria-label="More menu"
        aria-haspopup="dialog"
        className="flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
        More
      </button>
    </nav>
  )
}
