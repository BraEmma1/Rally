import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

// The scan-result dialog for the check-in desk. One component, three states:
// success (green check, who arrived and when), already (they were here at a
// known time), and not-registered (no registration exists).
//
// Keyboard contract: Escape closes, Tab stays inside, focus lands on the
// primary action when the dialog opens and returns to the page when it closes.
// Success also focuses the dialog itself so screen readers announce the whole
// result rather than just the first button.
export type CheckInOutcome =
  | { kind: 'success'; name: string; company?: string; checkedInAt: string }
  | { kind: 'already'; name: string; company?: string; checkedInAt: string }
  | { kind: 'not-registered' }

interface CheckInConfirmationProps {
  outcome: CheckInOutcome | null
  onClose: () => void
  onContinueScanning: () => void
}

export function CheckInConfirmation({ outcome, onClose, onContinueScanning }: CheckInConfirmationProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!outcome) return

    // The primary action depends on the state; put focus where the eye is
    // already looking. For success that is the Continue Scanning button, which
    // also keeps a run of scans two keystrokes apart (Enter to confirm,
    // Enter to scan again).
    const focusTarget =
      outcome.kind === 'success'
        ? dialogRef.current?.querySelector<HTMLButtonElement>('[data-primary]')
        : dialogRef.current?.querySelector<HTMLButtonElement>('[data-secondary]')
    focusTarget?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [outcome, onClose])

  if (!outcome) return null

  const success = outcome.kind === 'success'
  const already = outcome.kind === 'already'

  const tone = success
    ? { ring: 'ring-accent-100', chip: 'bg-accent-50 text-accent-800' }
    : already
      ? { ring: 'ring-warning-100', chip: 'bg-warning-50 text-warning-800' }
      : { ring: 'ring-error-100', chip: 'bg-error-50 text-error-800' }

  return (
    <div
      className="animate-checkin-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="checkin-confirmation-heading"
        className={cn(
          'animate-checkin-modal relative w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl ring-4',
          tone.ring
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>

        {success ? (
          <div className="animate-checkin-check mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent-600 shadow-lg shadow-accent-600/30">
            <svg
              viewBox="0 0 32 32"
              fill="none"
              className="h-10 w-10"
              aria-hidden="true"
            >
              <path
                d="M8 16.5 13.5 22 24 10.5"
                stroke="white"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-checkin-check-draw"
              />
            </svg>
          </div>
        ) : already ? (
          <div className="animate-checkin-check mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-warning-100">
            <AlertTriangle className="h-9 w-9 text-warning-600" aria-hidden="true" />
          </div>
        ) : (
          <div className="animate-checkin-check mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-error-100">
            <svg viewBox="0 0 32 32" fill="none" className="h-9 w-9" aria-hidden="true">
              <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2.5" className="text-error-400" />
              <path d="M11 11l10 10M21 11L11 21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-error-500" />
            </svg>
          </div>
        )}

        <h2 id="checkin-confirmation-heading" className="mt-4 text-lg font-bold text-gray-900">
          {success ? 'Check-in Successful' : already ? 'Already Checked In' : 'Not Registered'}
        </h2>

        {'name' in outcome && outcome.name ? (
          <>
            <p className="mt-1 text-xl font-semibold text-gray-900">{outcome.name}</p>
            {outcome.company && <p className="text-sm text-gray-500">{outcome.company}</p>}
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-600">
            This person is not registered for this event. No registration was created or changed.
          </p>
        )}

        {'checkedInAt' in outcome && (
          <p className={cn('mt-3 inline-block rounded-full px-3 py-1 text-sm font-medium', tone.chip)}>
            {already ? 'Originally checked in at ' : 'Checked in at '}
            {formatTime(outcome.checkedInAt)}
          </p>
        )}

        <div className="mt-5 grid gap-2">
          {success ? (
            <>
              <Button data-primary onClick={onContinueScanning} size="lg">
                Continue Scanning
              </Button>
              <Button data-secondary variant="secondary" onClick={onClose}>
                Done
              </Button>
            </>
          ) : (
            <Button data-secondary onClick={onClose} size="lg">
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
