import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase, type AppNotification } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface NotificationContextValue {
  notifications: AppNotification[]
  unreadCount: number
  loading: boolean
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  refresh: () => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)
const NONE: AppNotification[] = []

// This provider sits above the router, so unlike every page it is NOT remounted
// when a different person takes over the tab. The list is therefore kept with
// the person it belongs to and is shown only to that person, and an answer that
// arrives after the person changed (or after a newer load started) is dropped.
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [list, setList] = useState<{ owner: string | null; items: AppNotification[] }>({ owner: null, items: NONE })
  const [loading, setLoading] = useState(true)
  const seqRef = useRef(0)

  const notifications = list.owner !== null && list.owner === userId ? list.items : NONE

  // Applies an update only while the list still belongs to `owner`.
  function update(owner: string, change: (items: AppNotification[]) => AppNotification[]) {
    setList((prev) => (prev.owner === owner ? { owner, items: change(prev.items) } : prev))
  }

  async function loadNotifications() {
    const seq = ++seqRef.current
    const owner = userId
    if (!owner) {
      setList({ owner: null, items: NONE })
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', owner)
      .order('created_at', { ascending: false })
      .limit(100)
    if (seq !== seqRef.current) return
    if (!error) setList({ owner, items: (data as AppNotification[]) || [] })
    setLoading(false)
  }

  useEffect(() => {
    loadNotifications()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function markAsRead(id: string) {
    if (!userId) return
    const owner = userId
    const previous = notifications
    update(owner, (items) => items.map((n) => (n.id === id ? { ...n, read: true } : n)))
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', owner)
    if (error) update(owner, () => previous)
  }

  async function markAllAsRead() {
    if (!userId) return
    const owner = userId
    const previous = notifications
    update(owner, (items) => items.map((n) => ({ ...n, read: true })))
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', owner)
      .eq('read', false)
    if (error) update(owner, () => previous)
  }

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
        loading,
        markAsRead,
        markAllAsRead,
        refresh: loadNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
