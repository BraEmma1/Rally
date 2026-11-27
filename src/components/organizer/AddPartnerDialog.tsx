import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import {
  listEventPackages,
  loadPackageForPartner,
  type PartnershipPackage,
} from '@/lib/partnershipPackages'
import {
  EMPTY_TERMS,
  customizedFields,
  deliverableValuesOf,
  deliverablesPhrase,
  listFields,
  termsAreEmpty,
  termsFromPackage,
  type PackageTerms,
  type TermsField,
} from '@/lib/packageSelection'
import { MoveButton } from './MoveButton'
import { PartnerIdentityFields } from './PartnerIdentityFields'
import { PartnerPickerStep, type PartnerChoice } from './PartnerPickerStep'
import { CUSTOM, PackagePicker, TermsConfirmDialog, type PackageChoice } from './PackagePicker'
import {
  createOrganizationPartner,
  listOrganizationPartners,
  listPartnerEventLinks,
} from '@/lib/partners'
import { findPartnerByName, type DirectoryPartner, type PartnerEventLink } from '@/lib/partnerDirectory'
import { formatDueDate, formatMoney, rolesLabel, safeWebUrl } from './PartnerCommon'
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

export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

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
  return validateRepresentativeEmail(values.representative_email)
}

export function validateRepresentativeEmail(value: string): string | null {
  const email = value.trim()
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

const STEPS = ['Partner', 'Partnership', 'Deliverables', 'Requirements', 'Review'] as const

function alreadyAPartner(name: string): string {
  return name + ' is already one of your partners. Choose it from the list.'
}

type TermsConfirm =
  | { kind: 'replace'; id: string; name: string; terms: PackageTerms; fields: TermsField[] }
  | { kind: 'clear' }
  | null

function unavailableMessage(name: string, reason: 'archived' | 'missing', when: 'now' | 'since'): string {
  const what = reason === 'archived' ? 'archived' : 'removed'
  return when === 'now'
    ? name + ' was ' + what + ' and can no longer be used. Choose another package or Custom partnership.'
    : name + ' was ' + what + ' after you chose it, so nothing was saved. Choose another package, ' +
        'or Custom partnership to keep your current terms.'
}

export function AddPartnerDialog({
  event,
  onClose,
  onSaved,
}: {
  /** organization_id null: a legacy event, which cannot take a partner from the list. */
  event: { id: string; name: string; organization_id: string | null }
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

  // ---- The partner ---------------------------------------------------------
  // Chosen from the organization's partners, or created as a new one. A new
  // partner is created at Save, just before the partnership; if the
  // partnership then fails, the partner stays (it is a real entry in the list
  // now) and becomes the choice, so saving again links it instead of creating
  // a second one.
  const orgId = event.organization_id
  const [partners, setPartners] = useState<DirectoryPartner[] | null>(null)
  const [partnerLinks, setPartnerLinks] = useState<PartnerEventLink[]>([])
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [partnerChoice, setPartnerChoice] = useState<PartnerChoice>({ kind: 'none' })
  const [partnerQuery, setPartnerQuery] = useState('')

  const loadDirectory = useCallback(async () => {
    if (!orgId) return
    setDirectoryError(null)
    setPartners(null)
    const [p, l] = await Promise.all([listOrganizationPartners(orgId), listPartnerEventLinks(orgId)])
    if (p.error || l.error) {
      setDirectoryError(p.error ?? l.error)
      setPartners([])
      return
    }
    setPartners(p.data)
    setPartnerLinks(l.data)
  }, [orgId])

  useEffect(() => {
    void loadDirectory()
  }, [loadDirectory])

  function choosePartner(next: PartnerChoice, name?: string) {
    setError(null)
    setPartnerChoice(next)
    if (next.kind === 'existing') {
      const p = next.partner
      // The six basic details are the partner's; the database fills them from
      // the partner on save whatever is sent. The representative is this
      // event's, defaulted from the partner's contact.
      setValues((v) => ({
        ...v,
        company_name: p.company_name,
        description: p.description ?? '',
        logo_url: p.logo_url ?? '',
        industry: p.industry ?? '',
        website: p.website ?? '',
        linkedin: p.linkedin ?? '',
        representative_email: p.contact_email ?? '',
      }))
    } else if (next.kind === 'new') {
      setValues((v) => ({
        ...v,
        company_name: name ?? '',
        description: '',
        logo_url: '',
        industry: '',
        website: '',
        linkedin: '',
        representative_email: '',
      }))
    } else {
      // Back to the list: the six belong to whoever is chosen next.
      setValues((v) => ({
        ...v,
        company_name: '',
        description: '',
        logo_url: '',
        industry: '',
        website: '',
        linkedin: '',
      }))
    }
  }

  // ---- Packages ------------------------------------------------------------
  // `choice` is what the dropdown shows. `baseline` is where the terms on
  // screen were filled from -- a package's terms, or nothing -- and it is what
  // "customized" is measured against. They are separate on purpose: switching
  // to Custom keeps Gold's values and Gold as their origin, so a later switch
  // to Silver replaces untouched Gold values without asking.
  const [packages, setPackages] = useState<PartnershipPackage[] | null>(null)
  const [packagesError, setPackagesError] = useState<string | null>(null)
  const [choice, setChoice] = useState<PackageChoice>({ kind: 'custom' })
  const [baseline, setBaseline] = useState<PackageTerms>(EMPTY_TERMS)
  const [choosing, setChoosing] = useState(false)
  const [packageStatus, setPackageStatus] = useState('')
  const [termsConfirm, setTermsConfirm] = useState<TermsConfirm>(null)

  const loadPackages = useCallback(async () => {
    setPackagesError(null)
    const { data, error: loadError } = await listEventPackages(event.id)
    if (loadError) {
      setPackagesError(loadError)
      setPackages([])
      return
    }
    // This event's packages only (the RPC is scoped to it), and only active
    // ones: an archived package is kept for the partners made from it, not
    // offered for new ones.
    setPackages(data.filter((p) => p.archived_at === null))
  }, [event.id])

  useEffect(() => {
    void loadPackages()
  }, [loadPackages])

  function currentTerms(): PackageTerms {
    return {
      tier_label: values.tier_label,
      value_amount: values.value_amount,
      value_currency: values.value_currency,
      deliverables: deliverables.map(deliverableValuesOf),
    }
  }
  // The terms as of the latest render. choosePackage awaits a read, and an
  // edit typed while it waits must still count -- the render that started the
  // choice would not see it.
  const latestTerms = useRef<PackageTerms>(EMPTY_TERMS)
  latestTerms.current = currentTerms()

  function putTerms(terms: PackageTerms) {
    setValues((v) => ({
      ...v,
      tier_label: terms.tier_label,
      value_amount: terms.value_amount,
      value_currency: terms.value_currency,
    }))
    // Fresh local keys: these are this partner's own drafts from now on.
    setDeliverables(terms.deliverables.map((d) => ({ ...d, key: draftKey() })))
  }

  function takePackage(id: string, name: string, terms: PackageTerms) {
    putTerms(terms)
    setBaseline(terms)
    setChoice({ kind: 'package', id, name })
    setTermsConfirm(null)
    const money = formatMoney(
      terms.value_amount === '' ? null : Number(terms.value_amount),
      terms.value_currency || null
    )
    setPackageStatus(
      'Filled in from ' + name + ': the tier label' + (money ? ', ' + money : '') + ' and ' +
        deliverablesPhrase(terms.deliverables.length) + '.'
    )
  }

  async function choosePackage(value: string) {
    if (choosing) return
    setError(null)
    if (value === CUSTOM) {
      if (choice.kind === 'custom') return
      // Custom keeps everything on screen. Clearing is a separate, explicit act.
      setChoice({ kind: 'custom' })
      setPackageStatus(
        termsAreEmpty(currentTerms())
          ? 'Custom partnership. Fill in the tier label, value and deliverables yourself.'
          : 'Custom partnership. Your current tier label, value and deliverables are kept.'
      )
      return
    }
    const listedName = packages?.find((p) => p.id === value)?.name ?? 'That package'
    setChoosing(true)
    // Read the package now, not from the list: the prefill is the template as
    // it is at the moment of choosing.
    const result = await loadPackageForPartner(event.id, value)
    setChoosing(false)
    if (result.status === 'error') {
      setError(result.error)
      return
    }
    if (result.status !== 'ok') {
      setError(unavailableMessage(listedName, result.status, 'now'))
      void loadPackages()
      return
    }
    const terms = termsFromPackage(result.pkg, result.deliverables)
    const current = latestTerms.current
    const edited = customizedFields(current, baseline)
    // Ask only when something the organizer did would be lost: the terms were
    // changed from where they came from, AND the new package would change them.
    if (edited.length > 0 && customizedFields(current, terms).length > 0) {
      setTermsConfirm({ kind: 'replace', id: result.pkg.id, name: result.pkg.name, terms, fields: edited })
      return
    }
    takePackage(result.pkg.id, result.pkg.name, terms)
  }

  function clearTerms() {
    putTerms(EMPTY_TERMS)
    setBaseline(EMPTY_TERMS)
    setTermsConfirm(null)
    setPackageStatus('The tier label, value and deliverables were cleared.')
  }

  // Escape, the backdrop and the close button all come here. An open
  // confirmation is dismissed first -- keeping every edit -- so one Escape
  // never throws the whole wizard away.
  function requestClose() {
    if (saving) return
    if (termsConfirm) {
      setTermsConfirm(null)
      return
    }
    onClose()
  }

  function validatePartnerStep(): string | null {
    // A legacy event without an organization keeps today's company step.
    if (!orgId || partnerChoice.kind === 'new') return validateCompanyStep(values)
    if (partnerChoice.kind === 'none') return 'Choose a partner, or create a new one.'
    return validateRepresentativeEmail(values.representative_email)
  }

  // The name is taken: by a partner added since the list was read, or by one
  // the database found when creating. Back to the list, searching for it.
  function backToPartnerList(name: string) {
    setSaving(false)
    setPartnerChoice({ kind: 'none' })
    setPartnerQuery(name)
    setStep(0)
    setError(alreadyAPartner(name))
  }

  function next() {
    const invalid =
      step === 0 ? validatePartnerStep() : step === 1 ? validatePartnershipStep(values) : null
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
    const invalid = validatePartnerStep() ?? validatePartnershipStep(values)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    setError(null)
    const input = partnershipInputFrom(values)

    // A package can be archived or deleted by another manager while this
    // wizard is open. Check it is still usable before linking a partnership to
    // it; its TEMPLATE is not re-read into the terms -- what was chosen and
    // edited on screen is what gets saved.
    const packageId = choice.kind === 'package' ? choice.id : null
    if (choice.kind === 'package') {
      const check = await loadPackageForPartner(event.id, choice.id)
      if (check.status !== 'ok') {
        setSaving(false)
        if (check.status === 'error') {
          setError(check.error)
          return
        }
        setError(unavailableMessage(choice.name, check.status, 'since'))
        setStep(1)
        void loadPackages()
        return
      }
    }

    // The agreement as it is on screen: the organizer's own deliverables,
    // whether they came from the package, were edited, or were added by hand.
    // apply_partnership_package is not called -- it would add the template's
    // deliverables a second time.
    const obligations: ObligationInput[] = [
      ...deliverables.map((d) => obligationInputFrom(d, 'organizer_to_partner')),
      ...requirements.map((r) => obligationInputFrom(r, 'partner_to_organizer')),
    ]

    // The partner. Only now is a new one created: after every check that could
    // stop the save, and just before the partnership that links it.
    let partnerId: string | null = null
    let createdNow: DirectoryPartner | null = null
    if (orgId && partnerChoice.kind === 'existing') partnerId = partnerChoice.partner.id
    if (orgId && partnerChoice.kind === 'new') {
      const name = input.company_name
      const fresh = await listOrganizationPartners(orgId)
      if (fresh.error) {
        setError(fresh.error)
        setSaving(false)
        return
      }
      setPartners(fresh.data)
      if (findPartnerByName(fresh.data, name)) {
        backToPartnerList(name)
        return
      }
      const created = await createOrganizationPartner(orgId, {
        company_name: name,
        description: input.description,
        logo_url: input.logo_url,
        industry: input.industry,
        website: input.website,
        linkedin: input.linkedin,
        contact_email: input.representative_email,
      })
      if (created.duplicate) {
        void loadDirectory()
        backToPartnerList(name)
        return
      }
      if (created.error || !created.data) {
        setError(created.error ?? 'Unable to add this partner.')
        setSaving(false)
        return
      }
      createdNow = created.data
      partnerId = created.data.id
      // From here on this is the chosen partner: a retry links it.
      setPartners([...fresh.data, created.data])
      setPartnerChoice({ kind: 'existing', partner: created.data })
    }

    const result = await createPartnershipWithDetails(
      event.id,
      input,
      values.roles,
      obligations,
      packageId,
      partnerId
    )

    if (createdNow && result.error && !result.orphanDraftId) {
      setError(
        createdNow.company_name +
          " was added to your organization's partners, but not to this event. Save again to add it." +
          (result.packageUnavailable ? ' ' + result.error : '')
      )
      setSaving(false)
      if (result.packageUnavailable) {
        setStep(1)
        void loadPackages()
      }
      return
    }

    if (result.packageUnavailable) {
      // Deleted between the check and the insert: nothing was written.
      setError(result.error)
      setSaving(false)
      setStep(1)
      void loadPackages()
      return
    }

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
      onClose={requestClose}
      busy={saving}
      wide
    >
      <WizardProgress step={step} />

      <div className="mt-4">
        {step === 0 &&
          (orgId ? (
            <PartnerPickerStep
              eventId={event.id}
              partners={partners}
              links={partnerLinks}
              loadError={directoryError}
              onRetryLoad={() => void loadDirectory()}
              choice={partnerChoice}
              query={partnerQuery}
              onQueryChange={setPartnerQuery}
              onChoose={choosePartner}
              values={values}
              onChange={setValues}
            />
          ) : (
            <CompanyFields values={values} onChange={setValues} />
          ))}
        {step === 1 && (
          <PartnershipFields
            values={values}
            onChange={setValues}
            tierHint={
              choice.kind === 'package'
                ? 'Filled in from ' + choice.name + '. Change it for this partner if you like.'
                : 'Your own wording, such as Gold Sponsor.'
            }
            packageSlot={
              <PackagePicker
                packages={packages}
                loadError={packagesError}
                onRetryLoad={() => void loadPackages()}
                choice={choice}
                busy={choosing}
                status={packageStatus}
                canClear={choice.kind === 'custom' && !termsAreEmpty(currentTerms())}
                onChoose={(value) => void choosePackage(value)}
                onClear={() => setTermsConfirm({ kind: 'clear' })}
              />
            }
          />
        )}
        {step === 2 && (
          <DraftObligationStep
            direction="organizer_to_partner"
            items={deliverables}
            onChange={setDeliverables}
            note={
              choice.kind === 'package'
                ? 'Started from the ' + choice.name + ' package. Changes here apply to this partner only; the package itself is not changed.'
                : undefined
            }
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
            partnerNote={
              !orgId
                ? undefined
                : partnerChoice.kind === 'existing'
                  ? 'From your partners'
                  : "New partner, added to your organization's partners"
            }
            packageLabel={
              choice.kind === 'package'
                ? choice.name +
                  (customizedFields(currentTerms(), baseline).length > 0
                    ? ' · customized for this partner'
                    : '')
                : 'Custom partnership'
            }
            deliverables={deliverables.length}
            requirements={requirements.length}
          />
        )}
      </div>

      {termsConfirm?.kind === 'replace' && (
        <TermsConfirmDialog
          title={'Replace your changes with ' + termsConfirm.name + '?'}
          body={
            'You changed the ' + listFields(termsConfirm.fields) + '. Choosing ' + termsConfirm.name +
            ' replaces the tier label, value and deliverables with the package’s. Requirements are not affected.'
          }
          keepLabel="Keep my changes"
          actionLabel={'Use ' + termsConfirm.name}
          returnFocusTo="pt-package"
          onKeep={() => setTermsConfirm(null)}
          onConfirm={() => takePackage(termsConfirm.id, termsConfirm.name, termsConfirm.terms)}
        />
      )}
      {termsConfirm?.kind === 'clear' && (
        <TermsConfirmDialog
          title="Clear the tier, value and deliverables?"
          body={
            'This empties the tier label and commercial value and removes ' +
            deliverablesPhrase(deliverables.length) + ' from this partner. Requirements are not affected.'
          }
          keepLabel="Keep them"
          actionLabel="Clear"
          returnFocusTo="pt-package"
          onKeep={() => setTermsConfirm(null)}
          onConfirm={clearTerms}
        />
      )}

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
          <Button type="button" onClick={next} disabled={choosing}>
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
  return (
    <PartnerIdentityFields
      values={values}
      onChange={onChange}
      emailSlot={
        <RepresentativeEmailField
          value={values.representative_email}
          onChange={(representative_email) => onChange({ ...values, representative_email })}
          lockReason={lockRepresentativeEmail}
        />
      }
    />
  )
}

/** The representative of record for this event. Event-specific: never taken from or given to the partner. */
export function RepresentativeEmailField({
  value,
  onChange,
  lockReason,
  hint = 'Optional. Who you deal with at this company. Nothing is sent now.',
}: {
  value: string
  onChange: (next: string) => void
  lockReason?: string
  hint?: string
}) {
  return (
    <>
      <Label htmlFor='pt-rep'>Representative Email</Label>
      <Input
        id='pt-rep'
        type='email'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='john@acme.com'
        disabled={Boolean(lockReason)}
        aria-describedby='pt-rep-hint'
        className={lockReason ? 'bg-gray-50 text-gray-500' : undefined}
      />
      <p id='pt-rep-hint' className='mt-1 text-xs text-gray-500'>
        {lockReason ?? hint}
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 2 -- Partnership
// ---------------------------------------------------------------------------
export function PartnershipFields({
  values,
  onChange,
  packageSlot,
  tierHint = 'Your own wording. Rally does not keep a list of tiers.',
}: {
  values: PartnerFormValues
  onChange: (next: PartnerFormValues) => void
  /**
   * Add Partner puts the Package dropdown here, above the tier label. Edit
   * Partner passes nothing: a partnership's package is chosen once, when it is
   * created, and its tier label stays a plain editable field.
   */
  packageSlot?: React.ReactNode
  tierHint?: string
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

      {packageSlot}

      <div>
        <Label htmlFor="pt-tier">Tier / Partnership Level</Label>
        <Input
          id="pt-tier"
          value={values.tier_label}
          onChange={(e) => set('tier_label', e.target.value)}
          maxLength={80}
          placeholder="Gold Sponsor"
          aria-describedby="pt-tier-hint"
        />
        <p id="pt-tier-hint" className="mt-1 text-xs text-gray-500">
          {tierHint}
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
            aria-describedby="pt-value-hint"
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
      {/* Who really sees the value: the invitee projection (phase 3B) shows it
          to the invited representative, and my_sponsor_partnerships shows it
          to members of the sponsor organization once the invitation is
          accepted. Attendees never see it. "Private to your team" was wrong. */}
      <p id="pt-value-hint" className="-mt-3 text-xs text-gray-500">
        Optional. Visible to your event team, to the representative you invite and, once they
        accept, to authorized members of their organization. Never shown to attendees. Rally does
        not invoice or take payment.
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
  note,
}: {
  direction: ObligationDirection
  items: DraftObligation[]
  onChange: (next: DraftObligation[]) => void
  /** Where these came from, e.g. the package they were filled in from. */
  note?: string
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<DraftObligation | null>(null)
  const [moved, setMoved] = useState('')
  const copy = STEP_COPY[direction]

  // Local only: nothing is saved until Review, so a move cannot fail.
  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next)
    setMoved(item.title + ' moved to position ' + (target + 1) + ' of ' + next.length + '.')
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{copy.heading}</h3>
        <p className="mt-0.5 text-sm text-gray-500">{copy.support}</p>
        {note && <p className="mt-1 text-xs text-primary-700">{note}</p>}
      </div>

      <p className="sr-only" aria-live="polite" data-testid={'draft-order-status-' + direction}>
        {moved}
      </p>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center">
          <p className="text-sm text-gray-500">{copy.empty}</p>
          <p className="mt-1 text-xs text-gray-400">{copy.examples}</p>
        </div>
      ) : (
        // Same layout as a package's deliverables: on a phone the text takes
        // the full width and the controls get a row beneath it (move on the
        // left, Edit and Remove on the right, each 44px); from sm up they
        // share one row.
        <ul aria-label={copy.heading} className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {items.map((item, index) => (
            <li
              key={item.key}
              className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-2"
            >
              <div className="min-w-0 flex-1 sm:py-2.5">
                <p className="break-words text-sm font-medium text-gray-900">{item.title}</p>
                <p className="break-words text-xs text-gray-500">
                  {[
                    item.category || null,
                    item.quantity ? 'Qty ' + item.quantity : null,
                    formatDueDate(item.due_date) ? 'Due ' + formatDueDate(item.due_date) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'No category, quantity or due date'}
                </p>
              </div>
              <div className="-mx-1 flex shrink-0 items-center justify-between sm:mx-0 sm:justify-end sm:gap-1">
                {items.length > 1 ? (
                  <div className="flex items-center" role="group" aria-label={'Reorder ' + item.title}>
                    <MoveButton
                      label={'Move ' + item.title + ' up'}
                      atEdge={index === 0}
                      onMove={() => move(index, -1)}
                    >
                      <ChevronUp className="h-5 w-5" aria-hidden="true" />
                    </MoveButton>
                    <MoveButton
                      label={'Move ' + item.title + ' down'}
                      atEdge={index === items.length - 1}
                      onMove={() => move(index, 1)}
                    >
                      <ChevronDown className="h-5 w-5" aria-hidden="true" />
                    </MoveButton>
                  </div>
                ) : (
                  <span aria-hidden="true" />
                )}
                <div className="flex items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing(item)}
                    aria-label={'Edit ' + item.title}
                    title={'Edit ' + item.title}
                    className="h-11 w-11"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onChange(items.filter((i) => i.key !== item.key))}
                    aria-label={'Remove ' + item.title}
                    title={'Remove ' + item.title}
                    className="h-11 w-11"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
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
  partnerNote,
  packageLabel,
  deliverables,
  requirements,
}: {
  values: PartnerFormValues
  /** Where the partner comes from: one of the organization's, or new. */
  partnerNote?: string
  packageLabel: string
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
      <ReviewRow label="Partner">
        <p className="text-sm font-medium text-gray-900">{input.company_name}</p>
        {input.industry && <p className="text-sm text-gray-500">{input.industry}</p>}
        {partnerNote && <p className="text-xs text-gray-500">{partnerNote}</p>}
      </ReviewRow>
      <ReviewRow label="Package">
        <p className="text-sm text-gray-900">{packageLabel}</p>
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
