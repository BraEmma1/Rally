import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Building2, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input, Label, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminPagination } from '@/components/admin/AdminPagination'
import { ArchivedBadge, OrgApprovalBadge, OrgTypeBadge } from '@/components/admin/AdminBadges'
import { ApprovalControlsNotice, OrgLogo } from '@/components/admin/OrganizationParts'
import { formatDateTime } from '@/lib/admin'
import { listOrganizations, type OrganizationSort } from '@/lib/adminOrganizations'
import {
  ORG_APPROVAL_LABELS,
  ORG_TYPE_LABELS,
  type AdminOrganizationRow,
  type OrgApprovalStatus,
  type OrgType,
} from '@/lib/supabase'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 350
const SEARCH_MAX = 100

const TYPES = Object.keys(ORG_TYPE_LABELS) as OrgType[]
const APPROVALS = Object.keys(ORG_APPROVAL_LABELS) as OrgApprovalStatus[]
const SORTS: { value: OrganizationSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
]

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function CreatorLink({ row }: { row: AdminOrganizationRow }) {
  if (!row.created_by) return <span className="text-gray-400">—</span>
  return (
    <Link to={`/admin/users/${row.created_by}`} className="text-sm text-primary-600 hover:text-primary-700">
      {row.created_by_name || 'Unnamed account'}
    </Link>
  )
}

export default function AdminOrganizationsPage() {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').slice(0, SEARCH_MAX)
  const type = pick(params.get('type'), ['all', ...TYPES] as const, 'all')
  const approval = pick(params.get('approval'), ['all', ...APPROVALS] as const, 'all')
  const includeArchived = params.get('archived') === '1'
  const sort = pick(params.get('sort'), SORTS.map((s) => s.value), 'newest')
  const page = Math.max(0, Number.parseInt(params.get('page') ?? '0', 10) || 0)

  const [searchInput, setSearchInput] = useState(q)
  const [rows, setRows] = useState<AdminOrganizationRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const update = useCallback(
    (next: Record<string, string>) => {
      setParams(
        (current) => {
          const merged = new URLSearchParams(current)
          for (const [key, value] of Object.entries(next)) {
            const isDefault =
              value === '' ||
              value === 'all' ||
              (key === 'sort' && value === 'newest') ||
              (key === 'page' && value === '0') ||
              (key === 'archived' && value === '0')
            if (isDefault) merged.delete(key)
            else merged.set(key, value)
          }
          return merged
        },
        { replace: true }
      )
    },
    [setParams]
  )

  // Keep the box in step when the URL changes underneath it (back/forward).
  useEffect(() => {
    setSearchInput(q)
  }, [q])

  // Search runs in the database, so wait for typing to pause.
  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === q.trim()) return
    const timer = setTimeout(() => update({ q: trimmed, page: '0' }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput, q, update])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await listOrganizations({
      search: q,
      type,
      approval,
      includeArchived,
      sort,
      page,
      pageSize: PAGE_SIZE,
    })
    setError(loadError)
    setRows(data?.rows ?? [])
    setTotal(data?.total ?? 0)
    setLoading(false)
  }, [q, type, approval, includeArchived, sort, page])

  useEffect(() => {
    void load()
  }, [load])

  // A bookmarked or stale ?page= past the end: move to the last real page.
  useEffect(() => {
    if (!loading && !error && rows.length === 0 && total > 0 && page > 0) {
      update({ page: String(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)) })
    }
  }, [loading, error, rows.length, total, page, update])

  const detailState = { from: `${location.pathname}${location.search}` }
  const filtered = Boolean(q || type !== 'all' || approval !== 'all' || includeArchived)

  return (
    <div>
      <AdminPageHeader
        title="Organizations"
        description="Every organization on Rally: organizers, sponsors and vendors, with their members, events and approval status."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <div className="mb-4">
        <ApprovalControlsNotice />
      </div>

      <Card className="mb-4">
        <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem_9rem]">
          <div>
            <Label htmlFor="orgs-search">Search name or slug</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="orgs-search"
                type="search"
                value={searchInput}
                maxLength={SEARCH_MAX}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') update({ q: searchInput.trim(), page: '0' })
                }}
                placeholder="Search organizations"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="orgs-type">Type</Label>
            <Select id="orgs-type" value={type} onChange={(e) => update({ type: e.target.value, page: '0' })}>
              <option value="all">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {ORG_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="orgs-approval">Approval</Label>
            <Select id="orgs-approval" value={approval} onChange={(e) => update({ approval: e.target.value, page: '0' })}>
              <option value="all">All statuses</option>
              {APPROVALS.map((a) => (
                <option key={a} value={a}>
                  {ORG_APPROVAL_LABELS[a]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="orgs-sort">Sort</Label>
            <Select id="orgs-sort" value={sort} onChange={(e) => update({ sort: e.target.value, page: '0' })}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-4">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => update({ archived: e.target.checked ? '1' : '0', page: '0' })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
            />
            Include archived organizations
          </label>
        </CardContent>
      </Card>

      <Card>
        {loading && rows.length === 0 ? (
          <LoadingState message="Loading organizations…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title={filtered ? 'No organizations match these filters' : 'No organizations yet'}
            description={
              filtered ? undefined : 'Organizations appear here when organizers create them or sponsors accept an invitation.'
            }
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-gray-200 text-left">
                <caption className="sr-only">Organizations, page {page + 1}</caption>
                <thead className="bg-gray-50">
                  <tr>
                    {['Organization', 'Type', 'Approval', 'Created', 'Members', 'Events', 'Created by', ''].map((h, i) => (
                      <th
                        key={h || i}
                        scope="col"
                        className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500"
                      >
                        {h || <span className="sr-only">Open</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <OrgLogo name={row.name} src={row.logo_url} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-900">{row.name}</p>
                            {row.slug && <p className="truncate font-mono text-xs text-gray-400">{row.slug}</p>}
                          </div>
                          {row.archived_at && <ArchivedBadge />}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <OrgTypeBadge type={row.org_type} />
                      </td>
                      <td className="px-4 py-3">
                        <OrgApprovalBadge status={row.approval_status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDateTime(row.created_at)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{row.member_count}</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{row.event_count}</td>
                      <td className="px-4 py-3">
                        <CreatorLink row={row} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/admin/organizations/${row.id}`}
                          state={detailState}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          aria-label={`View ${row.name}`}
                        >
                          View <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-gray-100 md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    to={`/admin/organizations/${row.id}`}
                    state={detailState}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
                  >
                    <OrgLogo name={row.name} src={row.logo_url} />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="truncate text-sm font-medium text-gray-900">{row.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <OrgTypeBadge type={row.org_type} />
                        <OrgApprovalBadge status={row.approval_status} />
                        {row.archived_at && <ArchivedBadge />}
                      </div>
                      <p className="text-xs text-gray-500">
                        {row.member_count} {row.member_count === 1 ? 'member' : 'members'} · {row.event_count}{' '}
                        {row.event_count === 1 ? 'event' : 'events'} · {formatDateTime(row.created_at)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {total > 0 && !error && (
          <AdminPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            loading={loading}
            label="Organization pages"
            onPageChange={(next) => update({ page: String(next) })}
          />
        )}
      </Card>
    </div>
  )
}
