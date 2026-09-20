import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Users,
  QrCode,
  Calendar,
  CalendarClock,
  Target,
  Bell,
  Pencil,
  LogOut,
  X,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

interface DrawerItem {
  to: string
  label: string
  icon: typeof Users
  badge?: number
}

const personalItems: DrawerItem[] = [
  { to: '/scan', label: 'My QR Code & Scanning', icon: QrCode },
  { to: '/connections', label: 'My Contacts', icon: Users },
  { to: '/follow-ups', label: 'My Follow-ups', icon: CalendarClock },
  { to: '/opportunities', label: 'My Opportunities', icon: Target },
]

const eventItems: DrawerItem[] = [
  { to: '/events', label: 'All Events', icon: Calendar },
]

export default function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, user, signOut } = useAuth()
  const { unreadCount } = useNotifications()
  const [rendered, setRendered] = useState(open)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()

  // Keep the drawer in the tree through the slide-out transition, and lock
  // background page scroll for the whole time it is visible.
  useEffect(() => {
    if (open) setRendered(true)
  }, [open])

  useEffect(() => {
    if (!rendered) return
    document.body.style.overflow = 'hidden'
    // Move focus into the drawer once it is visible; waiting a frame avoids
    // focusing an element that is still mid-transition offscreen.
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

  const displayName = profile?.full_name || user?.email || 'User'

  const personal: DrawerItem[] = unreadCount > 0
    ? [...personalItems, { to: '/notifications', label: 'Notifications', icon: Bell, badge: unreadCount }]
    : [...personalItems, { to: '/notifications', label: 'Notifications', icon: Bell }]

  async function handleSignOut() {
    onClose()
    await signOut()
    navigate('/login')
  }

  function goToProfile() {
    onClose()
    navigate('/profile')
  }

  const rowClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex w-full items-center gap-4 px-5 py-3.5 text-[15px] font-medium transition-colors',
      isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
    )

  function renderRows(items: DrawerItem[]) {
    return items.map((item) => (
      <NavLink key={item.to} to={item.to} onClick={onClose} className={rowClass} end={item.to === '/events'}>
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.badge !== undefined && item.badge > 0 && (
          <span className="rounded-full bg-error-600 px-2 py-0.5 text-xs font-semibold text-white">
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </NavLink>
    ))
  }

  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-gray-900/50 transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden="true"
      />

      {/* Right-side panel */}
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
          className="absolute right-3 top-3 rounded-md p-2 text-white/90 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Profile header */}
        <div className="bg-primary-700 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <button onClick={goToProfile} className="flex w-full items-center gap-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-md">
            <Avatar name={displayName} src={profile?.photo_url} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-white">{displayName}</p>
              <span className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-primary-100">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit Profile
              </span>
            </div>
          </button>
        </div>

        {/* Scrollable menu body */}
        <nav className="flex-1 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="py-2" role="group" aria-label="Personal">
            {renderRows(personal)}
          </div>

          <div className="mx-5 my-3 border-t border-gray-200" role="presentation" />

          <div className="py-2" role="group" aria-label="Events">
            {renderRows(eventItems)}
          </div>

          <div className="mx-5 my-3 border-t border-gray-200" role="presentation" />

          <div className="py-2" role="group" aria-label="Account">
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-4 px-5 py-3.5 text-[15px] font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
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
