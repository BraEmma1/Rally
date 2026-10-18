import { Building2, Info } from 'lucide-react'
import { cn, normalizeUrl } from '@/lib/utils'

// Square logo with an initial fallback. Only http(s) URLs are rendered; the
// database enforces that too, but an image src is not the place to trust it.
export function OrgLogo({ name, src, size = 'md' }: { name: string; src: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const url = normalizeUrl(src)
  const box = size === 'lg' ? 'h-16 w-16 text-xl' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden="true"
        className={cn('shrink-0 rounded-md border border-gray-200 bg-white object-contain', box)}
      />
    )
  }
  const initial = name.trim().charAt(0).toUpperCase()
  return (
    <div
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center rounded-md bg-primary-50 font-semibold text-primary-700', box)}
    >
      {initial || <Building2 className="h-4 w-4" />}
    </div>
  )
}

// Approval status is displayed but not yet actionable: no secure function can
// change it, and nothing in Rally enforces it today.
export function ApprovalControlsNotice() {
  return (
    <div className="flex gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      <p>
        <span className="font-medium text-gray-800">Approval controls are not available yet.</span> Approving,
        rejecting and suspending organizations becomes available once the dedicated approval backend is in place.
        Until then the status is shown for reference, and it does not restrict what an organization can do.
      </p>
    </div>
  )
}
