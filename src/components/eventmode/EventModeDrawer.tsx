import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X,
  User as UserIcon,
  Info,
  Bell,
  CalendarCheck,
  Settings,
  LogOut,
  ExternalLink,
  Pencil,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'

// Event Mode's More drawer. Same look as the main app's MobileDrawer (brand-blue
// header, tinted icon tiles, pinned sign out) with event-scoped entries:
// profile, schedule, event info, notifications, main app exit, settings.
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
    { label: 'My Schedule', icon: CalendarCheck, onClick: () => navigate(`${eventBasePath}/schedule`) },
    { label: `${eventName} info`, icon: Info, onClick: () => navigate(`${eventBasePath}/info`) },
    { label: 'Notifications', icon: Bell, onClick: () => navigate('/notifications') },
    { label: 'Settings', icon: Settings, onClick: () => navigate('/profile') },
  ]

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const rowClass =
    'group flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px] font-medium text-rally-navy transition-colors hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600'
  const tile = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rally-tint text-primary-600 transition-colors group-hover:bg-white'

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More menu">
      <button className="absolute inset-0 bg-rally-ink/60 backdrop-blur-[2px]" aria-label="Close menu" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col overflow-hidden rounded-l-3xl bg-white shadow-float">
        <div className="relative bg-gradient-to-br from-primary-600 to-primary-700 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" />
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Event Mode</p>
          <p className="mt-0.5 line-clamp-1 pr-12 text-sm font-medium text-white/90">{eventName}</p>
          <button
            onClick={() => {
              onClose()
              navigate('/profile')
            }}
            className="mt-3 flex w-full items-center gap-3.5 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Avatar name={displayName} src={profile?.photo_url} size="lg" className="ring-2 ring-white/30" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-bold text-white">{displayName}</p>
              <p className="truncate text-sm text-white/70">{profile?.job_title || 'Attendee'}</p>
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">
                <Pencil className="h-3 w-3" aria-hidden="true" />
                Edit profile
              </span>
            </div>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-2">
          <p className="px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">This event</p>
          <div className="space-y-0.5">
            {items.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  onClose()
                  item.onClick()
                }}
                className={rowClass}
              >
                <span className={tile}>
                  <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </div>

          <p className="px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Rally</p>
          <button
            onClick={() => {
              onClose()
              navigate('/dashboard')
            }}
            className={rowClass}
          >
            <span className={tile}>
              <ExternalLink className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate">Exit to main Rally</span>
          </button>
        </nav>

        <div className="border-t border-rally-line bg-rally-canvas px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button
            onClick={handleSignOut}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-rally-line bg-white text-[15px] font-semibold text-error-600 transition-colors hover:bg-error-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-error-600"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
