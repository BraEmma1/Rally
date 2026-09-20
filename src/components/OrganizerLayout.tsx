import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Bell,
  Building2,
  CalendarRange,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Mail,
  Search,
  Settings,
  UserCircle,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { useOrganizer } from '@/context/OrganizerContext'
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

const pageTitles: Array<{ match: (path: string) => boolean; title: string }> = [
  { match: (p) => p === '/organizer' || p === '/organizer/', title: 'Dashboard' },
  { match: (p) => p.startsWith('/organizer/events'), title: 'Events' },
  { match: (p) => p.startsWith('/organizer/people'), title: 'People' },
  { match: (p) => p.startsWith('/organizer/team'), title: 'Team' },
  { match: (p) => p.startsWith('/organizer/invitations'), title: 'Invitations' },
  { match: (p) => p.startsWith('/organizer/settings'), title: 'Settings' },
]

function pageTitle(pathname: string): string {
  const found = pageTitles.find((entry) => entry.match(pathname))
  return found?.title ?? 'Organizer'
}

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
  const { signOut, account } = useAuth()
  const { role, organization } = useOrganizer()
  const { unreadCount } = useNotifications()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // An attendee on the team gets a way back to their own Rally; a full
  // organizer account has no attendee home to return to.
  const isAttendeeAccount = account?.account_type === 'attendee'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const title = pageTitle(location.pathname)

  // Search is organizer-scoped: the attendee global search reads connections,
  // which organizers do not have. Navigating to People keeps the organizer in
  // their own workspace instead of showing an empty attendee search.
  function handleSearch() {
    setSearchOpen(false)
    navigate('/organizer/people')
  }

  const nav = (onNavigate?: () => void) => (
    <nav className="space-y-1">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary-50 text-primary-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            )
          }
        >
          <item.icon className="h-4 w-4" />
          <span className="flex-1">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-gray-200 bg-white md:flex md:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-white">
            <Users className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold text-gray-900">Rally</span>
          <Badge variant="primary">Organizer</Badge>
        </div>

        <div className="border-b border-gray-200 px-3 py-3">
          <OrganizationSwitcher />
          {organization && role && (
            <p className="px-2 pt-1 text-xs text-gray-500">
              You are {role === 'admin' ? 'an' : 'a'} {role === 'manager' ? 'event manager' : role}
            </p>
          )}
        </div>

        <div className="flex-1 px-3 py-4">{nav()}</div>

        <div className="border-t border-gray-200 p-3">
          {/* Context switch back to the attendee experience — not an account
              switch; the account never changed. */}
          {isAttendeeAccount && (
            <button
              onClick={() => navigate('/dashboard')}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to My Rally
            </button>
          )}
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Desktop top header: workspace context on the left, centered search,
          notifications on the right. No avatar — profile lives in the sidebar. */}
      <header className="sticky top-0 z-20 hidden h-16 items-center gap-4 border-b border-gray-200 bg-white pl-4 pr-6 md:flex md:pl-[17rem]">
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

      {/* Mobile top header: page title on the left, search and notifications on
          the right. No avatar — it lives in the More drawer. */}
      <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-3 md:hidden">
        <h1 className="truncate pl-1 text-lg font-bold text-gray-900">{title}</h1>
        <div className="flex items-center">
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="rounded-md p-2.5 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            onClick={() => navigate('/organizer/invitations')}
            aria-label="My invitations"
            className="relative rounded-md p-2.5 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Bell className="h-5 w-5" />
            <UnreadBadge count={unreadCount} />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-gray-900/50 p-4 pt-20"
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
                  if (e.key === 'Enter') handleSearch()
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

      <main className="pb-20 md:pb-0 md:pl-60">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>

      <OrganizerBottomNav onMore={() => setMobileOpen(true)} />
      <OrganizerMobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </div>
  )
}
