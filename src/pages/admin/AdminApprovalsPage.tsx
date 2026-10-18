import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Info, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input, Label, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { SheetDialog } from '@/components/organizer/SheetDialog'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminNotice } from '@/components/admin/AdminNotice'
import { AdminPagination } from '@/components/admin/AdminPagination'
import { AccountStatusBadge, AccountTypeBadge } from '@/components/admin/AdminBadges'
import { PersonCell } from '@/components/admin/PersonCell'
import { StatusActionDialog } from '@/components/admin/StatusActionDialog'
import {
  AccountFacts,
  AccountHistory,
  AccountIdentity,
  PublicProfileFields,
  displayNameFor,
} from '@/components/admin/AccountDetails'
import { useAuth } from '@/context/AuthContext'
import {
  ACCOUNTS_CHANGED_EVENT,
  availableStatusActions,
  fetchAccountHistory,
  fetchAccounts,
  fetchProfileNames,
  fetchPublicProfiles,
  formatDateTime,
} from '@/lib/admin'
import type { AccountChange, AccountStatus, AdminAccountRow, ProfileName, PublicProfile } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

type StatusFilter = AccountStatus | 'all'

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'active', label: 'Approved (active)' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'all', label: 'All organizers' },
]

// Declining is not offered as a button: account_status has no "rejected"
// value, and "suspended" means something else (an account that had access and
// lost it). Representing a decision the database cannot record would be worse
// than leaving it pending.
function RejectionNotice() {
  return (
    <div className="flex gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      <p>
        <span className="font-medium text-gray-800">Declining is not available yet.</span> Rally&apos;s account statuses
        are pending approval, active and suspended. There is no rejected status, and suspension means something
        different, so an application you do not approve stays pending until declining has backend support.
      </p>
    </div>
  )
}

function ReviewSheet({
  account,
  profile,
  selfId,
  onClose,
  onApprove,
}: {
  account: AdminAccountRow
  profile?: PublicProfile
  selfId?: string
  onClose: () => void
  onApprove: () => void
}) {
  const [history, setHistory] = useState<AccountChange[]>([])
  const [names, setNames] = useState<Record<string, ProfileName>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canApprove = availableStatusActions(account, selfId).includes('approve')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { about, error: historyError } = await fetchAccountHistory(account.user_id)
      const resolved = await fetchProfileNames([account.approved_by, ...about.map((c) => c.changed_by)])
      if (cancelled) return
      setHistory(about)
      setNames(resolved)
      setError(historyError)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [account.user_id, account.approved_by])

  return (
    <SheetDialog title="Review organizer application" subtitle={displayNameFor(profile)} onClose={onClose} wide>
      <div className="space-y-5">
        <AccountIdentity account={account} profile={profile} />

        <section aria-labelledby="review-application">
          <h3 id="review-application" className="text-sm font-semibold text-gray-900">
            Application details
          </h3>
          <p className="mb-1 text-xs text-gray-500">
            The public profile card, which is everything Rally collects at organizer sign-up. Email is not visible to
            administrators.
          </p>
          <PublicProfileFields profile={profile} />
        </section>

        <section aria-labelledby="review-account">
          <h3 id="review-account" className="text-sm font-semibold text-gray-900">
            Account
          </h3>
          <AccountFacts account={account} names={names} />
        </section>

        <section aria-labelledby="review-history">
          <h3 id="review-history" className="mb-2 text-sm font-semibold text-gray-900">
            Approval history
          </h3>
          {loading ? (
            <LoadingState />
          ) : error ? (
            <p className="text-sm text-error-700">{error}</p>
          ) : (
            <AccountHistory changes={history} names={names} emptyText="No recorded changes to this account yet." />
          )}
        </section>

        {account.status === 'pending_approval' && <RejectionNotice />}

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            to={`/admin/users/${account.user_id}`}
            className="text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            Open full account page
          </Link>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {canApprove && <Button onClick={onApprove}>Approve organizer</Button>}
          </div>
        </div>
      </div>
    </SheetDialog>
  )
}

export default function AdminApprovalsPage() {
  const { user } = useAuth()
  const [status, setStatus] = useState<StatusFilter>('pending_approval')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<AdminAccountRow[]>([])
  const [total, setTotal] = useState(0)
  const [profiles, setProfiles] = useState<Record<string, PublicProfile>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [reviewing, setReviewing] = useState<AdminAccountRow | null>(null)
  const [approving, setApproving] = useState<AdminAccountRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await fetchAccounts({
      type: 'organizer',
      status,
      // The queue is first come, first served; history reads newest first.
      sort: status === 'pending_approval' ? 'oldest' : 'newest',
      page,
      pageSize: PAGE_SIZE,
    })
    setError(result.error)
    setRows(result.data)
    setTotal(result.total)
    setProfiles(await fetchPublicProfiles(result.data.map((row) => row.user_id)))
    setLoading(false)
  }, [status, page])

  useEffect(() => {
    void load()
  }, [load])

  // Another tab of the workspace (or the detail page) changed an account.
  useEffect(() => {
    function onChanged() {
      void load()
    }
    window.addEventListener(ACCOUNTS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(ACCOUNTS_CHANGED_EVENT, onChanged)
  }, [load])

  const names: Record<string, ProfileName> = profiles

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const p = profiles[row.user_id]
      return [p?.full_name, p?.company, p?.job_title].some((v) => v?.toLowerCase().includes(q))
    })
  }, [rows, profiles, query])

  return (
    <div>
      <AdminPageHeader
        title="Organizer approvals"
        description="Organizer accounts start pending. Review each application and approve it to give the organizer access."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <AdminNotice message={notice} onDismiss={() => setNotice(null)} />

      <Card className="mb-4">
        <CardContent className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <div>
            <Label htmlFor="approvals-search">Filter this page by name, company or title</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="approvals-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search applicants"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="approvals-status">Status</Label>
            <Select
              id="approvals-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as StatusFilter)
                setPage(0)
              }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        {loading && rows.length === 0 ? (
          <LoadingState message="Loading applications…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="h-8 w-8" />}
            title={status === 'pending_approval' ? 'No applications waiting' : 'No organizers with this status'}
            description={
              status === 'pending_approval'
                ? 'New organizer sign-ups appear here until an administrator reviews them.'
                : undefined
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState title="No applicants on this page match your search" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map((row) => {
              const p = profiles[row.user_id]
              const detail = [p?.job_title?.trim(), p?.company?.trim()].filter(Boolean).join(' · ')
              return (
                <li key={row.user_id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <PersonCell id={row.user_id} names={names} />
                    <p className="mt-1 truncate pl-10 text-xs text-gray-500">{detail || 'No company or title provided'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-10 sm:pl-0">
                    <AccountTypeBadge type={row.account_type} />
                    <AccountStatusBadge status={row.status} />
                    <span className="text-xs text-gray-500">Registered {formatDateTime(row.created_at)}</span>
                  </div>
                  <div className="pl-10 sm:pl-0">
                    <Button variant="secondary" size="sm" onClick={() => setReviewing(row)}>
                      Review
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {total > 0 && !error && (
          <AdminPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            loading={loading}
            label="Application pages"
            onPageChange={setPage}
          />
        )}
      </Card>

      {status === 'pending_approval' && total > 0 && (
        <div className="mt-4">
          <RejectionNotice />
        </div>
      )}

      {reviewing && (
        <ReviewSheet
          account={reviewing}
          profile={profiles[reviewing.user_id]}
          selfId={user?.id}
          onClose={() => setReviewing(null)}
          onApprove={() => {
            // Hand over from the review sheet to the confirmation, one dialog
            // at a time, so Escape and focus always belong to the one in front.
            setApproving(reviewing)
            setReviewing(null)
          }}
        />
      )}

      {approving && (
        <StatusActionDialog
          account={approving}
          action="approve"
          displayName={displayNameFor(profiles[approving.user_id])}
          onCancel={() => setApproving(null)}
          onDone={(message) => {
            // changeAccountStatus announces the change; the listener above
            // reloads this list, and the action-items count follows.
            setApproving(null)
            setNotice(message)
          }}
        />
      )}
    </div>
  )
}
