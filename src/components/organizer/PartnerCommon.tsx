import { Badge } from '@/components/ui/Badge'
import { initials, normalizeUrl } from '@/lib/utils'
import {
  OBLIGATION_STATUS_BADGE,
  OBLIGATION_STATUS_LABELS,
  ROLE_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  type ObligationStatus,
  type PartnershipRole,
  type PartnershipStatus,
} from '@/lib/partnerships'

// Small presentational pieces shared by the Partners list, the Add/Edit
// dialogs and Partner Detail.
//
// Deliberately NOT ExhibitorLogo from EventExhibitorsPanel, even though the
// markup would be similar: that module is the public attendee directory, and
// the private partnership workspace should not grow an import into it. Phase 1
// kept the two systems unrelated on purpose.

export function PartnerLogo({
  name,
  logoUrl,
  size = 'md',
}: {
  name: string
  logoUrl: string | null | undefined
  size?: 'sm' | 'md' | 'lg'
}) {
  const box = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name + ' logo'}
        className={box + ' shrink-0 rounded-md border border-gray-200 bg-white object-contain'}
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className={
        box +
        ' flex shrink-0 items-center justify-center rounded-md bg-primary-50 text-sm font-semibold text-primary-700'
      }
    >
      {initials(name)}
    </div>
  )
}

/**
 * A link a person actually meant to type.
 *
 * `normalizeUrl` rejects javascript: and friends, which is the part that
 * matters for safety, but it is otherwise permissive: it turns "not a url"
 * into https://not%20a%20url/ and "notaurl" into https://notaurl/. Both pass
 * the database's `~* '^https?://'` check and both are nonsense, so the
 * hostname has to look like a domain as well. A bare "acme.com" still works
 * and still becomes https://acme.com/.
 */
export function safeWebUrl(raw: string): string | null {
  const normalized = normalizeUrl(raw)
  if (!normalized) return null
  try {
    const host = new URL(normalized).hostname
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(host) ? normalized : null
  } catch {
    return null
  }
}

/** Status always carries its own label, so colour is never the only signal. */
export function PartnerStatusBadge({ status }: { status: PartnershipStatus }) {
  return <Badge variant={STATUS_BADGE[status]}>{STATUS_LABELS[status]}</Badge>
}

export function ObligationStatusBadge({ status }: { status: ObligationStatus }) {
  return <Badge variant={OBLIGATION_STATUS_BADGE[status]}>{OBLIGATION_STATUS_LABELS[status]}</Badge>
}

/** "Sponsor · Exhibitor". Empty string when a partnership has no roles yet. */
export function rolesLabel(roles: PartnershipRole[]): string {
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(' · ')
}

/**
 * "GHS 50,000". The currency is whatever the organizer recorded, printed as
 * the code rather than a symbol: Rally does not know the locale of a
 * commercial agreement and guessing one would misrepresent the amount.
 */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined
): string | null {
  if (amount === null || amount === undefined) return null
  // A whole amount prints whole; a fractional one prints both places, so
  // 12500.5 reads as 12,500.50 rather than 12,500.5.
  const fractionDigits = Number.isInteger(amount) ? 0 : 2
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
  return currency ? currency + ' ' + formatted : formatted
}

/**
 * A DATE column holds a calendar day, not an instant. `new Date('2026-03-01')`
 * is parsed as UTC midnight, which renders as the previous day anywhere west of
 * Greenwich -- so the parts are read out and a local date is built instead.
 */
export function formatDueDate(value: string | null | undefined): string | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** True when a due date is in the past and the item is not done yet. */
export function isOverdue(dueDate: string | null, status: ObligationStatus): boolean {
  if (!dueDate || status === 'completed') return false
  const [year, month, day] = dueDate.split('-').map(Number)
  if (!year || !month || !day) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(year, month - 1, day).getTime() < today.getTime()
}

/**
 * Counts first, bar second. The number is the information; the bar is there to
 * be glanceable down a column. No chart: "3 of 6" does not need one.
 */
export function ProgressMeter({
  label,
  completed,
  total,
  className,
}: {
  label: string
  completed: number
  total: number
  className?: string
}) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0
  const done = total > 0 && completed === total
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-xs font-medium tabular-nums text-gray-700">
          {completed} / {total}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label + ': ' + completed + ' of ' + total + ' complete'}
      >
        <div
          className={(done ? 'bg-accent-600' : 'bg-primary-600') + ' h-full rounded-full'}
          style={{ width: percent + '%' }}
        />
      </div>
    </div>
  )
}

/** The read-only notice an archived event shows above every partners screen. */
export function ArchivedNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
      role="status"
    >
      {children ??
        'This event is archived, so its partners are read-only. Restore the event to make changes.'}
    </div>
  )
}
