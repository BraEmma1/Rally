import { useMemo } from 'react'
import { SearchField } from '@/components/ui/SearchField'
import { Spinner } from '@/components/ui/States'
import { displayUrl } from '@/lib/utils'
import {
  newPartnerName,
  pickerRows,
  type DirectoryPartner,
  type PartnerEventLink,
} from '@/lib/partnerDirectory'
import { CompanyFields, RepresentativeEmailField, type PartnerFormValues } from './AddPartnerDialog'
import { PartnerLogo } from './PartnerCommon'

// Add Partner's first step: who the partner is. Choose one of the organization's
// partners -- their basic details come from the partner and stay theirs -- or
// create a new one, which joins the list for everyone. The representative is
// this event's, so it stays editable either way.

export type PartnerChoice =
  | { kind: 'none' }
  | { kind: 'existing'; partner: DirectoryPartner }
  | { kind: 'new' }

function eventsLabel(n: number): string | null {
  if (n === 0) return null
  return n === 1 ? '1 event' : n + ' events'
}

export function PartnerPickerStep({
  eventId,
  partners,
  links,
  loadError,
  onRetryLoad,
  choice,
  query,
  onQueryChange,
  onChoose,
  values,
  onChange,
}: {
  eventId: string
  /** null while loading */
  partners: DirectoryPartner[] | null
  links: PartnerEventLink[]
  loadError: string | null
  onRetryLoad: () => void
  choice: PartnerChoice
  query: string
  onQueryChange: (q: string) => void
  onChoose: (choice: PartnerChoice, name?: string) => void
  values: PartnerFormValues
  onChange: (next: PartnerFormValues) => void
}) {
  const rows = useMemo(
    () => (partners ? pickerRows(partners, links, eventId, query) : []),
    [partners, links, eventId, query]
  )
  const newName = partners ? newPartnerName(query, partners) : null

  if (choice.kind === 'existing') {
    const p = choice.partner
    return (
      <div className="space-y-4">
        <div data-testid="chosen-partner" className="rounded-md border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-start gap-3">
            <PartnerLogo name={p.company_name} logoUrl={p.logo_url} size="md" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">{p.company_name}</p>
              <p className="text-sm text-gray-600">
                {[p.industry, p.website ? displayUrl(p.website) : null].filter(Boolean).join(' · ')}
              </p>
              {p.description && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{p.description}</p>}
              <p className="mt-2 text-xs text-gray-500">From your partners. Their details are kept up to date on the partner.</p>
            </div>
            <button
              type="button"
              onClick={() => onChoose({ kind: 'none' })}
              className="min-h-[44px] shrink-0 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50 hover:text-primary-700"
            >
              Change
            </button>
          </div>
        </div>
        <div>
          <RepresentativeEmailField
            value={values.representative_email}
            onChange={(representative_email) => onChange({ ...values, representative_email })}
            hint={
              p.contact_email
                ? "Filled in from the partner's contact email. Change it for this event if you like."
                : 'Optional. Who you deal with at this company for this event. Nothing is sent now.'
            }
          />
        </div>
      </div>
    )
  }

  if (choice.kind === 'new') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md bg-primary-50 px-3 py-2 text-sm text-primary-800">
          <span>A new partner. It joins your organization's partners when you save.</span>
          <button
            type="button"
            onClick={() => onChoose({ kind: 'none' })}
            className="min-h-[44px] shrink-0 rounded-md px-3 font-medium text-primary-700 hover:bg-primary-100"
          >
            Change
          </button>
        </div>
        <CompanyFields values={values} onChange={onChange} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <SearchField
        value={query}
        onChange={onQueryChange}
        label="Search your organization's partners"
        placeholder="Search, or type a new partner's name"
      />
      {loadError ? (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {loadError}{' '}
          <button type="button" onClick={onRetryLoad} className="font-medium underline">
            Try again
          </button>
        </div>
      ) : partners === null ? (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
          <Spinner size="sm" /> Loading your partners…
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <ul aria-label="Your partners" className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
              {rows.map((row) => {
                const detail = [row.partner.industry, eventsLabel(row.eventCount)].filter(Boolean).join(' · ')
                return (
                  <li key={row.partner.id}>
                    <button
                      type="button"
                      disabled={row.alreadyOnEvent}
                      onClick={() => onChoose({ kind: 'existing', partner: row.partner })}
                      className="flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">
                          {row.partner.company_name}
                          {row.alreadyOnEvent && <span className="font-normal text-gray-500"> (already on this event)</span>}
                        </span>
                        {detail && <span className="block truncate text-xs text-gray-500"> {detail}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {rows.length === 0 && !newName && (
            <p className="text-sm text-gray-500">
              {partners.length === 0
                ? "Your organization has no partners yet. Type the company's name to add the first one."
                : 'No partners match your search.'}
            </p>
          )}
          {newName && (
            <button
              type="button"
              onClick={() => onChoose({ kind: 'new' }, newName)}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-left text-sm font-medium text-primary-700 hover:bg-primary-50"
            >
              <span className="truncate">+ New partner "{newName}"</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}
