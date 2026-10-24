import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { fetchConversations, subscribeToInbox } from '@/lib/messages'

// Total unread messages across all conversations, for the Messages tab badge.
// Derived from get_my_conversations so it can never disagree with the inbox,
// and kept live by the same realtime signal the inbox uses.
export function useUnreadMessages() {
  const { user } = useAuth()
  const userId = user?.id
  const [count, setCount] = useState(0)
  const seqRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    const { data, error } = await fetchConversations()
    if (seq !== seqRef.current || error) return
    setCount(data.reduce((sum, c) => sum + (c.unread_count || 0), 0))
  }, [])

  useEffect(() => {
    if (!userId) {
      setCount(0)
      return
    }
    void load()
    // Bursts of realtime events collapse into one refetch.
    const schedule = () => {
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => void load(), 300)
    }
    const unsubscribe = subscribeToInbox(
      userId,
      schedule,
      (status) => {
        if (status === 'SUBSCRIBED') void load()
      },
      'nav-badge'
    )
    return () => {
      window.clearTimeout(timerRef.current)
      seqRef.current++
      unsubscribe()
    }
  }, [userId, load])

  return count
}
