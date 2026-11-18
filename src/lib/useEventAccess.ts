import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchEventAccess } from '@/lib/events'
import { EVENT_ACCESS_ERROR, type EventAccess } from '@/lib/eventAccess'

// The caller's access to one event, asked of the database (see eventAccess.ts).
//
// The answer is stored WITH the event id it belongs to. Moving from one event
// to another therefore reads as "checking" until the new answer arrives, rather
// than briefly showing the previous event's controls. A late answer for an
// event the page has already left is dropped.
//
// Pass null to skip the check (e.g. the create-event form); the result then
// stays "checking" and must not be used.
export function useEventAccess(eventId: string | null | undefined): EventAccess & { retry: () => void } {
  const [answer, setAnswer] = useState<{ eventId: string; access: EventAccess } | null>(null)
  const seq = useRef(0)

  const check = useCallback(async () => {
    if (!eventId) return
    const mine = ++seq.current
    setAnswer(null)
    const access = await fetchEventAccess(eventId).catch(
      (): EventAccess => ({ state: 'error', message: EVENT_ACCESS_ERROR })
    )
    if (mine !== seq.current) return
    setAnswer({ eventId, access })
  }, [eventId])

  useEffect(() => {
    void check()
    return () => {
      seq.current++
    }
  }, [check])

  const retry = useCallback(() => void check(), [check])
  const access: EventAccess =
    eventId && answer && answer.eventId === eventId ? answer.access : { state: 'checking' }
  return { ...access, retry }
}
