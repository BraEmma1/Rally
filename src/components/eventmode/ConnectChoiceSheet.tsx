import { useEffect } from 'react'
import { ScanLine, Send, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'

// Shown when you tap Connect on a person in the attendee directory: two ways in.
// Scan QR code is the existing flow (camera / manual lookup, connects straight
// away). Send a request asks the person first; they accept and then you are both
// connected.
export default function ConnectChoiceSheet({
  open,
  name,
  photo,
  sending,
  error,
  onScan,
  onSendRequest,
  onClose,
}: {
  open: boolean
  name: string
  photo: string
  sending: boolean
  error: string | null
  onScan: () => void
  onSendRequest: () => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  const option =
    'flex min-h-[72px] w-full items-center gap-3 rounded-xl border border-rally-line bg-white px-4 py-3 text-left transition-colors hover:border-primary-300 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Connect with ${name}`}>
      <button className="absolute inset-0 bg-rally-ink/60" aria-label="Close" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-float md:bottom-auto md:left-1/2 md:top-1/2 md:w-[26rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 md:hidden" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <Avatar name={name || '?'} src={photo} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Connect with</p>
            <h2 className="truncate font-display text-lg font-bold text-rally-navy">{name || 'this person'}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-2.5">
          <button onClick={onScan} className={option} disabled={sending}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
              <ScanLine className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-rally-navy">Scan QR code</span>
              <span className="block text-xs text-slate-500">Scan their pass or badge to connect right now</span>
            </span>
          </button>
          <button onClick={onSendRequest} className={option} disabled={sending}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rally-tint text-primary-700">
              <Send className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-rally-navy">{sending ? 'Sending…' : 'Send a request'}</span>
              <span className="block text-xs text-slate-500">They get a request. When they accept, you are connected.</span>
            </span>
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
