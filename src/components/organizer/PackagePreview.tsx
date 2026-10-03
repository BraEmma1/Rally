import { Check } from 'lucide-react'
import { formatMoney } from './PartnerCommon'
import type { PackageDeliverable, PartnershipPackage } from '@/lib/partnerships'

/**
 * What a package brings, shown before anything is written.
 *
 * Read-only on purpose. The organizer customises these as ordinary
 * partnership deliverables once the partner exists, using the editor they
 * already know — letting them be edited here would mean either diverging from
 * the template silently, or writing obligation rows while the form is still
 * being filled in.
 */
export function PackagePreview({
  pkg,
  deliverables,
  loading,
}: {
  pkg: PartnershipPackage
  deliverables: PackageDeliverable[]
  loading: boolean
}) {
  const money = formatMoney(pkg.value_amount, pkg.value_currency)
  // Organizers name packages both ways -- "Gold" and "Media Partner Package"
  // -- and "Media Partner Package package" reads like a bug.
  const heading = /package/i.test(pkg.name) ? pkg.name : pkg.name + ' package'

  return (
    <div className="mb-4 rounded-md border border-primary-200 bg-primary-50 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-primary-900">{heading}</p>
        {money && <p className="text-sm font-medium tabular-nums text-primary-900">{money}</p>}
      </div>

      {loading ? (
        <p className="mt-1 text-xs text-primary-800">Loading its deliverables…</p>
      ) : deliverables.length === 0 ? (
        <p className="mt-1 text-xs text-primary-800">
          This package has no default deliverables. It still fills in the tier and the value.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-primary-800">
            Includes {deliverables.length}{' '}
            {deliverables.length === 1 ? 'default deliverable' : 'default deliverables'}:
          </p>
          <ul className="mt-2 space-y-1">
            {deliverables.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm text-primary-900">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  {item.title}
                  {item.quantity !== null && (
                    <span className="text-primary-700"> ×{item.quantity}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-primary-800">
            You can customize these deliverables for this partner once it is created.
          </p>
        </>
      )}
    </div>
  )
}
