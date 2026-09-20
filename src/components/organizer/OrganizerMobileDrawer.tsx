import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  CalendarRange,
  LogOut,
  Mail,
  Pencil,
  Settings,
  UserCircle,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

interface DrawerItem {
  to: string
  label: string
  icon: typeof Users
}

// Organizer-only drawer, modeled on the attendee MobileDrawer's right-slide
// pattern. Kept as a separate component so the attendee experience is never
// touched.
export default function OrganizerMobileDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { profile, user, signOut, account } = useAuth()
  const { organization } = useOrganizer()
  const [rendered, setRendered] = useState(open)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()

  // Keep the drawer mounted through the slide-out transition and lock
  // background scroll while visible.
  useEffect(() => {
    if (open) setRendered(true)
  }, [open])

  useEffect(() => {
    if (!rendered) return
    document.body.style.overflow = 'hidden'
    const raf = requestAnimationFrame(() => closeButtonRef.current?.focus())
    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = ''
    }
  }, [rendered])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!rendered) return null

  const displayName = profile?.full_name || user?.email || 'Organizer'

  async function handleSignOut() {
    onClose()
    await signOut()
    navigate('/login')
  }

  const organizationItems: DrawerItem[] = [
    { to: '/organizer/settings', label: 'Organization Settings', icon: Building2 },
    { to: '/organizer/team', label: 'Team', icon: Users },
    { to: '/organizer/invitations', label: 'Invitations', icon: Mail },
  ]

  const eventItems: DrawerItem[] = [
    { to: '/organizer/events', label: 'Events', icon: CalendarRange },
    { to: '/organizer/people', label: 'People', icon: UserCircle },
  ]

  const sectionClass = 'text-xs font-semibold uppercase tracking-wide text-gray-400'
  const rowClass =
    'flex w-full items-center gap-4 px-5 py-3 text-[15px] font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900'
  const activeRowClass =
    'flex w-full items-center gap-4 px-5 py-3 text-[15px] font-medium bg-primary-50 text-primary-700 transition-colors'

  function renderRows(items: DrawerItem[]) {
    return items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        onClick={onClose}
        className={({ isActive }) => (isActive ? activeRowClass : rowClass)}
      >
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </NavLink>
    ))
  }

  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Organizer menu"
    >
      <div
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-gray-900/50 transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden="true"
      />

      <div
        className={cn(
          'absolute inset-y-0 right-0 flex w-[85%] max-w-xs flex-col bg-white shadow-xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
        onTransitionEnd={() => {
          if (!open) setRendered(false)
        }}
      >
        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="Close menu"
          className="absolute right-3 top-3 z-10 rounded-md p-2 text-white/90 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="bg-primary-700 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="flex w-full items-center gap-4">
            <Avatar name={displayName} src={profile?.photo_url} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-white">{displayName}</p>
              {organization && (
                <p className="truncate text-sm text-primary-100">{organization.name}</p>
              )}
              <button
                onClick={() => {
                  onClose()
                  navigate('/organizer/settings')
                }}
                className="mt-1 inline-flex items-center gap-1.5 rounded text-sm text-primary-100 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit Profile
              </button>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="py-2" role="group" aria-label="Organization">
            <p className={cn('px-5 pb-1 pt-3', sectionClass)}>Organization</p>
            {renderRows(organizationItems)}
          </div>

          <div className="mx-5 my-3 border-t border-gray-200" role="presentation" />

          <div className="py-2" role="group" aria-label="Event management">
            <p className={cn('px-5 pb-1 pt-3', sectionClass)}>Event Management</p>
            {renderRows(eventItems)}
          </div>

          <div className="mx-5 my-3 border-t border-gray-200" role="presentation" />

          <div className="py-2" role="group" aria-label="Account">
            <p className={cn('px-5 pb-1 pt-3', sectionClass)}>Account</p>
            {account?.account_type === 'attendee' && (
              <button
                onClick={() => {
                  onClose()
                  navigate('/dashboard')
                }}
                className={rowClass}
              >
                <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">Back to My Rally</span>
              </button>
            )}
            <NavLink
              to="/organizer/settings"
              onClick={onClose}
              className={({ isActive }) => (isActive ? activeRowClass : rowClass)}
            >
              <Settings className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Settings</span>
            </NavLink>
            <button
              onClick={handleSignOut}
              className={rowClass}
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
              Sign Out
            </button>
          </div>
        </nav>
      </div>
    </div>
  )
}
