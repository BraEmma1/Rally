import { useEffect, useRef, useState } from 'react'
import { Ban, Check, CheckCheck, ChevronDown, Reply, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/lib/messages'

// One chat bubble. Reply is a swipe to the right (any bubble, like WhatsApp);
// the same actions are also reachable without a gesture — long-press on touch,
// right-click, or the small button that appears on hover/focus — so nothing
// depends on swiping.
const SWIPE_TRIGGER_PX = 56
const SWIPE_MAX_PX = 72
const LONG_PRESS_MS = 450
const MOVE_SLOP_PX = 8

function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function MessageBubble({
  message,
  startsBlock,
  read,
  otherName,
  highlighted,
  onReply,
  onDelete,
  onJumpTo,
}: {
  message: ChatMessage
  startsBlock: boolean
  read: boolean
  otherName: string
  highlighted: boolean
  onReply: (message: ChatMessage) => void
  onDelete: (message: ChatMessage) => void
  onJumpTo: (messageId: string) => void
}) {
  const m = message
  const deleted = !!m.deleted_at
  const [offset, setOffset] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

  // Gesture bookkeeping lives in a ref: it changes on every pointer move and
  // must not re-render the whole thread.
  const gesture = useRef<{
    x: number
    y: number
    axis: 'unknown' | 'horizontal' | 'vertical'
    timer?: number
    longPressed: boolean
  } | null>(null)

  function clearTimer() {
    if (gesture.current?.timer) window.clearTimeout(gesture.current.timer)
  }
  useEffect(() => () => clearTimer(), [])

  function onPointerDown(e: React.PointerEvent) {
    if (deleted || (e.pointerType === 'mouse' && e.button !== 0)) return
    // Never start a gesture from the action buttons inside the bubble.
    if ((e.target as HTMLElement).closest('button')) return
    gesture.current = { x: e.clientX, y: e.clientY, axis: 'unknown', longPressed: false }
    if (e.pointerType === 'touch') {
      gesture.current.timer = window.setTimeout(() => {
        if (!gesture.current) return
        gesture.current.longPressed = true
        setOffset(0)
        setMenuOpen(true)
      }, LONG_PRESS_MS)
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g || g.longPressed) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (g.axis === 'unknown') {
      if (Math.abs(dx) < MOVE_SLOP_PX && Math.abs(dy) < MOVE_SLOP_PX) return
      clearTimer()
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      if (g.axis === 'horizontal') (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    }
    if (g.axis !== 'horizontal') return
    // Rightwards only, with the pull getting heavier the further it goes.
    const pull = Math.max(0, dx)
    setOffset(Math.min(SWIPE_MAX_PX, pull * 0.6))
  }

  function endGesture(e: React.PointerEvent) {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    clearTimer()
    if (g.axis === 'horizontal' && e.type === 'pointerup' && offset >= SWIPE_TRIGGER_PX * 0.6) {
      onReply(m)
    }
    setOffset(0)
  }

  const quoted = m.reply_to_id != null
  const quoteText = m.reply_to_deleted
    ? 'Message deleted'
    : (m.reply_to_body ?? 'Original message')
  const quoteName = m.reply_to_sender_id
    ? m.reply_to_sender_id === m.sender_id
      ? m.is_mine
        ? 'You'
        : otherName
      : m.is_mine
        ? otherName
        : 'You'
    : ''

  return (
    <div
      id={`msg-${m.id}`}
      className={cn(
        'group relative flex items-center',
        m.is_mine ? 'justify-end' : 'justify-start',
        startsBlock ? 'mt-2' : 'mt-0.5'
      )}
    >
      {/* Revealed behind the bubble as it is dragged */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-primary-600 shadow-sm"
        style={{ opacity: Math.min(1, offset / (SWIPE_TRIGGER_PX * 0.6)) }}
      >
        <Reply className="h-4 w-4" />
      </span>

      <div
        className={cn('flex max-w-[78%] items-center gap-1', m.is_mine && 'flex-row-reverse')}
        // touch-action keeps vertical scrolling native; only horizontal drags are ours.
        style={{
          touchAction: 'pan-y',
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: offset ? undefined : 'transform 150ms ease-out',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onContextMenu={(e) => {
          if (deleted) return
          e.preventDefault()
          setMenuOpen(true)
        }}
      >
        <div
          className={cn(
            'min-w-0 px-3 py-1.5 shadow-sm transition-shadow',
            deleted
              ? 'rounded-2xl border border-dashed border-gray-300 bg-white/60 text-gray-500'
              : m.is_mine
                ? cn('rounded-2xl bg-primary-600 text-white', startsBlock ? 'rounded-br-md' : 'rounded-br-2xl')
                : cn('rounded-2xl border border-gray-200 bg-white text-gray-900', startsBlock ? 'rounded-bl-md' : 'rounded-bl-2xl'),
            m.pending && 'opacity-60',
            highlighted && 'ring-2 ring-primary-400 ring-offset-2 ring-offset-rally-canvas'
          )}
        >
          {deleted ? (
            <p className="flex items-center gap-1.5 text-[14px] italic leading-snug">
              <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {m.is_mine ? 'You deleted this message' : 'This message was deleted'}
            </p>
          ) : (
            <>
              {quoted && (
                <button
                  type="button"
                  onClick={() => m.reply_to_id && onJumpTo(m.reply_to_id)}
                  aria-label={`Replying to ${quoteName || 'a message'}: ${quoteText}`}
                  className={cn(
                    'mb-1 block w-full rounded-lg border-l-4 px-2 py-1 text-left text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                    m.is_mine ? 'border-white/70 bg-white/15 text-primary-50' : 'border-primary-500 bg-primary-50 text-gray-600'
                  )}
                >
                  {quoteName && (
                    <span className={cn('block font-semibold', m.is_mine ? 'text-white' : 'text-primary-700')}>
                      {quoteName}
                    </span>
                  )}
                  <span className={cn('line-clamp-2 break-words', m.reply_to_deleted && 'italic')}>{quoteText}</span>
                </button>
              )}
              <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.body}</p>
            </>
          )}
          <p
            className={cn(
              'mt-0.5 flex items-center justify-end gap-1 text-[10.5px]',
              deleted ? 'text-gray-400' : m.is_mine ? 'text-primary-100' : 'text-gray-400'
            )}
          >
            {formatMessageTime(m.created_at)}
            {m.is_mine &&
              !deleted &&
              (read ? (
                <CheckCheck className="h-3.5 w-3.5" aria-label="Read" />
              ) : (
                <Check className="h-3.5 w-3.5" aria-label="Sent" />
              ))}
          </p>
        </div>

        {!deleted && (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Message options"
            aria-haspopup="dialog"
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 opacity-0 transition-opacity hover:bg-white hover:text-gray-600 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 group-hover:opacity-100 md:flex"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {menuOpen && (
        <MessageActions
          message={m}
          onClose={() => setMenuOpen(false)}
          onReply={() => {
            setMenuOpen(false)
            onReply(m)
          }}
          onDelete={() => {
            setMenuOpen(false)
            onDelete(m)
          }}
        />
      )}
    </div>
  )
}

// Bottom sheet on phones, centred card on larger screens. Delete asks once more
// because it cannot be undone and removes the message for the other person too.
function MessageActions({
  message,
  onClose,
  onReply,
  onDelete,
}: {
  message: ChatMessage
  onClose: () => void
  onReply: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const firstRef = useRef<HTMLButtonElement>(null)
  // The parent passes a fresh onClose every render (a new message arriving
  // re-renders it); reading it through a ref keeps focus from being pulled back
  // to the first button each time.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    firstRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  const row =
    'flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium focus:outline-none focus-visible:bg-rally-tint'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="presentation">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={confirming ? 'Delete message' : 'Message options'}
        className="relative w-full max-w-sm overflow-hidden rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl md:rounded-2xl"
      >
        {confirming ? (
          <div className="p-4">
            <p className="font-display text-base font-semibold text-rally-navy">Delete this message?</p>
            <p className="mt-1 text-sm text-gray-500">It will be removed for everyone in this conversation. This can’t be undone.</p>
            <div className="mt-4 flex gap-2">
              <button
                ref={firstRef}
                type="button"
                onClick={onClose}
                className="min-h-[44px] flex-1 rounded-xl border border-rally-line text-sm font-semibold text-gray-700 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="min-h-[44px] flex-1 rounded-xl bg-error-600 text-sm font-semibold text-white hover:bg-error-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-error-600 focus-visible:ring-offset-2"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="py-1">
            <button ref={firstRef} type="button" onClick={onReply} className={cn(row, 'text-gray-800 hover:bg-rally-tint')}>
              <Reply className="h-5 w-5 text-gray-500" aria-hidden="true" /> Reply
            </button>
            {message.is_mine && (
              <button type="button" onClick={() => setConfirming(true)} className={cn(row, 'text-error-600 hover:bg-error-50')}>
                <Trash2 className="h-5 w-5" aria-hidden="true" /> Delete for everyone
              </button>
            )}
            <button type="button" onClick={onClose} className={cn(row, 'justify-center text-gray-500 hover:bg-rally-tint md:hidden')}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
