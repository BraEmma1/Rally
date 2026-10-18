import { Suspense, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, LogOut, Menu, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { LoadingState } from '@/components/ui/States'
import { ActionItemsMenu } from '@/components/admin/ActionItemsMenu'
import { AdminMobileDrawer } from '@/components/admin/AdminMobileDrawer'
import { ADMIN_NAV, adminPageTitle } from '@/components/admin/adminNav'
import { cn } from '@/lib/utils'

// The platform admin workspace shell. It renders only behind
// RequireAccount(isActivePlatformAdmin) in App.tsx, and that guard is a
// convenience: every read below it is authorized again by RLS.
//
// Structure follows OrganizerLayout (collapsible sidebar from md up, sticky top
// bar) so the two workspaces feel like one product; the collapse preference is
// stored separately so the two do not fight over it.
const COLLAPSE_KEY = 'rally.adminSidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export default function AdminLayout() {
  const { signOut, profile, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const title = adminPageTitle(location.pathname)
  const displayName = profile?.full_name || user?.email || 'Administrator'

  function toggleSidebar() {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1')
      } catch {
        // Storage unavailable (private mode): the preference just won't persist.
      }
      return !prev
    })
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-700 focus:shadow"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden border-r border-gray-200 bg-white transition-[width] duration-200 md:flex md:flex-col',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        <div
          className={cn(
            'flex h-16 shrink-0 items-center border-b border-gray-200',
            collapsed ? 'flex-col justify-center gap-1' : 'gap-2 px-5'
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-600 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          {!collapsed && (
            <>
              <span className="text-lg font-bold text-gray-900">Rally</span>
              <Badge variant="primary">Admin</Badge>
            </>
          )}
          <button
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
              !collapsed && 'ml-auto'
            )}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className={cn('flex-1 space-y-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')} aria-label="Administration">
          {ADMIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                  collapsed && 'justify-center px-0',
                  isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {!item.available && <span className="text-[11px] font-normal text-gray-400">Soon</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-200 p-3">
          <button
            onClick={handleSignOut}
            title={collapsed ? 'Sign out' : undefined}
            aria-label={collapsed ? 'Sign out' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
              collapsed && 'justify-center px-0'
            )}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      <header
        className={cn(
          'sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-gray-200 bg-white px-4 pt-[env(safe-area-inset-top)] md:pr-6',
          collapsed ? 'md:pl-[5rem]' : 'md:pl-[17rem]'
        )}
      >
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="-ml-1 rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <p className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900">{title}</p>

        <ActionItemsMenu />

        <div className="hidden items-center gap-2 border-l border-gray-200 pl-3 sm:flex">
          <Avatar name={displayName} src={profile?.photo_url} size="sm" />
          <div className="hidden min-w-0 lg:block">
            <p className="max-w-[12rem] truncate text-sm font-medium text-gray-900">{displayName}</p>
            <p className="text-xs text-gray-500">Platform administrator</p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          aria-label="Sign out"
          title="Sign out"
          className="hidden rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 md:inline-flex"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      <main id="admin-main" tabIndex={-1} className={cn('focus:outline-none', collapsed ? 'md:pl-16' : 'md:pl-60')}>
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
          {/* Pages load lazily; this keeps the sidebar and top bar in place
              while one arrives. */}
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      <AdminMobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} onSignOut={() => void handleSignOut()} />
    </div>
  )
}
