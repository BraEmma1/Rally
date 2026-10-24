import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { fetchMyConnectionRequests, REQUESTS_CHANGED_EVENT } from '@/lib/connectionRequests'

// Number of connection requests waiting for the signed-in user to answer, for the
// Network tab badge. Only incoming requests count: an outgoing one needs nothing
// from you. Derived from my_connection_requests so it cannot disagree with the
// requests list.
//
// connection_requests is not in the realtime publication, so this refreshes on
// mount, when the tab regains focus, on a slow poll while visible, and right away
// when this device sends, answers or cancels a request.
const POLL_MS = 30_000

export function usePendingRequests() {
  const { user } = useAuth()
  const userId = user?.id
  const [count, setCount] = useState(0)
  const seqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    const { data, error } = await fetchMyConnectionRequests()
    if (seq !== seqRef.current || error) return
    setCount(data.filter((r) => r.direction === 'incoming').length)
  }, [])

  useEffect(() => {
    if (!userId) {
      setCount(0)
      return
    }
    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const poll = window.setInterval(onVisible, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(REQUESTS_CHANGED_EVENT, onVisible)
    return () => {
      seqRef.current++
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(REQUESTS_CHANGED_EVENT, onVisible)
    }
  }, [userId, load])

  return count
}
