import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

// Every dialog currently on screen, oldest first. Dialogs nest -- the Add
// Partner wizard opens an obligation dialog on top of itself -- and without a
// stack two things go wrong: closing the inner one unlocks body scrolling
// while the outer is still open, and one Escape closes both because both
// listeners are on `document`. The stack makes the lock a reference count and
// gives Escape to the topmost dialog only.
const openDialogs: symbol[] = []

// Bottom sheet on mobile, centered dialog on desktop — the same shell the
// session form and session detail use, extracted here because the speaker
// screens need several of them.
export function SheetDialog({
  title,
  subtitle,
  onClose,
  busy,
  wide,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  busy?: boolean
  /** A wider desktop panel for multi-step content. Mobile is unchanged. */
  wide?: boolean
  children: React.ReactNode
}) {
  // One token per mounted dialog, created once so re-renders do not reshuffle
  // the stack and hand Escape to the wrong dialog.
  const token = useRef<symbol>()
  if (!token.current) token.current = Symbol('dialog')

  useEffect(() => {
    const self = token.current as symbol
    openDialogs.push(self)
    document.body.style.overflow = 'hidden'
    return () => {
      const at = openDialogs.indexOf(self)
      if (at !== -1) openDialogs.splice(at, 1)
      if (openDialogs.length === 0) document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy) return
      if (openDialogs[openDialogs.length - 1] !== token.current) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, busy])

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={busy ? undefined : onClose} />
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
          wide ? 'md:w-[46rem]' : 'md:w-[36rem]'
        )}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 md:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-snug text-gray-900">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-gray-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={cn('mt-4 border-t border-gray-200 pt-4')}>{children}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  body,
  action,
  busy,
  onConfirm,
  onClose,
}: {
  title: string
  body: string
  action: string
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={onClose} />
      <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl md:left-1/2 md:right-auto md:w-96 md:-translate-x-1/2">
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : action}
          </Button>
        </div>
      </div>
    </div>
  )
}
