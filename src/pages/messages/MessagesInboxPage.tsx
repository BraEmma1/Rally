import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Search, MessageSquare } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import {
  fetchConversations,
  subscribeToInbox,
  toFriendlyMessageError,
  type ConversationSummary,
} from '@/lib/messages'
import { Avatar } from '@/components/ui/Avatar'
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/States'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'

function formatConversationTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  }
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
}

export default function MessagesInboxPage() {
  const navigate = useNavigate()
  // This page is mounted at both /messages and /events/:eventId/messages.
  // Opening a thread has to stay on whichever branch the user is already on,
  // or tapping a conversation inside Event Mode drops them into the main app.
  const { eventId } = useParams<{ eventId?: string }>()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [search, setSearch] = useState('')

  const mountedRef = useRef(true)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stamps each fetch so a slow earlier one cannot land after a newer one and
  // put stale rows back on screen.
  const requestSeqRef = useRef(0)
  // True once any fetch has delivered rows, so a later failure can be told
  // apart from "nothing has ever loaded".
  const hasLoadedRef = useRef(false)

  // The list is always re-read whole from get_my_conversations rather than
  // patched row by row. That RPC is the only thing that knows what a row should
  // say -- preview, unread count, deleted-message tombstone, ordering -- and
  // reproducing those rules on the client would be a second implementation of
  // them, free to drift from the database and impossible to reconcile after a
  // missed event. One small RPC per burst buys exact agreement instead.
  const load = useCallback(async (initial = false) => {
    const seq = ++requestSeqRef.current
    if (initial) {
      setLoading(true)
      setError(null)
    }
    const { data, error: loadError } = await fetchConversations()
    if (seq !== requestSeqRef.current || !mountedRef.current) return
    if (loadError) {
      // Only the first load may replace the list with an error screen. A
      // background refresh that fails leaves the last good rows up; the next
      // event, reconnect or tab focus reconciles.
      if (initial || !hasLoadedRef.current) {
        setError(toFriendlyMessageError(loadError, 'Could not load your conversations. Please try again.'))
      }
    } else {
      hasLoadedRef.current = true
      setConversations(data)
      setError(null)
    }
    // Whichever fetch is newest ends the loading state, not only the first one.
    // A realtime refresh that starts while the first fetch is still in flight
    // makes the first result stale and discards it; if only "initial" could
    // clear the spinner, the page would then load forever. This is exactly what
    // happens after leaving a chat, because marking it read fires an event as
    // the inbox mounts.
    setLoading(false)
  }, [])

  // Three messages arriving together are one refresh, not three.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => void load(), 250)
  }, [load])

  useEffect(() => {
    mountedRef.current = true
    void load(true)
    return () => {
      mountedRef.current = false
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [load])

  useEffect(() => {
    if (!user?.id) return
    const unsubscribe = subscribeToInbox(user.id, scheduleRefresh, (status) => {
      // Realtime does not replay. Re-reading once the binding goes live closes
      // both the gap after the initial fetch and whatever was missed while a
      // dropped connection was being re-established.
      if (status === 'SUBSCRIBED') void load()
    })
    return () => unsubscribe()
  }, [user?.id, scheduleRefresh, load])

  // A tab suspended in the background can miss events without the socket ever
  // reporting a clean reconnect.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') scheduleRefresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [scheduleRefresh])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) =>
        c.other_full_name.toLowerCase().includes(q) ||
        c.other_company.toLowerCase().includes(q)
    )
  }, [conversations, search])

  async function openConversation(c: ConversationSummary) {
    navigate(
      eventId
        ? `/events/${eventId}/messages/${c.conversation_id}`
        : `/messages/${c.conversation_id}`
    )
  }

  const unreadTotal = conversations.reduce((n, c) => n + (c.unread_count > 0 ? 1 : 0), 0)

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Messages" description="Direct conversations with the people you have connected with." />

      <div className="relative mt-5">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or company…"
          aria-label="Search conversations"
          className="h-12 w-full rounded-xl border border-rally-line bg-white pl-10 pr-3 text-sm text-rally-navy shadow-card placeholder:text-gray-400 focus:border-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        />
      </div>

      {loading ? (
        <LoadingState message="Loading conversations…" />
      ) : error ? (
        <ErrorState message={error} />
      ) : conversations.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-rally-line bg-white p-6 shadow-card">
          <EmptyState
            icon={<MessageSquare className="h-8 w-8" />}
            title="No conversations yet."
            description="Connect with someone at an event to start a conversation."
          />
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-gray-300 bg-white px-3 py-6 text-center text-sm text-gray-500">
          No conversations match “{search.trim()}”.
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
            {unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''}
          </p>
          <ul className="mt-2 divide-y divide-rally-line overflow-hidden rounded-2xl border border-rally-line bg-white shadow-card">
            {filtered.map((c) => (
              <li key={c.conversation_id}>
                <button
                  onClick={() => void openConversation(c)}
                  className={cn(
                    'flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600',
                    c.unread_count > 0 && 'bg-rally-tint/60'
                  )}
                >
                  <Avatar name={c.other_full_name} src={c.other_photo_url} size="md" className="h-12 w-12 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={cn('truncate text-[15px] text-rally-navy', c.unread_count > 0 ? 'font-semibold' : 'font-medium')}>
                        {c.other_full_name || 'Rally member'}
                      </p>
                      <span className={cn('flex-shrink-0 text-xs', c.unread_count > 0 ? 'font-semibold text-primary-700' : 'text-gray-400')}>
                        {formatConversationTime(c.last_message_at)}
                      </span>
                    </div>
                    {c.other_company && <p className="truncate text-xs text-slate-500">{c.other_company}</p>}
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className={cn('truncate text-sm', c.unread_count > 0 ? 'font-medium text-gray-700' : 'text-gray-500')}>
                        {c.last_message_body || 'No messages yet'}
                      </p>
                      {c.unread_count > 0 && (
                        <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary-600 px-1.5 text-[11px] font-semibold text-white">
                          {c.unread_count > 9 ? '9+' : c.unread_count}
                        </span>
                      )}
                    </div>
                    {c.event_name && <p className="mt-0.5 truncate text-xs text-gray-400">Met at {c.event_name}</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
