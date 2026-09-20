import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Building2, ChevronDown, LayoutDashboard, LogOut, Mail, Menu, Settings, Users, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/organizer', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/organizer/team', label: 'Team', icon: Users, end: false },
  { to: '/organizer/invitations', label: 'My invitations', icon: Mail, end: false },
  { to: '/organizer/settings', label: 'Organization', icon: Settings, end: false },
]

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
  const { profile, user, signOut } = useAuth()
  const { role, organization } = useOrganizer()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const displayName = profile?.full_name || user?.email || 'Organizer'

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
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={displayName} src={profile?.photo_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{displayName}</p>
              <p className="truncate text-xs text-gray-500">Organizer account</p>
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

      <div className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-white">
            <Users className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold text-gray-900">Rally</span>
          <Badge variant="primary">Organizer</Badge>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-b border-gray-200 bg-white px-4 py-2 md:hidden">
          <div className="pb-2">
            <OrganizationSwitcher onNavigate={() => setMobileOpen(false)} />
          </div>
          {nav(() => setMobileOpen(false))}
          <button
            onClick={handleSignOut}
            className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}

      <main className="md:pl-60">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
