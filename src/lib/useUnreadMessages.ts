import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { fetchConversations, subscribeToInbox } from '@/lib/messages'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

// Total unread messages across all conversations, for the Messages tab badge.
// Derived from get_my_conversations so it can never disagree with the inbox,
// and kept live by the same realtime signal the inbox uses.
export function useUnreadMessages() {
  const { user } = useAuth()
  const userId = user?.id
  const [count, setCount] = useState(0)
  const seqRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)
  const retryTimerRef = useRef<number | undefined>(undefined)
  const retryAttemptsRef = useRef(0)

  const load = useCallback(async (isRetry = false) => {
    if (!isRetry) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = undefined
      retryAttemptsRef.current = 0
    }
    const seq = ++seqRef.current
    const scheduleRetry = (error: unknown) => {
      if (seq !== seqRef.current) return
      console.error('Failed to load unread message count:', error)
      if (retryAttemptsRef.current >= MAX_RETRIES) return

      const delay = RETRY_DELAY_MS * 2 ** retryAttemptsRef.current
      retryAttemptsRef.current++
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = undefined
        void load(true)
      }, delay)
    }

    try {
      const { data, error } = await fetchConversations()
      if (seq !== seqRef.current) return
      if (error) {
        scheduleRetry(error)
        return
      }
      retryAttemptsRef.current = 0
      setCount(data.reduce((sum, c) => sum + (c.unread_count || 0), 0))
    } catch (error) {
      scheduleRetry(error)
    }
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
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = undefined
      retryAttemptsRef.current = 0
      seqRef.current++
      unsubscribe()
    }
  }, [userId, load])

  return count
}
