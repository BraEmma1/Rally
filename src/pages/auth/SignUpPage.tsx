import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Users, Mail, Lock, User as UserIcon, Eye, EyeOff, CheckCircle2, CalendarDays, Ticket } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { GoogleButton } from '@/components/ui/GoogleButton'
import { LinkedInButton } from '@/components/ui/LinkedInButton'

export default function SignUpPage() {
  const { signUp, signInWithGoogle, signInWithLinkedIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Invitation id from an organization-invitation email link, carried through
  // sign-up so the new account lands on the invitation they came for.
  const searchParams = new URLSearchParams(location.search)
  const invitationId = searchParams.get('invitation')
  // /signup?type=organizer preselects organizer registration. An invitation
  // always wins: invited people join an existing organization as attendees, so
  // the choice is not offered at all when an invitation is present.
  const [accountType, setAccountType] = useState<'attendee' | 'organizer'>(
    !invitationId && searchParams.get('type') === 'organizer' ? 'organizer' : 'attendee'
  )
  const isOrganizer = accountType === 'organizer' && !invitationId
  const loginLink = invitationId
    ? `/login?invitation=${encodeURIComponent(invitationId)}`
    : isOrganizer
      ? '/login?type=organizer'
      : '/login'
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [linkedinLoading, setLinkedinLoading] = useState(false)
  const [linkedinError, setLinkedinError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    const { error: signUpError, needsEmailConfirmation } = await signUp(
      email,
      password,
      fullName,
      invitationId ?? undefined,
      isOrganizer ? 'organizer' : undefined
    )
    if (signUpError) {
      setError(signUpError)
      setLoading(false)
      return
    }
    setLoading(false)
    if (needsEmailConfirmation) {
      setConfirmationSent(true)
      return
    }
    if (invitationId) {
      navigate(`/organizer/invitations?invitation=${encodeURIComponent(invitationId)}`, { replace: true })
      return
    }
    // An organizer is pending approval, so attendee onboarding is not theirs.
    navigate(isOrganizer ? '/account' : '/onboarding', { replace: isOrganizer })
  }

  async function handleGoogle() {
    setGoogleError(null)
    setGoogleLoading(true)
    const { error: googleError } = await signInWithGoogle()
    if (googleError) {
      setGoogleError(googleError)
      setGoogleLoading(false)
    }
  }

  async function handleLinkedIn() {
    setLinkedinError(null)
    setLinkedinLoading(true)
    const { error: linkedinError } = await signInWithLinkedIn()
    if (linkedinError) {
      setLinkedinError(linkedinError)
      setLinkedinLoading(false)
    }
  }

  if (confirmationSent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
              <Users className="h-6 w-6" />
            </div>
            <div className="text-center">
              <h1 className="text-xl font-bold text-gray-900">Confirm your email</h1>
              <p className="mt-1 text-sm text-gray-500">One more step to activate your account</p>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="text-sm text-gray-700">
                We sent a confirmation link to <span className="font-medium text-gray-900">{email}</span>.
                Click the link in the email and you will be brought straight back to Rally.
              </p>
              {isOrganizer && (
                <p className="text-sm text-gray-700">
                  Organizer accounts also need to be approved by a Rally administrator after you
                  confirm your email. Until then you will see an approval-pending screen.
                </p>
              )}
            </div>
            <Link to="/login">
              <Button variant="secondary" className="w-full">Back to sign in</Button>
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
            <h1 className="text-xl font-bold text-gray-900">
              {isOrganizer ? 'Create your organizer account' : 'Create your Rally account'}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {isOrganizer ? 'Run events and see what they create' : 'Start building your professional network'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
          {!invitationId && (
            <fieldset>
              <legend className="sr-only">Account type</legend>
              <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: 'attendee', label: "I'm attending events", icon: Ticket },
                    { value: 'organizer', label: "I'm organizing events", icon: CalendarDays },
                  ] as const
                ).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={accountType === value}
                    onClick={() => setAccountType(value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-center text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-1',
                      accountType === value
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {isOrganizer && (
            <div className="rounded-md bg-primary-50 px-3 py-2 text-sm text-primary-700">
              Organizer accounts need to be approved by a Rally administrator before you can
              create an organization or access organizer features. Sign up with email below and
              we will hold your account until it is reviewed.
            </div>
          )}

          {/* Google and LinkedIn cannot carry an account type, so they would
              create an attendee. They are not offered for organizer sign-up. */}
          {!isOrganizer && (
            <>
              <GoogleButton onClick={handleGoogle} loading={googleLoading} />
              <LinkedInButton onClick={handleLinkedIn} loading={linkedinLoading} />
              {(googleError || linkedinError) && (
                <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">
                  {googleError || linkedinError}
                </div>
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-gray-400">or sign up with email</span>
                </div>
              </div>
            </>
          )}

          <div>
            <Label htmlFor="fullName">Full name</Label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                required
                className="pl-9"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@company.com"
                required
                className="pl-9"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                className="pl-9 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{error}</div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Creating account…' : 'Sign up'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to={loginLink} className="font-medium text-primary-600 hover:text-primary-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
