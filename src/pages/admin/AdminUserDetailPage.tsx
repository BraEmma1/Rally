import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, Info, Lock, RefreshCw, UserX } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { AdminNotice } from '@/components/admin/AdminNotice'
import { StatusActionDialog, STATUS_ACTION_LABELS } from '@/components/admin/StatusActionDialog'
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
  fetchAccount,
  fetchAccountHistory,
  fetchProfileNames,
  fetchPublicProfiles,
  type StatusAction,
} from '@/lib/admin'
import type { AccountChange, AdminAccountRow, ProfileName, PublicProfile } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function AdminUserDetailPage() {
  const { userId = '' } = useParams()
  const location = useLocation()
  const { user } = useAuth()
  const backTo = (location.state as { from?: string } | null)?.from?.startsWith('/admin/users')
    ? (location.state as { from: string }).from
    : '/admin/users'

  const [account, setAccount] = useState<AdminAccountRow | null>(null)
  const [profile, setProfile] = useState<PublicProfile | undefined>()
  const [about, setAbout] = useState<AccountChange[]>([])
  const [by, setBy] = useState<AccountChange[]>([])
  const [names, setNames] = useState<Record<string, ProfileName>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [action, setAction] = useState<StatusAction | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const validId = UUID_RE.test(userId)

  const load = useCallback(async () => {
    if (!validId) {
      setLoading(false)
      return
    }
    setLoading(true)
    const [accountResult, history, profiles] = await Promise.all([
      fetchAccount(userId),
      fetchAccountHistory(userId),
      fetchPublicProfiles([userId]),
    ])
    setAccount(accountResult.data)
    setError(accountResult.error)
    setAbout(history.about)
    setBy(history.by)
    setHistoryError(history.error)
    setProfile(profiles[userId])
    setNames(
      await fetchProfileNames([
        accountResult.data?.approved_by,
        ...history.about.map((c) => c.changed_by),
        ...history.by.map((c) => c.user_id),
        userId,
      ])
    )
    setLoading(false)
  }, [userId, validId])

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

  const back = (
    <Link
      to={backTo}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to users
    </Link>
  )

  if (loading && !account) {
    return (
      <div>
        {back}
        <LoadingState message="Loading account…" />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {back}
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      </div>
    )
  }

  if (!validId || !account) {
    return (
      <div>
        {back}
        <Card>
          <EmptyState
            icon={<UserX className="h-8 w-8" />}
            title="Account not found"
            description="There is no Rally account with this id."
          />
        </Card>
      </div>
    )
  }

  const isSelf = account.user_id === user?.id
  const actions = availableStatusActions(account, user?.id)
  const name = displayNameFor(profile)

  return (
    <div>
      {back}
      <AdminNotice message={notice} onDismiss={() => setNotice(null)} />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <AccountIdentity account={account} profile={profile} />
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Public profile</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-1 text-xs text-gray-500">
                The fields any signed-in member can see. Email and phone are private and not visible to administrators.
              </p>
              <PublicProfileFields profile={profile} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account history</CardTitle>
            </CardHeader>
            <CardContent>
              {historyError ? (
                <p className="text-sm text-error-700">{historyError}</p>
              ) : (
                <AccountHistory changes={about} names={names} emptyText="No recorded type or status changes." />
              )}
            </CardContent>
          </Card>

          {by.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Changes made by this administrator</CardTitle>
              </CardHeader>
              <CardContent>
                <AccountHistory changes={by} names={names} emptyText="" showTarget />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent>
              <AccountFacts account={account} names={names} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isSelf ? (
                <p className="flex gap-2 text-sm text-gray-600">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  This is your own account. Administrators cannot change their own status; another administrator
                  must.
                </p>
              ) : actions.length === 0 ? (
                <p className="text-sm text-gray-600">No status change is available for this account.</p>
              ) : (
                actions.map((a) => (
                  <Button
                    key={a}
                    variant={a === 'suspend' ? 'danger' : 'primary'}
                    className="w-full"
                    onClick={() => setAction(a)}
                  >
                    {STATUS_ACTION_LABELS[a]}
                  </Button>
                ))
              )}
              <p className="flex gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Account type is read-only. Changing it waits on a hardened backend function.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {action && (
        <StatusActionDialog
          account={account}
          action={action}
          displayName={name}
          onCancel={() => setAction(null)}
          onDone={(message) => {
            // The announced change reloads this page through the listener.
            setAction(null)
            setNotice(message)
          }}
        />
      )}
    </div>
  )
}
