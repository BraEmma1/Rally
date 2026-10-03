import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Bell,
  Building2,
  CalendarRange,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Search,
  Settings,
  UserCircle,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import OrganizerBottomNav from '@/components/organizer/OrganizerBottomNav'
import OrganizerMobileDrawer from '@/components/organizer/OrganizerMobileDrawer'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/organizer', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/organizer/events', label: 'Events', icon: CalendarRange, end: false },
  { to: '/organizer/people', label: 'People', icon: UserCircle, end: false },
  { to: '/organizer/team', label: 'Team', icon: Users, end: false },
  { to: '/organizer/invitations', label: 'My invitations', icon: Mail, end: false },
  { to: '/organizer/settings', label: 'Settings', icon: Settings, end: false },
]

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-600 px-1 text-[10px] font-semibold text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}

function OrganizationSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { memberships, organization, selectOrganization } = useOrganizer()
  const [open, setOpen] = useState(false)

  if (!organization) return null

  // One organization is the common case; a dropdown for a single item is noise.
  if (memberships.length < 2) {
    return (
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
          <Building2 className="h-4 w-4" />
        </div>
        <p className="truncate text-sm font-medium text-gray-900">{organization.name}</p>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-gray-100"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
          <Building2 className="h-4 w-4" />
        </div>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{organization.name}</p>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          {memberships.map((m) => (
            <button
              key={m.organization.id}
              onClick={() => {
                selectOrganization(m.organization.id)
                setOpen(false)
                onNavigate?.()
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50',
                m.organization.id === organization.id ? 'font-medium text-primary-700' : 'text-gray-700'
              )}
            >
              <span className="min-w-0 flex-1 truncate">{m.organization.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function OrganizerLayout() {
  const { signOut, account, profile, user } = useAuth()
  const { role, organization } = useOrganizer()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('rally.sidebarCollapsed') === '1'
  )

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      localStorage.setItem('rally.sidebarCollapsed', prev ? '0' : '1')
      return !prev
    })
  }

  // An attendee on the team gets a way back to their own Rally; a full
  // organizer account has no attendee home to return to.
  const isAttendeeAccount = account?.account_type === 'attendee'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const nav = (onNavigate?: () => void) => (
    <nav className="space-y-1">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
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
          <item.icon className="h-4 w-4" />
          {!sidebarCollapsed && <span className="flex-1">{item.label}</span>}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-gray-50">
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
          {!sidebarCollapsed && (
            <>
              <span className="text-lg font-bold text-gray-900">Rally</span>
              <Badge variant="primary">Organizer</Badge>
            </>
          )}
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

        {!sidebarCollapsed && (
          <div className="border-b border-gray-200 px-3 py-3">
            <OrganizationSwitcher />
            {organization && role && (
              <p className="px-2 pt-1 text-xs text-gray-500">
                You are {role === 'admin' ? 'an' : 'a'} {role === 'manager' ? 'event manager' : role}
              </p>
            )}
          </div>
        )}

        <div className={cn('flex-1 py-4', sidebarCollapsed ? 'px-2' : 'px-3')}>{nav()}</div>

        <div className="border-t border-gray-200 p-3">
          {/* Context switch back to the attendee experience — not an account
              switch; the account never changed. */}
          {isAttendeeAccount && (
            <button
              onClick={() => navigate('/dashboard')}
              title={sidebarCollapsed ? 'Back to My Rally' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900',
                sidebarCollapsed && 'justify-center px-0'
              )}
            >
              <ArrowLeft className="h-4 w-4" />
              {!sidebarCollapsed && 'Back to My Rally'}
            </button>
          )}
          <button
            onClick={handleSignOut}
            title={sidebarCollapsed ? 'Sign out' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900',
              sidebarCollapsed && 'justify-center px-0'
            )}
          >
            <LogOut className="h-4 w-4" />
            {!sidebarCollapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Desktop top header: workspace context on the left, centered search,
          notifications on the right. No avatar — profile lives in the sidebar. */}
      <header
        className={cn(
          'sticky top-0 z-20 hidden h-16 items-center gap-4 border-b border-gray-200 bg-white pr-6 md:flex',
          sidebarCollapsed ? 'md:pl-[5rem]' : 'md:pl-[17rem]'
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
            <Building2 className="h-4 w-4" />
          </div>
          <span className="truncate text-sm font-semibold text-gray-900">
            {organization?.name ?? 'Organizer workspace'}
          </span>
        </div>

        <div className="flex flex-1 justify-center">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-10 w-full max-w-xl items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 text-left text-sm text-gray-400 transition-colors hover:border-primary-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            aria-label="Search people and events"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Search people, events…
          </button>
        </div>

        <div className="flex items-center">
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            onClick={() => navigate('/organizer/invitations')}
            aria-label="My invitations"
            className="relative rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Bell className="h-5 w-5" />
            <UnreadBadge count={unreadCount} />
          </button>
        </div>
      </header>

      {/* Mobile top header: shared Rally toolbar — menu, brand, workspace
          badge, then search, notifications and the user's avatar. The page name
          lives in the page body, not here. */}
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white pt-[env(safe-area-inset-top)] md:hidden">
        {searchOpen ? (
          <div className="flex h-16 items-center gap-2 px-4">
            <Search className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <input
              autoFocus
              placeholder="Search people, events…"
              aria-label="Search people and events"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSearchOpen(false)
                  navigate('/organizer/people')
                }
                if (e.key === 'Escape') setSearchOpen(false)
              }}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400"
            />
            <button
              onClick={() => setSearchOpen(false)}
              aria-label="Close search"
              className="-mr-2 rounded-full p-2.5 text-slate-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="flex h-16 items-center px-4">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="-ml-2 rounded-full p-2.5 text-slate-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <Menu className="h-6 w-6" />
            </button>
            <img
              src="/favicon.svg"
              alt=""
              aria-hidden="true"
              className="ml-3 h-10 w-10 shrink-0"
            />
            <span className="ml-2 whitespace-nowrap text-[21px] font-bold leading-none text-gray-900">
              Rally
            </span>
            <span className="ml-2 whitespace-nowrap rounded-full bg-[#E6F2FF] px-2.5 py-0.5 text-xs font-semibold text-primary-600">
              Organizer
            </span>
            <div className="flex-1" />
            <button
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              className="rounded-full p-2.5 text-slate-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <Search className="h-6 w-6" />
            </button>
            <button
              onClick={() => navigate('/organizer/invitations')}
              aria-label="Notifications"
              className="relative ml-1 rounded-full p-2.5 text-slate-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <Bell className="h-6 w-6" />
              <UnreadBadge count={unreadCount} />
            </button>
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open profile"
              className="ml-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <Avatar
                name={profile?.full_name || user?.email || 'Organizer'}
                src={profile?.photo_url}
                size="md"
              />
            </button>
          </div>
        )}
      </div>

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 hidden items-start justify-center bg-gray-900/50 p-4 pt-20 md:flex"
          role="dialog"
          aria-modal="true"
          aria-label="Search people and events"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-2 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-2 py-2">
              <Search className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
              <input
                autoFocus
                placeholder="Search people, events…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSearchOpen(false)
                    navigate('/organizer/people')
                  }
                  if (e.key === 'Escape') setSearchOpen(false)
                }}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400"
                aria-label="Search people and events"
              />
              <button
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
                className="rounded-md p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="px-3 pb-2 pt-1 text-xs text-gray-400">
              Press Enter to search people and events.
            </p>
          </div>
        </div>
      )}

      <main className={cn('pb-20 md:pb-0', sidebarCollapsed ? 'md:pl-16' : 'md:pl-60')}>
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>

      <OrganizerBottomNav onMore={() => setMobileOpen(true)} />
      <OrganizerMobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </div>
  )
}
