import { CheckCircle2, X } from 'lucide-react'

// Page-level success feedback after an administrative change. Failures stay in
// the dialog that caused them, next to the action that can be retried.
export function AdminNotice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  return (
    <div role="status" aria-live="polite">
      {message && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="flex-1">{message}</p>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded p-0.5 text-accent-700 hover:bg-accent-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
