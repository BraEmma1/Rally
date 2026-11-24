import { supabase } from '@/lib/supabase'
import { sessionOwnerFromStored, type StoredOwner } from '@/lib/sessionIdentity'

// The localStorage key supabase-js keeps its session under. It is not part of
// the client's typed surface, so it is read defensively; null means "cannot
// tell", and callers then rely on the auth events alone.
export function authStorageKey(): string | null {
  const key = (supabase.auth as unknown as { storageKey?: unknown }).storageKey
  return typeof key === 'string' && key ? key : null
}

// Who the stored session belongs to, read synchronously and without the auth
// client's lock. getSession() would give the same answer, but it waits on the
// lock every request also takes, and this runs on every focus and every auth
// event. See src/lib/sessionIdentity.ts for why the stored session decides.
export function readStoredSessionOwner(): StoredOwner {
  const key = authStorageKey()
  if (!key) return undefined
  try {
    return sessionOwnerFromStored(window.localStorage.getItem(key))
  } catch {
    return undefined
  }
}
