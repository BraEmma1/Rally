import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AccountStatusBadge, AccountTypeBadge } from '@/components/admin/AdminBadges'
import { fetchAccount, formatDateTime } from '@/lib/admin'
import type { AdminAccountRow } from '@/lib/supabase'

// Read-only by design. Nothing on this page changes configuration: auth
// settings, email delivery, policies and secrets are managed in the Supabase
// dashboard and the repository, never through the browser.

function apiHost(): string {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).host
  } catch {
    return 'Not configured'
  }
}

const MANAGED_ELSEWHERE = [
  { label: 'Authentication settings', detail: 'Sign-in providers, email confirmation and redirect URLs — Supabase dashboard.' },
  { label: 'Email delivery', detail: 'SMTP and invitation email credentials — Supabase dashboard and Edge Function secrets.' },
  { label: 'Database policies and migrations', detail: 'Row-level security and schema — reviewed migrations in the repository.' },
  { label: 'API keys and secrets', detail: 'Never exposed to the browser.' },
]

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 sm:col-span-2">{children}</dd>
    </div>
  )
}

export default function AdminSettingsPage() {
  const { user, profile } = useAuth()
  const [account, setAccount] = useState<AdminAccountRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const userId = user?.id
  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const { data, error: loadError } = await fetchAccount(userId)
    setAccount(data)
    setError(loadError)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const displayName = profile?.full_name?.trim() || 'Not set'

  return (
    <div>
      <AdminPageHeader
        title="Settings"
        description="Your administrator account and the platform configuration this app is connected to. Read-only."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Administrator profile</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState message={error} onRetry={() => void load()} />
            ) : (
              <>
                <div className="mb-2 flex items-center gap-3">
                  <Avatar name={profile?.full_name || user?.email || 'Administrator'} src={profile?.photo_url} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
                    <p className="truncate text-sm text-gray-500">{user?.email}</p>
                  </div>
                </div>
                <dl className="divide-y divide-gray-100">
                  <Row label="Account type">
                    <AccountTypeBadge type={account?.account_type ?? null} />
                  </Row>
                  <Row label="Status">
                    <AccountStatusBadge status={account?.status ?? null} />
                  </Row>
                  <Row label="Account created">{formatDateTime(account?.created_at)}</Row>
                  <Row label="Administrator since">{formatDateTime(account?.approved_at)}</Row>
                  <Row label="Last sign-in">{formatDateTime(user?.last_sign_in_at)}</Row>
                </dl>
                <p className="mt-3 text-xs text-gray-500">
                  An administrator cannot change their own account type or status; another administrator, or an
                  operator, must do it. Profile editing for administrator accounts is not available yet.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-gray-100">
              <Row label="Environment">{import.meta.env.MODE}</Row>
              <Row label="Supabase API">
                <span className="break-all font-mono text-xs">{apiHost()}</span>
              </Row>
              <Row label="Authorization">
                Database-enforced: row-level security and administrator-only functions.
              </Row>
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Managed outside this workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-gray-100">
              {MANAGED_ELSEWHERE.map((item) => (
                <li key={item.label} className="flex items-start gap-3 py-3">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.label}</p>
                    <p className="text-sm text-gray-500">{item.detail}</p>
                  </div>
                  <span className="ml-auto shrink-0 text-xs font-medium text-gray-400">Not editable here</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
