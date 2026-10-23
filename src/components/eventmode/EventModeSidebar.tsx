import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Bell,
  BookmarkCheck,
  Calendar,
  CalendarRange,
  LogOut,
  MessagesSquare,
  Mic,
  ScanLine,
  Store,
  User as UserIcon,
  Users,
  Home,
  Info,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import type { EventRow } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn, formatDateRange } from '@/lib/utils'

interface EventModeSidebarProps {
  event: EventRow
  eventBasePath: string
  unreadCount: number
  onConnect: () => void
  // Tablet only: whether the full sidebar is open (otherwise the icon rail).
  tabletOpen: boolean
  onTabletOpenChange: (open: boolean) => void
}

// Event Mode desktop navigation (md and up). On phones the bottom bar and the
// More drawer carry the same destinations. Every item points at a route that
// exists; /info, /map and /deal-room are still "coming soon" pages, so they are
// not advertised here (the Event Home tiles and the More drawer still reach them).
export default function EventModeSidebar({ event, eventBasePath, unreadCount, onConnect, tabletOpen, onTabletOpenChange }: EventModeSidebarProps) {
  const { profile, user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const displayName = profile?.full_name || user?.email || 'User'
  // Tablets (md to lg) rest on an icon rail; the arrow opens the full sidebar
  // and the page makes room for it. From lg up the sidebar is always full.
  const wide = useMediaQuery('(min-width: 1024px)')
  const compact = !wide && !tabletOpen

  const items: { to: string; label: string; icon: typeof Home; extraActive?: string; end?: boolean }[] = [
    // The way back to the public event page for this event.
    { to: eventBasePath, label: 'Event Details', icon: Info, end: true },
    { to: `${eventBasePath}/home`, label: 'Event Home', icon: Home },
    // A connection opened from the directory keeps the directory highlighted.
    { to: `${eventBasePath}/network`, label: 'Attendee Directory', icon: Users, extraActive: `${eventBasePath}/connections/` },
    { to: `${eventBasePath}/agenda`, label: 'Agenda', icon: CalendarRange },
    { to: `${eventBasePath}/schedule`, label: 'My Schedule', icon: BookmarkCheck },
    { to: `${eventBasePath}/speakers`, label: 'Speakers', icon: Mic },
    { to: `${eventBasePath}/exhibitors`, label: 'Exhibitors', icon: Store },
    { to: `${eventBasePath}/messages`, label: 'Messages', icon: MessagesSquare },
  ]

  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
      compact && 'justify-center px-0',
      active ? 'bg-primary-600 text-white' : 'text-rally-sidebar-text hover:bg-primary-600/70 hover:text-white'
    )

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <aside className={cn('fixed inset-y-0 left-0 z-30 hidden flex-col bg-rally-ink md:flex', compact ? 'w-[4.5rem]' : 'w-64')}>
      <div className={cn('flex items-center gap-3', compact ? 'justify-center px-2 pb-3 pt-5' : 'px-5 pb-4 pt-6')}>
        <Link to="/dashboard" aria-label="Rally home" className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-600 font-display text-xl font-extrabold text-white"
            aria-hidden="true"
          >
            R
          </div>
          {!compact && (
            <div className="min-w-0">
              <span className="block font-display text-lg font-bold leading-none tracking-tight text-white">Rally</span>
              <span className="mt-1 block text-[11px] leading-tight text-rally-sidebar-text">Events. People. Opportunities.</span>
            </div>
          )}
        </Link>
        {!wide && !compact && (
          <button
            type="button"
            onClick={() => onTabletOpenChange(false)}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg text-rally-sidebar-text transition-colors hover:bg-primary-600/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {compact && (
        <div className="flex justify-center px-3 pb-1">
          <button
            type="button"
            onClick={() => onTabletOpenChange(true)}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="flex h-8 w-full items-center justify-center rounded-lg text-rally-sidebar-text transition-colors hover:bg-primary-600/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {!compact && (
        <div className="mx-4 rounded-xl bg-white/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-rally-sidebar-text/70">Event Mode</p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-white">{event.name}</p>
          <p className="mt-0.5 text-xs text-rally-sidebar-text">{formatDateRange(event.start_date, event.end_date)}</p>
        </div>
      )}

      <div className={compact ? 'px-3 pt-2' : 'px-4 pt-4'}>
        <button
          type="button"
          onClick={onConnect}
          aria-haspopup="dialog"
          aria-label="Connect"
          title={compact ? 'Connect' : undefined}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <ScanLine className="h-5 w-5" aria-hidden="true" />
          {!compact && 'Connect'}
        </button>
      </div>

      <nav aria-label="Event menu" className={cn('flex-1 space-y-1 overflow-y-auto py-4', compact ? 'px-3' : 'px-4')}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={compact ? item.label : undefined}
            aria-label={item.label}
            className={({ isActive }) =>
              linkClass(isActive || (!!item.extraActive && location.pathname.startsWith(item.extraActive)))
            }
          >
            <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            {!compact && <span className="flex-1">{item.label}</span>}
          </NavLink>
        ))}

        <div className="my-3 h-px bg-white/10" aria-hidden="true" />

        <NavLink to="/events" end title={compact ? 'All Events' : undefined} aria-label="All Events" className={({ isActive }) => linkClass(isActive)}>
          <Calendar className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!compact && <span className="flex-1">All Events</span>}
        </NavLink>
        <NavLink to="/notifications" title={compact ? 'Notifications' : undefined} aria-label="Notifications" className={({ isActive }) => cn(linkClass(isActive), 'relative')}>
          <Bell className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!compact && <span className="flex-1">Notifications</span>}
          {compact && unreadCount > 0 && (
            <span className="absolute right-2 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-600 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
          {!compact && unreadCount > 0 && (
            <span className="rounded-full bg-error-600 px-1.5 py-0.5 text-xs font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </NavLink>
        <NavLink to="/profile" title={compact ? 'My Profile' : undefined} aria-label="My Profile" className={({ isActive }) => linkClass(isActive)}>
          <UserIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!compact && <span className="flex-1">My Profile</span>}
        </NavLink>
      </nav>

      <div className={cn('space-y-1 border-t border-white/10', compact ? 'p-3' : 'p-4')}>
        <Link to="/dashboard" title={compact ? 'Exit Event Mode' : undefined} aria-label="Exit Event Mode" className={linkClass(false)}>
          <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!compact && 'Exit Event Mode'}
        </Link>
        <button type="button" onClick={handleSignOut} title={compact ? 'Sign out' : undefined} aria-label="Sign out" className={cn(linkClass(false), 'w-full')}>
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!compact && 'Sign out'}
        </button>
        <div className={cn('flex items-center gap-3 pt-2', compact ? 'justify-center' : 'px-3')} title={compact ? displayName : undefined}>
          <Avatar name={displayName} src={profile?.photo_url} size="sm" />
          {!compact && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{displayName}</p>
              {profile?.job_title && <p className="truncate text-xs text-rally-sidebar-text">{profile.job_title}</p>}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
