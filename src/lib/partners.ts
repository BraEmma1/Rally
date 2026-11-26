import { supabase } from '@/lib/supabase'
import { eventLifecycle, readableError } from '@/lib/events'
import type { OrganizerEvent } from '@/lib/supabase'
import type { DirectoryPartner, PartnerEventLink } from '@/lib/partnerDirectory'
import type { PartnershipStatus } from '@/lib/partnerships'

// ---------------------------------------------------------------------------
// The organization's partner list -- the Supabase side.
//
// Who may do what is the database's decision (RLS on organization_partners):
//   * read and create: owners, admins, and managers assigned to an event of the
//     organization
//   * edit, archive, restore: owners and admins only, because an edit reaches
//     every event the partner is on
// A partner's events come from event_partnerships, whose RLS returns only the
// events the caller manages -- so a manager's tags and history are their own
// events, and what was agreed at other events never reaches them.
// ---------------------------------------------------------------------------

/** What a partner's form sends. `organization_id` is set on create only, and never changes. */
export type PartnerDetailsInput = {
  company_name: string
  description: string | null
  logo_url: string | null
  industry: string | null
  website: string | null
  linkedin: string | null
  contact_email: string | null
}

type PgError = { message?: string; code?: string; details?: string } | null

function isDuplicate(error: PgError): boolean {
  return error?.code === '23505' && /organization_partners_active_name_unique/.test((error.message ?? '') + ' ' + (error.details ?? ''))
}

function mapPartnerError(error: PgError, fallback: string, denied: string, name?: string): string {
  const code = error?.code ?? ''
  const all = (error?.message ?? '') + ' ' + (error?.details ?? '')
  if (isDuplicate(error)) return (name ? name.trim() : 'That partner') + ' is already one of your partners.'
  if (code === '42501' || /row-level security|permission denied/i.test(all)) return denied
  if (code === '23514') {
    if (/safe_url/.test(all)) return 'Links must be full URLs starting with https://'
    if (/email/.test(all)) return 'Enter a valid contact email address.'
    if (/not_blank/.test(all)) return 'Give this partner a company name.'
    if (/_length/.test(all)) return 'One of the fields is too long. Shorten it and try again.'
    return fallback
  }
  // The database's own messages ("Kora Payments already exists. Rename one of
  // them first.") are written for a person and pass through.
  return readableError(error, fallback)
}

function partnerPayload(input: PartnerDetailsInput) {
  return {
    company_name: input.company_name,
    description: input.description,
    logo_url: input.logo_url,
    industry: input.industry,
    website: input.website,
    linkedin: input.linkedin,
    contact_email: input.contact_email,
  }
}

export async function listOrganizationPartners(
  orgId: string
): Promise<{ data: DirectoryPartner[]; error: string | null }> {
  const { data, error } = await supabase
    .from('organization_partners')
    .select('*')
    .eq('organization_id', orgId)
    .order('company_name')
  if (error) return { data: [], error: mapPartnerError(error, 'Unable to load your partners.', 'Unable to load your partners.') }
  return { data: (data ?? []) as DirectoryPartner[], error: null }
}

export async function getOrganizationPartner(
  partnerId: string
): Promise<{ data: DirectoryPartner | null; error: string | null }> {
  const { data, error } = await supabase
    .from('organization_partners')
    .select('*')
    .eq('id', partnerId)
    .maybeSingle()
  if (error) return { data: null, error: mapPartnerError(error, 'Unable to load this partner.', 'Unable to load this partner.') }
  return { data: (data as DirectoryPartner | null) ?? null, error: null }
}

type LinkRow = {
  id: string
  partner_id: string
  event_id: string
  tier_label: string | null
  status: PartnershipStatus
  event: Pick<OrganizerEvent, 'id' | 'name' | 'start_date' | 'status' | 'visibility' | 'archived_at' | 'organization_id'>
  obligations: { direction: string; status: string }[] | null
}

/**
 * The organization's partnerships that are linked to a partner, as the caller
 * may see them; one partner's only when `partnerId` is given. One request: the
 * event and the obligations are embedded, never fetched per row. The foreign
 * keys are named because other tables join partnerships to events too.
 */
export async function listPartnerEventLinks(
  orgId: string,
  partnerId?: string
): Promise<{ data: PartnerEventLink[]; error: string | null }> {
  let query = supabase
    .from('event_partnerships')
    .select(
      'id, partner_id, event_id, tier_label, status, ' +
        'event:events!event_partnerships_event_id_fkey!inner(id, name, start_date, status, visibility, archived_at, organization_id), ' +
        'obligations:event_partnership_obligations!event_partnership_obligations_partnership_fk(direction, status)'
    )
    .not('partner_id', 'is', null)
    .eq('event.organization_id', orgId)
  if (partnerId) query = query.eq('partner_id', partnerId)
  const { data, error } = await query
  if (error) return { data: [], error: readableError(error, "Unable to load your partners' events.") }
  const rows = (data ?? []) as unknown as LinkRow[]
  return {
    data: rows.map((row) => {
      const owed = (row.obligations ?? []).filter((o) => o.direction === 'organizer_to_partner')
      return {
        partnership_id: row.id,
        partner_id: row.partner_id,
        event_id: row.event_id,
        event_name: row.event.name,
        event_start_date: row.event.start_date ?? null,
        event_lifecycle: eventLifecycle(row.event as OrganizerEvent),
        event_archived: row.event.archived_at !== null,
        tier_label: row.tier_label,
        status: row.status,
        owed_total: owed.length,
        owed_completed: owed.filter((o) => o.status === 'completed').length,
      }
    }),
    error: null,
  }
}

/** created_by is the database's (auth.uid()); archived_at is never sent here. */
export async function createOrganizationPartner(
  orgId: string,
  input: PartnerDetailsInput
): Promise<{ data: DirectoryPartner | null; error: string | null; duplicate?: boolean }> {
  const { data, error } = await supabase
    .from('organization_partners')
    .insert({ organization_id: orgId, ...partnerPayload(input) })
    .select('*')
    .single()
  if (error || !data) {
    return {
      data: null,
      error: mapPartnerError(error, 'Unable to add this partner.', 'You cannot add partners to this organization.', input.company_name),
      ...(isDuplicate(error) ? { duplicate: true } : {}),
    }
  }
  return { data: data as DirectoryPartner, error: null }
}

/** Reaches every event the partner is on (archived events catch up when restored). */
export async function updateOrganizationPartner(
  partnerId: string,
  input: PartnerDetailsInput
): Promise<{ error: string | null; duplicate?: boolean }> {
  const { data, error } = await supabase
    .from('organization_partners')
    .update(partnerPayload(input))
    .eq('id', partnerId)
    .select('id')
  if (error) {
    return {
      error: mapPartnerError(error, 'Unable to save this partner.', 'Only owners and admins can change partners.', input.company_name),
      ...(isDuplicate(error) ? { duplicate: true } : {}),
    }
  }
  // RLS turns a refused update into zero rows, not an error.
  if (!data || data.length === 0) return { error: 'Only owners and admins can change partners.' }
  return { error: null }
}

export async function setOrganizationPartnerArchived(
  partnerId: string,
  archived: boolean
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('organization_partners')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', partnerId)
    .select('id')
  if (error) {
    return {
      error: mapPartnerError(
        error,
        archived ? 'Unable to archive this partner.' : 'Unable to restore this partner.',
        'Only owners and admins can change partners.'
      ),
    }
  }
  if (!data || data.length === 0) return { error: 'Only owners and admins can change partners.' }
  return { error: null }
}
