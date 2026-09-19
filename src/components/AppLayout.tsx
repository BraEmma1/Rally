import { useState } from 'react'
import { NavLink, useNavigate, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  User as UserIcon,
  Calendar,
  QrCode,
  CalendarClock,
  Target,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/connections', label: 'Connections', icon: Users },
  { to: '/scan', label: 'Scan QR', icon: QrCode },
  { to: '/events', label: 'Events', icon: Calendar },
  { to: '/follow-ups', label: 'Follow-ups', icon: CalendarClock },
  { to: '/opportunities', label: 'Opportunities', icon: Target },
  { to: '/profile', label: 'My Profile', icon: UserIcon },
]

export default function AppLayout() {
  const { profile, user, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

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
              {item.label}
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

      {/* Mobile header */}
      <div className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-white">
            <Users className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold text-gray-900">Rally</span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="border-b border-gray-200 bg-white px-4 py-2 md:hidden">
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </nav>
        </div>
      )}

      {/* Main content */}
      <main className="md:pl-60">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
