import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Label, Textarea } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/States'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export const REASON_MAX = 500

// Confirmation for an administrative change. An alertdialog: focus moves into
// it, Tab stays inside it, Escape cancels (unless a change is in flight), and
// focus returns to whatever opened it. The reason is optional and lands in the
// audit log verbatim.
export function AdminConfirmDialog({
  title,
  children,
  confirmLabel,
  tone,
  reason,
  onReasonChange,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  tone: 'primary' | 'danger'
  reason: string
  onReasonChange: (value: string) => void
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const bodyId = useId()
  const reasonId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    reasonRef.current?.focus()
    return () => {
      document.body.style.overflow = ''
      // The opener may be gone (a review sheet that handed over to this
      // dialog); only return focus to something still on the page.
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!busy) onCancel()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={busy ? undefined : onCancel} />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="relative w-full max-w-md rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-gray-900">
          {title}
        </h2>
        <div id={bodyId} className="mt-2 space-y-2 text-sm leading-relaxed text-gray-600">
          {children}
        </div>

        <div className="mt-4">
          <Label htmlFor={reasonId}>Reason (optional)</Label>
          <Textarea
            ref={reasonRef}
            id={reasonId}
            rows={3}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            disabled={busy}
            placeholder="Recorded in the audit log"
          />
          <p className="mt-1 text-right text-xs text-gray-400">
            {reason.length}/{REASON_MAX}
          </p>
        </div>

        {error && (
          <div role="alert" className="mt-3 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">
            {error}
          </div>
        )}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner size="sm" className="text-white" />}
            {busy ? 'Saving…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
