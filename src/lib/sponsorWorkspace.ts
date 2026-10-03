import { supabase } from '@/lib/supabase'
import { readableError } from '@/lib/events'
import {
  listPartnershipDocuments,
  signPartnershipDocument,
  signPartnershipDocumentDownload,
  type PartnershipDocument,
} from '@/lib/partnershipDocuments'

// ---------------------------------------------------------------------------
// The sponsor side of a partnership -- data layer only.
//
// There is no UI in this file and there should not be: the Sponsor Workspace
// screens are designed separately. What this does is state the contract in
// TypeScript, so that whoever builds those screens does not have to infer the
// shape of three RPCs from a migration, and so the compiler notices if the
// backend and the frontend disagree.
//
// Everything here is READ-ONLY, deliberately. A sponsor cannot change terms,
// tiers, roles, deliverables, requirements, obligation status, documents or
// document visibility; those write paths are organizer-only in the database and
// adding a helper for them here would only invite someone to try.
//
// Authorization is never done in this file. Every function below calls a
// contract that re-authorizes the caller in the database:
//
//   authenticated user -> organization membership -> linked partnership
//
// never account_type. A professional who accepts a sponsorship invitation keeps
// account_type = 'attendee' and becomes an owner of the sponsor organization,
// so there is no account type to check and nothing to gate the UI on except
// whether these calls return anything.
// ---------------------------------------------------------------------------

/**
 * One row of `my_sponsor_partnerships()`, and of `my_sponsor_partnership(id)`:
 * the two contracts return the same columns on purpose, so a card in the list
 * and the header of a detail page can share this type and never disagree.
 *
 * Every field here is sponsor-safe by decision, not by accident. The row
 * carries no `internal_notes`, no `representative_email` or other contact
 * detail, no `created_by` or any other internal user id, and no `package_id` --
 * nothing that leads into the organizer's private notes or package library.
 */
export type SponsorPartnership = {
  partnership_id: string
  event_id: string
  event_name: string
  event_start_date: string | null
  event_end_date: string | null
  event_location: string | null
  /** 'upcoming' | 'live' | 'past', the organizer's own event lifecycle. */
  event_status: string
  /**
   * The event has been archived by the organizer. The partnership is still
   * returned -- history does not disappear -- so this is a label, not a filter.
   */
  event_archived: boolean
  organizer_organization_id: string | null
  organizer_organization_name: string | null
  organizer_organization_logo_url: string | null
  /** Which of the caller's organizations this partnership belongs to. */
  sponsor_organization_id: string
  sponsor_organization_name: string | null
  /** The company name as it appears on the agreement. */
  company_name: string
  /** This partnership's own tier snapshot, e.g. 'Gold'. Never a live package. */
  tier_label: string | null
  /** 'active' | 'completed' | 'cancelled' -- never 'draft' or 'invited'. */
  status: SponsorPartnershipStatus
  acknowledged_at: string
  created_at: string
  /** The negotiated figure for THIS partnership, not a package's suggestion. */
  value_amount: number | null
  value_currency: string | null
  /** 'sponsor' | 'exhibitor' | 'media_partner' | 'supporting_partner' | 'other' */
  roles: string[]
  deliverables_total: number
  deliverables_completed: number
  requirements_total: number
  requirements_completed: number
  overall_total: number
  overall_completed: number
  /**
   * Server-computed, and NULL when there are no obligations at all -- not 0 and
   * not 100, because neither is true of a partnership with nothing agreed yet.
   * Render the empty case as "nothing yet" rather than as a full or empty bar.
   */
  overall_percent: number | null
}

/**
 * A sponsor only ever sees these three. 'draft' and 'invited' are the organizer
 * still deciding, and a pending invitation is reviewed through the phase 3B
 * invitation screen instead -- not here.
 */
export type SponsorPartnershipStatus = 'active' | 'completed' | 'cancelled'

/** One row of `my_sponsor_partnership_obligations(id)`. */
export type SponsorObligation = {
  id: string
  /**
   * 'organizer_to_partner' is what the organizer owes the sponsor, shown as
   * Deliverables. 'partner_to_organizer' is what the sponsor owes, shown as
   * Requirements. Both arrive in one call; split on this.
   */
  direction: ObligationDirection
  title: string
  description: string | null
  category: string | null
  quantity: number | null
  due_date: string | null
  /** 'pending' | 'in_progress' | 'completed', set by the organizer. */
  status: ObligationStatus
  /** When it was completed. WHO completed it is organizer-internal. */
  completed_at: string | null
  display_order: number
}

export type ObligationDirection = 'organizer_to_partner' | 'partner_to_organizer'
export type ObligationStatus = 'pending' | 'in_progress' | 'completed'

export const DELIVERABLE: ObligationDirection = 'organizer_to_partner'
export const REQUIREMENT: ObligationDirection = 'partner_to_organizer'

function mapSponsorError(
  error: { message?: string; code?: string; details?: string } | null,
  fallback: string
): string {
  const all = (error?.message ?? '') + ' ' + (error?.details ?? '')
  if (error?.code === '42501' || /permission denied/i.test(all)) {
    return 'Please sign in to see your partnerships.'
  }
  return readableError(error, fallback)
}

function toPartnership(row: SponsorPartnership): SponsorPartnership {
  return {
    ...row,
    // bigint arrives as a string over the wire.
    deliverables_total: Number(row.deliverables_total),
    deliverables_completed: Number(row.deliverables_completed),
    requirements_total: Number(row.requirements_total),
    requirements_completed: Number(row.requirements_completed),
    overall_total: Number(row.overall_total),
    overall_completed: Number(row.overall_completed),
    overall_percent: row.overall_percent === null ? null : Number(row.overall_percent),
    value_amount: row.value_amount === null ? null : Number(row.value_amount),
    roles: row.roles ?? [],
  }
}

/**
 * Every partnership the signed-in user may read as a sponsor, newest event
 * first.
 *
 * This spans ALL of their sponsor organizations -- a person may represent more
 * than one company -- so group by `sponsor_organization_id` if that matters to
 * the screen. The filtering is done in the database: there is no broad table to
 * query and nothing to filter client-side.
 *
 * An empty array means "you have no partnerships", not "you are not allowed".
 * There is no state in which this errors for an ordinary signed-in user.
 */
export async function listMySponsorPartnerships(): Promise<{
  data: SponsorPartnership[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('my_sponsor_partnerships')
  if (error) {
    return { data: [], error: mapSponsorError(error, 'Unable to load your partnerships.') }
  }
  return { data: ((data ?? []) as SponsorPartnership[]).map(toPartnership), error: null }
}

/**
 * One partnership, re-authorized from scratch.
 *
 * Knowing the id grants nothing: an id belonging to someone else returns null,
 * exactly as an id that does not exist does. Treat null as "not found" and show
 * the same thing for both -- distinguishing them is what would turn this into
 * an enumeration oracle.
 */
export async function getMySponsorPartnership(
  partnershipId: string
): Promise<{ data: SponsorPartnership | null; error: string | null }> {
  const { data, error } = await supabase.rpc('my_sponsor_partnership', {
    target_partnership_id: partnershipId,
  })
  if (error) {
    return { data: null, error: mapSponsorError(error, 'Unable to load this partnership.') }
  }
  const rows = (data ?? []) as SponsorPartnership[]
  return { data: rows.length ? toPartnership(rows[0]) : null, error: null }
}

/**
 * Both halves of the agreement in one call, deliverables first.
 *
 * These are the partnership's actual obligations. A package's default
 * deliverables were copied once when the partnership was created and are never
 * read again, so what comes back is what the partnership says today.
 */
export async function listMySponsorPartnershipObligations(
  partnershipId: string
): Promise<{ data: SponsorObligation[]; error: string | null }> {
  const { data, error } = await supabase.rpc('my_sponsor_partnership_obligations', {
    target_partnership_id: partnershipId,
  })
  if (error) {
    return { data: [], error: mapSponsorError(error, 'Unable to load this partnership.') }
  }
  return { data: (data ?? []) as SponsorObligation[], error: null }
}

/** Deliverables and requirements already split, for convenience. */
export function splitObligations(obligations: SponsorObligation[]): {
  deliverables: SponsorObligation[]
  requirements: SponsorObligation[]
} {
  return {
    deliverables: obligations.filter((o) => o.direction === DELIVERABLE),
    requirements: obligations.filter((o) => o.direction === REQUIREMENT),
  }
}

/**
 * Shared documents, through the phase 5B contract unchanged.
 *
 * Nothing sponsor-specific was needed: `get_partnership_documents` already
 * returns only `visibility = 'shared'` rows to a sponsor member, and the bucket
 * stays private with 60-second signed URLs. Re-exported here so the workspace
 * has one place to import from, and so it is obvious that a sponsor never sees
 * an internal document -- there is no call that would return one.
 */
export const listMySponsorPartnershipDocuments = listPartnershipDocuments
export const signMySponsorDocument = signPartnershipDocument
export const signMySponsorDocumentDownload = signPartnershipDocumentDownload
export type { PartnershipDocument }
