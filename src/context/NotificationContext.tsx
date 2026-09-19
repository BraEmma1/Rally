import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
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

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)

  async function loadNotifications() {
    if (!user) {
      setNotifications([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (!error) {
      setNotifications((data as AppNotification[]) || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadNotifications()
  }, [user])

  async function markAsRead(id: string) {
    if (!user) return
    setNotifications(notifications.map((n) => n.id === id ? { ...n, read: true } : n))
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) {
      setNotifications(notifications)
    }
  }

  async function markAllAsRead() {
    if (!user) return
    const previous = notifications
    setNotifications(notifications.map((n) => ({ ...n, read: true })))
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)
    if (error) {
      setNotifications(previous)
    }
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
