import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { listMyOrganizations } from '@/lib/organizer'
import type { Organization, OrganizationMembership, OrgRole } from '@/lib/supabase'

// Which organization the organizer is currently looking at. A user may belong
// to several, so the choice is remembered per browser — it is a view
// preference, not authority, and every request is authorized server-side
// against the organization id regardless of what is stored here.
const ACTIVE_ORG_KEY = 'rally.organizer.active_org'

function readStored(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_ORG_KEY)
  } catch {
    return null
  }
}

function writeStored(value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(ACTIVE_ORG_KEY)
    else window.localStorage.setItem(ACTIVE_ORG_KEY, value)
  } catch {
    // Blocked storage just means the choice resets on reload.
  }
}

type OrganizerContextValue = {
  memberships: OrganizationMembership[]
  organization: Organization | null
  role: OrgRole | null
  loading: boolean
  error: string | null
  selectOrganization: (id: string) => void
  refresh: () => Promise<void>
}

const OrganizerContext = createContext<OrganizerContextValue | undefined>(undefined)

export function OrganizerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([])
  const [activeId, setActiveId] = useState<string | null>(() => readStored())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user) {
      setMemberships([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: loadError } = await listMyOrganizations()
    setMemberships(data)
    setError(loadError)
    setLoading(false)
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // A remembered id is only a hint: it may name an organization the user has
  // since been removed from, or one that never existed. Fall back to the first
  // real membership rather than showing an empty shell.
  const active =
    memberships.find((m) => m.organization.id === activeId) ?? memberships[0] ?? null

  useEffect(() => {
    if (active && active.organization.id !== activeId) {
      setActiveId(active.organization.id)
      writeStored(active.organization.id)
    }
    if (!active && !loading && activeId) {
      setActiveId(null)
      writeStored(null)
    }
  }, [active, activeId, loading])

  function selectOrganization(id: string) {
    setActiveId(id)
    writeStored(id)
  }

  return (
    <OrganizerContext.Provider
      value={{
        memberships,
        organization: active?.organization ?? null,
        role: active?.role ?? null,
        loading,
        error,
        selectOrganization,
        refresh,
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
