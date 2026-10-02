import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, Building2, CalendarRange, Globe, Mail, UserPlus, Users } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/States'
import {
  canManageTeam,
  fetchOrganizationEventCounts,
  listInvitations,
  listMembers,
  type OrgEventCounts,
} from '@/lib/organizer'
import {
  eventLifecycle,
  formatEventDate,
  LIFECYCLE_BADGE,
  LIFECYCLE_LABELS,
  listOrganizationEvents,
  type EventLifecycle,
} from '@/lib/events'
import {
  ORG_ROLE_LABELS,
  type OrganizationInvitation,
  type OrganizationMember,
  type OrganizerEvent,
} from '@/lib/supabase'

function ApprovalBadge({ status }: { status: string }) {
  if (status === 'approved') return <Badge variant="success">Approved</Badge>
  if (status === 'rejected') return <Badge variant="error">Rejected</Badge>
  if (status === 'suspended') return <Badge variant="error">Suspended</Badge>
  return <Badge variant="warning">Pending review</Badge>
}

// Calendar days from today until the event's start date. Null when no date is
// set. Local midnight to local midnight, so "starts today" is 0 everywhere.
function daysUntil(startDate: string | null): number | null {
  if (!startDate) return null
  const start = new Date(startDate + 'T00:00:00')
  if (Number.isNaN(start.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((start.getTime() - today.getTime()) / 86_400_000)
}

// Deterministic, conservative rules only: each one is computable from the
// derived lifecycle plus organization_event_counts. No invented warnings.
type AttentionItem = {
  key: string
  eventName: string
  title: string
  detail: string
  action: string
  to: string
}

function attentionItems(
  events: OrganizerEvent[],
  counts: Record<string, OrgEventCounts>
): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const event of events) {
    const lifecycle = eventLifecycle(event)
    const count = counts[event.id]
    const days = daysUntil(event.start_date)
    const registrations = count?.registrations ?? 0
    const checkedIn = count?.checked_in ?? 0

    if (lifecycle === 'draft' && days !== null && days >= 0 && days <= 14) {
      items.push({
        key: event.id + '-draft',
        eventName: event.name,
        title: 'Still a draft',
        detail:
          days === 0
            ? 'It starts today but has not been published.'
            : `It starts in ${days} day${days === 1 ? '' : 's'} but has not been published.`,
        action: 'Review event',
        to: '/organizer/events/' + event.id,
      })
      continue
    }

    if (lifecycle === 'published' && days !== null && days >= 0 && days <= 14 && registrations === 0) {
      items.push({
        key: event.id + '-noregs',
        eventName: event.name,
        title: 'No registrations yet',
        detail:
          days === 0
            ? 'It starts today and nobody has registered.'
            : `It starts in ${days} day${days === 1 ? '' : 's'} and nobody has registered yet.`,
        action: 'View event',
        to: '/organizer/events/' + event.id,
      })
      continue
    }

    if (lifecycle === 'live' && registrations > 0 && checkedIn === 0) {
      items.push({
        key: event.id + '-checkin',
        eventName: event.name,
        title: 'Check-in has not started',
        detail: `${registrations.toLocaleString()} attendee${registrations === 1 ? ' is' : 's are'} registered.`,
        action: 'Open Check-in',
        to: '/organizer/events/' + event.id + '?tab=checkin',
      })
    }
  }
  return items
}

// Live first, then upcoming, then drafts, then recent completions. Archived
// events stay off Home entirely; the Events list holds the full history.
const LIFECYCLE_PRIORITY: Record<EventLifecycle, number> = {
  live: 0,
  published: 1,
  draft: 2,
  completed: 3,
  archived: 4,
}

function visibleEvents(events: OrganizerEvent[]): OrganizerEvent[] {
  const ranked = events
    .filter((e) => eventLifecycle(e) !== 'archived')
    .sort((a, b) => {
      const byLifecycle = LIFECYCLE_PRIORITY[eventLifecycle(a)] - LIFECYCLE_PRIORITY[eventLifecycle(b)]
      if (byLifecycle !== 0) return byLifecycle
      if (eventLifecycle(a) === 'completed') {
        // Most recently ended first among past events.
        return (b.start_date ?? '').localeCompare(a.start_date ?? '')
      }
      // Soonest first among everything still ahead.
      return (a.start_date ?? '9999-12-31').localeCompare(b.start_date ?? '9999-12-31')
    })
  return ranked.slice(0, 6)
}

// One compact metric. Value reads as "—" when it cannot be known yet rather
// than pretending a zero means something.
function SummaryMetric({
  label,
  value,
  hint,
  loading,
}: {
  label: string
  value: string
  hint?: string
  loading: boolean
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">
        {loading ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-gray-100" /> : value}
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export default function OrganizerDashboardPage() {
  const { organization, role, loading: orgLoading, error: orgError, refresh } = useOrganizer()
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([])
  const [events, setEvents] = useState<OrganizerEvent[]>([])
  const [counts, setCounts] = useState<Record<string, OrgEventCounts>>({})
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [teamLoading, setTeamLoading] = useState(true)

  const orgId = organization?.id ?? null
  const manages = canManageTeam(role)

  const loadEvents = useCallback(async () => {
    if (!orgId) return
    setEventsLoading(true)
    setEventsError(null)

    const eventsResult = await listOrganizationEvents(orgId)
    if (eventsResult.error) {
      setEventsError(eventsResult.error)
      setEventsLoading(false)
      return
    }
    setEvents(eventsResult.data)

    // The aggregate counts are a separate, failure-tolerant layer: the event
    // list stays usable even if activity numbers cannot be loaded.
    const countsResult = await fetchOrganizationEventCounts(orgId)
    if (countsResult.error) setEventsError(countsResult.error)
    setCounts(countsResult.data)
    setEventsLoading(false)
  }, [orgId])

  const loadTeam = useCallback(async () => {
    if (!orgId) return
    setTeamLoading(true)

    const membersResult = await listMembers(orgId)
    if (!membersResult.error) setMembers(membersResult.data)

    // Only owners and admins may list invitations, so a manager simply sees
    // none rather than an error they can do nothing about.
    if (manages) {
      const invitationsResult = await listInvitations(orgId)
      if (!invitationsResult.error) setInvitations(invitationsResult.data)
    } else {
      setInvitations([])
    }

    setTeamLoading(false)
  }, [orgId, manages])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  useEffect(() => {
    void loadTeam()
  }, [loadTeam])

  const attention = useMemo(() => attentionItems(events, counts), [events, counts])
  const shown = useMemo(() => visibleEvents(events), [events])

  const totals = useMemo(() => {
    let registrations = 0
    let checkedIn = 0
    let connections = 0
    for (const c of Object.values(counts)) {
      registrations += c.registrations
      checkedIn += c.checked_in
      connections += c.connections_made
    }
    const live = events.filter((e) => eventLifecycle(e) === 'live').length
    const upcoming = events.filter((e) => eventLifecycle(e) === 'published').length
    return { registrations, checkedIn, connections, live, upcoming }
  }, [events, counts])

  if (orgLoading) return <LoadingState message="Loading your organization…" />
  if (orgError) return <ErrorState message={orgError} onRetry={() => void refresh()} />
  if (!organization) return null // the route guard sends this case to setup

  const pendingCount = invitations.filter((i) => i.status === 'pending').length
  const hasEvents = events.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <Building2 className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold text-gray-900">{organization.name}</h1>
              <ApprovalBadge status={organization.approval_status} />
              {organization.archived_at && <Badge variant="gray">Archived</Badge>}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {role ? `You are ${role === 'admin' ? 'an admin' : role === 'owner' ? 'the owner' : 'an event manager'}` : ''}
            </p>
            {organization.website && (
              <a
                href={organization.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                <Globe className="h-4 w-4" />
                {organization.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link to="/organizer/events/new">
            <Button>Create event</Button>
          </Link>
          <Link to="/organizer/settings">
            <Button variant="secondary">Organization settings</Button>
          </Link>
        </div>
      </div>

      {organization.approval_status !== 'approved' && (
        <div className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700" role="status">
          This organization has not been reviewed by Rally yet. Everything still works — your team,
          your events and registrations are unaffected — and the badge disappears once a Rally
          administrator reviews it.
        </div>
      )}

      {hasEvents && (
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="sr-only">
            Organization summary
          </h2>
          <div className="grid grid-cols-2 divide-gray-100 rounded-lg border border-gray-200 bg-white sm:grid-cols-4 sm:divide-x">
            <SummaryMetric
              label="Events"
              value={String(events.length)}
              hint={
                totals.live > 0
                  ? totals.live + ' live now'
                  : totals.upcoming > 0
                    ? totals.upcoming + ' upcoming'
                    : 'None upcoming'
              }
              loading={eventsLoading}
            />
            <SummaryMetric
              label="Registrations"
              value={totals.registrations.toLocaleString()}
              hint="Across your events"
              loading={eventsLoading}
            />
            <SummaryMetric
              label="Checked in"
              value={totals.checkedIn.toLocaleString()}
              hint={totals.checkedIn === 0 ? 'No check-ins yet' : undefined}
              loading={eventsLoading}
            />
            <SummaryMetric
              label="Connections"
              value={totals.connections.toLocaleString()}
              hint={totals.connections === 0 ? 'No connections yet' : 'Made at your events'}
              loading={eventsLoading}
            />
          </div>
        </section>
      )}

      {!hasEvents && !eventsLoading ? (
        <section aria-labelledby="get-started-heading">
          <div className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
              <CalendarRange className="h-6 w-6" />
            </div>
            <h2 id="get-started-heading" className="mt-4 text-lg font-semibold text-gray-900">
              Create your first event
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              Start by setting up an event, inviting your team and preparing attendee registration.
              Your activity will appear here as it happens.
            </p>
            <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Link to="/organizer/events/new">
                <Button>Create Event</Button>
              </Link>
              <Link to="/organizer/team">
                <Button variant="secondary">Invite Team</Button>
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <>
          {attention.length > 0 && (
            <section aria-labelledby="attention-heading">
              <h2 id="attention-heading" className="text-base font-semibold text-gray-900">
                Needs attention
              </h2>
              <ul className="mt-2 space-y-2">
                {attention.map((item) => (
                  <li
                    key={item.key}
                    className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{item.eventName}</p>
                        <p className="text-sm text-gray-600">
                          {item.title} — {item.detail}
                        </p>
                      </div>
                    </div>
                    <Link to={item.to} className="shrink-0 sm:ml-4">
                      <Button variant="secondary" size="sm" className="w-full sm:w-auto">
                        {item.action}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="events-heading">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="events-heading" className="text-base font-semibold text-gray-900">
                Your events
              </h2>
              <Link
                to="/organizer/events"
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                View all
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>

            {eventsError && (
              <div className="mt-2 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
                {eventsError}
              </div>
            )}

            {eventsLoading ? (
              <ul className="mt-2 space-y-2">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="rounded-lg border border-gray-200 bg-white px-4 py-4">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
                    <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-gray-100" />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-2 space-y-2">
                {shown.map((event) => {
                  const lifecycle = eventLifecycle(event)
                  const count = counts[event.id]
                  const isPast = lifecycle === 'completed' || lifecycle === 'archived'
                  return (
                    <li
                      key={event.id}
                      className="rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              to={'/organizer/events/' + event.id}
                              className="truncate text-sm font-semibold text-gray-900 hover:text-primary-700"
                            >
                              {event.name}
                            </Link>
                            <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">{formatEventDate(event)}</p>
                        </div>

                        <dl className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 sm:justify-end">
                          <div className="text-right">
                            <dt className="text-[11px] uppercase tracking-wide text-gray-400">
                              {isPast ? 'Registrations' : 'Registered'}
                            </dt>
                            <dd className="text-sm font-medium tabular-nums text-gray-900">
                              {count ? count.registrations.toLocaleString() : '—'}
                            </dd>
                          </div>
                          {lifecycle !== 'draft' && lifecycle !== 'published' && (
                            <div className="text-right">
                              <dt className="text-[11px] uppercase tracking-wide text-gray-400">Checked in</dt>
                              <dd className="text-sm font-medium tabular-nums text-gray-900">
                                {count ? count.checked_in.toLocaleString() : '—'}
                              </dd>
                            </div>
                          )}
                          {lifecycle !== 'draft' && lifecycle !== 'published' && (
                            <div className="text-right">
                              <dt className="text-[11px] uppercase tracking-wide text-gray-400">Connections</dt>
                              <dd className="text-sm font-medium tabular-nums text-gray-900">
                                {count ? count.connections_made.toLocaleString() : '—'}
                              </dd>
                            </div>
                          )}
                          <Link to={'/organizer/events/' + event.id} className="sm:ml-2">
                            <Button variant="secondary" size="sm">
                              Manage
                            </Button>
                          </Link>
                        </dl>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <section aria-labelledby="team-heading">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="team-heading" className="text-sm font-semibold text-gray-900">
                Team
              </h2>
              <Users className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            </div>
            {teamLoading ? (
              <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-gray-100" />
            ) : (
              <>
                <p className="mt-1 text-sm text-gray-600">
                  {members.length === 0
                    ? 'You are working on your own for now.'
                    : members.length === 1
                      ? 'Just you so far.'
                      : members.length + ' people can work on these events.'}
                </p>
                <Link
                  to="/organizer/team"
                  className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
                >
                  {manages ? 'Manage team' : 'View team'}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Invitations</h2>
              <Mail className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            </div>
            {teamLoading ? (
              <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-gray-100" />
            ) : (
              <>
                <p className="mt-1 text-sm text-gray-600">
                  {!manages
                    ? 'Invitations are managed by owners and admins.'
                    : pendingCount === 0
                      ? 'No invitations waiting.'
                      : pendingCount +
                        ' invitation' +
                        (pendingCount === 1 ? ' is' : 's are') +
                        ' waiting for a response.'}
                </p>
                {manages && (
                  <Link
                    to="/organizer/team"
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Invite someone
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {pendingCount > 0 && manages && (
        <section aria-labelledby="pending-heading">
          <h2 id="pending-heading" className="text-base font-semibold text-gray-900">
            Pending invitations
          </h2>
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {invitations
              .filter((i) => i.status === 'pending')
              .slice(0, 5)
              .map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {invitation.full_name || invitation.invited_email || 'Invited user'}
                    </p>
                    {invitation.invited_email && invitation.full_name && (
                      <p className="truncate text-xs text-gray-500">{invitation.invited_email}</p>
                    )}
                  </div>
                  <Badge variant="warning">Invited as {ORG_ROLE_LABELS[invitation.role]}</Badge>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  )
}
