import { useState } from 'react'
import { NavLink, useNavigate, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
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
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/connections', label: 'Connections', icon: Users },
  { to: '/messages', label: 'Messages', icon: MessagesSquare },
  { to: '/scan', label: 'Scan QR', icon: QrCode },
  { to: '/events', label: 'Events', icon: Calendar },
  { to: '/follow-ups', label: 'Follow-ups', icon: CalendarClock },
  { to: '/opportunities', label: 'Opportunities', icon: Target },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/profile', label: 'My Profile', icon: UserIcon },
]

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-600 px-1 text-[10px] font-semibold text-white">
      {count > 99 ? '99+' : count}
    </span>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('rally.sidebarCollapsed') === '1'
  )
  const [orgsOpen, setOrgsOpen] = useState(false)

  function toggleSidebar() {
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

  // Organization entry point, desktop. Same data as the mobile More drawer:
  // only loaded, real memberships produce rows, and selecting one sets the
  // active organization context before the organizer layout opens.
  function organizationSection() {
    if (orgLoading || memberships.length === 0) return null
    if (sidebarCollapsed) {
      return (
        <div className="border-t border-gray-200 py-3">
          <p className="sr-only">My Organizations</p>
          <div className="flex flex-col items-center gap-1">
            {memberships.map((m) => (
              <NavLink
                key={m.organization.id}
                to="/organizer"
                onClick={() => selectOrganization(m.organization.id)}
                title={`${m.organization.name} (${ORG_ROLE_LABELS[m.role]})`}
                aria-label={`Open organizer workspace: ${m.organization.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <Building2 className="h-4 w-4" />
              </NavLink>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="mt-4 border-t border-gray-200 pt-3">
        <button
          onClick={() => setOrgsOpen((prev) => !prev)}
          aria-expanded={orgsOpen}
          className="flex w-full items-center justify-between rounded-md px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
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
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  )
                }
              >
                <Building2 className="h-4 w-4" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.organization.name}</span>
                  <span className="block truncate text-xs font-normal text-gray-500">
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

  return (
    <div
      className={cn(
        'bg-gray-50',
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
          'fixed inset-y-0 left-0 z-30 hidden border-r border-gray-200 bg-white transition-[width] duration-200 md:flex md:flex-col',
          sidebarCollapsed ? 'w-16' : 'w-60'
        )}
      >
        <div
          className={cn(
            'flex h-16 shrink-0 items-center border-b border-gray-200',
            sidebarCollapsed ? 'flex-col justify-center gap-1' : 'gap-2 px-5'
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-600 text-white">
            <Users className="h-5 w-5" />
          </div>
          {!sidebarCollapsed && <span className="text-lg font-bold text-gray-900">Rally</span>}
          <button
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            {sidebarCollapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className={cn('flex-1 py-4', sidebarCollapsed ? 'space-y-1 px-2' : 'space-y-1 px-3')}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={sidebarCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  sidebarCollapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              <span className="relative shrink-0">
                <item.icon className="h-4 w-4" />
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
          ))}
        </nav>

        {organizationSection()}

        <div
          className={cn(
            'border-t border-gray-200 p-3',
            sidebarCollapsed && 'flex flex-col items-center'
          )}
        >
          <div
            className={cn(
              'items-center gap-3',
              sidebarCollapsed ? 'flex justify-center' : 'flex px-2 py-2'
            )}
          >
            <Avatar name={displayName} src={profile?.photo_url} size="sm" />
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{displayName}</p>
                <p className="truncate text-xs text-gray-500">{profile?.job_title || 'No title set'}</p>
              </div>
            )}
          </div>
          <button
            onClick={handleSignOut}
            title={sidebarCollapsed ? 'Sign out' : undefined}
            className={cn(
              'mt-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900',
              sidebarCollapsed && 'justify-center px-0'
            )}
          >
            <LogOut className="h-4 w-4" />
            {!sidebarCollapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Desktop top header: centered search, right-side actions. Branding
          lives in the sidebar's top-left, so it is not duplicated here. */}
      <header
        className={cn(
          'sticky top-0 z-20 hidden h-16 items-center gap-4 border-b border-gray-200 bg-white pr-6 md:flex',
          sidebarCollapsed ? 'md:pl-[5rem]' : 'md:pl-[17rem]'
        )}
      >
        <div className="flex flex-1 justify-center">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-10 w-full max-w-xl items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 text-left text-sm text-gray-400 transition-colors hover:border-primary-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            aria-label="Search Rally"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Search connections, companies, events…
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/notifications')}
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            className="relative rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            <UnreadBadge count={unreadCount} />
          </button>
        </div>
      </header>

      {/* Mobile top header */}
      {!inConversation && (
      <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-3 md:hidden">
        <div className="flex items-center gap-2 pl-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-white">
            <Users className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold text-gray-900">Rally</span>
        </div>
        <div className="flex items-center">
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="rounded-md p-2.5 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            onClick={() => navigate('/notifications')}
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            className="relative rounded-md p-2.5 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
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
          sidebarCollapsed ? 'md:pl-16' : 'md:pl-60',
          inConversation ? 'min-h-0 flex-1 overflow-hidden' : 'pb-20 md:pb-0'
        )}
      >
        <div
          className={cn(
            'mx-auto max-w-5xl',
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
