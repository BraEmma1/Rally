import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { Spinner, LoadingState, ErrorState } from '@/components/ui/States'
import { cn } from '@/lib/utils'

function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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

  return (
    <div className="mx-auto flex h-[calc(100dvh-3rem)] max-w-md flex-col md:h-[calc(100dvh-4rem)] md:max-w-2xl md:px-2">
      {/* Header */}
      <div className="relative flex items-center justify-between border-b border-gray-100 py-2">
        <button
          onClick={() => navigate('/messages')}
          aria-label="Back to messages"
          className="-ml-2 rounded-full p-2 text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="max-w-[60%] truncate text-base font-semibold text-gray-900">{headerName}</span>
        <button aria-label="Conversation options" className="-mr-2 rounded-full p-2 text-gray-500 hover:text-gray-700">
          <MoreVertical className="h-5 w-5" />
        </button>
      </div>

      {/* Compact relationship context */}
      {summary && (
        <div className="flex flex-col items-center gap-1 border-b border-gray-100 py-3">
          <Avatar name={summary.other_full_name} src={summary.other_photo_url} size="md" className="h-11 w-11" />
          <p className="mt-1 max-w-full truncate text-sm font-semibold text-gray-900">{summary.other_full_name}</p>
          {(summary.other_job_title || summary.other_company) && (
            <p className="max-w-full truncate text-xs text-gray-500">
              {[summary.other_job_title, summary.other_company].filter(Boolean).join(' | ')}
            </p>
          )}
          {summary.event_name && (
            <p className="text-xs text-gray-400">Met at {summary.event_name}</p>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3">
        {loading ? (
          <LoadingState message="Loading messages…" />
        ) : (
          <>
            {olderError && (
              <button
                onClick={() => void loadOlder()}
                className="mx-auto mb-2 block rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
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
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                <p className="text-sm font-medium text-gray-700">No messages yet</p>
                <p className="max-w-xs text-sm text-gray-400">Say hello — your message starts the conversation.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {messages.map((m) => (
                  <li key={m.id} className={cn('flex', m.is_mine ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[78%] rounded-2xl px-3.5 py-2',
                        m.is_mine ? 'bg-primary-600 text-white' : 'bg-white text-gray-900 border border-gray-200',
                        m.pending && 'opacity-60'
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.body}</p>
                      <p className={cn('mt-0.5 text-right text-[11px]', m.is_mine ? 'text-primary-100' : 'text-gray-400')}>
                        {formatMessageTime(m.created_at)}
                      </p>
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
      <div className="border-t border-gray-100 bg-white pb-[env(safe-area-inset-bottom)]">
        {sendError && <p className="px-3 pt-2 text-xs text-error-600">{sendError}</p>}
        <form onSubmit={handleSend} className="flex items-end gap-2 px-3 py-2.5">
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
            className="max-h-32 min-h-[42px] flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-primary-600 focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-primary-600 text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? <Spinner size="sm" className="text-white" /> : <Send className="h-4.5 w-4.5" />}
          </button>
        </form>
      </div>
    </div>
  )
}
