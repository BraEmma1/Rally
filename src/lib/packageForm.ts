import type { PackageInput, PartnershipPackage } from './partnershipPackages'

// ---------------------------------------------------------------------------
// The package form, without React or Supabase, so it can be unit tested.
//
// The rules mirror the CHECK constraints and trigger of migration
// 20261007000000 (phase 5A) so the screen says what is wrong before the
// database refuses it. The database still decides.
//
// One rule is stricter than the table on purpose: a suggested value needs both
// an amount and a currency, or neither. The table accepts either alone, but
// apply_partnership_package copies the two together into a partnership, and
// the partnership form (validatePartnershipStep) refuses an amount without a
// currency. A package that could only produce a partnership the organizer then
// cannot save would be a trap.
// ---------------------------------------------------------------------------

export const PACKAGE_NAME_MAX = 80
export const PACKAGE_DESCRIPTION_MAX = 4000

export type PackageFormValues = {
  name: string
  description: string
  value_amount: string
  value_currency: string
}

export const EMPTY_PACKAGE_VALUES: PackageFormValues = {
  name: '',
  description: '',
  value_amount: '',
  value_currency: '',
}

export function packageValuesFrom(
  pkg: Pick<PartnershipPackage, 'name' | 'description' | 'value_amount' | 'value_currency'>
): PackageFormValues {
  return {
    name: pkg.name,
    description: pkg.description ?? '',
    value_amount: pkg.value_amount === null ? '' : String(pkg.value_amount),
    value_currency: pkg.value_currency ?? '',
  }
}

/**
 * Form values to the row shape. Blanks become NULL, and the trigger's own
 * normalizing (trimmed name, upper-case currency) is done here too, so what the
 * screen shows after saving is what was stored.
 */
export function packageInputFrom(values: PackageFormValues): PackageInput {
  const amount = values.value_amount.trim()
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    value_amount: amount ? Number(amount) : null,
    value_currency: values.value_currency.trim().toUpperCase() || null,
  }
}

export function validatePackage(values: PackageFormValues): string | null {
  const name = values.name.trim()
  if (!name) return 'Give this package a name, such as Gold or Headline Sponsor.'
  if (name.length > PACKAGE_NAME_MAX) {
    return 'Package names can be up to ' + PACKAGE_NAME_MAX + ' characters.'
  }
  if (values.description.trim().length > PACKAGE_DESCRIPTION_MAX) {
    return 'The description can be up to ' + PACKAGE_DESCRIPTION_MAX + ' characters.'
  }
  const amount = values.value_amount.trim()
  const currency = values.value_currency.trim()
  if (amount) {
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 'The suggested value must be a number that is not negative.'
    }
    if (!currency) return 'Add the currency for this amount, such as GHS or USD.'
  }
  if (currency && !/^[A-Za-z]{3}$/.test(currency)) {
    return 'Use a three-letter currency code, such as GHS, USD, EUR or GBP.'
  }
  if (currency && !amount) return 'Add the amount this currency applies to.'
  return null
}

/** True when the form differs from what is saved, after normalizing both. */
export function packageFormChanged(saved: PackageFormValues, current: PackageFormValues): boolean {
  const a = packageInputFrom(saved)
  const b = packageInputFrom(current)
  return (
    a.name !== b.name ||
    a.description !== b.description ||
    a.value_amount !== b.value_amount ||
    a.value_currency !== b.value_currency
  )
}

/** Active packages in their saved order, then archived ones. */
export function splitPackages<T extends Pick<PartnershipPackage, 'archived_at'>>(
  packages: T[]
): { active: T[]; archived: T[] } {
  return {
    active: packages.filter((p) => p.archived_at === null),
    archived: packages.filter((p) => p.archived_at !== null),
  }
}

/**
 * The delete trigger refuses to remove a package any partnership was created
 * from, so the screen only offers Delete when nothing used it.
 */
export function packageCanBeDeleted(pkg: Pick<PartnershipPackage, 'partnership_count'>): boolean {
  return pkg.partnership_count === 0
}

/** The position for a new row: after everything already there. */
export function nextDisplayOrder(rows: { display_order: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.display_order + 1), 0)
}

/**
 * The ids in their new order after moving one item up (-1) or down (+1), or
 * null when the move would leave the list.
 */
export function movedIds(ids: string[], index: number, delta: -1 | 1): string[] | null {
  const target = index + delta
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return null
  const next = [...ids]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

/** "Used by 1 partner" / "Not used by any partner yet". */
export function packageUsageLabel(count: number): string {
  if (count === 0) return 'Not used by any partner yet'
  return 'Used by ' + count + (count === 1 ? ' partner' : ' partners')
}

/** "3 deliverables" / "No deliverables yet". */
export function deliverableCountLabel(count: number): string {
  if (count === 0) return 'No deliverables yet'
  return count + (count === 1 ? ' deliverable' : ' deliverables')
}
