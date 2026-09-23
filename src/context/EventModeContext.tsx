import { createContext, useContext, type ReactNode } from 'react'
import { useParams, Navigate, useLocation } from 'react-router-dom'

// Event Mode context. The event id comes from the route itself (/events/:eventId/...)
// so there is exactly one source of truth — no separate event data model, no
// duplicated context state. Children only render inside this provider, which
// means the id is always the real event being opened.
const EventModeContext = createContext<string | null>(null)

export function useEventModeId(): string {
  const id = useContext(EventModeContext)
  if (!id) throw new Error('useEventModeId must be used inside EventModeProvider')
  return id
}

export function EventModeProvider({ children }: { children: ReactNode }) {
  const { eventId } = useParams<{ eventId: string }>()
  if (!eventId) return <Navigate to="/events" replace />
  return <EventModeContext.Provider value={eventId}>{children}</EventModeContext.Provider>
}

// Redirect helper for Event Mode pages: an event id that is not on the route
// (should not happen) sends the user back to the events catalog.
export function RequireEventMode({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { eventId } = useParams<{ eventId: string }>()
  if (!eventId) return <Navigate to="/events" state={{ from: location.pathname }} replace />
  return <>{children}</>
}
