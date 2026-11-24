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
import type { Organization, OrganizationMembership, OrgRole } from '@/lib/supabase'
import {
  LEGACY_ACTIVE_ORG_KEY,
  activeOrganizationStorageKey,
  isMemberOf,
  lostOrganization,
  resolveActiveMembership,
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

// Background re-checks (tab regains focus, the switcher opens) at most this often.
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
  dismissLostAccess: () => void
  selectOrganization: (id: string) => void
  refresh: () => Promise<void>
  // A throttled background re-check, for moments the list is about to be relied
  // on (opening the switcher, returning to the tab). `force` skips the throttle
  // (a Retry button); a failure still only sets revalidationError.
  revalidate: (options?: { force?: boolean }) => void
}

const OrganizerContext = createContext<OrganizerContextValue | undefined>(undefined)

export function OrganizerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [memberships, setMemberships] = useState<OrganizationMembership[]>([])
  const [activeId, setActiveId] = useState<string | null>(() => (userId ? readStored(userId) : null))
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revalidationError, setRevalidationError] = useState<string | null>(null)
  const [lostAccess, setLostAccess] = useState<LostOrganizationAccess | null>(null)

  // Whose memberships are already loaded. The id, not the user object: supabase
  // hands out a new user object on every auth event, and depending on the object
  // re-ran this whole load on every token refresh and every tab return.
  const loadedForRef = useRef<string | null>(null)
  // Only the latest request may change state: a slow answer to an older one
  // (a focus re-check overtaken by an explicit refresh) must not overwrite it.
  const seqRef = useRef(0)
  const lastCheckRef = useRef(0)
  // A selection of an organization not in the list yet — the moment after
  // accepting an invitation or creating an organization. Honoured only if a load
  // that STARTED after the selection contains it.
  const pendingRef = useRef<{ id: string; afterSeq: number } | null>(null)
  const membershipsRef = useRef<OrganizationMembership[]>([])
  const resolvedIdRef = useRef<string | null>(null)

  const active = resolveActiveMembership(memberships, activeId)
  membershipsRef.current = memberships
  resolvedIdRef.current = active?.organization.id ?? null

  // A different person (sign-out, then someone else signs in): forget the
  // previous person's selection and read theirs. load() below clears the
  // memberships and any pending selection for the same change.
  useEffect(() => {
    setActiveId(userId ? readStored(userId) : null)
    setLostAccess(null)
  }, [userId])

  const load = useCallback(
    async (mode: 'explicit' | 'background') => {
      if (!userId) {
        seqRef.current++
        loadedForRef.current = null
        pendingRef.current = null
        setMemberships([])
        setError(null)
        setRevalidationError(null)
        setLostAccess(null)
        setLoading(false)
        setRefreshing(false)
        return
      }

      const seq = ++seqRef.current
      const first = loadedForRef.current !== userId
      lastCheckRef.current = Date.now()
      if (first) {
        setLoading(true)
        // Never show one person's organizations while another person's load,
        // and never carry a selection across people.
        setMemberships([])
        pendingRef.current = null
      } else {
        setRefreshing(true)
      }

      const { data, error: loadError } = await listMyOrganizations()
      // A newer request owns the state, including the loading flags.
      if (seq !== seqRef.current) return

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

        setMemberships(data)
        setError(null)
        setRevalidationError(null)
        loadedForRef.current = userId

        if (nextActive) {
          setActiveId(nextActive)
          writeStored(userId, nextActive)
          setLostAccess(null)
        } else {
          const lost = lostOrganization(previous, previousActiveId, data)
          if (lost) setLostAccess(lost)
        }
      }

      if (first) setLoading(false)
      else setRefreshing(false)
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
  // the person comes back to it, quietly: a failure keeps the known list.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') revalidate()
    }
    function onFocus() {
      revalidate()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [revalidate])

  // Keep the remembered choice equal to what is actually shown: a stale id (an
  // organization left, or never belonged to) is replaced by the fallback. Not
  // while a just-made selection is waiting for its membership to load.
  useEffect(() => {
    if (loading || pendingRef.current) return
    const resolved = active?.organization.id ?? null
    if (resolved !== activeId) {
      setActiveId(resolved)
      writeStored(userId, resolved)
    }
  }, [active, activeId, loading, userId])

  const selectOrganization = useCallback(
    (id: string) => {
      setLostAccess(null)
      if (isMemberOf(membershipsRef.current, id)) {
        pendingRef.current = null
        setActiveId(id)
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
// the event is loaded and the person is a member of its organization, show that
// organization in the header and navigation, so the page and its workspace agree.
// Never selects an organization the person does not belong to.
export function useFollowOrganization(organizationId: string | null | undefined) {
  const { memberships, organization, selectOrganization } = useOrganizer()
  const activeId = organization?.id ?? null
  useEffect(() => {
    if (!organizationId || organizationId === activeId) return
    if (!isMemberOf(memberships, organizationId)) return
    selectOrganization(organizationId)
  }, [organizationId, activeId, memberships, selectOrganization])
}
