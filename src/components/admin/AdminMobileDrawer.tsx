import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LogOut, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { ADMIN_NAV } from '@/components/admin/adminNav'
import { cn } from '@/lib/utils'

// Mobile navigation for the admin workspace, following the
// organizer drawer's pattern: focus moves in on open, Escape closes, and the
// page behind stops scrolling.
export function AdminMobileDrawer({
  open,
  onClose,
  onSignOut,
}: {
  open: boolean
  onClose: () => void
  onSignOut: () => void
}) {
  const { profile, user } = useAuth()
  const [rendered, setRendered] = useState(open)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

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

  const displayName = profile?.full_name || user?.email || 'Administrator'

  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Administration menu"
    >
      <div
        className={cn('absolute inset-0 bg-gray-900/50 transition-opacity', open ? 'opacity-100' : 'opacity-0')}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl transition-transform duration-200',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        onTransitionEnd={() => {
          if (!open) setRendered(false)
        }}
      >
        <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" aria-hidden="true" className="h-8 w-8" />
            <span className="text-lg font-bold text-gray-900">Rally</span>
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">
              Admin
            </span>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2" aria-label="Administration">
          {ADMIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-4 px-5 py-3 text-[15px] font-medium transition-colors',
                  isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                )
              }
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {!item.available && <span className="text-xs font-normal text-gray-400">Soon</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-200 p-4">
          <div className="mb-3 flex items-center gap-3">
            <Avatar name={displayName} src={profile?.photo_url} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{displayName}</p>
              <p className="text-xs text-gray-500">Platform administrator</p>
            </div>
          </div>
          <button
            onClick={() => {
              onClose()
              onSignOut()
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
