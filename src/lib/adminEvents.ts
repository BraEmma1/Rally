import { supabase } from '@/lib/supabase'
import type { AdminEventDetail, AdminEventRow, AdminEventStatus, AdminEventVisibility, AdminPage } from '@/lib/supabase'
import { readableError } from '@/lib/admin'

// Platform-wide event data for the admin workspace, read only through
// admin_list_events and admin_get_event. Both refuse unless the caller is an
// active platform admin, include drafts and unlisted events, and return counts
// rather than attendee identities. Read-only by design: nothing here edits,
// publishes, archives or deletes an event.

export type EventSort = 'start_desc' | 'start_asc' | 'newest' | 'name'

export type EventQuery = {
  search?: string
  visibility?: AdminEventVisibility | 'all'
  status?: AdminEventStatus | 'all'
  organizationId?: string | null
  from?: string | null
  to?: string | null
  includeArchived?: boolean
  sort?: EventSort
  page: number
  pageSize: number
}

export async function listEvents(
  query: EventQuery
): Promise<{ data: AdminPage<AdminEventRow> | null; error: string | null }> {
  const search = query.search?.trim()
  const { data, error } = await supabase.rpc('admin_list_events', {
    p_search: search ? search : null,
    p_visibility: query.visibility && query.visibility !== 'all' ? query.visibility : null,
    p_status: query.status && query.status !== 'all' ? query.status : null,
    p_organization_id: query.organizationId || null,
    p_from: query.from || null,
    p_to: query.to || null,
    p_include_archived: Boolean(query.includeArchived),
    p_sort: query.sort ?? 'start_desc',
    p_limit: query.pageSize,
    p_offset: query.page * query.pageSize,
  })
  if (error) return { data: null, error: readableError(error, 'Could not load events.') }
  return { data: data as AdminPage<AdminEventRow>, error: null }
}

// null data with no error means there is no event with that id.
export async function getEvent(eventId: string): Promise<{ data: AdminEventDetail | null; error: string | null }> {
  const { data, error } = await supabase.rpc('admin_get_event', { p_event_id: eventId })
  if (error) return { data: null, error: readableError(error, 'Could not load this event.') }
  return { data: (data as AdminEventDetail | null) ?? null, error: null }
}

// Calendar dates are stored without a zone, so they are parsed as local
// midnight to stop the day shifting for viewers west of UTC.
function day(value: string, withYear: boolean): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}

export function formatEventDates(start: string | null, end: string | null): string {
  if (!start) return 'No date set'
  if (!end || end === start) return day(start, true)
  return `${day(start, false)} – ${day(end, true)}`
}

export function formatEventTimes(start: string | null, end: string | null, timezone: string | null): string | null {
  if (!start) return null
  const trim = (t: string) => t.slice(0, 5)
  const range = end ? `${trim(start)} – ${trim(end)}` : trim(start)
  return timezone ? `${range} (${timezone})` : range
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
