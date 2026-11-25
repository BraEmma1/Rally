import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Label, Select } from '@/components/ui/Input'
import type { PartnershipPackage } from '@/lib/partnershipPackages'
import { deliverablesPhrase } from '@/lib/packageSelection'
import { formatMoney } from './PartnerCommon'

// ---------------------------------------------------------------------------
// The Package dropdown in Add Partner, and the confirmation that guards it.
//
// Presentational only: Add Partner decides what a choice does (prefill, ask
// first, keep), and this renders it. The options are the event's ACTIVE
// packages, which the wizard loads for this event alone; archived packages
// and other events' packages are never in the list.
// ---------------------------------------------------------------------------

export const CUSTOM = 'custom'

export type PackageChoice = { kind: 'custom' } | { kind: 'package'; id: string; name: string }

export function PackagePicker({
  packages,
  loadError,
  onRetryLoad,
  choice,
  busy,
  status,
  canClear,
  onChoose,
  onClear,
}: {
  /** Active packages of this event, or null while they load. */
  packages: PartnershipPackage[] | null
  loadError: string | null
  onRetryLoad: () => void
  choice: PackageChoice
  /** A chosen package is being read. */
  busy: boolean
  /** What the last choice did, announced politely. */
  status: string
  /** Custom partnership with terms on screen: offer to clear them. */
  canClear: boolean
  onChoose: (value: string) => void
  onClear: () => void
}) {
  // A package chosen earlier and archived or removed since stays visible as
  // the current choice instead of silently turning into another option.
  const chosenMissing =
    choice.kind === 'package' && packages !== null && !packages.some((p) => p.id === choice.id)

  const hint =
    packages === null
      ? 'Loading this event’s packages…'
      : packages.length === 0
        ? 'This event has no packages yet. Continue with a custom partnership, or set packages up under Partners → Packages.'
        : 'A package fills in the tier label, value and deliverables. You can change any of them for this partner.'

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor="pt-package">Package</Label>
        <Select
          id="pt-package"
          value={choice.kind === 'package' ? choice.id : CUSTOM}
          onChange={(e) => onChoose(e.target.value)}
          // Not `disabled` while a package loads: a disabled control drops
          // keyboard focus to the page. Add Partner ignores a change made
          // during a load instead, and the controlled value snaps back.
          aria-describedby="pt-package-hint"
          aria-busy={busy || undefined}
        >
          <option value={CUSTOM}>Custom partnership</option>
          {(packages ?? []).map((p) => {
            const money = formatMoney(p.value_amount, p.value_currency)
            return (
              <option key={p.id} value={p.id}>
                {p.name + (money ? ' · ' + money : '') + ' · ' + deliverablesPhrase(p.deliverable_count)}
              </option>
            )
          })}
          {chosenMissing && choice.kind === 'package' && (
            <option value={choice.id} disabled>
              {choice.name + ' (no longer available)'}
            </option>
          )}
        </Select>
        <p id="pt-package-hint" className="mt-1 text-xs text-gray-500">
          {hint}
        </p>
      </div>

      {loadError && (
        <div className="rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-800" role="alert">
          {loadError} You can still add a custom partnership.{' '}
          <button type="button" onClick={onRetryLoad} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      <p className="text-sm text-gray-600" role="status" aria-live="polite" data-testid="package-status">
        {busy ? 'Loading the package…' : status}
      </p>

      {canClear && (
        <Button type="button" variant="ghost" size="sm" onClick={onClear} className="-ml-2 min-h-11">
          Clear tier, value and deliverables
        </Button>
      )}
    </div>
  )
}

/**
 * "Replace your changes?" / "Clear these terms?". A small modal of its own
 * rather than the shared ConfirmDialog, because this one must take focus (the
 * keyboard user is on the dropdown behind it) and give it back on close.
 * Escape is handled by Add Partner, which dismisses this before the wizard.
 */
export function TermsConfirmDialog({
  title,
  body,
  keepLabel,
  actionLabel,
  onKeep,
  onConfirm,
  returnFocusTo,
}: {
  title: string
  body: string
  keepLabel: string
  actionLabel: string
  onKeep: () => void
  onConfirm: () => void
  /**
   * Where focus goes on close when the control that had it is gone (Clear
   * removes its own button). Otherwise focus returns to that control.
   */
  returnFocusTo?: string
}) {
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    keepRef.current?.focus()
    return () => {
      if (previous && previous !== document.body && document.contains(previous)) {
        previous.focus()
        return
      }
      const fallback = returnFocusTo ? document.getElementById(returnFocusTo) : null
      fallback?.focus()
    }
  }, [returnFocusTo])

  return (
    <div className="fixed inset-0 z-[60]" role="alertdialog" aria-modal="true" aria-labelledby="terms-confirm-title" aria-describedby="terms-confirm-body">
      <button className="absolute inset-0 bg-gray-900/50" aria-hidden="true" tabIndex={-1} onClick={onKeep} />
      <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl md:left-1/2 md:right-auto md:w-[26rem] md:-translate-x-1/2">
        <h3 id="terms-confirm-title" className="text-base font-bold text-gray-900">
          {title}
        </h3>
        <p id="terms-confirm-body" className="mt-2 text-sm leading-relaxed text-gray-600">
          {body}
        </p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={keepRef} variant="secondary" onClick={onKeep} className="min-h-11">
            {keepLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} className="min-h-11">
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
