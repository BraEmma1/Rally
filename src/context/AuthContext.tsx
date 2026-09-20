import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, type Profile, type UserAccount } from '@/lib/supabase'

type AuthContextValue = {
  session: Session | null
  user: User | null
  profile: Profile | null
  // What this user is allowed to be. Null while loading, and null after loading
  // only when the account record is genuinely missing — which the routing layer
  // surfaces as a fault rather than guessing a type.
  account: UserAccount | null
  accountError: string | null
  loading: boolean
  isRecovery: boolean
  recoveryError: string | null
  oauthError: string | null
  clearOauthError: () => void
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  refreshAccount: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: string | null }>
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signInWithLinkedIn: () => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Clicking a password reset link lands here with a recovery grant in the URL.
// Supabase exchanges it for a real session, so "is there a session" cannot tell
// a recovery visit apart from a normal login.
//
// The URL is not a reliable place to keep that answer: supabase-js strips the
// auth params with replaceState once it has consumed them, so anything that
// re-reads the URL later — a remount, or simply losing the race against the
// client's own initialisation — sees a plain session and treats recovery as a
// normal login. The flag is therefore latched in sessionStorage, which is
// scoped to this tab, so a normal session in another tab is unaffected.
const RECOVERY_FLAG_KEY = 'rally.auth.recovery'
const RECOVERY_ERROR_KEY = 'rally.auth.recovery_error'
const OAUTH_ERROR_KEY = 'rally.auth.oauth_error'

function readStored(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: recovery still works for this render.
  }
}

// Supabase reports the outcome in the hash for the implicit flow and the query
// string for PKCE, so both have to be read.
function readAuthParam(name: string): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  return hash.get(name) ?? query.get(name)
}

function onResetRoute(): boolean {
  return window.location.pathname === '/reset-password'
}

// A failed OAuth round trip (provider misconfiguration, redirect URL not
// allowlisted, cancelled consent) lands on the Site URL with error params
// instead of /auth/callback. The catch-all route then bounces to /dashboard
// and on to /login, dropping the params — so they are captured on boot and
// latched in sessionStorage like the recovery flags.
//
// Raw provider/Supabase messages ("Unable to exchange external code: 4/0A…",
// "invalid compact jws") are leaky internals; map the known ones to something
// a user can act on and fall back to a neutral message for the rest.
function friendlyOAuthError(raw: string | null): string {
  if (!raw) return 'Sign-in with that provider failed. Please try again.'
  const normalized = decodeURIComponent(raw).toLowerCase()
  if (normalized.includes('exchange external code')) {
    return 'We could not complete the sign-in with that provider. This usually fixes itself in a few minutes — if it keeps happening, the provider sign-in is misconfigured. Please try again or use email sign-in.'
  }
  if (normalized.includes('invalid compact jws') || normalized.includes('invalid jwt')) {
    return 'The sign-in attempt expired before it could be completed. Please try again.'
  }
  if (normalized.includes('provider is not enabled') || normalized.includes('unsupported provider')) {
    return 'That sign-in option is not available yet. Please use email sign-in.'
  }
  if (normalized.includes('redirect') && (normalized.includes('not allowed') || normalized.includes('allowlist') || normalized.includes('whitelist'))) {
    return 'This app\'s address is not yet allowed for sign-in. The app owner needs to add it to the allowed addresses in the sign-in settings.'
  }
  if (normalized.includes('timeout') || normalized.includes('temporarily unavailable')) {
    return 'The sign-in service is temporarily unavailable. Please try again in a moment.'
  }
  return 'Sign-in with that provider failed. Please try again or use email sign-in.'
}

function detectOAuthErrorFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const error = readAuthParam('error')
  const errorCode = readAuthParam('error_code')
  if (!error && !errorCode) return null
  // Recovery failures have their own reporting path on the reset screen.
  if (onResetRoute() || readAuthParam('type') === 'recovery') return null
  if (errorCode === 'access_denied' || error === 'access_denied') {
    return 'Sign-in was cancelled before it could finish. If this was accidental, just try again.'
  }
  return friendlyOAuthError(readAuthParam('error_description'))
}

function detectRecoveryFromUrl(): boolean {
  if (typeof window === 'undefined') return false
  if (readAuthParam('type') === 'recovery') return true
  // PKCE arrives as /reset-password?code=... with no type parameter, and a
  // spent or expired link arrives as /reset-password#error=... Both are the
  // recovery flow and must not fall through to the signed-in redirect.
  const hasCode = new URLSearchParams(window.location.search).has('code')
  const hasError = !!readAuthParam('error') || !!readAuthParam('error_code')
  return onResetRoute() && (hasCode || hasError)
}

function detectRecoveryErrorFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const error = readAuthParam('error')
  const errorCode = readAuthParam('error_code')
  if (!error && !errorCode) return null
  if (!onResetRoute() && readAuthParam('type') !== 'recovery') return null
  if (errorCode === 'otp_expired') {
    return 'This password reset link has expired. Request a new one to continue.'
  }
  const description = readAuthParam('error_description')
  return description
    ? decodeURIComponent(description).replace(/\+/g, ' ')
    : 'This password reset link is no longer valid.'
}

// In the preview sandbox the browser's network access can drop momentarily;
// supabase-js then surfaces a raw "Failed to fetch". Detect it so callers can
// show a recovery hint instead of a browser-internal message.
function isNetworkError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('load failed') ||
    m.includes('network request failed')
  )
}

const NETWORK_ERROR_MESSAGE =
  'Could not reach the server. Check your connection and try again — if you are offline, sign-in will work once the connection is back.'

function authErrorMessage(message: string): string {
  return isNetworkError(message) ? NETWORK_ERROR_MESSAGE : message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [account, setAccount] = useState<UserAccount | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRecovery, setIsRecovery] = useState(
    () => detectRecoveryFromUrl() || readStored(RECOVERY_FLAG_KEY) === '1'
  )
  const [recoveryError, setRecoveryError] = useState<string | null>(
    () => detectRecoveryErrorFromUrl() ?? readStored(RECOVERY_ERROR_KEY)
  )
  const [oauthError, setOauthError] = useState<string | null>(
    () => detectOAuthErrorFromUrl() ?? readStored(OAUTH_ERROR_KEY)
  )

  useEffect(() => {
    writeStored(OAUTH_ERROR_KEY, oauthError)
  }, [oauthError])

  // The error has been captured; clear the params so a refresh does not
  // re-latch the same message.
  useEffect(() => {
    if (!oauthError) return
    if (!readAuthParam('error') && !readAuthParam('error_code')) return
    const cleaned = `${window.location.pathname}${window.location.search}`
    window.history.replaceState(window.history.state, '', cleaned.split('?')[0] + window.location.hash)
  }, [oauthError])

  // Latch both so they survive supabase-js clearing the URL, and any remount.
  useEffect(() => {
    writeStored(RECOVERY_FLAG_KEY, isRecovery ? '1' : null)
  }, [isRecovery])

  useEffect(() => {
    writeStored(RECOVERY_ERROR_KEY, recoveryError)
  }, [recoveryError])

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      console.error('Error loading profile:', error)
      return
    }
    setProfile(data as Profile | null)
  }

  // The row is readable only by its owner, so no filter on user_id is needed —
  // RLS already narrows this to one row.
  async function loadAccount(userId: string) {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('account_type, status')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('Error loading account:', error)
      setAccount(null)
      setAccountError(error.message)
      return
    }
    setAccount((data as UserAccount | null) ?? null)
    setAccountError(null)
  }

  // Both are needed before any routing decision can be made, so they load
  // together and `loading` clears once.
  async function loadIdentity(userId: string) {
    await Promise.all([loadProfile(userId), loadAccount(userId)])
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      if (data.session?.user) {
        loadIdentity(data.session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Authoritative signal from the client once it has consumed the grant.
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true)
        setRecoveryError(null)
      }
      setSession(newSession)
      setUser(newSession?.user ?? null)
      if (newSession?.user) {
        (async () => {
          await loadIdentity(newSession.user.id)
          setLoading(false)
        })()
      } else {
        setProfile(null)
        setAccount(null)
        setAccountError(null)
        setLoading(false)
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  async function signUp(email: string, password: string, fullName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        // Where the {{ .ConfirmationURL }} in the confirmation email sends the
        // user back to. /login would bounce them straight to the dashboard
        // without ever reporting a failed or expired link.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) return { error: authErrorMessage(error.message), needsEmailConfirmation: false }
    // With email confirmation on, Supabase returns a user but no session until
    // the address is verified. The caller must not route into the app yet.
    return { error: null, needsEmailConfirmation: !data.session }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: authErrorMessage(error.message) }
    return { error: null }
  }

  // Also the way out of a recovery flow: ending the grant is what lets /login
  // render instead of bouncing the recovery session to the dashboard.
  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    setAccount(null)
    setAccountError(null)
    setIsRecovery(false)
    setRecoveryError(null)
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.id)
  }

  // An organizer awaiting approval sits on a screen that has to notice when the
  // decision lands, without making them sign out and back in.
  async function refreshAccount() {
    if (user) await loadAccount(user.id)
  }

  async function resetPassword(email: string) {
    const redirectTo = `${window.location.origin}/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) return { error: authErrorMessage(error.message) }
    return { error: null }
  }

  async function updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { error: error.message }
    setIsRecovery(false)
    setRecoveryError(null)
    return { error: null }
  }

  // OAuth must not return to a protected route. The provider hands back a grant
  // in the URL that the client still has to exchange; ProtectedRoute sees no
  // session yet, redirects to /login, and that navigation discards the grant
  // before the exchange can happen — which is why sign-in ended on /login.
  // /auth/callback waits for the session, then defers to the normal guards so
  // profile completeness decides between onboarding and the dashboard.
  async function startOAuth(provider: 'google' | 'linkedin_oidc') {
    // A stale message from a previous failed attempt should not sit next to a
    // fresh try — clear it when the user starts a new sign-in.
    setOauthError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) return { error: isNetworkError(error.message) ? NETWORK_ERROR_MESSAGE : friendlyOAuthError(error.message) }
    return { error: null }
  }

  async function signInWithGoogle() {
    return startOAuth('google')
  }

  async function signInWithLinkedIn() {
    return startOAuth('linkedin_oidc')
  }

  return (
    <AuthContext.Provider value={{ session, user, profile, account, accountError, loading, isRecovery, recoveryError, oauthError, clearOauthError: () => setOauthError(null), signUp, signIn, signOut, refreshProfile, refreshAccount, resetPassword, updatePassword, signInWithGoogle, signInWithLinkedIn }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
