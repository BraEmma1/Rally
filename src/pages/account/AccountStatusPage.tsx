import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, Clock, LogOut, RefreshCw, Users } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { accountHomePath } from '@/lib/routing'
import { ACCOUNT_TYPE_LABELS } from '@/lib/supabase'

type Content = {
  icon: 'clock' | 'alert'
  title: string
  subtitle: string
  body: string
  canRecheck: boolean
}

// Everyone who is signed in but has nowhere to be: awaiting approval,
// suspended, an account type Rally has not built an experience for yet, or a
// missing account record. Each gets the specific reason rather than a generic
// "access denied", because the action they should take differs.
function contentFor(
  type: string | undefined,
  status: string | undefined,
  missing: boolean
): Content {
  if (missing) {
    return {
      icon: 'alert',
      title: 'Your account is not set up',
      subtitle: 'Something went wrong on our side',
      body: 'We could not find the account record that decides what you can access. This is a fault in Rally, not something you did — signing out and back in sometimes clears it. If it persists, contact support.',
      canRecheck: true,
    }
  }

  if (status === 'suspended') {
    return {
      icon: 'alert',
      title: 'Your account is suspended',
      subtitle: 'Access is paused',
      body: 'A Rally administrator has suspended this account. Your data has not been deleted. Contact support if you think this is a mistake.',
      canRecheck: false,
    }
  }

  if (status === 'pending_approval') {
    return {
      icon: 'clock',
      title: 'Your organizer account is awaiting approval',
      subtitle: 'A Rally administrator is reviewing it',
      body: 'Organizer accounts are approved by hand before they can create an organization or run events. You will be able to sign in and pick up where you left off as soon as that is done.',
      canRecheck: true,
    }
  }

  if (type === 'vendor' || type === 'sponsor') {
    const label = ACCOUNT_TYPE_LABELS[type]
    return {
      icon: 'clock',
      title: `The ${label.toLowerCase()} experience is not ready yet`,
      subtitle: 'Your account is active',
      body: `This is a ${label.toLowerCase()} account. Rally is building that experience now — you will not need to do anything when it arrives, and organizers can already invite you to their events.`,
      canRecheck: true,
    }
  }

  return {
    icon: 'alert',
    title: 'Nothing to show here yet',
    subtitle: 'Your account has no experience assigned',
    body: 'This account is signed in but has nowhere to go. Contact support if you expected to see something.',
    canRecheck: true,
  }
}

export default function AccountStatusPage() {
  const { account, accountError, signOut, refreshAccount, loading } = useAuth()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)

  // Approval may have landed while this screen was open; once it has, this page
  // is no longer the right place for them.
  const home = accountHomePath(account)
  if (!loading && home !== '/account') return <Navigate to={home} replace />

  const content = contentFor(account?.account_type, account?.status, !account)

  async function handleRecheck() {
    setChecking(true)
    await refreshAccount()
    setChecking(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
            <Users className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">{content.title}</h1>
            <p className="mt-1 text-sm text-gray-500">{content.subtitle}</p>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div
              className={
                content.icon === 'clock'
                  ? 'flex h-12 w-12 items-center justify-center rounded-full bg-warning-50 text-warning-600'
                  : 'flex h-12 w-12 items-center justify-center rounded-full bg-error-50 text-error-600'
              }
            >
              {content.icon === 'clock' ? (
                <Clock className="h-6 w-6" />
              ) : (
                <AlertCircle className="h-6 w-6" />
              )}
            </div>
            <p className="text-sm text-gray-700">{content.body}</p>
            {account && (
              <p className="text-xs text-gray-400">
                {ACCOUNT_TYPE_LABELS[account.account_type]} · {account.status.replace(/_/g, ' ')}
              </p>
            )}
            {accountError && <p className="text-xs text-error-600">{accountError}</p>}
          </div>

          {content.canRecheck && (
            <Button variant="secondary" className="w-full" disabled={checking} onClick={() => void handleRecheck()}>
              <RefreshCw className="h-4 w-4" />
              {checking ? 'Checking…' : 'Check again'}
            </Button>
          )}

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => void signOut().then(() => navigate('/login'))}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}
