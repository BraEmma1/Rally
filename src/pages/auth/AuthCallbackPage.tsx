import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Users, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { accountHomePath } from '@/lib/routing'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/States'

// Supabase reports a failed verification by appending error params to the
// redirect, in the hash for the implicit flow and the query string for PKCE.
function readVerificationError(): string | null {
  if (typeof window === 'undefined') return null
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const queryParams = new URLSearchParams(window.location.search)
  const code = hashParams.get('error_code') || queryParams.get('error_code')
  const description = hashParams.get('error_description') || queryParams.get('error_description')
  const error = hashParams.get('error') || queryParams.get('error')
  if (!code && !description && !error) return null
  if (code === 'otp_expired') {
    return 'That confirmation link has expired. Sign up again to get a new one.'
  }
  return description ? description.replace(/\+/g, ' ') : 'We could not complete sign-in.'
}

export default function AuthCallbackPage() {
  const { session, account, loading } = useAuth()
  const [verificationError] = useState(readVerificationError)
  // An organization-invitation email thread put ?invitation=<id> on this
  // callback URL at sign-up time. Once the confirmation lands with a session,
  // finish the round trip by returning to the exact invitation instead of the
  // account home. Absent the parameter, routing is unchanged.
  const [invitationId] = useState(
    () => new URLSearchParams(window.location.search).get('invitation')
  )
  // The client still has to exchange the grant in the URL for a session, which
  // happens after loading first flips false. Give it a moment before calling it
  // a failure, otherwise a successful confirmation flashes an error.
  const [graceElapsed, setGraceElapsed] = useState(false)

  useEffect(() => {
    if (verificationError) return
    const timer = setTimeout(() => setGraceElapsed(true), 2500)
    return () => clearTimeout(timer)
  }, [verificationError])

  // Signed in, whether that came from a confirmation link or an OAuth provider.
  // Where they land is decided by account type, and the guards on that route
  // make the rest of the decisions — profile completeness for an attendee,
  // having an organization for an organizer. An invitation link overrides the
  // destination: the invitation experience is reachable for any signed-in user
  // and accepting is still an explicit action there.
  if (session && invitationId) {
    return <Navigate to={`/organizer/invitations?invitation=${encodeURIComponent(invitationId)}`} replace />
  }
  if (session) return <Navigate to={accountHomePath(account)} replace />

  if (!verificationError && (loading || !graceElapsed)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-4">
        <Spinner size="lg" />
        <p className="text-sm text-gray-500">Signing you in…</p>
      </div>
    )
  }

  // No session and no error. For a confirmation link this means the address was
  // verified but the exchange could not finish in this browser, which is what
  // happens when the email is opened on a different device than signup. For an
  // OAuth return it means the grant did not survive the round trip. Signing in
  // resolves both, so the copy stays neutral rather than claiming either.
  if (!verificationError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
              <Users className="h-6 w-6" />
            </div>
            <div className="text-center">
              <h1 className="text-xl font-bold text-gray-900">Almost there</h1>
              <p className="mt-1 text-sm text-gray-500">Sign in to finish setting up</p>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="text-sm text-gray-700">
                Your account is ready. Sign in to continue to Rally.
              </p>
            </div>
            <Link to="/login">
              <Button className="w-full">Sign in</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
            <Users className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">Sign-in failed</h1>
            <p className="mt-1 text-sm text-gray-500">We could not complete that step</p>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-50 text-error-600">
              <AlertCircle className="h-6 w-6" />
            </div>
            <p className="text-sm text-gray-700">{verificationError}</p>
          </div>
          <Link to="/login">
            <Button variant="secondary" className="w-full">Go to sign in</Button>
          </Link>
          <Link to="/signup">
            <Button variant="ghost" className="w-full">Sign up again</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
