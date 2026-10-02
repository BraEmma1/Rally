import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { EventPhotoUpload } from '@/components/ui/EventPhotoUpload'
import { formatDueDate, rolesLabel, safeWebUrl } from './PartnerCommon'
import {
  PARTNERSHIP_ROLES,
  ROLE_LABELS,
  createPartnershipWithDetails,
  type ObligationDirection,
  type ObligationInput,
  type PartnershipInput,
  type PartnershipRole,
} from '@/lib/partnerships'
import { SheetDialog } from './SheetDialog'
import {
  EMPTY_OBLIGATION_VALUES,
  PartnerObligationDialog,
  obligationInputFrom,
  obligationValuesFrom,
  type ObligationFormValues,
} from './PartnerObligationDialog'

// ---------------------------------------------------------------------------
// Add Partner -- five steps, one dialog.
//
// A partnership is three tables, so the alternative to a wizard is one page
// with a company block, a roles block, a commercial block and two repeatable
// obligation lists. That is a wall. The steps exist to make the shape of a
// partnership legible, not to dress it up as a checkout: the progress row is a
// line of numbered labels, the whole thing is one <form> per step, and nothing
// is submitted until Review.
//
// The company and partnership field groups are exported because Edit Partner
// renders exactly the same inputs. Two copies would drift.
// ---------------------------------------------------------------------------

export type PartnerFormValues = {
  company_name: string
  logo_url: string
  industry: string
  website: string
  linkedin: string
  description: string
  representative_email: string
  roles: PartnershipRole[]
  tier_label: string
  value_amount: string
  value_currency: string
  internal_notes: string
}

export const EMPTY_PARTNER_VALUES: PartnerFormValues = {
  company_name: '',
  logo_url: '',
  industry: '',
  website: '',
  linkedin: '',
  description: '',
  representative_email: '',
  roles: [],
  tier_label: '',
  value_amount: '',
  value_currency: '',
  internal_notes: '',
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Form values to the row shape. Blanks become NULL rather than empty strings,
 * so "not recorded" and "recorded as nothing" stay distinguishable, and the
 * normalizing the database does (lowercase email, uppercase currency) is
 * mirrored here so the review step shows what will actually be stored.
 */
export function partnershipInputFrom(values: PartnerFormValues): PartnershipInput {
  const amount = values.value_amount.trim()
  return {
    company_name: values.company_name.trim(),
    description: values.description.trim() || null,
    logo_url: values.logo_url.trim() || null,
    industry: values.industry.trim() || null,
    website: safeWebUrl(values.website),
    linkedin: safeWebUrl(values.linkedin),
    tier_label: values.tier_label.trim() || null,
    value_amount: amount ? Number(amount) : null,
    value_currency: values.value_currency.trim().toUpperCase() || null,
    internal_notes: values.internal_notes.trim() || null,
    representative_email: values.representative_email.trim().toLowerCase() || null,
  }
}

export function validateCompanyStep(values: PartnerFormValues): string | null {
  if (!values.company_name.trim()) return 'Give this partner a company name.'
  if (values.website.trim() && !safeWebUrl(values.website)) {
    return 'The website must be a full URL, such as https://acme.com'
  }
  if (values.linkedin.trim() && !safeWebUrl(values.linkedin)) {
    return 'The LinkedIn link must be a full URL, such as https://linkedin.com/company/acme'
  }
  const email = values.representative_email.trim()
  if (email && !EMAIL_SHAPE.test(email)) {
    return 'Enter a valid representative email address, or leave it blank.'
  }
  return null
}

export function validatePartnershipStep(values: PartnerFormValues): string | null {
  if (values.roles.length === 0) return 'Choose at least one role for this partner.'
  const amount = values.value_amount.trim()
  const currency = values.value_currency.trim()
  if (amount) {
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 'The commercial value must be a number that is not negative.'
    }
    // Deliberately no default: an amount with no currency is not information.
    if (!currency) return 'Add the currency for this amount, such as GHS or USD.'
  }
  if (currency && !/^[A-Za-z]{3}$/.test(currency)) {
    return 'Use a three-letter currency code, such as GHS, USD, EUR or GBP.'
  }
  if (currency && !amount) return 'Add the amount this currency applies to.'
  return null
}

// A draft obligation, before anything is saved. `key` is local only -- the
// database assigns the real id.
type DraftObligation = ObligationFormValues & { key: string }

function draftKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

const STEPS = ['Company', 'Partnership', 'Deliverables', 'Requirements', 'Review'] as const

export function AddPartnerDialog({
  event,
  onClose,
  onSaved,
}: {
  event: { id: string; name: string }
  onClose: () => void
  /** Closes the dialog and reloads the list. `warning` is shown by the panel. */
  onSaved: (warning: string | null) => void
}) {
  const [step, setStep] = useState(0)
  const [values, setValues] = useState<PartnerFormValues>(EMPTY_PARTNER_VALUES)
  const [deliverables, setDeliverables] = useState<DraftObligation[]>([])
  const [requirements, setRequirements] = useState<DraftObligation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function next() {
    const invalid =
      step === 0 ? validateCompanyStep(values) : step === 1 ? validatePartnershipStep(values) : null
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function back() {
    setError(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  async function save() {
    if (saving) return
    const invalid = validateCompanyStep(values) ?? validatePartnershipStep(values)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    setError(null)

    const obligations: ObligationInput[] = [
      ...deliverables.map((d) => obligationInputFrom(d, 'organizer_to_partner')),
      ...requirements.map((r) => obligationInputFrom(r, 'partner_to_organizer')),
    ]

    const result = await createPartnershipWithDetails(
      event.id,
      partnershipInputFrom(values),
      values.roles,
      obligations
    )

    if (result.orphanDraftId) {
      // The partnership saved, a later step did not, and the compensating
      // delete also failed -- so a usable draft really is there. Say so
      // instead of reporting a clean failure.
      setSaving(false)
      onSaved(
        values.company_name.trim() +
          ' was saved as a draft, but its deliverables and requirements were not. ' +
          'Open the draft to finish adding them.'
      )
      return
    }
    if (result.error) {
      setError(result.error)
      setSaving(false)
      return
    }
    setSaving(false)
    onSaved(null)
  }

  return (
    <SheetDialog
      title="Add Partner"
      subtitle={event.name}
      onClose={onClose}
      busy={saving}
      wide
    >
      <WizardProgress step={step} />

      <div className="mt-4">
        {step === 0 && <CompanyFields values={values} onChange={setValues} />}
        {step === 1 && <PartnershipFields values={values} onChange={setValues} />}
        {step === 2 && (
          <DraftObligationStep
            direction="organizer_to_partner"
            items={deliverables}
            onChange={setDeliverables}
          />
        )}
        {step === 3 && (
          <DraftObligationStep
            direction="partner_to_organizer"
            items={requirements}
            onChange={setRequirements}
          />
        )}
        {step === 4 && (
          <ReviewStep
            values={values}
            deliverables={deliverables.length}
            requirements={requirements.length}
          />
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {error}
        </div>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="secondary"
          onClick={step === 0 ? onClose : back}
          disabled={saving}
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={next}>
            Continue
          </Button>
        ) : (
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save Partner'}
          </Button>
        )}
      </div>
    </SheetDialog>
  )
}

function WizardProgress({ step }: { step: number }) {
  return (
    <nav aria-label="Add Partner progress" className="-mx-1 overflow-x-auto px-1">
      <ol className="flex w-max items-center gap-2 md:w-full">
        {STEPS.map((label, index) => {
          const state = index === step ? 'current' : index < step ? 'done' : 'todo'
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={state === 'current' ? 'step' : undefined}
                className={
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ' +
                  (state === 'current'
                    ? 'bg-primary-50 text-primary-700'
                    : state === 'done'
                      ? 'text-gray-700'
                      : 'text-gray-400')
                }
              >
                <span
                  className={
                    'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ' +
                    (state === 'current'
                      ? 'bg-primary-600 text-white'
                      : state === 'done'
                        ? 'bg-accent-600 text-white'
                        : 'bg-gray-200 text-gray-600')
                  }
                >
                  {index + 1}
                </span>
                {label}
              </span>
              {index < STEPS.length - 1 && (
                <span aria-hidden="true" className="h-px w-3 bg-gray-200 md:w-full md:min-w-3" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Step 1 -- Company
//
// This is a company SNAPSHOT on the partnership, not a Rally organization and
// not an account. Nothing here creates a sponsor organization, a membership or
// a login, and sponsor_organization_id is not on this form at all: it is earned
// by accepting an invitation, which is a later phase.
// ---------------------------------------------------------------------------
export function CompanyFields({
  values,
  onChange,
  lockRepresentativeEmail,
}: {
  values: PartnerFormValues
  onChange: (next: PartnerFormValues) => void
  /**
   * When set, the representative email is read-only and this is the reason.
   * The backend refuses a change that would disagree with a live invitation,
   * so the field is disabled rather than allowed to fail on save.
   */
  lockRepresentativeEmail?: string
}) {
  function set<K extends keyof PartnerFormValues>(key: K, value: PartnerFormValues[K]) {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="space-y-4">
      <EventPhotoUpload
        folder="partners"
        fullName={values.company_name || 'Partner'}
        currentPhotoUrl={values.logo_url || null}
        onUploaded={(url) => set('logo_url', url)}
        size="lg"
        hint="Click to upload a company logo"
      />
      <div>
        <Label htmlFor="pt-company">Company Name *</Label>
        <Input
          id="pt-company"
          value={values.company_name}
          onChange={(e) => set('company_name', e.target.value)}
          maxLength={200}
          placeholder="Acme Bank"
          required
          autoFocus
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pt-industry">Industry</Label>
          <Input
            id="pt-industry"
            value={values.industry}
            onChange={(e) => set('industry', e.target.value)}
            maxLength={120}
            placeholder="Financial Services"
          />
        </div>
        <div>
          <Label htmlFor="pt-rep">Representative Email</Label>
          <Input
            id="pt-rep"
            type="email"
            value={values.representative_email}
            onChange={(e) => set('representative_email', e.target.value)}
            placeholder="john@acme.com"
            disabled={Boolean(lockRepresentativeEmail)}
            aria-describedby="pt-rep-hint"
            className={lockRepresentativeEmail ? 'bg-gray-50 text-gray-500' : undefined}
          />
          <p id="pt-rep-hint" className="mt-1 text-xs text-gray-500">
            {lockRepresentativeEmail ??
              'Optional. Who you deal with at this company. Nothing is sent now.'}
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pt-website">Website</Label>
          <Input
            id="pt-website"
            value={values.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="https://acme.com"
          />
        </div>
        <div>
          <Label htmlFor="pt-linkedin">LinkedIn</Label>
          <Input
            id="pt-linkedin"
            value={values.linkedin}
            onChange={(e) => set('linkedin', e.target.value)}
            placeholder="https://linkedin.com/company/acme"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="pt-description">Description</Label>
        <Textarea
          id="pt-description"
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          maxLength={4000}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 -- Partnership
// ---------------------------------------------------------------------------
export function PartnershipFields({
  values,
  onChange,
}: {
  values: PartnerFormValues
  onChange: (next: PartnerFormValues) => void
}) {
  function set<K extends keyof PartnerFormValues>(key: K, value: PartnerFormValues[K]) {
    onChange({ ...values, [key]: value })
  }

  function toggleRole(role: PartnershipRole) {
    set(
      'roles',
      values.roles.includes(role)
        ? values.roles.filter((r) => r !== role)
        : [...values.roles, role]
    )
  }

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="label-base">Roles *</legend>
        <p className="-mt-1 mb-2 text-xs text-gray-500">
          A partner can hold more than one. Sponsor + Exhibitor is common.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PARTNERSHIP_ROLES.map((role) => {
            const checked = values.roles.includes(role)
            return (
              <label
                key={role}
                className={
                  'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ' +
                  (checked
                    ? 'border-primary-600 bg-primary-50 text-primary-800'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50')
                }
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
                  checked={checked}
                  onChange={() => toggleRole(role)}
                />
                {ROLE_LABELS[role]}
              </label>
            )
          })}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="pt-tier">Tier / Partnership Level</Label>
        <Input
          id="pt-tier"
          value={values.tier_label}
          onChange={(e) => set('tier_label', e.target.value)}
          maxLength={80}
          placeholder="Gold Sponsor"
        />
        <p className="mt-1 text-xs text-gray-500">
          Your own wording. Rally does not keep a list of tiers.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <div>
          <Label htmlFor="pt-value">Commercial Value</Label>
          <Input
            id="pt-value"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={values.value_amount}
            onChange={(e) => set('value_amount', e.target.value)}
            placeholder="50000"
          />
        </div>
        <div>
          <Label htmlFor="pt-currency">Currency</Label>
          <Input
            id="pt-currency"
            value={values.value_currency}
            onChange={(e) => set('value_currency', e.target.value.toUpperCase())}
            maxLength={3}
            placeholder="GHS"
            className="uppercase"
          />
        </div>
      </div>
      <p className="-mt-3 text-xs text-gray-500">
        Optional, and private to your team. Rally does not invoice or take payment.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Steps 3 and 4 -- the two obligation lists
//
// Same component twice. The direction is the only difference, which is also
// true of the table it writes to.
// ---------------------------------------------------------------------------
const STEP_COPY: Record<
  ObligationDirection,
  { heading: string; support: string; add: string; empty: string; examples: string }
> = {
  organizer_to_partner: {
    heading: 'Deliverables',
    support: 'What will your organization provide to this partner?',
    add: 'Add Deliverable',
    empty: 'Nothing added yet.',
    examples: 'Logo placement · Social promotion · Exhibition booth · VIP passes',
  },
  partner_to_organizer: {
    heading: 'Requirements',
    support: 'What does this partner need to provide to your organization?',
    add: 'Add Requirement',
    empty: 'Nothing added yet.',
    examples: 'High-resolution logo · Brand guidelines · Booth artwork · Company profile',
  },
}

function DraftObligationStep({
  direction,
  items,
  onChange,
}: {
  direction: ObligationDirection
  items: DraftObligation[]
  onChange: (next: DraftObligation[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<DraftObligation | null>(null)
  const copy = STEP_COPY[direction]

  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{copy.heading}</h3>
        <p className="mt-0.5 text-sm text-gray-500">{copy.support}</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center">
          <p className="text-sm text-gray-500">{copy.empty}</p>
          <p className="mt-1 text-xs text-gray-400">{copy.examples}</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {items.map((item, index) => (
            <li key={item.key} className="flex items-start gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                <p className="truncate text-xs text-gray-500">
                  {[
                    item.category || null,
                    item.quantity ? 'Qty ' + item.quantity : null,
                    formatDueDate(item.due_date) ? 'Due ' + formatDueDate(item.due_date) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'No category, quantity or due date'}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                {items.length > 1 && (
                  <div className="mr-1 hidden flex-col sm:flex">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={'Move ' + item.title + ' up'}
                      className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={index === items.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={'Move ' + item.title + ' down'}
                      className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditing(item)}
                  aria-label={'Edit ' + item.title}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onChange(items.filter((i) => i.key !== item.key))}
                  aria-label={'Remove ' + item.title}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
        <Plus className="h-4 w-4" />
        {copy.add}
      </Button>

      {adding && (
        <PartnerObligationDialog
          title={copy.add}
          direction={direction}
          initial={EMPTY_OBLIGATION_VALUES}
          submitLabel="Add"
          onClose={() => setAdding(false)}
          onSubmit={async (next) => {
            onChange([...items, { ...next, key: draftKey() }])
            setAdding(false)
            return null
          }}
        />
      )}

      {editing && (
        <PartnerObligationDialog
          title={'Edit ' + copy.heading.replace(/s$/, '')}
          direction={direction}
          initial={obligationValuesFrom({
            title: editing.title,
            description: editing.description || null,
            category: editing.category || null,
            quantity: editing.quantity ? Number(editing.quantity) : null,
            due_date: editing.due_date || null,
          })}
          submitLabel="Save"
          onClose={() => setEditing(null)}
          onSubmit={async (next) => {
            onChange(items.map((i) => (i.key === editing.key ? { ...next, key: i.key } : i)))
            setEditing(null)
            return null
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 5 -- Review
// ---------------------------------------------------------------------------
function ReviewStep({
  values,
  deliverables,
  requirements,
}: {
  values: PartnerFormValues
  deliverables: number
  requirements: number
}) {
  const input = useMemo(() => partnershipInputFrom(values), [values])
  const money =
    input.value_amount === null
      ? null
      : (input.value_currency ? input.value_currency + ' ' : '') +
        new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(input.value_amount)

  return (
    <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
      <ReviewRow label="Company">
        <p className="text-sm font-medium text-gray-900">{input.company_name}</p>
        {input.industry && <p className="text-sm text-gray-500">{input.industry}</p>}
      </ReviewRow>
      <ReviewRow label="Partnership">
        {input.tier_label && <p className="text-sm font-medium text-gray-900">{input.tier_label}</p>}
        <p className="text-sm text-gray-500">{rolesLabel(values.roles)}</p>
      </ReviewRow>
      <ReviewRow label="Commercial value">
        <p className="text-sm text-gray-900">{money ?? 'Not recorded'}</p>
      </ReviewRow>
      <ReviewRow label="Deliverables">
        <p className="text-sm text-gray-900">
          {deliverables} {deliverables === 1 ? 'item' : 'items'}
        </p>
      </ReviewRow>
      <ReviewRow label="Requirements">
        <p className="text-sm text-gray-900">
          {requirements} {requirements === 1 ? 'item' : 'items'}
        </p>
      </ReviewRow>
      <ReviewRow label="Representative">
        <p className="break-all text-sm text-gray-900">
          {input.representative_email ?? 'Not recorded'}
        </p>
      </ReviewRow>
      <div className="px-4 py-3">
        <p className="text-xs text-gray-500">
          This partner is saved as a <strong className="font-medium">draft</strong>. No invitation
          is sent and nothing is shared with the company.
        </p>
      </div>
    </div>
  )
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 sm:pt-0.5">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
