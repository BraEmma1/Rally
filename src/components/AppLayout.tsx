import { useEffect, useState } from 'react'
import { NavLink, Link, useNavigate, Outlet, useLocation } from 'react-router-dom'
import {
  Home,
  Users,
  MessagesSquare,
  Calendar,
  QrCode,
  CalendarClock,
  Target,
  Bell,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Search,
  Building2,
  User as UserIcon,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { ORG_ROLE_LABELS } from '@/lib/supabase'
import { Avatar } from '@/components/ui/Avatar'
import MobileDrawer from '@/components/MobileDrawer'
import BottomNav from '@/components/BottomNav'
import GlobalSearchDialog from '@/components/GlobalSearchDialog'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

// Labels follow the Rally Event UI ("Home", "Network") but every item still
// points at the route it always did: the design's Meetings & Deals, My Notes,
// Past Events and Saved have no page behind them, so they are not listed.
const navItems = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/events', label: 'Events', icon: Calendar },
  { to: '/connections', label: 'Network', icon: Users },
  { to: '/messages', label: 'Messages', icon: MessagesSquare },
  { to: '/follow-ups', label: 'Follow-ups', icon: CalendarClock },
  { to: '/opportunities', label: 'Opportunities', icon: Target },
  { to: '/scan', label: 'Scan QR', icon: QrCode },
  { to: '/notifications', label: 'Notifications', icon: Bell },
]

const profileItem = { to: '/profile', label: 'Profile', icon: UserIcon }

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-600 px-1 text-[10px] font-semibold text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}

function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-primary-600 font-display font-extrabold text-white',
        className
      )}
      aria-hidden="true"
    >
      R
    </div>
  )
}

export default function AppLayout() {
  const { profile, user, signOut } = useAuth()
  const { unreadCount } = useNotifications()
  const { memberships, loading: orgLoading, selectOrganization } = useOrganizer()
  const navigate = useNavigate()
  const location = useLocation()
  // Inside a chat the conversation owns the whole screen: its own header,
  // composer and safe-area handling replace the shell chrome until the user
  // backs out to the inbox.
  const inConversation = /^\/messages\/[^/]+$/.test(location.pathname)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [userCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('rally.sidebarCollapsed') === '1'
  )
  // Tablets rest on the icon rail. The arrow opens the full sidebar and the page
  // content moves over to make room (nothing is covered); the close arrow goes
  // back to icons only. From lg up the arrow does the same and remembers the
  // choice.
  const wide = useMediaQuery('(min-width: 1024px)')
  const [tabletOpen, setTabletOpen] = useState(false)
  const sidebarCollapsed = wide ? userCollapsed : !tabletOpen
  const contentCollapsed = sidebarCollapsed
  useEffect(() => {
    setTabletOpen(false)
  }, [wide])
  const [orgsOpen, setOrgsOpen] = useState(false)

  function toggleSidebar() {
    if (!wide) {
      setTabletOpen((prev) => !prev)
      return
    }
    setSidebarCollapsed((prev) => {
      localStorage.setItem('rally.sidebarCollapsed', prev ? '0' : '1')
      return !prev
    })
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const displayName = profile?.full_name || user?.email || 'User'

  function navLinkClass(isActive: boolean) {
    return cn(
      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
      sidebarCollapsed && 'justify-center px-0',
      isActive
        ? 'bg-primary-600 text-white'
        : 'text-rally-sidebar-text hover:bg-primary-600/70 hover:text-white'
    )
  }

  // Organization entry point, desktop. Same data as the mobile More drawer:
  // only loaded, real memberships produce rows, and selecting one sets the
  // active organization context before the organizer layout opens.
  function organizationSection() {
    if (orgLoading || memberships.length === 0) return null
    if (sidebarCollapsed) {
      return (
        <div className="border-t border-white/10 py-3">
          <p className="sr-only">My Organizations</p>
          <div className="flex flex-col items-center gap-1">
            {memberships.map((m) => (
              <NavLink
                key={m.organization.id}
                to="/organizer"
                onClick={() => selectOrganization(m.organization.id)}
                title={`${m.organization.name} (${ORG_ROLE_LABELS[m.role]})`}
                aria-label={`Open organizer workspace: ${m.organization.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-rally-sidebar-text transition-colors hover:bg-primary-600/70 hover:text-white"
              >
                <Building2 className="h-4 w-4" />
              </NavLink>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="mt-4 border-t border-white/10 px-3 pt-3">
        <button
          onClick={() => setOrgsOpen((prev) => !prev)}
          aria-expanded={orgsOpen}
          className="flex w-full items-center justify-between rounded-md px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-rally-sidebar-text/70 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          My Organizations
          <ChevronDown
            className={cn('h-4 w-4 transition-transform duration-200', orgsOpen && 'rotate-180')}
          />
        </button>
        {orgsOpen && (
          <div className="mt-1 space-y-1">
            {memberships.map((m) => (
              <NavLink
                key={m.organization.id}
                to="/organizer"
                onClick={() => selectOrganization(m.organization.id)}
                className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-rally-sidebar-text transition-colors hover:bg-primary-600/70 hover:text-white"
              >
                <Building2 className="h-4 w-4" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.organization.name}</span>
                  <span className="block truncate text-xs font-normal text-rally-sidebar-text/70">
                    {ORG_ROLE_LABELS[m.role]}
                  </span>
                </span>
              </NavLink>
            ))}
          </div>
        )}
      </div>
    )
  }

  function renderNavItem(item: { to: string; label: string; icon: typeof Home }) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        title={sidebarCollapsed ? item.label : undefined}
        className={({ isActive }) => navLinkClass(isActive)}
      >
        <span className="relative shrink-0">
          <item.icon className="h-5 w-5" aria-hidden="true" />
          {sidebarCollapsed && item.to === '/notifications' && unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-600 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </span>
        {!sidebarCollapsed && (
          <>
            <span className="flex-1">{item.label}</span>
            {item.to === '/notifications' && unreadCount > 0 && (
              <span className="rounded-full bg-error-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </>
        )}
      </NavLink>
    )
  }

  return (
    <div
      className={cn(
        'bg-rally-canvas',
        // In a conversation the shell is a fixed-height app frame so the page
        // itself never scrolls; h-screen is the fallback for browsers without
        // dynamic viewport units.
        inConversation
          ? 'flex h-screen flex-col overflow-hidden supports-[height:100dvh]:h-[100dvh]'
          : 'min-h-screen'
      )}
    >
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 hidden bg-rally-ink transition-[width] duration-200 md:flex md:flex-col',
          'z-30',
          sidebarCollapsed ? (wide ? 'w-16' : 'w-[4.5rem]') : 'w-64'
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center',
            sidebarCollapsed ? 'flex-col justify-center gap-2 py-4' : 'gap-3 px-5 pb-4 pt-6'
          )}
        >
          <BrandMark className="h-10 w-10 text-xl" />
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <span className="block font-display text-lg font-bold leading-none tracking-tight text-white">
                Rally
              </span>
              <span className="mt-1 block text-[11px] leading-tight text-rally-sidebar-text">
                Events. People. Opportunities.
              </span>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-rally-sidebar-text transition-colors hover:bg-primary-600/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {sidebarCollapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav
          aria-label="Main"
          className={cn(
            'flex-1 overflow-y-auto py-2',
            sidebarCollapsed ? 'space-y-1 px-2' : 'space-y-1 px-4'
          )}
        >
          {navItems.map(renderNavItem)}
          <div className="my-3 h-px bg-white/10" aria-hidden="true" />
          {renderNavItem(profileItem)}
        </nav>

        {organizationSection()}

        <div className={cn('border-t border-white/10 p-3', sidebarCollapsed && 'flex flex-col items-center')}>
          <button
            onClick={handleSignOut}
            title={sidebarCollapsed ? 'Sign out' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-rally-sidebar-text transition-colors hover:bg-primary-600/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
              sidebarCollapsed && 'justify-center px-0'
            )}
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            {!sidebarCollapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Desktop top header: search, notifications, the signed-in person. */}
      <header
        className={cn(
          'sticky top-0 z-20 hidden h-16 items-center gap-4 border-b border-rally-line bg-white pr-6 md:flex',
          contentCollapsed ? (wide ? 'md:pl-[5rem]' : 'md:pl-[6.5rem]') : 'md:pl-[17rem]'
        )}
      >
        <div className="flex flex-1">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-10 w-full max-w-xl items-center gap-3 rounded-xl border border-rally-line bg-rally-canvas px-4 text-left text-sm text-slate-500 transition-colors hover:border-primary-300 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            aria-label="Search Rally"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Search connections, companies, events…
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/notifications')}
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            className="relative rounded-xl p-2 text-slate-600 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            <UnreadBadge count={unreadCount} />
          </button>
          <div className="h-8 w-px bg-rally-line" aria-hidden="true" />
          <Link
            to="/profile"
            className="flex items-center gap-3 rounded-xl py-1 pl-1 pr-2 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Avatar name={displayName} src={profile?.photo_url} size="sm" />
            <span className="hidden min-w-0 text-left lg:block">
              <span className="block max-w-[11rem] truncate text-sm font-semibold text-rally-navy">
                {displayName}
              </span>
              {profile?.job_title && (
                <span className="block max-w-[11rem] truncate text-xs text-slate-500">
                  {profile.job_title}
                </span>
              )}
            </span>
          </Link>
        </div>
      </header>

      {/* Mobile top header */}
      {!inConversation && (
        <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-rally-line bg-white px-3 md:hidden">
          <Link to="/dashboard" className="flex items-center gap-2 pl-1" aria-label="Rally home">
            <BrandMark className="h-8 w-8 text-base" />
            <span className="font-display text-lg font-bold tracking-tight text-rally-navy">Rally</span>
          </Link>
          <div className="flex items-center">
            <button
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              className="rounded-xl p-2.5 text-slate-600 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              onClick={() => navigate('/notifications')}
              aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
              className="relative rounded-xl p-2.5 text-slate-600 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <Bell className="h-5 w-5" />
              <UnreadBadge count={unreadCount} />
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main
        className={cn(
          contentCollapsed ? (wide ? 'md:pl-16' : 'md:pl-[4.5rem]') : 'md:pl-64',
          inConversation ? 'min-h-0 flex-1 overflow-hidden' : 'pb-20 md:pb-0'
        )}
      >
        <div
          className={cn(
            'mx-auto max-w-6xl',
            inConversation ? 'h-full md:max-w-3xl' : 'px-4 py-6 md:px-8 md:py-8'
          )}
        >
          <Outlet />
        </div>
      </main>

      {!inConversation && (
      <BottomNav
        onMore={() => setMobileOpen(true)}
      />
      )}
      <GlobalSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </div>
  )
}
