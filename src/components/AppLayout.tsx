import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  User as UserIcon,
  Calendar,
  QrCode,
  CalendarClock,
  Target,
  Bell,
  LogOut,
  Search,
  ScanLine,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { Avatar } from '@/components/ui/Avatar'
import MobileDrawer from '@/components/MobileDrawer'
import BottomNav from '@/components/BottomNav'
import ConnectSheet from '@/components/ConnectSheet'
import GlobalSearchDialog from '@/components/GlobalSearchDialog'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/connections', label: 'Connections', icon: Users },
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
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!profileMenuOpen) return
    function onDown(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setProfileMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [profileMenuOpen])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const displayName = profile?.full_name || user?.email || 'User'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-gray-200 bg-white md:flex md:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-white">
            <Users className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold text-gray-900">Rally</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
              {item.to === '/notifications' && unreadCount > 0 && (
                <span className="rounded-full bg-error-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-200 p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={displayName} src={profile?.photo_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{displayName}</p>
              <p className="truncate text-xs text-gray-500">{profile?.job_title || 'No title set'}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="mt-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Desktop top header: centered search, right-side actions. Branding
          lives in the sidebar's top-left, so it is not duplicated here. */}
      <header className="sticky top-0 z-20 hidden h-16 items-center gap-4 border-b border-gray-200 bg-white pr-6 md:flex md:pl-[17rem]">
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

          <button
            onClick={() => navigate('/scan')}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
          >
            <ScanLine className="h-4 w-4" aria-hidden="true" />
            Connect
          </button>

          <div className="relative ml-1" ref={profileMenuRef}>
          <button
            onClick={() => setProfileMenuOpen((v) => !v)}
            aria-label="Open profile menu"
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
          >
            <Avatar name={displayName} src={profile?.photo_url} size="sm" />
          </button>
          {profileMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-12 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            >
              <button
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false)
                  navigate('/profile')
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <UserIcon className="h-4 w-4" aria-hidden="true" /> My profile
              </button>
              <button
                role="menuitem"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
              </button>
            </div>
          )}
        </div>
        </div>
      </header>

      {/* Mobile top header */}
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
          <button
            onClick={() => navigate('/profile')}
            aria-label="My profile"
            className="rounded-full p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Avatar name={displayName} src={profile?.photo_url} size="sm" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <main className="pb-20 md:pb-0 md:pl-60">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>

      <BottomNav
        onMore={() => setMobileOpen(true)}
        connectActive={connectOpen}
        onConnect={() => setConnectOpen(true)}
      />
      <ConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      <GlobalSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </div>
  )
}
