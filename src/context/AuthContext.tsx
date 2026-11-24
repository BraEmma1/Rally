import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { supabase, type Profile, type UserAccount } from '@/lib/supabase'
import { authStorageKey, readStoredSessionOwner } from '@/lib/session'
import { identityStep, type IdentityStep } from '@/lib/sessionIdentity'

type AuthContextValue = {
  session: Session | null
  user: User | null
  profile: Profile | null
  // What this user is allowed to be. Null while loading, and null after loading
  // only when the account record is genuinely missing — which the routing layer
  // surfaces as a fault rather than guessing a type.
  account: UserAccount | null
  accountError: string | null
  // True only while Rally has no authorization for the current user yet: the
  // first load of a tab, or a different person signing in (in this tab or in
  // another one). It is NOT set again for routine background work — see the
  // comment on the auth listener below.
  loading: boolean
  // True while an already-authorized identity is being re-checked in the
  // background. Nothing is required to react to it; it exists so a screen can
  // show a quiet indicator without any of them blocking on it.
  revalidating: boolean
  isRecovery: boolean
  recoveryError: string | null
  oauthError: string | null
  clearOauthError: () => void
  signUp: (
    email: string,
    password: string,
    fullName: string,
    invitationId?: string,
    accountType?: 'attendee' | 'organizer'
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

// What a load returned, kept apart from applying it: an answer is applied only
// if the tab is still showing the person it was fetched for.
type ProfileResult = { ok: true; data: Profile | null } | { ok: false }
type AccountResult = { ok: true; data: UserAccount | null } | { ok: false; message: string }

async function fetchProfile(userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) {
    console.error('Error loading profile:', error)
    return { ok: false }
  }
  return { ok: true, data: (data as Profile | null) ?? null }
}

// The row is readable only by its owner, so no filter on user_id is needed —
// RLS already narrows this to one row.
async function fetchAccount(userId: string): Promise<AccountResult> {
  const { data, error } = await supabase.from('user_accounts').select('account_type, status').eq('user_id', userId).maybeSingle()
  if (error) {
    console.error('Error loading account:', error)
    return { ok: false, message: error.message }
  }
  return { ok: true, data: (data as UserAccount | null) ?? null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [account, setAccount] = useState<UserAccount | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revalidating, setRevalidating] = useState(false)
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  // WHO THIS TAB IS FOR. Refs, not state: the auth listener and the window
  // listeners close over them and must read the live value, and changing them
  // must not cause a render.
  //
  // `generation` goes up every time the person changes (including to nobody).
  // Every load is tagged with the generation it was started for, and its answer
  // is dropped if the tab has moved on — so a slow answer for the previous
  // person can never land on the next one's screen.
  const shownRef = useRef<{ userId: string | null; generation: number }>({ userId: null, generation: 0 })
  const loadedRef = useRef<number | null>(null) // generation whose identity has loaded
  const inFlightRef = useRef<number | null>(null) // generation with a load running
  const readyRef = useRef(false) // the first auth event has been handled
  const readingRef = useRef(false) // a read of the stored session is pending

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

  // Whether two rows carry the same values. Used to decide if a revalidation
  // actually changed anything, because for every consumer that watches one of
  // these objects, a NEW OBJECT IS A CHANGE even when the data is identical.
  //
  // The profile is the clearest case: ProfilePage resyncs its edit form from
  // `profile` whenever the object changes, so republishing an unchanged profile
  // after a background refresh silently discarded whatever the user had typed.
  function sameRow<T extends object>(a: T | null, b: T | null): boolean {
    if (a === b) return true
    if (!a || !b) return false
    const keys = Object.keys(a) as (keyof T)[]
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((k) => a[k] === b[k])
  }

  // supabase-js publishes a NEW user object on every auth event, even when it is
  // the same person with the same token. Around twenty effects across the app
  // depend on `user`, so handing out a fresh object re-ran every one of them on
  // each resume. Hold the identity stable while the id is unchanged;
  // USER_UPDATED is the one event that really does carry new user fields.
  function publishUser(next: User | null, userChanged: boolean) {
    setUser((prev) => {
      if (!userChanged && prev && next && prev.id === next.id) return prev
      return next
    })
  }

  // A different person (or nobody) from now on. Everything that belonged to the
  // previous person goes at once, in the same render that sets `loading`, so
  // App unmounts the router (every page, form and organization workspace) before
  // anything could draw the new person's data next to the old.
  function beginIdentity(userId: string | null): number {
    const previous = shownRef.current.userId
    const generation = shownRef.current.generation + 1
    shownRef.current = { userId, generation }
    loadedRef.current = null
    inFlightRef.current = null
    setProfile(null)
    setAccount(null)
    setAccountError(null)
    setRevalidating(false)
    if (previous !== null) {
      // A recovery grant belonged to the previous person.
      setIsRecovery(false)
      setRecoveryError(null)
    }
    // Someone else took over this tab (another tab signed them in): the page it
    // was on was the previous person's. Start the new person at their own home;
    // the `/` route sends them there once their account type is known.
    if (previous !== null && userId !== null) navigateRef.current('/', { replace: true })
    return generation
  }

  // `bootstrap` separates the two very different failures a load can have:
  //
  //   bootstrap  — we have never established what this user may do, so a
  //                failure has to be reported. /account explains it, and no
  //                protected data is rendered on a guess.
  //   revalidate — we already know, and the network simply did not answer.
  //                Clearing the account here is what threw someone from a deep
  //                page to /account on a flaky connection: the route guards
  //                cannot tell "no account" from "no answer", so they treated a
  //                dropped request as a revoked account.
  //
  // A revalidation that SUCCEEDS is always applied, including when it returns no
  // row or a suspended status — that is authoritative and must take effect.
  function loadIdentity(userId: string, generation: number, bootstrap: boolean) {
    inFlightRef.current = generation
    ;(async () => {
      try {
        const [p, a] = await Promise.all([fetchProfile(userId), fetchAccount(userId)])
        if (shownRef.current.generation !== generation) return
        // The answers count only if they were given to this person's session:
        // if the stored session changed while they were on the way, follow it.
        const stored = readStoredSessionOwner()
        if (stored !== undefined && stored !== userId) {
          reconcile()
          return
        }
        if (p.ok) setProfile((prev) => (sameRow(prev, p.data) ? prev : p.data))
        if (a.ok) {
          setAccount((prev) => (sameRow(prev, a.data) ? prev : a.data))
          setAccountError(null)
        } else if (bootstrap) {
          setAccount(null)
          setAccountError(a.message)
        }
        loadedRef.current = generation
      } finally {
        if (inFlightRef.current === generation) inFlightRef.current = null
        if (shownRef.current.generation === generation) {
          if (bootstrap) setLoading(false)
          else setRevalidating(false)
        }
      }
    })()
  }

  // Ask the client for the stored session. Deferred, because supabase-js may be
  // notifying subscribers from inside its own lock, and getSession() waits for
  // that lock. A read that comes back disagreeing with storage (storage changed
  // again meanwhile) is retried a few times; after that the tab shows no one,
  // which is the safe side, and the next focus or storage change tries again.
  function readStoredSession(attempt = 0) {
    if (readingRef.current && attempt === 0) return
    readingRef.current = true
    window.setTimeout(async () => {
      let read: Session | null = null
      try {
        read = (await supabase.auth.getSession()).data.session
      } catch {
        read = null
      }
      const owner = read?.user?.id ?? null
      const stored = readStoredSessionOwner()
      if (stored !== undefined && stored !== owner && attempt < 3) {
        readStoredSession(attempt + 1)
        return
      }
      readingRef.current = false
      if (stored !== undefined && stored !== owner) {
        apply({ kind: 'signed-out' }, null, null)
        return
      }
      onSession(read ? 'SIGNED_IN' : 'SIGNED_OUT', read)
    }, 0)
  }

  function apply(step: IdentityStep, event: AuthChangeEvent | null, eventSession: Session | null) {
    if (step.kind === 'signed-out') {
      // A definitive end of the session. Protected state goes immediately --
      // this is the one path that must forget everything.
      if (shownRef.current.userId !== null || !readyRef.current) beginIdentity(null)
      setSession(null)
      publishUser(null, true)
      setLoading(false)
      return
    }

    if (step.kind === 'switch') {
      // No authorization for this person yet — a cold start, or a different
      // person signing in. Blocking here is correct: a guard that sees
      // account === null cannot tell "not allowed" from "not known yet", and
      // without it a fresh sign-in flashes "Your account is not set up".
      const generation = beginIdentity(step.userId)
      setLoading(true)
      if (step.session === 'event' && eventSession) {
        setSession(eventSession)
        publishUser(eventSession.user, true)
        loadIdentity(step.userId, generation, true)
      } else {
        // The event was not about the stored session, or there was none. Nobody
        // is published until the stored session has been read and confirmed.
        setSession(null)
        publishUser(null, true)
        readStoredSession()
      }
      if (event === 'PASSWORD_RECOVERY' && step.session === 'event') {
        setIsRecovery(true)
        setRecoveryError(null)
      }
      return
    }

    // THE DISTINCTION THIS WHOLE PROVIDER TURNS ON.
    //
    // supabase-js re-announces the stored session as SIGNED_IN every time the
    // tab becomes visible again, and as TOKEN_REFRESHED whenever it rotates
    // the token (roughly hourly, and on resume when expiry is near). Both used
    // to take the blocking branch, and App renders a full-page spinner INSTEAD
    // OF the router whenever loading is true — so every return to the tab
    // unmounted the router, every page, every open dialog and every unsaved
    // form, then remounted and refetched all of it.
    //
    // If this is the same person we already authorized, it is a revalidation:
    // refresh quietly and leave the interface where the user left it.
    if (!eventSession) return
    setSession(eventSession)
    publishUser(eventSession.user, event === 'USER_UPDATED')
    if (event === 'PASSWORD_RECOVERY') {
      setIsRecovery(true)
      setRecoveryError(null)
    }
    const generation = shownRef.current.generation
    // Already fetching for exactly this person: nothing to add. Keeps the
    // bootstrap idempotent when INITIAL_SESSION and SIGNED_IN arrive
    // together, and under StrictMode's double mount.
    if (inFlightRef.current === generation) return
    const bootstrap = loadedRef.current !== generation
    if (bootstrap) setLoading(true)
    else setRevalidating(true)
    loadIdentity(step.userId, generation, bootstrap)
  }

  // Every auth event, including the ones other tabs relay. The event is checked
  // against the stored session before anything is loaded for it.
  function onSession(event: AuthChangeEvent, newSession: Session | null) {
    const step = identityStep(shownRef.current.userId, { userId: newSession?.user?.id ?? null }, readStoredSessionOwner())
    if (step) apply(step, event, newSession)
    readyRef.current = true
  }

  // No event: the stored session may have changed under this tab (another tab
  // wrote it, or this tab missed the message). Cheap and lock-free; does
  // nothing unless storage and the tab disagree.
  function reconcile() {
    if (!readyRef.current) return
    const step = identityStep(shownRef.current.userId, null, readStoredSessionOwner())
    if (step) apply(step, null, null)
  }

  useEffect(() => {
    // No getSession() call here on purpose. onAuthStateChange delivers
    // INITIAL_SESSION to every new subscriber, so asking separately ran the
    // whole bootstrap twice on every cold start — two profile reads and two
    // account reads for one page load.
    const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Authoritative signal from the client once it has consumed the grant,
      // when it is about the session this tab follows (see apply).
      onSession(event, newSession)
    })

    // The browser's own cross-tab signal: it fires in every other tab once a
    // change to localStorage is visible there, which is exactly the moment the
    // new session can be read. It does not depend on supabase-js's message
    // reaching this tab, or arriving in order.
    const key = authStorageKey()
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== window.localStorage) return
      if (e.key === null || e.key === key) reconcile()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile()
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) reconcile()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', reconcile)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)

    return () => {
      authListener.subscription.unsubscribe()
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', reconcile)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
    // The listeners read only refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signUp(
    email: string,
    password: string,
    fullName: string,
    invitationId?: string,
    accountType?: 'attendee' | 'organizer'
  ) {
    // An organization-invitation email link carries ?invitation=<id>; threading
    // it into emailRedirectTo means the confirmation email returns the user to
    // /auth/callback with the id still attached, and the callback page routes
    // them to the invitation instead of their account home. Without an id the
    // redirect is exactly as before.
    const callbackUrl = invitationId
      ? `${window.location.origin}/auth/callback?invitation=${encodeURIComponent(invitationId)}`
      : `${window.location.origin}/auth/callback`
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Only an organizer request adds account_type, so an attendee signup
        // sends exactly what it always has. This is a request, not a grant: the
        // handle_new_user trigger turns 'organizer' into pending_approval and
        // ignores every other value.
        data: {
          full_name: fullName,
          ...(accountType === 'organizer' ? { account_type: 'organizer' } : {}),
        },
        // Where the {{ .ConfirmationURL }} in the confirmation email sends the
        // user back to. /login would bounce them straight to the dashboard
        // without ever reporting a failed or expired link.
        emailRedirectTo: callbackUrl,
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
  // supabase-js removes the stored session even when the server call fails, and
  // announces SIGNED_OUT, which the listener handles; this makes the end of the
  // session immediate in this tab regardless.
  async function signOut() {
    await supabase.auth.signOut()
    apply({ kind: 'signed-out' }, null, null)
    setIsRecovery(false)
    setRecoveryError(null)
  }

  // Both refreshes apply only to the person they were asked for.
  async function refreshProfile() {
    const { userId, generation } = shownRef.current
    if (!userId) return
    const p = await fetchProfile(userId)
    if (!p.ok || shownRef.current.generation !== generation) return
    setProfile((prev) => (sameRow(prev, p.data) ? prev : p.data))
  }

  // An organizer awaiting approval sits on a screen that has to notice when the
  // decision lands, without making them sign out and back in.
  async function refreshAccount() {
    const { userId, generation } = shownRef.current
    if (!userId) return
    const a = await fetchAccount(userId)
    if (!a.ok || shownRef.current.generation !== generation) return
    setAccount((prev) => (sameRow(prev, a.data) ? prev : a.data))
    setAccountError(null)
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
    <AuthContext.Provider value={{ session, user, profile, account, accountError, loading, revalidating, isRecovery, recoveryError, oauthError, clearOauthError: () => setOauthError(null), signUp, signIn, signOut, refreshProfile, refreshAccount, resetPassword, updatePassword, signInWithGoogle, signInWithLinkedIn }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
