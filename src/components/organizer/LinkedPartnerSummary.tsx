import { Link } from 'react-router-dom'
import type { Partnership } from '@/lib/partnerships'
import { displayUrl } from '@/lib/utils'
import { PartnerLogo } from './PartnerCommon'

// A linked partnership's company details, read-only. They belong to the
// partner: the database keeps this copy equal to it and refuses edits made
// here, so the way to change them is the partner -- for owners and admins,
// one link away. Managers see the details without the link.

export function ManagedOnPartner({ partnerId, canEdit }: { partnerId: string; canEdit: boolean }) {
  return (
    <p className="text-sm text-gray-500">
      Managed on the partner.
      {canEdit && (
        <>
          {' '}
          <Link to={'/organizer/partners/' + partnerId} className="font-medium text-primary-700 hover:text-primary-800">
            Edit partner
          </Link>
        </>
      )}
    </p>
  )
}

export function LinkedPartnerSummary({
  partnership,
  canEdit,
}: {
  partnership: Pick<Partnership, 'partner_id' | 'company_name' | 'description' | 'logo_url' | 'industry' | 'website' | 'linkedin'>
  canEdit: boolean
}) {
  const links = [partnership.website, partnership.linkedin].filter((u): u is string => Boolean(u)).map(displayUrl)
  return (
    <div data-testid="linked-partner" className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start gap-3">
        <PartnerLogo name={partnership.company_name} logoUrl={partnership.logo_url} size="md" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900">{partnership.company_name}</p>
          {(partnership.industry || links.length > 0) && (
            <p className="break-words text-sm text-gray-600">{[partnership.industry, ...links].filter(Boolean).join(' · ')}</p>
          )}
          {partnership.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{partnership.description}</p>
          )}
          {partnership.partner_id && (
            <div className="mt-2">
              <ManagedOnPartner partnerId={partnership.partner_id} canEdit={canEdit} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
