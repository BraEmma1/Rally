import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Info, RefreshCw, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { PersonCell } from '@/components/admin/PersonCell'
import {
  changeTitle,
  describeChange,
  fetchAccountChanges,
  fetchProfileNames,
  formatDateTime,
} from '@/lib/admin'
import type { AccountChange, ProfileName } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

function Responsible({ id, names }: { id: string | null; names: Record<string, ProfileName> }) {
  // changed_by is NULL only for operator SQL, e.g. the first-admin bootstrap.
  if (!id) return <span className="text-sm text-gray-500">Operator (direct SQL)</span>
  return <PersonCell id={id} names={names} />
}

export default function AdminAuditLogsPage() {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<AccountChange[]>([])
  const [total, setTotal] = useState(0)
  const [names, setNames] = useState<Record<string, ProfileName>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (target: number) => {
    setLoading(true)
    const { data, total: count, error: loadError } = await fetchAccountChanges(target, PAGE_SIZE)
    setError(loadError)
    setRows(data)
    setTotal(count)
    setNames(await fetchProfileNames(data.flatMap((row) => [row.user_id, row.changed_by])))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(page)
  }, [load, page])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <div>
      <AdminPageHeader
        title="Audit logs"
        description="Every recorded change to an account's type or status, newest first."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load(page)} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <div className="mb-4 flex gap-3 rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          These are <strong>recorded audit events</strong> from the account_type_changes table, written whenever an
          administrator changes an account&apos;s type or status, and by operator SQL. Rally has no general activity
          log: sign-ins, profile edits, events and organization changes are not recorded here.
        </p>
      </div>

      <Card>
        {loading && rows.length === 0 ? (
          <LoadingState message="Loading audit log…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load(page)} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-8 w-8" />} title="No recorded account changes yet" />
        ) : (
          <>
            {/* Desktop: a real table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-gray-200 text-left">
                <caption className="sr-only">Account audit log, page {page + 1} of {pageCount}</caption>
                <thead className="bg-gray-50">
                  <tr>
                    {['When', 'Action', 'Target account', 'Change', 'Responsible', 'Reason'].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDateTime(row.created_at)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{changeTitle(row)}</td>
                      <td className="px-4 py-3">
                        <PersonCell id={row.user_id} names={names} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{describeChange(row)}</td>
                      <td className="px-4 py-3">
                        <Responsible id={row.changed_by} names={names} />
                      </td>
                      <td className="max-w-xs px-4 py-3 text-sm text-gray-600">
                        {row.reason?.trim() || <span className="text-gray-400">No reason given</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: one card per entry. */}
            <ul className="divide-y divide-gray-100 md:hidden">
              {rows.map((row) => (
                <li key={row.id} className="space-y-2 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900">{changeTitle(row)}</p>
                    <span className="shrink-0 text-xs text-gray-500">{formatDateTime(row.created_at)}</span>
                  </div>
                  <PersonCell id={row.user_id} names={names} />
                  <p className="text-sm text-gray-700">{describeChange(row)}</p>
                  <div className="text-xs text-gray-500">
                    <span className="font-medium text-gray-600">By: </span>
                    {row.changed_by ? names[row.changed_by]?.full_name?.trim() || row.changed_by.slice(0, 8) : 'Operator (direct SQL)'}
                  </div>
                  <p className="text-xs text-gray-500">
                    <span className="font-medium text-gray-600">Reason: </span>
                    {row.reason?.trim() || 'No reason given'}
                  </p>
                </li>
              ))}
            </ul>

            <nav
              className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3"
              aria-label="Audit log pages"
            >
              <p className="text-sm text-gray-500" aria-live="polite">
                {first}–{last} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={loading || page === 0}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-gray-600">
                  Page {page + 1} of {pageCount}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={loading || page >= pageCount - 1}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </nav>
          </>
        )}
      </Card>
    </div>
  )
}
