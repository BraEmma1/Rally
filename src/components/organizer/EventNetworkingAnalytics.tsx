import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Handshake,
  PieChart,
  Target,
  UserCheck,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import {
  fetchIndustryActivity,
  fetchIndustryConnections,
  fetchNetworkingOverview,
  fetchNetworkingTimeline,
  fetchOpportunityBreakdown,
  type IndustryActivityRow,
  type IndustryConnectionRow,
  type NetworkingOverview,
  type NetworkingTimelineBucket,
  type OpportunityBreakdownRow,
} from '@/lib/checkin'
import { cn } from '@/lib/utils'

// Organizer networking analytics for one event. Reads only the Phase D
// analytics RPCs — the backend decides who may see this (event organizers and
// assigned event managers), so no registration is required on the caller's
// side. Every number shown is a real backend value; metrics the backend reports
// as unavailable are labeled "Not tracked", never zero, and opportunity value
// carries no currency symbol because Rally does not store currency.

const UNAVAILABLE_LABELS: Record<string, string> = {
  connection_requests: 'Connection Requests',
  accepted_connections: 'Accepted Connections',
  pending_requests: 'Pending Connection Requests',
  profile_views: 'Profile Views',
}

const UNAVAILABLE_ORDER = [
  'profile_views',
  'connection_requests',
  'accepted_connections',
  'pending_requests',
]

function shortBucketLabel(bucketStart: string, interval: string): string {
  const date = new Date(bucketStart)
  if (Number.isNaN(date.getTime())) return ''
  if (interval.includes('hour')) {
    return date.toLocaleTimeString([], { hour: 'numeric' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function TimelineChart({ buckets }: { buckets: NetworkingTimelineBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.connections_made), 1)
  return (
    <div className="space-y-2" role="img" aria-label="Networking activity over time">
      <div className="flex h-40 items-end gap-1.5 sm:gap-2">
        {buckets.map((bucket) => (
          <div key={bucket.bucket_start} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className={cn(
                'w-full rounded-t-sm bg-primary-500 transition-colors group-hover:bg-primary-600',
                bucket.connections_made === 0 && 'bg-gray-100'
              )}
              style={{ height: `${Math.max((bucket.connections_made / max) * 100, bucket.connections_made === 0 ? 2 : 6)}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white group-hover:block">
              {bucket.connections_made} {bucket.connections_made === 1 ? 'connection' : 'connections'}
              {' · '}
              {shortBucketLabel(bucket.bucket_start, bucket.bucket_interval)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>{shortBucketLabel(buckets[0].bucket_start, buckets[0].bucket_interval)}</span>
        <span>{shortBucketLabel(buckets[buckets.length - 1].bucket_start, buckets[buckets.length - 1].bucket_interval)}</span>
      </div>
      <p className="text-xs text-gray-400">Connections made between attendees of this event.</p>
    </div>
  )
}

function SkeletonSection({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-md bg-gray-100', className)} aria-hidden="true" />
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-4">
              <SkeletonSection className="h-3 w-20" />
              <SkeletonSection className="mt-3 h-7 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="py-5">
          <SkeletonSection className="h-4 w-52" />
          <SkeletonSection className="mt-4 h-2 w-full" />
          <SkeletonSection className="mt-3 h-3 w-72" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-5">
          <SkeletonSection className="h-4 w-56" />
          <SkeletonSection className="mt-4 h-40 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

export function EventNetworkingAnalytics({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [overview, setOverview] = useState<NetworkingOverview | null>(null)
  const [timeline, setTimeline] = useState<NetworkingTimelineBucket[] | null>(null)
  const [industry, setIndustry] = useState<IndustryActivityRow[] | null>(null)
  const [industryConnections, setIndustryConnections] = useState<IndustryConnectionRow[] | null>(null)
  const [opportunities, setOpportunities] = useState<OpportunityBreakdownRow[] | null>(null)
  const [industryKnownTotal, setIndustryKnownTotal] = useState<{ known: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [overviewRes, timelineRes, industryRes, industryConnRes, oppRes] = await Promise.all([
      fetchNetworkingOverview(eventId),
      fetchNetworkingTimeline(eventId),
      fetchIndustryActivity(eventId),
      fetchIndustryConnections(eventId),
      fetchOpportunityBreakdown(eventId),
    ])
    const firstError =
      overviewRes.error || timelineRes.error || industryRes.error || industryConnRes.error || oppRes.error
    if (firstError) {
      setError(firstError)
      setOverview(null)
      setTimeline(null)
      setIndustry(null)
      setIndustryConnections(null)
      setOpportunities(null)
      setLoading(false)
      return
    }
    setOverview(overviewRes.data)
    setTimeline(timelineRes.data)
    setIndustry(industryRes.data)
    setIndustryConnections(industryConnRes.data)
    setOpportunities(oppRes.data)

    // Industry coverage, from the backend's industry_known flag: how many
    // checked-in participants have a known industry versus the attendee total.
    const overviewData = overviewRes.data
    if (overviewData && industryRes.data) {
      const known = industryRes.data
        .filter((r) => r.industry_known && r.industry !== 'Unknown')
        .reduce((sum, r) => sum + r.participants, 0)
      setIndustryKnownTotal({ known, total: overviewData.registered_attendees })
    } else {
      setIndustryKnownTotal(null)
    }
    setLoading(false)
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <Card>
        <CardContent>
          <ErrorState message={error} onRetry={() => void load()} />
        </CardContent>
      </Card>
    )
  }

  if (loading || !overview || !timeline || !industry || !industryConnections || !opportunities) {
    return <OverviewSkeleton />
  }

  const hasAnyActivity =
    overview.networking_participants > 0 ||
    overview.connections_made > 0 ||
    overview.opportunities_total > 0

  const kpis = [
    { icon: Users, label: 'Registered Attendees', value: overview.registered_attendees },
    { icon: CheckCircle2, label: 'Checked In', value: overview.checked_in_attendees },
    { icon: Handshake, label: 'Networking Participants', value: overview.networking_participants },
    { icon: UserX, label: 'No Networking Activity', value: overview.attendees_without_networking },
    {
      icon: PieChart,
      label: 'Networking Participation',
      value: `${overview.participation_percent}%`,
    },
    { icon: UserPlus, label: 'Connections Made', value: overview.connections_made },
    { icon: Target, label: 'Opportunities', value: overview.opportunities_total },
    { icon: Briefcase, label: 'Opportunity Value', value: overview.opportunities_value.toLocaleString() },
  ]

  const participationDenominator = overview.checked_in_attendees

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Networking analytics</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          How {eventName} attendees networked — real values from the event's own data.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-gray-400">
                <Icon className="h-4 w-4" />
                <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Participation */}
      <Card>
        <CardContent className="py-5">
          <h3 className="text-sm font-bold text-gray-900">Networking participation</h3>
          {participationDenominator === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              No attendees are checked in yet, so participation cannot be measured.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-gray-600">
                {overview.networking_participants} of {participationDenominator} checked-in attendees participated
              </p>
              <div
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100"
                role="progressbar"
                aria-valuenow={overview.participation_percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Networking participation"
              >
                <div
                  className="h-full rounded-full bg-primary-500"
                  style={{ width: `${Math.min(overview.participation_percent, 100)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="font-bold text-gray-900">{overview.participation_percent}%</span>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                A networking participant is a registered event attendee with qualifying event networking
                activity. Organizers scanning badges do not count.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2.5">
                  <Handshake className="h-4 w-4 text-primary-600" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{overview.networking_participants}</p>
                    <p className="text-xs text-gray-500">with networking activity</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2.5">
                  <UserCheck className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{overview.attendees_without_networking}</p>
                    <p className="text-xs text-gray-500">with no networking activity</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardContent className="py-5">
          <h3 className="text-sm font-bold text-gray-900">Networking activity over time</h3>
          {timeline.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="h-8 w-8" />}
              title="No networking activity recorded yet"
              description="Once attendees start connecting at the event, activity will show up here over time."
            />
          ) : (
            <div className="mt-4">
              <TimelineChart buckets={timeline} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Industry activity */}
      <Card>
        <CardContent className="py-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h3 className="text-sm font-bold text-gray-900">Industry activity</h3>
            {industryKnownTotal && (
              <p className="text-xs text-gray-400">
                Industry data available for {industryKnownTotal.known} of {industryKnownTotal.total} attendees.
              </p>
            )}
          </div>
          {industry.length === 0 || industry.every((r) => !r.industry_known && r.industry === 'Unknown') ? (
            <EmptyState
              icon={<PieChart className="h-8 w-8" />}
              title="Industry data not available"
              description="Attendee industries are taken from profiles. When profiles include an industry, a breakdown appears here."
            />
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {industry
                .filter((r) => r.industry_known && r.industry !== 'Unknown')
                .map((row) => (
                  <li key={row.industry} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{row.industry}</p>
                      <p className="text-xs text-gray-500">
                        {row.participants} {row.participants === 1 ? 'participant' : 'participants'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{row.connections_made}</p>
                      <p className="text-xs text-gray-400">connections</p>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Industry connections */}
      <Card>
        <CardContent className="py-5">
          <h3 className="text-sm font-bold text-gray-900">Cross-industry connections</h3>
          {industryConnections.length === 0 ? (
            <EmptyState
              icon={<ArrowLeftRight className="h-8 w-8" />}
              title="No connections recorded"
              description="Connections between attendees of different industries will appear here."
            />
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {industryConnections.map((row) => (
                <li key={`${row.industry_from}-${row.industry_to}`} className="flex items-center justify-between gap-3 py-2.5">
                  <p className="min-w-0 truncate text-sm text-gray-900">
                    <span className="font-medium">{row.industry_from}</span>
                    <span className="mx-2 text-gray-400">↔</span>
                    <span className="font-medium">{row.industry_to}</span>
                  </p>
                  <p className="shrink-0 text-sm text-gray-500">
                    {row.connections_made} {row.connections_made === 1 ? 'connection' : 'connections'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Opportunities */}
      <Card>
        <CardContent className="py-5">
          <h3 className="text-sm font-bold text-gray-900">Opportunity breakdown</h3>
          {opportunities.length === 0 ? (
            <EmptyState
              icon={<Target className="h-8 w-8" />}
              title="No opportunities generated"
              description="Opportunities traced back to this event will appear here, by stage."
            />
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                    <th className="pb-2 pr-4 font-medium">Stage</th>
                    <th className="pb-2 pr-4 text-right font-medium">Opportunities</th>
                    <th className="pb-2 text-right font-medium">Opportunity Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {opportunities.map((row) => (
                    <tr key={row.stage}>
                      <td className="py-2.5 pr-4 font-medium text-gray-900">{row.stage}</td>
                      <td className="py-2.5 pr-4 text-right text-gray-700">{row.opportunities}</td>
                      <td className="py-2.5 text-right text-gray-700">
                        {row.total_value > 0 ? row.total_value.toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-400">
            Value is shown without a currency symbol because Rally does not store opportunity currency.
          </p>
        </CardContent>
      </Card>

      {/* Unavailable metrics — secondary, never zero */}
      <Card>
        <CardContent className="py-5">
          <h3 className="text-sm font-semibold text-gray-700">Additional metrics</h3>
          <p className="mt-1 text-xs text-gray-400">
            Rally does not track these today, so they are shown as untracked rather than zero.
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {UNAVAILABLE_ORDER.map((key) => {
              const isUnavailable = overview.unavailable_metrics.includes(key)
              const label = UNAVAILABLE_LABELS[key]
              if (!label || !isUnavailable) return null
              return (
                <div key={key} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2.5">
                  <dt className="text-sm text-gray-600">{label}</dt>
                  <dd className="text-sm font-medium text-gray-400">Not tracked</dd>
                </div>
              )
            })}
          </dl>
        </CardContent>
      </Card>

      {!hasAnyActivity && (
        <p className="text-xs text-gray-400">
          This event has no networking activity yet — all values above are live counts.
        </p>
      )}
    </div>
  )
}
