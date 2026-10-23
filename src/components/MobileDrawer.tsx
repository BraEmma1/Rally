import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Building2,
  Users,
  MessagesSquare,
  QrCode,
  Calendar,
  CalendarCheck,
  CalendarClock,
  Target,
  Bell,
  Pencil,
  LogOut,
  X,
  MailOpen,
  ChevronDown,
  ArrowRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { listMyPendingInvitations } from '@/lib/organizer'
import type { IncomingInvitation } from '@/lib/supabase'
import { ORG_ROLE_LABELS } from '@/lib/supabase'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

interface DrawerItem {
  to: string
  label: string
  icon: typeof Users
  badge?: number
}

const personalItems: (Omit<DrawerItem, 'to'> & { to: string })[] = [
  { to: '/messages', label: 'My Messages', icon: MessagesSquare },
  { to: '/scan', label: 'My QR Code & Scanning', icon: QrCode },
  { to: '/connections', label: 'My Contacts', icon: Users },
  { to: '/follow-ups', label: 'My Follow-ups', icon: CalendarClock },
  { to: '/opportunities', label: 'My Opportunities', icon: Target },
]

const eventSubItems: DrawerItem[] = [
  { to: '/events?tab=upcoming', label: 'Upcoming Events', icon: CalendarCheck },
  { to: '/events?tab=invitations', label: 'Invitations', icon: MailOpen },
]

export default function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, user, signOut } = useAuth()
  const { unreadCount } = useNotifications()
  const { memberships, loading: orgLoading, selectOrganization } = useOrganizer()
  const [pendingOrgInvitations, setPendingOrgInvitations] = useState<IncomingInvitation[]>([])
  const [rendered, setRendered] = useState(open)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const [upcomingCount, setUpcomingCount] = useState(0)
  const [pendingInvites, setPendingInvites] = useState(0)
  const [eventsExpanded, setEventsExpanded] = useState(false)
  const [orgsExpanded, setOrgsExpanded] = useState(false)

  // Counts for the events sub-items. The user is always signed in when the
  // drawer is reachable; without a user the counts simply stay at zero.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    void listMyPendingInvitations().then(({ data }) => {
      if (!cancelled) setPendingOrgInvitations(data)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const userId = user.id

    async function loadCounts() {
      const today = new Date(new Date().toDateString()).toISOString()

      const [regRes, inviteRes] = await Promise.all([
        supabase
          .from('event_registrations')
          .select('event_id, events!inner(start_date)', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('events.start_date', today),
        supabase
          .from('event_invitations')
          .select('id', { count: 'exact', head: true })
          .eq('invited_user_id', userId)
          .eq('status', 'Pending'),
      ])

      if (cancelled) return
      setUpcomingCount(regRes.count ?? 0)
      setPendingInvites(inviteRes.count ?? 0)
    }

    loadCounts()
    return () => {
      cancelled = true
    }
  }, [user])

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

  const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600'

  const rowClass = (subItem?: boolean) =>
    cn(
      'group flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium text-rally-navy transition-colors hover:bg-rally-tint',
      subItem && 'min-h-[46px] pl-6',
      focusRing
    )

  const activeRowClass = (subItem?: boolean) =>
    cn(
      'group flex min-h-[52px] w-full items-center gap-3 rounded-xl bg-rally-tint px-3 py-2 text-[15px] font-semibold text-primary-700 transition-colors',
      subItem && 'min-h-[46px] pl-6',
      focusRing
    )

  const iconTile = (active: boolean) =>
    cn(
      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
      active ? 'bg-primary-600 text-white' : 'bg-rally-tint text-primary-600 group-hover:bg-white'
    )

  const sectionLabel = 'px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400'

  function renderRows(items: DrawerItem[], subItems = false) {
    return items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        onClick={onClose}
        className={({ isActive }) => (isActive ? activeRowClass(subItems) : rowClass(subItems))}
        end={!subItems}
      >
        {({ isActive }) => (
          <>
            <span className={iconTile(isActive)}>
              <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.to === '/events?tab=upcoming' && upcomingCount > 0 && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-primary-700 ring-1 ring-rally-line">{upcomingCount}</span>
            )}
            {item.to === '/events?tab=invitations' && pendingInvites > 0 && (
              <span className="rounded-full bg-error-600 px-2 py-0.5 text-xs font-semibold text-white">{pendingInvites}</span>
            )}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="rounded-full bg-error-600 px-2 py-0.5 text-xs font-semibold text-white">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </>
        )}
      </NavLink>
    ))
  }

  const toggleButton = (expanded: boolean, label: string, onToggle: () => void) => (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={label}
      className={cn('flex h-[52px] w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-rally-tint hover:text-rally-navy', focusRing)}
    >
      <ChevronDown className={cn('h-5 w-5 transition-transform duration-200 motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn('absolute inset-0 bg-rally-ink/60 backdrop-blur-[2px] transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')}
        aria-hidden="true"
      />

      {/* Right-side panel */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col overflow-hidden rounded-l-3xl bg-white shadow-float transition-transform duration-300 ease-out motion-reduce:transition-none',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
        onTransitionEnd={() => {
          if (!open) setRendered(false)
        }}
      >
        {/* Profile header */}
        <div className="relative bg-gradient-to-br from-primary-600 to-primary-700 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close menu"
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" />
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Rally</p>
          <button
            onClick={goToProfile}
            className="mt-3 flex w-full items-center gap-3.5 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Avatar name={displayName} src={profile?.photo_url} size="lg" className="ring-2 ring-white/30" />
            <div className="min-w-0 flex-1 pr-10">
              <p className="truncate font-display text-lg font-bold text-white">{displayName}</p>
              {profile?.job_title && <p className="truncate text-sm text-white/70">{profile.job_title}</p>}
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">
                <Pencil className="h-3 w-3" aria-hidden="true" />
                Edit profile
              </span>
            </div>
          </button>
        </div>

        {/* Scrollable menu body */}
        <nav className="flex-1 overflow-y-auto px-3 pb-2">
          <div role="group" aria-label="Personal">
            <p className={sectionLabel}>My Rally</p>
            <div className="space-y-0.5">{renderRows(personal)}</div>
          </div>

          <div role="group" aria-label="Events">
            <p className={sectionLabel}>Events</p>
            <div className="flex items-stretch gap-1">
              <NavLink
                to="/events"
                onClick={onClose}
                end
                className={({ isActive }) => cn(isActive ? activeRowClass() : rowClass(), 'min-w-0 flex-1')}
              >
                {({ isActive }) => (
                  <>
                    <span className={iconTile(isActive)}>
                      <Calendar className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">All Events</span>
                  </>
                )}
              </NavLink>
              {toggleButton(eventsExpanded, eventsExpanded ? 'Hide events submenu' : 'Show events submenu', () => setEventsExpanded((v) => !v))}
            </div>
            {eventsExpanded && (
              <div role="group" aria-label="Events submenu" className="mt-0.5 space-y-0.5">
                {renderRows(eventSubItems, true)}
              </div>
            )}
          </div>

          {/* My Organizations: only shown once loaded and only for real
              memberships, so a revoked or absent membership leaves no trace. */}
          {!orgLoading && memberships.length > 0 && (
            <div role="group" aria-label="My organizations">
              <p className={sectionLabel}>Organizations</p>
              <div className="flex items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => setOrgsExpanded((v) => !v)}
                  aria-expanded={orgsExpanded}
                  className={cn(rowClass(), 'min-w-0 flex-1 text-left')}
                >
                  <span className={iconTile(false)}>
                    <Building2 className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">My Organizations</span>
                </button>
                {toggleButton(orgsExpanded, orgsExpanded ? 'Hide organizations submenu' : 'Show organizations submenu', () => setOrgsExpanded((v) => !v))}
              </div>

              {orgsExpanded && (
                <div role="group" aria-label="Organizations submenu" className="mt-0.5 space-y-0.5">
                  {memberships.map((m) => (
                    <NavLink
                      key={m.organization.id}
                      to="/organizer"
                      onClick={() => {
                        selectOrganization(m.organization.id)
                        onClose()
                      }}
                      className={cn(rowClass(true), 'gap-3 py-2')}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rally-tint text-primary-700">
                        <Building2 className="h-[18px] w-[18px]" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{m.organization.name}</span>
                        <span className="block truncate text-xs font-normal text-slate-500">{ORG_ROLE_LABELS[m.role]}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pending organization invitations, straight from the authorized
              RPC: accepted, declined or revoked invitations disappear here
              without any local tracking. */}
          {!orgLoading && pendingOrgInvitations.length > 0 && (
            <div role="group" aria-label="Pending invitations">
              <p className={sectionLabel}>
                {pendingOrgInvitations.length === 1 ? 'Pending invitation' : 'Pending invitations'}
              </p>
              <div className="space-y-1.5">
                {pendingOrgInvitations.map((invitation) => (
                  <NavLink
                    key={invitation.id}
                    to="/invitations/organizations"
                    onClick={onClose}
                    className={cn('flex w-full items-center gap-3 rounded-xl border border-warning-200 bg-warning-50 px-3 py-2.5 text-[15px] font-medium text-rally-navy', focusRing)}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-warning-700">
                      <Building2 className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{invitation.organization_name}</span>
                      <span className="block truncate text-xs font-normal text-slate-600">
                        Invited as {ORG_ROLE_LABELS[invitation.role]}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-error-600 px-2 py-0.5 text-xs font-semibold text-white">Review</span>
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Footer: sign out stays reachable without scrolling */}
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
