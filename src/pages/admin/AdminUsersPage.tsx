import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ChevronRight, RefreshCw, Search, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input, Label, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminPagination } from '@/components/admin/AdminPagination'
import { AccountStatusBadge, AccountTypeBadge } from '@/components/admin/AdminBadges'
import { PersonCell } from '@/components/admin/PersonCell'
import { ACCOUNTS_CHANGED_EVENT, fetchAccounts, fetchPublicProfiles, formatDateTime, type AccountSort } from '@/lib/admin'
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  type AccountStatus,
  type AccountType,
  type AdminAccountRow,
  type PublicProfile,
} from '@/lib/supabase'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

const TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]
const STATUSES = Object.keys(ACCOUNT_STATUS_LABELS) as AccountStatus[]
const SORTS: { value: AccountSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'recently_updated', label: 'Recently changed' },
]

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

// The directory is read-only: changes happen on an account's own page, after
// its details and history are in front of the administrator.
export default function AdminUsersPage() {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const type = pick(params.get('type'), ['all', ...TYPES] as const, 'all')
  const status = pick(params.get('status'), ['all', ...STATUSES] as const, 'all')
  const sort = pick(params.get('sort'), SORTS.map((s) => s.value), 'newest')
  const page = Math.max(0, Number.parseInt(params.get('page') ?? '0', 10) || 0)

  const [rows, setRows] = useState<AdminAccountRow[]>([])
  const [total, setTotal] = useState(0)
  const [profiles, setProfiles] = useState<Record<string, PublicProfile>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value === '' || value === 'all' || (key === 'sort' && value === 'newest') || (key === 'page' && value === '0')) {
        merged.delete(key)
      } else {
        merged.set(key, value)
      }
    }
    setParams(merged, { replace: true })
  }

  const load = useCallback(async () => {
    setLoading(true)
    const result = await fetchAccounts({ type, status, sort, page, pageSize: PAGE_SIZE })
    setError(result.error)
    setRows(result.data)
    setTotal(result.total)
    setProfiles(await fetchPublicProfiles(result.data.map((row) => row.user_id)))
    setLoading(false)
  }, [type, status, sort, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    function onChanged() {
      void load()
    }
    window.addEventListener(ACCOUNTS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(ACCOUNTS_CHANGED_EVENT, onChanged)
  }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const p = profiles[row.user_id]
      return [p?.full_name, p?.company, p?.job_title].some((v) => v?.toLowerCase().includes(q))
    })
  }, [rows, profiles, query])

  const detailState = { from: `${location.pathname}${location.search}` }

  return (
    <div>
      <AdminPageHeader
        title="Users"
        description="Every Rally account. Open an account to see its details and history, or to change its status."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem_11rem]">
          <div>
            <Label htmlFor="users-search">Filter this page by name, company or title</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="users-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="users-type">Account type</Label>
            <Select id="users-type" value={type} onChange={(e) => update({ type: e.target.value, page: '0' })}>
              <option value="all">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="users-status">Status</Label>
            <Select id="users-status" value={status} onChange={(e) => update({ status: e.target.value, page: '0' })}>
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ACCOUNT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="users-sort">Sort</Label>
            <Select id="users-sort" value={sort} onChange={(e) => update({ sort: e.target.value, page: '0' })}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
        <p className="border-t border-gray-100 px-5 py-2 text-xs text-gray-500">
          Type, status, sorting and paging run in the database. Name search covers the current page only: names are
          public profile data, which administrators can look up by account but not search across.
        </p>
      </Card>

      <Card>
        {loading && rows.length === 0 ? (
          <LoadingState message="Loading accounts…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Users className="h-8 w-8" />} title="No accounts match these filters" />
        ) : visible.length === 0 ? (
          <EmptyState title="No accounts on this page match your search" />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-gray-200 text-left">
                <caption className="sr-only">Accounts, page {page + 1}</caption>
                <thead className="bg-gray-50">
                  <tr>
                    {['Account', 'Type', 'Status', 'Registered', 'Approved', ''].map((h, i) => (
                      <th
                        key={h || i}
                        scope="col"
                        className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500"
                      >
                        {h || <span className="sr-only">Open</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {visible.map((row) => (
                    <tr key={row.user_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <PersonCell id={row.user_id} names={profiles} />
                      </td>
                      <td className="px-4 py-3">
                        <AccountTypeBadge type={row.account_type} />
                      </td>
                      <td className="px-4 py-3">
                        <AccountStatusBadge status={row.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDateTime(row.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {row.approved_at ? formatDateTime(row.approved_at) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/admin/users/${row.user_id}`}
                          state={detailState}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          aria-label={`View ${profiles[row.user_id]?.full_name?.trim() || 'account'}`}
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
              {visible.map((row) => (
                <li key={row.user_id}>
                  <Link
                    to={`/admin/users/${row.user_id}`}
                    state={detailState}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <PersonCell id={row.user_id} names={profiles} />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <AccountTypeBadge type={row.account_type} />
                        <AccountStatusBadge status={row.status} />
                        <span className="text-xs text-gray-500">{formatDateTime(row.created_at)}</span>
                      </div>
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
            label="Account pages"
            onPageChange={(next) => update({ page: String(next) })}
          />
        )}
      </Card>
    </div>
  )
}
