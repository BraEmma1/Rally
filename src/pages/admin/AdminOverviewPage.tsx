import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ClipboardCheck, RefreshCw, ScrollText, Settings, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AccountStatusBadge, AccountTypeBadge } from '@/components/admin/AdminBadges'
import { PersonCell } from '@/components/admin/PersonCell'
import { StatCard } from '@/components/admin/StatCard'
import {
  describeChange,
  fetchAccountChanges,
  fetchAccountMetrics,
  fetchPendingOrganizers,
  fetchProfileNames,
  fetchRecentAccounts,
  formatDateTime,
  type AccountMetrics,
} from '@/lib/admin'
import type { AccountChange, AdminAccountRow, ProfileName } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Admins have no read policy on organizations, private events, registrations or
// partnerships, so those metrics are shown as unavailable with the reason,
// never as 0.
const NO_ADMIN_READ = 'Admins cannot read this data yet. It needs an admin-only read function.'
const EVENTS_PRIVATE =
  'Draft, unlisted and archived events are private to each organization, so a platform-wide count is not readable yet.'
const PUBLISHED_HELD =
  'Held back until the total is readable, so a public-only figure is not mistaken for the platform total.'

type Section<T> = { data: T; error: string | null }

export default function AdminOverviewPage() {
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<Section<AccountMetrics | null>>({ data: null, error: null })
  const [pending, setPending] = useState<Section<AdminAccountRow[]>>({ data: [], error: null })
  const [pendingTotal, setPendingTotal] = useState(0)
  const [recent, setRecent] = useState<Section<AdminAccountRow[]>>({ data: [], error: null })
  const [activity, setActivity] = useState<Section<AccountChange[]>>({ data: [], error: null })
  const [names, setNames] = useState<Record<string, ProfileName>>({})
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [m, p, r, a] = await Promise.all([
      fetchAccountMetrics(),
      fetchPendingOrganizers(5),
      fetchRecentAccounts(8),
      fetchAccountChanges(0, 5),
    ])
    setMetrics(m)
    setPending({ data: p.data, error: p.error })
    setPendingTotal(p.total)
    setRecent({ data: r.data, error: r.error })
    setActivity({ data: a.data, error: a.error })
    setNames(
      await fetchProfileNames([
        ...p.data.map((row) => row.user_id),
        ...r.data.map((row) => row.user_id),
        ...a.data.flatMap((row) => [row.user_id, row.changed_by]),
      ])
    )
    setLoadedAt(new Date().toISOString())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const m = metrics.data

  return (
    <div>
      <AdminPageHeader
        title="Overview"
        description="Live platform state from the database. Figures an administrator is not yet authorized to read are marked unavailable."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <section aria-labelledby="accounts-heading" className="mb-8">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="accounts-heading" className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Accounts
          </h2>
          {loadedAt && <p className="text-xs text-gray-400">Updated {formatDateTime(loadedAt)}</p>}
        </div>
        {metrics.error ? (
          <Card>
            <ErrorState message={metrics.error} onRetry={() => void load()} />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total users"
              definition="Accounts with a Rally account record, every type and status."
              value={m?.totalAccounts}
              loading={loading && !m}
            />
            <StatCard
              label="Active attendees"
              definition="Attendee accounts with status active."
              value={m?.activeAttendees}
              loading={loading && !m}
            />
            <StatCard
              label="Registered organizers"
              definition="Organizer accounts in any status, including pending."
              value={m?.organizers}
              loading={loading && !m}
            />
            <StatCard
              label="Pending organizer approvals"
              definition="Organizer accounts waiting for an administrator."
              value={m?.pendingOrganizers}
              loading={loading && !m}
              highlight={(m?.pendingOrganizers ?? 0) > 0}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="platform-heading" className="mb-8">
        <h2 id="platform-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Organizations, events and partnerships
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total organizations" definition="" unavailable={NO_ADMIN_READ} />
          <StatCard label="Pending organization approvals" definition="" unavailable={NO_ADMIN_READ} />
          <StatCard label="Total events" definition="" unavailable={EVENTS_PRIVATE} />
          <StatCard label="Published events" definition="" unavailable={PUBLISHED_HELD} />
          <StatCard label="Active partnerships" definition="" unavailable={NO_ADMIN_READ} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Pending approval queue</CardTitle>
            {pendingTotal > 0 && (
              <span className="text-xs font-medium text-warning-700">{pendingTotal} waiting</span>
            )}
          </CardHeader>
          <CardContent>
            {loading && pending.data.length === 0 ? (
              <LoadingState />
            ) : pending.error ? (
              <ErrorState message={pending.error} onRetry={() => void load()} />
            ) : pending.data.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck className="h-8 w-8" />}
                title="No organizers waiting"
                description="New organizer sign-ups appear here until an administrator reviews them."
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {pending.data.map((row) => (
                  <li key={row.user_id} className="flex items-center justify-between gap-3 py-3">
                    <PersonCell id={row.user_id} names={names} />
                    <span className="shrink-0 text-xs text-gray-500">Signed up {formatDateTime(row.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-500">
              Approving and declining from this workspace arrives with the Approvals page.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent registrations</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && recent.data.length === 0 ? (
              <LoadingState />
            ) : recent.error ? (
              <ErrorState message={recent.error} onRetry={() => void load()} />
            ) : recent.data.length === 0 ? (
              <EmptyState icon={<UserPlus className="h-8 w-8" />} title="No accounts yet" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {recent.data.map((row) => (
                  <li key={row.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <PersonCell id={row.user_id} names={names} />
                    <span className="flex items-center gap-2">
                      <AccountTypeBadge type={row.account_type} />
                      <AccountStatusBadge status={row.status} />
                      <span className="text-xs text-gray-500">{formatDateTime(row.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Recent administrative activity</CardTitle>
            <Link
              to="/admin/audit-logs"
              className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Full audit log <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent>
            {loading && activity.data.length === 0 ? (
              <LoadingState />
            ) : activity.error ? (
              <ErrorState message={activity.error} onRetry={() => void load()} />
            ) : activity.data.length === 0 ? (
              <EmptyState icon={<ScrollText className="h-8 w-8" />} title="No recorded account changes yet" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {activity.data.map((change) => (
                  <li key={change.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center">
                    <PersonCell id={change.user_id} names={names} />
                    <p className="text-sm text-gray-700">
                      {describeChange(change)}
                      <span className="block text-xs text-gray-500">
                        By {change.changed_by ? names[change.changed_by]?.full_name?.trim() || 'an administrator' : 'operator (direct SQL)'}
                      </span>
                    </p>
                    <span className="text-xs text-gray-500">{formatDateTime(change.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="links-heading" className="mt-8">
        <h2 id="links-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Quick links
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { to: '/admin/approvals', label: 'Organizer approvals', icon: ClipboardCheck },
            { to: '/admin/audit-logs', label: 'Audit logs', icon: ScrollText },
            { to: '/admin/settings', label: 'Settings', icon: Settings },
          ].map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <link.icon className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1">{link.label}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
