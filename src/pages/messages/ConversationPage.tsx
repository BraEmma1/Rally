import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MoreVertical, Send } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import {
  fetchConversations,
  fetchMessages,
  sendMessage,
  markConversationRead,
  subscribeToMessages,
  toFriendlyMessageError,
  MESSAGE_PAGE_SIZE,
  type ChatMessage,
  type ConversationSummary,
} from '@/lib/messages'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner, ErrorState } from '@/components/ui/States'
import { cn } from '@/lib/utils'

function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDaySeparator(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Group consecutive messages: a new block starts on a sender change or when the
// gap between two messages exceeds five minutes. Only block starts get extra
// breathing room, so a rapid exchange reads as one tight thread.
const GROUP_GAP_MS = 5 * 60 * 1000

type BubbleBlock = { message: ChatMessage; startsBlock: boolean; firstOfTheDay: boolean }

function buildBlocks(messages: ChatMessage[]): BubbleBlock[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1]
    const startsBlock =
      !prev ||
      prev.is_mine !== m.is_mine ||
      new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_GAP_MS
    const firstOfTheDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
    return { message: m, startsBlock, firstOfTheDay }
  })
}

function ChatSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[70, 45, 60, 40, 55].map((width, i) => (
        <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
          <div
            className="h-9 animate-pulse rounded-2xl bg-gray-200"
            style={{ width: `${width}%`, borderTopLeftRadius: i % 2 === 0 && i === 0 ? '0.25rem' : undefined }}
          />
        </div>
      ))}
    </div>
  )
}

export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ConversationSummary | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomAnchorRef = useRef<HTMLDivElement>(null)
  const pinnedToBottomRef = useRef(true)
  const seenMessageIdsRef = useRef<Set<string>>(new Set())
  const realtimeAliveRef = useRef(true)

  const blocks = useMemo(() => buildBlocks(messages), [messages])

  // Locate the conversation's header info from the user's conversation list.
  const loadSummary = useCallback(async () => {
    if (!conversationId) return null
    const { data, error: listError } = await fetchConversations()
    if (listError) throw listError
    const found = data.find((c) => c.conversation_id === conversationId) ?? null
    if (!found) throw new Error('Conversation not found')
    return found
  }, [conversationId])

  const loadInitialMessages = useCallback(async () => {
    if (!conversationId) return
    const { data, error: msgError } = await fetchMessages(conversationId)
    if (msgError) throw msgError
    setMessages(data)
    data.forEach((m) => seenMessageIdsRef.current.add(m.id))
    setHasOlder(data.length === MESSAGE_PAGE_SIZE)
    pinnedToBottomRef.current = true
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    seenMessageIdsRef.current = new Set()
    realtimeAliveRef.current = true

    async function load() {
      setLoading(true)
      setPageError(null)
      try {
        const [found] = await Promise.all([loadSummary(), loadInitialMessages()])
        if (cancelled) return
        setSummary(found)
        // Clear unread flags for this conversation as soon as it is open.
        const { error: readError } = await markConversationRead(conversationId!)
        if (!cancelled && readError) {
          console.warn('Could not mark conversation as read:', readError.message)
        }
      } catch (err) {
        if (!cancelled) {
          setPageError(toFriendlyMessageError(err, 'Could not open this conversation. Please try again.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      realtimeAliveRef.current = false
    }
  }, [conversationId, loadSummary, loadInitialMessages])

  // Realtime subscription. Own inserts are appended optimistically by the
  // composer and reconciled here; the guard set keeps every message unique.
  useEffect(() => {
    if (!conversationId) return
    const unsubscribe = subscribeToMessages(
      conversationId,
      (row) => {
        if (seenMessageIdsRef.current.has(row.id)) return
        seenMessageIdsRef.current.add(row.id)
        setMessages((prev) => [...prev, { ...row, is_mine: row.sender_id === user?.id, pending: false }])
      },
      (status) => {
        if (!realtimeAliveRef.current) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setPageError((prev) => prev ?? 'Live updates were interrupted. Pull to refresh or reopen the conversation.')
        }
        if (status === 'SUBSCRIBED') {
          setPageError((prev) => (prev?.startsWith('Live updates') ? null : prev))
        }
      }
    )
    return () => unsubscribe()
  }, [conversationId])

  // Keep the view pinned to the newest message unless the reader has scrolled
  // up into history.
  useLayoutEffect(() => {
    if (pinnedToBottomRef.current) {
      bottomAnchorRef.current?.scrollIntoView()
    }
  }, [messages])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    pinnedToBottomRef.current = distanceFromBottom < 80
    if (distanceFromBottom > 400 && hasOlder && !loadingOlder) {
      void loadOlder()
    }
  }

  async function loadOlder() {
    if (!conversationId || loadingOlder || messages.length === 0) return
    const el = scrollRef.current
    // Remember the viewport position so inserting a page above does not yank
    // the reader away from the message they were reading.
    const previousHeight = el?.scrollHeight ?? 0
    const previousTop = el?.scrollTop ?? 0
    setLoadingOlder(true)
    setOlderError(null)
    const oldest = messages[0]?.created_at
    const { data, error: olderErr } = await fetchMessages(conversationId, oldest)
    if (olderErr) {
      setOlderError(toFriendlyMessageError(olderErr, 'Could not load earlier messages.'))
    } else {
      const fresh = data.filter((m) => !seenMessageIdsRef.current.has(m.id))
      fresh.forEach((m) => seenMessageIdsRef.current.add(m.id))
      setMessages((prev) => [...fresh, ...prev])
      setHasOlder(data.length === MESSAGE_PAGE_SIZE)
      requestAnimationFrame(() => {
        const node = scrollRef.current
        if (node) node.scrollTop = previousTop + (node.scrollHeight - previousHeight)
      })
    }
    setLoadingOlder(false)
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || !conversationId || sending) return
    setSending(true)
    setSendError(null)
    setDraft('')
    const { error: sendErr } = await sendMessage(conversationId, body)
    if (sendErr) {
      setDraft(body) // restore so the user can retry without retyping
      setSendError(toFriendlyMessageError(sendErr, 'Your message could not be sent. Please try again.'))
    }
    setSending(false)
  }

  if (!conversationId || (pageError && !loading && !summary)) {
    return (
      <div className="mx-auto max-w-md md:max-w-2xl">
        <ErrorState message={pageError ?? 'Conversation not found.'} onRetry={() => navigate('/messages')} />
      </div>
    )
  }

  const headerName = summary?.other_full_name || 'Conversation'
  const subtitle = [summary?.other_job_title, summary?.other_company].filter(Boolean).join(' | ')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Compact chat header */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white py-2 pl-1 pr-2">
        <button
          onClick={() => navigate('/messages')}
          aria-label="Back to messages"
          className="rounded-full p-2 text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar name={headerName} src={summary?.other_photo_url} size="sm" className="h-9 w-9 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight text-gray-900">{headerName}</p>
          {subtitle && <p className="truncate text-xs leading-tight text-gray-500">{subtitle}</p>}
        </div>
        <button aria-label="Conversation options" className="rounded-full p-2 text-gray-500 hover:text-gray-700">
          <MoreVertical className="h-5 w-5" />
        </button>
      </div>

      {/* Subtle relationship context */}
      {summary?.event_name && (
        <p className="border-b border-gray-200 bg-white py-1.5 text-center text-xs text-gray-400">
          Met at {summary.event_name}
        </p>
      )}

      {/* Messages — the only scrollable region on this screen */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f1f2f4] px-3 py-3">
        {loading ? (
          <ChatSkeleton />
        ) : (
          <>
            {olderError && (
              <button
                onClick={() => void loadOlder()}
                className="mx-auto mb-2 block rounded-md bg-white px-3 py-1.5 text-xs text-gray-600 shadow-sm"
              >
                {olderError} Tap to retry.
              </button>
            )}
            {loadingOlder && (
              <div className="mb-2 flex justify-center">
                <Spinner size="sm" />
              </div>
            )}
            {hasOlder && !loadingOlder && !olderError && messages.length > 0 && (
              <button
                onClick={() => void loadOlder()}
                className="mx-auto mb-2 block text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                Load earlier messages
              </button>
            )}

            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                <p className="text-[15px] font-medium text-gray-700">Start the conversation</p>
                <p className="max-w-xs text-sm text-gray-400">
                  Say hello to {headerName}
                  {summary?.event_name ? ` from ${summary.event_name}` : ''} — your message begins the thread.
                </p>
              </div>
            ) : (
              <ul>
                {blocks.map(({ message: m, startsBlock, firstOfTheDay }) => (
                  <li key={m.id}>
                    {firstOfTheDay && (
                      <div className="flex justify-center py-2">
                        <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium text-gray-500 shadow-sm">
                          {formatDaySeparator(m.created_at)}
                        </span>
                      </div>
                    )}
                    <div className={cn('flex', m.is_mine ? 'justify-end' : 'justify-start', startsBlock ? 'mt-2' : 'mt-0.5')}>
                      <div
                        className={cn(
                          'max-w-[78%] px-3 py-1.5 shadow-sm',
                          m.is_mine
                            ? cn('rounded-2xl bg-primary-600 text-white', startsBlock ? 'rounded-br-md' : 'rounded-br-2xl')
                            : cn('rounded-2xl border border-gray-200 bg-white text-gray-900', startsBlock ? 'rounded-bl-md' : 'rounded-bl-2xl'),
                          m.pending && 'opacity-60'
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.body}</p>
                        <p
                          className={cn(
                            'mt-0.5 text-right text-[10.5px]',
                            m.is_mine ? 'text-primary-100' : 'text-gray-400'
                          )}
                        >
                          {formatMessageTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={bottomAnchorRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {sendError && <p className="px-3 pt-2 text-xs text-error-600">{sendError}</p>}
        <form onSubmit={handleSend} className="flex items-end gap-2 px-3 py-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault()
                void handleSend(e)
              }
            }}
            rows={1}
            aria-label="Type a message"
            placeholder="Type a message..."
            className="max-h-28 min-h-[40px] flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-primary-600 focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 enabled:bg-primary-600 enabled:hover:bg-primary-700"
          >
            {sending ? <Spinner size="sm" className="text-white" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  )
}
