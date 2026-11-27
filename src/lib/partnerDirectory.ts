// ---------------------------------------------------------------------------
// The organization's partner list -- the pure part: ordering, search, name
// matching, labels and the update payload for a linked partnership. No
// Supabase here (type-only imports), so it runs under node's unit tests.
//
// A partner holds a company's basic details once for the whole organization.
// A partnership linked to it (`partner_id`) keeps a copy of those six details
// that the DATABASE keeps equal to the partner: linking fills them, editing the
// partner updates every linked event, and any update that would make the copy
// differ is refused. So a screen never writes those six on a linked
// partnership; it edits the partner instead.
// ---------------------------------------------------------------------------
import type { EventLifecycle } from '@/lib/events'
import type { PartnershipInput, PartnershipStatus } from '@/lib/partnerships'
import type { OrgRole } from '@/lib/supabase'

/** One row of organization_partners. */
export type DirectoryPartner = {
  id: string
  organization_id: string
  company_name: string
  description: string | null
  logo_url: string | null
  industry: string | null
  website: string | null
  linkedin: string | null
  /** A default for the representative when the partner is added to an event. Not synced. */
  contact_email: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

/**
 * One event partnership linked to a partner, as the caller may see it. RLS on
 * event_partnerships returns only events the caller manages, so a manager's
 * links are their own events and nothing else.
 */
export type PartnerEventLink = {
  partnership_id: string
  partner_id: string
  event_id: string
  event_name: string
  event_start_date: string | null
  event_lifecycle: EventLifecycle
  event_archived: boolean
  tier_label: string | null
  status: PartnershipStatus
  /** organizer_to_partner obligations: what was promised to the partner. */
  owed_total: number
  owed_completed: number
}

export type DirectoryRow = {
  partner: DirectoryPartner
  events: PartnerEventLink[]
  lastEventDate: string | null
}

export type PickerRow = {
  partner: DirectoryPartner
  eventCount: number
  alreadyOnEvent: boolean
}

/** The six columns a linked partnership takes from its partner. */
export const BASIC_PARTNER_FIELDS = [
  'company_name',
  'description',
  'logo_url',
  'industry',
  'website',
  'linkedin',
] as const

/**
 * The same comparison as the database's unique index on active partners:
 * lower(btrim(regexp_replace(company_name, '\s+', ' ', 'g'))).
 */
export function normalizePartnerName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** The active partner with this name, if there is one. Archived names may be reused. */
export function findPartnerByName(partners: DirectoryPartner[], name: string): DirectoryPartner | null {
  const key = normalizePartnerName(name)
  if (!key) return null
  return partners.find((p) => p.archived_at === null && normalizePartnerName(p.company_name) === key) ?? null
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

// Dates are ISO yyyy-mm-dd strings, so string order is date order.
function byDateDesc(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? 1 : -1
}

function matches(partner: DirectoryPartner, query: string): boolean {
  const q = normalizePartnerName(query)
  if (!q) return true
  return (
    normalizePartnerName(partner.company_name).includes(q) ||
    normalizePartnerName(partner.industry ?? '').includes(q)
  )
}

function linksByPartner(links: PartnerEventLink[]): Map<string, PartnerEventLink[]> {
  const map = new Map<string, PartnerEventLink[]>()
  for (const l of links) {
    const list = map.get(l.partner_id)
    if (list) list.push(l)
    else map.set(l.partner_id, [l])
  }
  return map
}

/** The Partners page: most recent event first, then name; partners without events last. */
export function buildDirectoryRows(
  partners: DirectoryPartner[],
  links: PartnerEventLink[],
  opts: { query: string; showArchived: boolean }
): DirectoryRow[] {
  const grouped = linksByPartner(links)
  return partners
    .filter((p) => (opts.showArchived || p.archived_at === null) && matches(p, opts.query))
    .map((partner) => {
      const events = [...(grouped.get(partner.id) ?? [])].sort(
        (a, b) => byDateDesc(a.event_start_date, b.event_start_date) || byName(a.event_name, b.event_name)
      )
      return { partner, events, lastEventDate: events[0]?.event_start_date ?? null }
    })
    .sort(
      (a, b) =>
        byDateDesc(a.lastEventDate, b.lastEventDate) || byName(a.partner.company_name, b.partner.company_name)
    )
}

/** Add Partner's list: active partners by name, with what the caller can see of their events. */
export function pickerRows(
  partners: DirectoryPartner[],
  links: PartnerEventLink[],
  eventId: string,
  query: string
): PickerRow[] {
  const grouped = linksByPartner(links)
  return partners
    .filter((p) => p.archived_at === null && matches(p, query))
    .map((partner) => {
      const own = grouped.get(partner.id) ?? []
      return {
        partner,
        eventCount: new Set(own.map((l) => l.event_id)).size,
        alreadyOnEvent: own.some((l) => l.event_id === eventId),
      }
    })
    .sort((a, b) => byName(a.partner.company_name, b.partner.company_name))
}

/** The name to offer as "+ New partner", or null when it is blank or already a partner. */
export function newPartnerName(query: string, partners: DirectoryPartner[]): string | null {
  const name = query.replace(/\s+/g, ' ').trim()
  if (!name) return null
  return findPartnerByName(partners, name) ? null : name
}

export function deliveredLabel(completed: number, total: number): string | null {
  if (total <= 0) return null
  return completed + '/' + total + ' delivered'
}

/**
 * Editing a partner changes it at every event, so only owners and admins are
 * offered it. Managers ask one of them. The database enforces the same rule.
 */
export function canEditPartners(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * The update for a partnership linked to a partner: the event's own fields
 * only. Sending the partner's six -- even unchanged on screen, since the form
 * normalizes them -- would be refused as drift.
 */
export function linkedPartnershipPatch(input: PartnershipInput): Partial<PartnershipInput> {
  return {
    tier_label: input.tier_label,
    value_amount: input.value_amount,
    value_currency: input.value_currency,
    internal_notes: input.internal_notes,
    representative_email: input.representative_email,
  }
}
