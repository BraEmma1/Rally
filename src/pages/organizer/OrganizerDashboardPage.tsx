import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Globe,
  Link2,
  Mail,
  Users,
} from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Avatar } from '@/components/ui/Avatar'
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
import { cn } from '@/lib/utils'
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

// ---------------------------------------------------------------------------
// Needs attention — deterministic rules over the derived lifecycle plus
// organization_event_counts. No invented warnings.
// ---------------------------------------------------------------------------
type AttentionItem = {
  key: string
  eventName: string
  schedule: string
  title: string
  detail: string
  action: string
  primary: boolean
  to: string
  tone: 'calendar' | 'live'
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
    const dateLabel = formatEventDate(event)

    if (lifecycle === 'draft' && days !== null && days >= 0 && days <= 14) {
      items.push({
        key: event.id + '-draft',
        eventName: event.name,
        schedule: (days === 0 ? 'Starts today' : `Starts in ${days} day${days === 1 ? '' : 's'}`) + ' · ' + dateLabel,
        title: 'Still a draft',
        detail: 'Publish your event to open registration.',
        action: 'Manage event',
        primary: false,
        to: '/organizer/events/' + event.id,
        tone: 'calendar',
      })
      continue
    }

    if (lifecycle === 'published' && days !== null && days >= 0 && days <= 14 && registrations === 0) {
      items.push({
        key: event.id + '-noregs',
        eventName: event.name,
        schedule: (days === 0 ? 'Starts today' : `Starts in ${days} day${days === 1 ? '' : 's'}`) + ' · ' + dateLabel,
        title: 'No registrations yet',
        detail: 'Share the event so people can start registering.',
        action: 'Manage event',
        primary: false,
        to: '/organizer/events/' + event.id,
        tone: 'calendar',
      })
      continue
    }

    if (lifecycle === 'live' && registrations > 0 && checkedIn === 0) {
      items.push({
        key: event.id + '-checkin',
        eventName: event.name,
        schedule: 'Live now · ' + dateLabel,
        title: 'Check-in has not started',
        detail: `${registrations.toLocaleString()} attendee${registrations === 1 ? ' is' : 's are'} registered.`,
        action: 'Open check-in',
        primary: true,
        to: '/organizer/events/' + event.id + '?tab=checkin',
        tone: 'live',
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
  return events
    .filter((e) => eventLifecycle(e) !== 'archived')
    .sort((a, b) => {
      const byLifecycle = LIFECYCLE_PRIORITY[eventLifecycle(a)] - LIFECYCLE_PRIORITY[eventLifecycle(b)]
      if (byLifecycle !== 0) return byLifecycle
      if (eventLifecycle(a) === 'completed') {
        return (b.start_date ?? '').localeCompare(a.start_date ?? '')
      }
      return (a.start_date ?? '9999-12-31').localeCompare(b.start_date ?? '9999-12-31')
    })
    .slice(0, 6)
}

function EventThumb({ event, className }: { event: OrganizerEvent; className?: string }) {
  if (event.image_url) {
    return (
      <img
        src={event.image_url}
        alt=""
        className={cn('shrink-0 rounded-md object-cover bg-gray-100', className)}
      />
    )
  }
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-400',
        className
      )}
      aria-hidden="true"
    >
      <CalendarRange className="h-4 w-4" />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  hint,
  icon,
  iconClassName,
  loading,
}: {
  label: string
  value: string
  hint: string
  icon: React.ReactNode
  iconClassName: string
  loading: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', iconClassName)}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
          {loading ? (
            <div className="mt-1 h-7 w-14 animate-pulse rounded bg-gray-100" />
          ) : (
            <p className="text-2xl font-bold leading-7 tabular-nums text-gray-900">{value}</p>
          )}
          <p className="mt-0.5 truncate text-xs text-gray-500">{hint}</p>
        </div>
      </div>
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

  const attention = useMemo(
    () => (eventsLoading ? [] : attentionItems(events, counts)),
    [events, counts, eventsLoading]
  )
  const shown = useMemo(() => visibleEvents(events), [events])
  const pending = useMemo(() => invitations.filter((i) => i.status === 'pending'), [invitations])

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

  const hasEvents = events.length > 0

  const eventsHint =
    totals.live > 0 && totals.upcoming > 0
      ? `${totals.upcoming} upcoming · ${totals.live} live`
      : totals.live > 0
        ? `${totals.live} live now`
        : totals.upcoming > 0
          ? `${totals.upcoming} upcoming`
          : 'None upcoming'
  const checkedInHint =
    totals.registrations > 0
      ? `${Math.round((totals.checkedIn / totals.registrations) * 100)}% of registrations`
      : 'No check-ins yet'

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
              <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 7h2m2 0h2M9 11h2m2 0h2M9 15h2m2 0h2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-gray-500">Welcome back</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold text-gray-900">{organization.name}</h1>
              <ApprovalBadge status={organization.approval_status} />
              {organization.archived_at && <Badge variant="gray">Archived</Badge>}
            </div>
            {organization.website && (
              <a
                href={organization.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
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

      {!hasEvents && !eventsLoading ? (
        <section aria-labelledby="get-started-heading">
          <div className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
              <CalendarRange className="h-6 w-6" aria-hidden="true" />
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
          <section aria-label="Organization summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryCard
                label="Events"
                value={String(events.length)}
                hint={eventsHint}
                loading={eventsLoading}
                icon={<CalendarRange className="h-5 w-5" aria-hidden="true" />}
                iconClassName="bg-primary-50 text-primary-600"
              />
              <SummaryCard
                label="Registrations"
                value={totals.registrations.toLocaleString()}
                hint="Across your events"
                loading={eventsLoading}
                icon={<Users className="h-5 w-5" aria-hidden="true" />}
                iconClassName="bg-primary-50 text-primary-600"
              />
              <SummaryCard
                label="Checked in"
                value={totals.checkedIn.toLocaleString()}
                hint={checkedInHint}
                loading={eventsLoading}
                icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                iconClassName="bg-success-50 text-success-600"
              />
              <SummaryCard
                label="Connections"
                value={totals.connections.toLocaleString()}
                hint="Made at your events"
                loading={eventsLoading}
                icon={<Link2 className="h-5 w-5" aria-hidden="true" />}
                iconClassName="bg-violet-50 text-violet-600"
              />
            </div>
          </section>

          {!eventsLoading && attention.length > 0 && (
            <section aria-labelledby="attention-heading">
              <div className="rounded-lg border border-warning-200 bg-warning-50 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-error-500 text-white">
                    <AlertCircle className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 id="attention-heading" className="text-base font-bold text-gray-900">
                        Needs attention
                      </h2>
                      <span className="rounded-full bg-warning-200 px-2 py-0.5 text-xs font-bold text-warning-800">
                        {attention.length}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">
                      A few things need your attention before or during your events.
                    </p>
                  </div>
                </div>

                <ul className="mt-3 space-y-2">
                  {attention.map((item) => (
                    <li
                      key={item.key}
                      className="relative flex flex-col gap-2 rounded-lg border border-warning-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="flex min-w-0 items-start gap-3 sm:w-2/5">
                        <div
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                            item.tone === 'live' ? 'bg-success-50 text-success-600' : 'bg-primary-50 text-primary-600'
                          )}
                          aria-hidden="true"
                        >
                          {item.tone === 'live' ? (
                            <Users className="h-5 w-5" />
                          ) : (
                            <CalendarRange className="h-5 w-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-gray-900">{item.eventName}</p>
                          <p
                            className={cn(
                              'truncate text-xs',
                              item.tone === 'live' ? 'font-medium text-success-600' : 'text-gray-500'
                            )}
                          >
                            {item.schedule}
                          </p>
                        </div>
                      </div>

                      <div className="min-w-0 flex-1 sm:border-l sm:border-warning-100 sm:pl-4">
                        <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                        <p className="text-xs text-gray-500">{item.detail}</p>
                      </div>

                      <Link
                        to={item.to}
                        className="hidden shrink-0 sm:inline-flex"
                        aria-label={`${item.action} — ${item.eventName}`}
                      >
                        <Button variant={item.primary ? 'primary' : 'secondary'} size="sm">
                          {item.action}
                        </Button>
                      </Link>
                      <Link
                        to={item.to}
                        className="absolute inset-y-0 right-3 flex items-center sm:hidden"
                        aria-label={`${item.action} — ${item.eventName}`}
                      >
                        <ChevronRight className="h-5 w-5 text-gray-400" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <section aria-labelledby="events-heading">
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <h2 id="events-heading" className="text-lg font-bold text-gray-900">
                  Your events
                </h2>
                <p className="text-sm text-gray-500">An overview of your recent and upcoming events.</p>
              </div>
              <Link
                to="/organizer/events"
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                View all events
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>

            {eventsError && (
              <div className="mt-2 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
                {eventsError}{' '}
                <button
                  type="button"
                  onClick={() => void loadEvents()}
                  className="font-semibold underline hover:text-error-800"
                >
                  Try again
                </button>
              </div>
            )}

            {eventsLoading ? (
              <ul className="mt-3 space-y-2">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="rounded-lg border border-gray-200 bg-white px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-14 animate-pulse rounded-md bg-gray-100" />
                      <div className="flex-1">
                        <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
                        <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-gray-100" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                {/* Desktop — table */}
                <div className="mt-3 hidden overflow-hidden rounded-lg border border-gray-200 bg-white md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        <th scope="col" className="px-4 py-2.5 font-semibold">Event</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Date</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Registrations</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Checked in</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Connections</th>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((event) => {
                        const lifecycle = eventLifecycle(event)
                        const count = counts[event.id]
                        const showActivity = lifecycle === 'live' || lifecycle === 'completed'
                        return (
                          <tr key={event.id} className="border-t border-gray-100 first:border-t-0 hover:bg-gray-50/60">
                            <td className="px-4 py-2.5">
                              <Link to={'/organizer/events/' + event.id} className="flex items-center gap-3">
                                <EventThumb event={event} className="h-10 w-14" />
                                <span className="font-semibold text-gray-900 hover:text-primary-700">
                                  {event.name}
                                </span>
                              </Link>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                              {formatEventDate(event)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                              {count ? count.registrations.toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                              {showActivity && count ? count.checked_in.toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                              {showActivity && count ? count.connections_made.toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <Link to={'/organizer/events/' + event.id}>
                                <Button variant="secondary" size="sm">
                                  Manage
                                </Button>
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile — compact rows */}
                <ul className="mt-3 space-y-2 md:hidden">
                  {shown.map((event) => {
                    const lifecycle = eventLifecycle(event)
                    const count = counts[event.id]
                    const showActivity = lifecycle === 'live' || lifecycle === 'completed'
                    return (
                      <li key={event.id}>
                        <Link
                          to={'/organizer/events/' + event.id}
                          className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300"
                        >
                          <EventThumb event={event} className="h-12 w-16" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-gray-900">{event.name}</p>
                              <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
                            </div>
                            <p className="mt-0.5 text-xs text-gray-500">{formatEventDate(event)}</p>
                            <div className="mt-1.5 flex items-center gap-4 text-xs text-gray-600">
                              <span className="inline-flex items-center gap-1">
                                <Users className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                                {count ? count.registrations.toLocaleString() : '—'}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <CheckCircle2 className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                                {showActivity && count ? count.checked_in.toLocaleString() : '—'}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Link2 className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                                {showActivity && count ? count.connections_made.toLocaleString() : '—'}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>

          <section aria-label="Team and invitations">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <Users className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h2 className="text-base font-bold text-gray-900">Team</h2>
                  </div>
                  <Link
                    to="/organizer/team"
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    {manages ? 'Manage team' : 'View team'}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
                {teamLoading ? (
                  <div className="mt-3 h-8 w-1/3 animate-pulse rounded bg-gray-100" />
                ) : (
                  <>
                    <p className="mt-1.5 text-sm text-gray-600">
                      {members.length === 0
                        ? 'You are working on your own for now.'
                        : `${members.length} ${members.length === 1 ? 'person can work' : 'people can work'} on these events.`}
                    </p>
                    {members.length > 0 && (
                      <div className="mt-3 flex items-center">
                        {members.slice(0, 4).map((m, i) => (
                          <div
                            key={m.user_id}
                            className={cn('rounded-full ring-2 ring-white', i > 0 && '-ml-2')}
                            title={m.full_name || 'Unnamed member'}
                          >
                            <Avatar name={m.full_name || 'Unnamed member'} src={m.photo_url || null} size="sm" />
                          </div>
                        ))}
                        {members.length > 4 && (
                          <div className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 ring-2 ring-white">
                            +{members.length - 4}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <Mail className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h2 className="text-base font-bold text-gray-900">Pending invitations</h2>
                  </div>
                  {manages && (
                    <Link
                      to="/organizer/team"
                      className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                      Invite someone
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  )}
                </div>
                {teamLoading ? (
                  <div className="mt-3 h-10 w-2/3 animate-pulse rounded bg-gray-100" />
                ) : (
                  <>
                    <p className="mt-1.5 text-sm text-gray-600">
                      {!manages
                        ? 'Invitations are managed by owners and admins.'
                        : pending.length === 0
                          ? 'No invitations waiting for a response.'
                          : `${pending.length} invitation${pending.length === 1 ? ' is' : 's are'} waiting for a response.`}
                    </p>
                    {manages && pending.length > 0 && (
                      <ul className="mt-3 space-y-2.5">
                        {pending.slice(0, 3).map((invitation) => (
                          <li key={invitation.id} className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Avatar
                                name={invitation.full_name || invitation.invited_email || 'Invited user'}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-gray-900">
                                  {invitation.full_name || invitation.invited_email || 'Invited user'}
                                </p>
                                {invitation.invited_email && invitation.full_name && (
                                  <p className="truncate text-xs text-gray-500">{invitation.invited_email}</p>
                                )}
                              </div>
                            </div>
                            <Badge variant="warning">
                              Invited as {ORG_ROLE_LABELS[invitation.role]}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
