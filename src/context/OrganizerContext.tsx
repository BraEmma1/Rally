import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/context/AuthContext'
import { listMyOrganizations } from '@/lib/organizer'
import { type Organization, type OrganizationMembership, type OrgRole } from '@/lib/supabase'
import { readStoredSessionOwner } from '@/lib/session'
import {
  LEGACY_ACTIVE_ORG_KEY,
  activeOrganizationStorageKey,
  isMemberOf,
  lostOrganization,
  resolveActiveMembership,
  reuseUnchanged,
} from '@/lib/workspaces'

// Which organization the person is currently working in. They may belong to
// several, so the choice is remembered per browser AND per person — it is a view
// preference, not authority, and every request is authorized server-side against
// the organization id regardless of what is stored here.
//
// This is the single source of truth for the selected organization. The
// workspace switcher, the organizer header and every organizer page read it;
// nothing else stores a selection.

function readStored(userId: string): string | null {
  try {
    const own = window.localStorage.getItem(activeOrganizationStorageKey(userId))
    if (own) return own
    // Before the key was per person. Still only a hint: it is checked against
    // this person's own memberships before anything is shown.
    return window.localStorage.getItem(LEGACY_ACTIVE_ORG_KEY)
  } catch {
    return null
  }
}

function writeStored(userId: string | null, value: string | null) {
  if (!userId) return
  try {
    window.localStorage.removeItem(LEGACY_ACTIVE_ORG_KEY)
    const key = activeOrganizationStorageKey(userId)
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Blocked storage just means the choice resets on reload.
  }
}

// The person the API token currently belongs to (src/lib/session.ts). A
// membership answer is only ever filed under the person whose token produced it.
// AuthContext follows the stored session too (Q-33) and remounts this provider
// when the person changes; this check is the organizer area's own guard for the
// moment in between.
const tokenOwner = readStoredSessionOwner

// Background re-checks (tab focus or visibility, opening the switcher, moving
// between organizer pages) run at most this often.
const REVALIDATE_INTERVAL_MS = 15_000

export type LostOrganizationAccess = { id: string; name: string }

type OrganizerContextValue = {
  memberships: OrganizationMembership[]
  organization: Organization | null
  role: OrgRole | null
  // First load only. Route guards block on this, so it must never be set again
  // for a background re-check — that is what replaced the organizer area with a
  // spinner on every return to the tab.
  loading: boolean
  // A re-check of memberships we already have, running behind the interface.
  refreshing: boolean
  // A failed first load, or a failed explicit refresh(). Pages show it.
  error: string | null
  // A failed BACKGROUND re-check. The last known list stays in use; the switcher
  // says it could not confirm it. Never blanks a page.
  revalidationError: string | null
  // Set when a successful reload no longer contains the organization that was on
  // screen: the membership was removed, or the account lost access.
  lostAccess: LostOrganizationAccess | null
  // This tab's API token now belongs to a different person than the one the app
  // shows (another tab signed someone else in). The organizer area shows nothing
  // of either workspace until the tab is reloaded as the new person.
  foreignSession: boolean
  dismissLostAccess: () => void
  selectOrganization: (id: string) => void
  refresh: () => Promise<void>
  // A throttled background re-check, for moments the list is about to be relied
  // on (opening the switcher, returning to the tab). `force` skips the throttle
  // (a Retry button); a failure still only sets revalidationError.
  revalidate: (options?: { force?: boolean }) => void
}

const OrganizerContext = createContext<OrganizerContextValue | undefined>(undefined)

const NO_MEMBERSHIPS: OrganizationMembership[] = []

export function OrganizerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Everything below belongs to the person it was loaded for, and `owner` says
  // who that is. When the signed-in person changes — another tab signs out and
  // someone else signs in, and this tab picks up their session — there is a render
  // before the new load starts. In it, every value of the previous person reads
  // as empty and loading, so none of their organizations, selection, notices or
  // errors reaches the new person's screen, not even for one render.
  const [owner, setOwner] = useState<string | null>(null)
  const [ownMemberships, setMemberships] = useState<OrganizationMembership[]>(NO_MEMBERSHIPS)
  const [selection, setSelection] = useState<{ userId: string | null; id: string | null }>(() => ({
    userId,
    id: userId ? readStored(userId) : null,
  }))
  const [ownLoading, setLoading] = useState(true)
  const [ownRefreshing, setRefreshing] = useState(false)
  const [ownError, setError] = useState<string | null>(null)
  const [ownRevalidationError, setRevalidationError] = useState<string | null>(null)
  const [ownLost, setLostAccess] = useState<LostOrganizationAccess | null>(null)
  const [ownForeign, setForeignSession] = useState(false)

  const mine = userId !== null && owner === userId
  const memberships = mine ? ownMemberships : NO_MEMBERSHIPS
  const loading = userId === null ? false : !mine || ownLoading
  const refreshing = mine && ownRefreshing
  const error = mine ? ownError : null
  const revalidationError = mine ? ownRevalidationError : null
  const lostAccess = mine ? ownLost : null
  const foreignSession = mine && ownForeign
  // The remembered choice is per person: another person's selection is never
  // even consulted. Still only a hint, resolved against this person's memberships.
  const activeId = selection.userId === userId ? selection.id : userId ? readStored(userId) : null

  // Whose memberships are already loaded. The id, not the user object: supabase
  // hands out a new user object on every auth event, and depending on the object
  // re-ran this whole load on every token refresh and every tab return.
  const loadedForRef = useRef<string | null>(null)
  // Only the latest request may change state: a slow answer to an older one
  // (a focus re-check overtaken by an explicit refresh, or the previous
  // person's load) must not overwrite it.
  const seqRef = useRef(0)
  const lastCheckRef = useRef(0)
  // A selection of an organization not in the list yet — the moment after
  // accepting an invitation or creating an organization. Honoured only if a load
  // that STARTED after the selection contains it.
  const pendingRef = useRef<{ id: string; afterSeq: number } | null>(null)
  const membershipsRef = useRef<OrganizationMembership[]>(NO_MEMBERSHIPS)
  const resolvedIdRef = useRef<string | null>(null)

  const active = resolveActiveMembership(memberships, activeId)
  membershipsRef.current = memberships
  resolvedIdRef.current = active?.organization.id ?? null

  const load = useCallback(
    async (mode: 'explicit' | 'background') => {
      if (!userId) {
        seqRef.current++
        loadedForRef.current = null
        pendingRef.current = null
        setOwner(null)
        setMemberships(NO_MEMBERSHIPS)
        setError(null)
        setRevalidationError(null)
        setLostAccess(null)
        setForeignSession(false)
        setLoading(false)
        setRefreshing(false)
        return
      }

      const seq = ++seqRef.current
      const first = loadedForRef.current !== userId
      lastCheckRef.current = Date.now()
      if (first) {
        // A new person: start from nothing, and never carry a selection across.
        setOwner(userId)
        setMemberships(NO_MEMBERSHIPS)
        setError(null)
        setRevalidationError(null)
        setLostAccess(null)
        setForeignSession(false)
        setLoading(true)
        pendingRef.current = null
      } else {
        setRefreshing(true)
      }
      const settle = () => {
        if (first) setLoading(false)
        else setRefreshing(false)
      }

      const { data, error: loadError } = await listMyOrganizations()
      // A newer request owns the state, including the loading flags.
      if (seq !== seqRef.current) return
      // Answered under someone else's token, this would be someone else's
      // memberships filed under this person: a false "lost access", another
      // person's organizations in this person's switcher and stored choice.
      // The token cannot be checked for free before the request (supabase-js
      // takes its auth lock), so it is checked once, after: if it belongs to
      // anyone else now, the answer is dropped.
      const answeredAs = tokenOwner()
      if (answeredAs !== undefined && answeredAs !== userId) {
        if (answeredAs) setForeignSession(true)
        settle()
        return
      }

      if (loadError) {
        // listMyOrganizations returns an empty list alongside its error, and the
        // route guards read an empty list as "this person has no organization" —
        // which would send an organizer from a deep page to /organizer/setup
        // because one background request did not come back. Keep what we had and
        // report the error instead; only a SUCCESSFUL answer changes membership.
        if (first || mode === 'explicit') setError(loadError)
        else setRevalidationError(loadError)
      } else {
        const previous = membershipsRef.current
        const previousActiveId = first ? null : resolvedIdRef.current

        let nextActive: string | null = null
        const pending = pendingRef.current
        if (pending && seq > pending.afterSeq) {
          pendingRef.current = null
          if (isMemberOf(data, pending.id)) nextActive = pending.id
        }

        setMemberships(reuseUnchanged(previous, data))
        setError(null)
        setRevalidationError(null)
        loadedForRef.current = userId

        if (nextActive) {
          setSelection({ userId, id: nextActive })
          writeStored(userId, nextActive)
          setLostAccess(null)
        } else {
          const lost = lostOrganization(previous, previousActiveId, data)
          if (lost) setLostAccess(lost)
        }
      }

      settle()
    },
    [userId]
  )

  const refresh = useCallback(() => load('explicit'), [load])

  const revalidate = useCallback(
    (options?: { force?: boolean }) => {
      if (!userId || loadedForRef.current !== userId) return
      if (!options?.force && Date.now() - lastCheckRef.current < REVALIDATE_INTERVAL_MS) return
      void load('background')
    },
    [userId, load]
  )

  useEffect(() => {
    void load('explicit')
  }, [load])

  // Memberships change on the server — someone is removed from a team, an
  // account is suspended — and nothing pushes that to an open tab. Re-check when
  // the person comes back to it (focus, visibility, a page restored from the
  // back-forward cache), quietly: a failure keeps the known list. The organizer
  // layout also re-checks as the person moves between pages.
  // The token check is a local storage read (no request, no lock), so it runs on
  // every return; the membership re-check behind it is throttled.
  const checkTokenOwner = useCallback(() => {
    if (!userId || loadedForRef.current !== userId) return true
    const owner = tokenOwner()
    if (owner && owner !== userId) {
      setForeignSession(true)
      return false
    }
    return true
  }, [userId])

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && checkTokenOwner()) revalidate()
    }
    function onFocus() {
      if (checkTokenOwner()) revalidate()
    }
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted && checkTokenOwner()) revalidate({ force: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [revalidate, checkTokenOwner])

  // Keep the remembered choice equal to what is actually shown: a stale id (an
  // organization left, or never belonged to) is replaced by the fallback. Not
  // while a just-made selection is waiting for its membership to load.
  useEffect(() => {
    if (loading || pendingRef.current) return
    const resolved = active?.organization.id ?? null
    if (resolved !== activeId) {
      setSelection({ userId, id: resolved })
      writeStored(userId, resolved)
    }
  }, [active, activeId, loading, userId])

  const selectOrganization = useCallback(
    (id: string) => {
      setLostAccess(null)
      if (isMemberOf(membershipsRef.current, id)) {
        pendingRef.current = null
        setSelection({ userId, id })
        writeStored(userId, id)
        return
      }
      // Not in the list we hold. Callers that have just created the membership
      // follow this with refresh(); the selection waits for that answer and is
      // dropped if the membership is not there.
      pendingRef.current = { id, afterSeq: seqRef.current }
    },
    [userId]
  )

  const dismissLostAccess = useCallback(() => setLostAccess(null), [])

  return (
    <OrganizerContext.Provider
      value={{
        memberships,
        organization: active?.organization ?? null,
        role: active?.role ?? null,
        loading,
        refreshing,
        error,
        revalidationError,
        lostAccess,
        foreignSession,
        dismissLostAccess,
        selectOrganization,
        refresh,
        revalidate,
      }}
    >
      {children}
    </OrganizerContext.Provider>
  )
}

export function useOrganizer() {
  const ctx = useContext(OrganizerContext)
  if (!ctx) throw new Error('useOrganizer must be used within OrganizerProvider')
  return ctx
}

// Pages about one event (detail, edit, a partnership) authorize against the event
// and may be opened from a link, while another organization is selected. Once
// the database has said the person may manage the event, show the event's own
// organization in the header and navigation, so the page and its workspace agree.
// Never selects an organization the person does not belong to.
export function useFollowOrganization(organizationId: string | null | undefined) {
  const { memberships, organization, selectOrganization, revalidate } = useOrganizer()
  const activeId = organization?.id ?? null
  const askedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!organizationId || organizationId === activeId) return
    if (isMemberOf(memberships, organizationId)) {
      selectOrganization(organizationId)
      return
    }
    // The database lets this person manage the event, but its organization is not
    // in the list we hold — most likely a membership granted after the list was
    // loaded. Ask once for this organization; when the list changes this effect
    // runs again and follows if the membership is there. If it is not (an event
    // reached through another rule), the selection simply stays as it is.
    if (askedRef.current !== organizationId) {
      askedRef.current = organizationId
      revalidate({ force: true })
    }
  }, [organizationId, activeId, memberships, selectOrganization, revalidate])
}
