import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  Building2,
  Check,
  CheckCheck,
  ArrowRight,
  UserPlus,
  CalendarPlus,
  CalendarCheck,
  CalendarX,
  CalendarClock,
  AlertCircle,
  Target,
  type LucideIcon,
} from 'lucide-react'
import { NOTIFICATION_TYPE_LABELS, type AppNotification, ORG_ROLE_LABELS } from '@/lib/supabase'
import type { IncomingInvitation } from '@/lib/supabase'
import { listMyPendingInvitations } from '@/lib/organizer'
import { useNotifications } from '@/context/NotificationContext'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { Button } from '@/components/ui/Button'
import { LoadingState, EmptyState } from '@/components/ui/States'
import { cn, formatRelativeDate } from '@/lib/utils'

// One icon and one tone per notification type. The tile colour carries the
// meaning (needs attention / good news / bad news / informational).
type Tone = 'primary' | 'success' | 'warning' | 'error'

const TYPE_META: Record<string, { icon: LucideIcon; tone: Tone }> = {
  new_connection: { icon: UserPlus, tone: 'primary' },
  event_invitation: { icon: CalendarPlus, tone: 'warning' },
  invitation_accepted: { icon: CalendarCheck, tone: 'success' },
  invitation_declined: { icon: CalendarX, tone: 'error' },
  organization_invitation: { icon: Building2, tone: 'primary' },
  follow_up_due: { icon: CalendarClock, tone: 'warning' },
  follow_up_overdue: { icon: AlertCircle, tone: 'error' },
  opportunity_stage_changed: { icon: Target, tone: 'primary' },
  event_registration: { icon: CalendarCheck, tone: 'success' },
  upcoming_event: { icon: CalendarClock, tone: 'primary' },
}

const TONE_CLASSES: Record<Tone, string> = {
  primary: 'bg-rally-tint text-primary-600',
  success: 'bg-success-50 text-success-600',
  warning: 'bg-warning-50 text-warning-600',
  error: 'bg-error-50 text-error-600',
}

type Filter = 'all' | 'unread'

function dayBucket(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  const startOfToday = new Date(new Date().toDateString()).getTime()
  const day = 24 * 60 * 60 * 1000
  const t = d.getTime()
  if (t >= startOfToday) return 'Today'
  if (t >= startOfToday - day) return 'Yesterday'
  if (t >= startOfToday - 6 * day) return 'This week'
  return 'Earlier'
}

const BUCKET_ORDER = ['Today', 'Yesterday', 'This week', 'Earlier']

// Pending organization invitations rendered in the same stream as database
// notifications. They are not stored: they come from the authorized invitations
// RPC on each visit, so an accepted or declined invitation disappears on the
// next load and no local record can drift from the backend.
function useOrganizationInvitationEntries(): AppNotification[] {
  const [invitations, setInvitations] = useState<IncomingInvitation[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void listMyPendingInvitations().then(({ data }) => {
      if (!cancelled) setInvitations(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => {
    if (!invitations) return []
    return invitations.map((invitation) => ({
      id: `org-invitation-${invitation.id}`,
      user_id: '',
      type: 'organization_invitation',
      title: 'Organization Invitation',
      message: `${invitation.organization_name} has invited you to join their organization as ${ORG_ROLE_LABELS[invitation.role]}.`,
      link: '/invitations/organizations',
      read: false,
      created_at: invitation.created_at,
    }))
  }, [invitations])
}

export default function NotificationsPage() {
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } = useNotifications()
  const orgInvitationEntries = useOrganizationInvitationEntries()
  const [filter, setFilter] = useState<Filter>('all')
  const all = useMemo(
    () =>
      [...notifications, ...orgInvitationEntries].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [notifications, orgInvitationEntries]
  )
  const visible = filter === 'unread' ? all.filter((n) => !n.read) : all
  // Organization invitations are not stored rows, so they cannot be marked read.
  const isStored = (n: AppNotification) => !n.id.startsWith('org-invitation-')

  const groups = useMemo(() => {
    const map = new Map<string, AppNotification[]>()
    for (const n of visible) {
      const key = dayBucket(n.created_at)
      map.set(key, [...(map.get(key) ?? []), n])
    }
    return BUCKET_ORDER.filter((k) => map.has(k)).map((k) => ({ label: k, items: map.get(k)! }))
  }, [visible])

  if (loading) return <LoadingState message="Loading notifications…" />

  function renderRow(n: AppNotification) {
    const meta = TYPE_META[n.type]
    const Icon = meta?.icon ?? Bell
    const label = NOTIFICATION_TYPE_LABELS[n.type] || 'Notification'
    const body = (
      <>
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', TONE_CLASSES[meta?.tone ?? 'primary'])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
            <span className="truncate text-xs text-slate-400">· {formatRelativeDate(n.created_at)}</span>
          </span>
          <span className={cn('mt-0.5 block text-[15px] text-rally-navy', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</span>
          {n.message && <span className="mt-0.5 line-clamp-2 block text-sm text-rally-muted">{n.message}</span>}
        </span>
      </>
    )
    const rowClass = 'flex min-w-0 flex-1 items-start gap-3 rounded-xl p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600'
    return (
      <li key={n.id} className={cn('relative flex items-start transition-colors hover:bg-rally-tint/60', !n.read && 'bg-rally-tint/50')}>
        {!n.read && <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary-600" aria-hidden="true" />}
        {n.link ? (
          <Link to={n.link} onClick={() => { if (!n.read && isStored(n)) markAsRead(n.id) }} className={rowClass}>
            {body}
            <ArrowRight className="mt-3 hidden h-4 w-4 shrink-0 text-slate-300 sm:block" aria-hidden="true" />
          </Link>
        ) : (
          <div className={rowClass}>{body}</div>
        )}
        {!n.read && isStored(n) && (
          <button
            onClick={() => markAsRead(n.id)}
            className="mr-2 mt-3.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            aria-label={`Mark "${n.title}" as read`}
            title="Mark as read"
          >
            <Check className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </li>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Notifications"
        description={unreadCount > 0 ? `${unreadCount} unread ${unreadCount === 1 ? 'update' : 'updates'} waiting for you.` : 'You are all caught up.'}
        actions={
          unreadCount > 0 ? (
            <Button variant="secondary" size="lg" className="rounded-xl" onClick={markAllAsRead}>
              <CheckCheck className="h-4 w-4" /> Mark all as read
            </Button>
          ) : undefined
        }
      />

      <SegmentedTabs
        className="mt-5 w-fit"
        label="Filter notifications"
        value={filter}
        onChange={setFilter}
        tabs={[
          { key: 'all', label: 'All' },
          { key: 'unread', label: 'Unread', count: unreadCount },
        ]}
      />

      <div className="mt-5">
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-rally-line bg-white p-6 shadow-card">
            <EmptyState
              icon={<Bell className="h-10 w-10" />}
              title={filter === 'unread' ? 'Nothing unread' : 'No notifications'}
              description={
                filter === 'unread'
                  ? 'You have read everything. New updates will show up here.'
                  : 'Updates about your connections, events, follow-ups, and opportunities will appear here.'
              }
            />
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{g.label}</h2>
                <ul className="divide-y divide-rally-line overflow-hidden rounded-2xl border border-rally-line bg-white shadow-card">
                  {g.items.map(renderRow)}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
