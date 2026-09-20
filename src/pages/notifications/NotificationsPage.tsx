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
} from 'lucide-react'
import { NOTIFICATION_TYPE_LABELS, type AppNotification, ORG_ROLE_LABELS } from '@/lib/supabase'
import type { IncomingInvitation } from '@/lib/supabase'
import { listMyPendingInvitations } from '@/lib/organizer'
import { useNotifications } from '@/context/NotificationContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState, EmptyState } from '@/components/ui/States'
import { formatRelativeDate } from '@/lib/utils'

const TYPE_ICONS: Record<string, React.ReactNode> = {
  new_connection: <UserPlus className="h-4 w-4 text-primary-600" />,
  event_invitation: <CalendarPlus className="h-4 w-4 text-warning-600" />,
  invitation_accepted: <CalendarCheck className="h-4 w-4 text-success-600" />,
  invitation_declined: <CalendarX className="h-4 w-4 text-error-600" />,
  organization_invitation: <Building2 className="h-4 w-4 text-primary-600" />,
  follow_up_due: <CalendarClock className="h-4 w-4 text-warning-600" />,
  follow_up_overdue: <AlertCircle className="h-4 w-4 text-error-600" />,
  opportunity_stage_changed: <Target className="h-4 w-4 text-primary-600" />,
  event_registration: <CalendarCheck className="h-4 w-4 text-success-600" />,
  upcoming_event: <CalendarClock className="h-4 w-4 text-primary-600" />,
}

const TYPE_BADGE_VARIANTS: Record<string, 'primary' | 'success' | 'warning' | 'error' | 'gray'> = {
  new_connection: 'primary',
  event_invitation: 'warning',
  invitation_accepted: 'success',
  invitation_declined: 'error',
  organization_invitation: 'primary',
  follow_up_due: 'warning',
  follow_up_overdue: 'error',
  opportunity_stage_changed: 'primary',
  event_registration: 'success',
  upcoming_event: 'primary',
}

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
  const all = useMemo(
    () =>
      [...notifications, ...orgInvitationEntries].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [notifications, orgInvitationEntries]
  )

  if (loading) return <LoadingState message="Loading notifications…" />

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
          <p className="mt-1 text-sm text-gray-500">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'You are all caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={markAllAsRead}>
            <CheckCheck className="h-4 w-4" /> Mark all as read
          </Button>
        )}
      </div>

      <div className="mt-6">
        {all.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Bell className="h-10 w-10" />}
                title="No notifications"
                description="Updates about your connections, events, follow-ups, and opportunities will appear here."
              />
            </CardContent>
          </Card>
        ) : (
          all.map((n) => {
            const icon = TYPE_ICONS[n.type] || <Bell className="h-4 w-4 text-gray-500" />
            const label = NOTIFICATION_TYPE_LABELS[n.type] || 'Notification'
            const content = (
              <Card
                className={`mb-3 transition-colors ${n.read ? '' : 'border-primary-200 bg-primary-50/40 hover:bg-primary-50/60'}`}
              >
                <CardContent className="flex items-start gap-3 py-3">
                  <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${n.read ? 'bg-gray-100' : 'bg-white'}`}>
                    {icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={TYPE_BADGE_VARIANTS[n.type] || 'gray'}>{label}</Badge>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-primary-600" aria-label="Unread" />}
                      <span className="text-xs text-gray-400">{formatRelativeDate(n.created_at)}</span>
                    </div>
                    <p className={`mt-1 text-sm ${n.read ? 'font-medium text-gray-700' : 'font-semibold text-gray-900'}`}>
                      {n.title}
                    </p>
                    {n.message && <p className="mt-0.5 text-sm text-gray-500">{n.message}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {!n.read && (
                      <button
                        onClick={(e) => { e.preventDefault(); if (!n.id.startsWith('org-invitation-')) markAsRead(n.id) }}
                        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        aria-label="Mark as read"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                    {n.link && <ArrowRight className="h-4 w-4 text-gray-300" />}
                  </div>
                </CardContent>
              </Card>
            )
            return n.link ? (
              <Link key={n.id} to={n.link} onClick={() => { if (!n.read && !n.id.startsWith('org-invitation-')) markAsRead(n.id) }}>
                {content}
              </Link>
            ) : (
              <div key={n.id}>{content}</div>
            )
          })
        )}
      </div>
    </div>
  )
}
