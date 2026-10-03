import { useCallback, useEffect, useState } from 'react'
import { Building2, Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/States'
import { SheetDialog } from '@/components/organizer/SheetDialog'
import { normalizeUrl } from '@/lib/utils'
import {
  acceptWithExistingOrganization,
  acceptWithNewOrganization,
  listEligibleSponsorOrganizations,
  partnershipRolesLabel,
  type EligibleSponsorOrganization,
  type PartnershipInvitationReview,
} from '@/lib/partnerInvitations'

// ---------------------------------------------------------------------------
// Accepting is three decisions, not one: which organization, confirm, commit.
//
// The organization step exists because a partnership links to an ORGANIZATION,
// never to a person. Phase 3A offers exactly two ways to supply one, and both
// are a single transaction that also links the partnership, accepts the
// invitation, activates it and stamps acknowledged_at. Nothing is written here
// in steps, and no organization is ever created without the person saying so.
//
// The candidate list comes only from my_eligible_sponsor_organizations -- the
// organizations this caller already owns or administers. There is no search,
// no lookup by name and no field for an organization id, because there is no
// backend contract that would honour one.
// ---------------------------------------------------------------------------

type Step = 'choose' | 'create' | 'confirm'

type Choice =
  | { kind: 'existing'; organization: EligibleSponsorOrganization }
  | { kind: 'new'; name: string; website: string; description: string }

export function AcceptPartnershipDialog({
  invitation,
  onClose,
  onAccepted,
}: {
  invitation: PartnershipInvitationReview
  onClose: () => void
  onAccepted: (organizationName: string) => void | Promise<void>
}) {
  const [organizations, setOrganizations] = useState<EligibleSponsorOrganization[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [step, setStep] = useState<Step>('choose')
  const [choice, setChoice] = useState<Choice | null>(null)
  const [newOrg, setNewOrg] = useState({ name: '', website: '', description: '' })
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error: listError } = await listEligibleSponsorOrganizations(
      invitation.invitation_id
    )
    setOrganizations(data)
    setLoadError(listError)
    // With nothing to choose from there is no choice to make, so the first
    // thing they see is the form rather than an empty list.
    if (!listError && data.length === 0) setStep('create')
    setLoading(false)
  }, [invitation.invitation_id])

  useEffect(() => {
    void load()
  }, [load])

  function continueFromCreate() {
    const name = newOrg.name.trim()
    if (!name) {
      setError('Enter your organization name.')
      return
    }
    if (name.length > 120) {
      setError('That organization name is too long.')
      return
    }
    if (newOrg.website.trim() && !normalizeUrl(newOrg.website)) {
      setError('The website must be a full URL, such as https://acme.com')
      return
    }
    setError(null)
    setChoice({ kind: 'new', name, website: newOrg.website, description: newOrg.description })
    setStep('confirm')
  }

  async function accept() {
    if (!choice || accepting) return
    setAccepting(true)
    setError(null)

    const result =
      choice.kind === 'existing'
        ? await acceptWithExistingOrganization(
            invitation.invitation_id,
            choice.organization.organization_id
          )
        : await acceptWithNewOrganization({
            invitationId: invitation.invitation_id,
            name: choice.name,
            website: normalizeUrl(choice.website),
            description: choice.description.trim() || null,
          })

    setAccepting(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onAccepted(choice.kind === 'existing' ? choice.organization.name : choice.name)
  }

  const title =
    step === 'confirm'
      ? 'Accept Partnership'
      : step === 'create'
        ? 'Set Up Your Organization'
        : 'Choose Sponsor Organization'

  return (
    <SheetDialog title={title} subtitle={invitation.event_name} onClose={onClose} busy={accepting}>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Spinner size="sm" />
          Checking your organizations…
        </div>
      ) : loadError ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{loadError}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => void load()}>Try again</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {step === 'choose' && (
            <>
              <p className="text-sm text-gray-600">
                Select the organization that will participate in this partnership.
              </p>
              <ul className="space-y-2">
                {organizations.map((organization) => (
                  <li key={organization.organization_id}>
                    <button
                      type="button"
                      onClick={() => {
                        setChoice({ kind: 'existing', organization })
                        setError(null)
                        setStep('confirm')
                      }}
                      className="flex w-full items-center gap-3 rounded-md border border-gray-300 px-3 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
                        <Building2 className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-gray-900">
                          {organization.name}
                        </span>
                        <span className="block text-xs text-gray-500">
                          Sponsor organization · Your role:{' '}
                          {organization.my_role === 'owner' ? 'Owner' : 'Admin'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-gray-200 pt-4">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setError(null)
                    setStep('create')
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Create New Sponsor Organization
                </Button>
              </div>
            </>
          )}

          {step === 'create' && (
            <>
              <p className="text-sm text-gray-600">
                {organizations.length === 0
                  ? 'Set up your organization to accept this partnership. This is your company on Rally, not a new account.'
                  : 'This creates a new organization on Rally for your company.'}
              </p>
              <div>
                <Label htmlFor="org-name">Organization Name *</Label>
                <Input
                  id="org-name"
                  value={newOrg.name}
                  onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                  maxLength={120}
                  placeholder={invitation.company_name}
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-500">
                  The organizer recorded you as “{invitation.company_name}”. Use your
                  organization’s own name here.
                </p>
              </div>
              <div>
                <Label htmlFor="org-website">Website</Label>
                <Input
                  id="org-website"
                  value={newOrg.website}
                  onChange={(e) => setNewOrg({ ...newOrg, website: e.target.value })}
                  placeholder="https://acme.com"
                />
              </div>
              <div>
                <Label htmlFor="org-description">Description</Label>
                <Textarea
                  id="org-description"
                  value={newOrg.description}
                  onChange={(e) => setNewOrg({ ...newOrg, description: e.target.value })}
                  rows={3}
                  maxLength={2000}
                />
              </div>
            </>
          )}

          {step === 'confirm' && choice && (
            <>
              <dl className="divide-y divide-gray-100 rounded-md border border-gray-200">
                <ConfirmRow label="Organization">
                  {choice.kind === 'existing' ? choice.organization.name : choice.name}
                </ConfirmRow>
                <ConfirmRow label="Event">{invitation.event_name}</ConfirmRow>
                {invitation.tier_label && (
                  <ConfirmRow label="Partnership">{invitation.tier_label}</ConfirmRow>
                )}
                {invitation.roles.length > 0 && (
                  <ConfirmRow label="Roles">{partnershipRolesLabel(invitation.roles)}</ConfirmRow>
                )}
              </dl>
              <p className="text-sm leading-relaxed text-gray-600">
                {choice.kind === 'existing' ? choice.organization.name : choice.name} will be linked
                to this partnership on Rally
                {choice.kind === 'new' ? ', and you will be its owner' : ''}. Your own Rally account
                type does not change.
              </p>
            </>
          )}

          {error && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={accepting}
              onClick={() => {
                setError(null)
                if (step === 'confirm') {
                  setChoice(null)
                  setStep(organizations.length > 0 && choice?.kind === 'existing' ? 'choose' : 'create')
                } else if (step === 'create' && organizations.length > 0) {
                  setStep('choose')
                } else {
                  onClose()
                }
              }}
            >
              {step === 'choose' || (step === 'create' && organizations.length === 0)
                ? 'Cancel'
                : 'Back'}
            </Button>

            {step === 'create' && (
              <Button type="button" onClick={continueFromCreate} disabled={!newOrg.name.trim()}>
                Continue
              </Button>
            )}
            {step === 'confirm' && (
              <Button type="button" onClick={() => void accept()} disabled={accepting}>
                <Check className="h-4 w-4" />
                {accepting ? 'Accepting…' : 'Accept Partnership'}
              </Button>
            )}
          </div>
        </div>
      )}
    </SheetDialog>
  )
}

function ConfirmRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400 sm:pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0 text-sm text-gray-900">{children}</dd>
    </div>
  )
}
