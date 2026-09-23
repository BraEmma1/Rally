import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X,
  User as UserIcon,
  Info,
  Bell,
  Settings,
  LogOut,
  ExternalLink,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'

// Event Mode's More drawer. Reuses the same visual pattern as the main app's
// MobileDrawer but with event-scoped entries: profile, event info, main app
// exit, notifications, settings, sign out.
export default function EventModeDrawer({
  open,
  onClose,
  eventBasePath,
  eventName,
}: {
  open: boolean
  onClose: () => void
  eventBasePath: string
  eventName: string
}) {
  const { profile, user, signOut } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  const displayName = profile?.full_name || user?.email || 'Profile'

  const items: { label: string; icon: typeof Info; onClick: () => void }[] = [
    { label: 'My Profile', icon: UserIcon, onClick: () => navigate('/profile') },
    { label: `${eventName} info`, icon: Info, onClick: () => navigate(`${eventBasePath}/info`) },
    { label: 'Notifications', icon: Bell, onClick: () => navigate('/notifications') },
    { label: 'Exit to main Rally', icon: ExternalLink, onClick: () => navigate('/dashboard') },
    { label: 'Settings', icon: Settings, onClick: () => navigate('/profile') },
  ]

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More menu">
      <button className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
          <div className="flex items-center gap-3">
            <Avatar name={displayName} src={profile?.photo_url} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
              <p className="truncate text-xs text-gray-500">{profile?.job_title || 'Attendee'}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close menu" className="rounded-md p-2 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                onClose()
                item.onClick()
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1 truncate text-left">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="border-t border-gray-200 p-3">
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
