// ---------------------------------------------------------------------------
// Choosing a package in Add Partner: what it fills in, and whether filling it
// in would throw away something the organizer typed.
//
// A package is a STARTING POINT. Choosing one copies its name (as the tier
// label), its suggested value and currency, and its deliverables into the
// wizard, where the organizer can change any of them for this partner. What is
// saved is what the wizard holds at Save -- the partner's own agreement --
// never a reference to the template, so later edits to the package cannot
// reach it.
//
// "Customized" is measured, not flagged: the terms on screen are compared with
// the terms they were filled from (the BASELINE). That makes "edit it, then
// change it back" not count as customized, and it means a value the organizer
// typed into a Custom partnership counts exactly like an edited package value:
// both are work that a new package would overwrite.
//
// Pure functions only, so the rules are unit-tested without a browser.
// ---------------------------------------------------------------------------

/** One deliverable as the obligation form holds it (strings, not numbers). */
export type DeliverableValues = {
  title: string
  description: string
  category: string
  quantity: string
  due_date: string
}

/** The four things a package fills in. Requirements are never touched. */
export type PackageTerms = {
  tier_label: string
  value_amount: string
  value_currency: string
  deliverables: DeliverableValues[]
}

export const EMPTY_TERMS: PackageTerms = {
  tier_label: '',
  value_amount: '',
  value_currency: '',
  deliverables: [],
}

type PackageLike = {
  name: string
  value_amount: number | null
  value_currency: string | null
}

type TemplateDeliverableLike = {
  title: string
  description: string | null
  category: string | null
  quantity: number | null
  due_date: string | null
}

/**
 * The terms a package fills in, from its CURRENT template rows, in template
 * order. The package name becomes the tier label, the way
 * apply_partnership_package has always prefilled it.
 */
export function termsFromPackage(
  pkg: PackageLike,
  deliverables: TemplateDeliverableLike[]
): PackageTerms {
  return {
    tier_label: pkg.name,
    value_amount: pkg.value_amount === null ? '' : String(pkg.value_amount),
    value_currency: pkg.value_amount === null ? '' : (pkg.value_currency ?? '').toUpperCase(),
    deliverables: deliverables.map((d) => ({
      title: d.title,
      description: d.description ?? '',
      category: d.category ?? '',
      quantity: d.quantity === null ? '' : String(d.quantity),
      due_date: d.due_date ?? '',
    })),
  }
}

/** The fields of a draft deliverable that make up the agreement (no local key). */
export function deliverableValuesOf(item: DeliverableValues): DeliverableValues {
  return {
    title: item.title,
    description: item.description,
    category: item.category,
    quantity: item.quantity,
    due_date: item.due_date,
  }
}

function sameText(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

// "50000", "50000.00" and " 50000 " are the same amount.
function sameAmount(a: string, b: string): boolean {
  const x = a.trim()
  const y = b.trim()
  if (x === y) return true
  if (x === '' || y === '') return false
  const nx = Number(x)
  const ny = Number(y)
  return Number.isFinite(nx) && Number.isFinite(ny) && nx === ny
}

function sameDeliverables(a: DeliverableValues[], b: DeliverableValues[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, i) => {
    const other = b[i]
    return (
      sameText(item.title, other.title) &&
      sameText(item.description, other.description) &&
      sameText(item.category, other.category) &&
      sameAmount(item.quantity, other.quantity) &&
      sameText(item.due_date, other.due_date)
    )
  })
}

export type TermsField = 'tier label' | 'commercial value' | 'deliverables'

/**
 * Which of the terms on screen differ from the terms they were filled from.
 * Empty means nothing would be lost by replacing them. Order and wording are
 * the ones the confirmation uses.
 */
export function customizedFields(current: PackageTerms, baseline: PackageTerms): TermsField[] {
  const changed: TermsField[] = []
  if (!sameText(current.tier_label, baseline.tier_label)) changed.push('tier label')
  if (
    !sameAmount(current.value_amount, baseline.value_amount) ||
    !sameText(current.value_currency.toUpperCase(), baseline.value_currency.toUpperCase())
  ) {
    changed.push('commercial value')
  }
  if (!sameDeliverables(current.deliverables, baseline.deliverables)) changed.push('deliverables')
  return changed
}

/** True when the terms hold nothing at all, so clearing them would do nothing. */
export function termsAreEmpty(terms: PackageTerms): boolean {
  return customizedFields(terms, EMPTY_TERMS).length === 0
}

/** "tier label", "tier label and deliverables", "tier label, commercial value and deliverables". */
export function listFields(fields: TermsField[]): string {
  if (fields.length <= 1) return fields.join('')
  return fields.slice(0, -1).join(', ') + ' and ' + fields[fields.length - 1]
}

/** "3 deliverables" / "1 deliverable" / "no deliverables". */
export function deliverablesPhrase(count: number): string {
  if (count === 0) return 'no deliverables'
  return count + (count === 1 ? ' deliverable' : ' deliverables')
}
