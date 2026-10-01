import { supabase } from '@/lib/supabase'
import type {
  EventAttendee,
  EventInvitationRow,
  EventVisibility,
  OrganizationPerson,
  OrganizerEvent,
} from '@/lib/supabase'

export const EVENT_TIMEZONES: string[] =
  typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
    ? (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf('timeZone')
    : ['Africa/Accra', 'Europe/London', 'America/New_York', 'Asia/Dubai', 'UTC']

// The five lifecycle states the organizer works in. They are derived, not
// stored: `visibility` says whether it is published, `status` where it sits in
// time, and `archived_at` whether it is put away. Deriving keeps one source of
// truth per fact instead of a state column that can disagree with the dates.
export type EventLifecycle = 'draft' | 'published' | 'live' | 'completed' | 'archived'

export function eventLifecycle(event: OrganizerEvent): EventLifecycle {
  if (event.archived_at) return 'archived'
  if (event.visibility === 'draft') return 'draft'
  if (event.status === 'live') return 'live'
  if (event.status === 'past') return 'completed'
  return 'published'
}

export const LIFECYCLE_LABELS: Record<EventLifecycle, string> = {
  draft: 'Draft',
  published: 'Published',
  live: 'Live',
  completed: 'Completed',
  archived: 'Archived',
}

export const LIFECYCLE_BADGE: Record<EventLifecycle, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'gray'> = {
  draft: 'warning',
  published: 'primary',
  live: 'success',
  completed: 'default',
  archived: 'gray',
}

export const VISIBILITY_LABELS: Record<EventVisibility, string> = {
  draft: 'Draft — not visible to anyone outside your team',
  published: 'Public — listed for everyone on Rally',
  unlisted: 'Unlisted — only people you invite can find it',
}

export function readableError(error: { message?: string } | null, fallback: string): string {
  const message = error?.message?.trim()
  if (!message) return fallback
  // Database messages here are written for a person; Postgres internals are not.
  if (/^(permission denied|new row violates|duplicate key|null value|invalid input|violates)/i.test(message)) {
    if (/duplicate key/i.test(message)) return 'That already exists.'
    return fallback
  }
  return message
}

export async function listOrganizationEvents(
  orgId: string
): Promise<{ data: OrganizerEvent[]; counts: Record<string, number>; error: string | null }> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('organization_id', orgId)
    .order('start_date', { ascending: true, nullsFirst: false })

  if (error) return { data: [], counts: {}, error: readableError(error, 'Could not load events.') }

  const events = (data ?? []) as OrganizerEvent[]
  const counts: Record<string, number> = {}

  // One aggregate call rather than one per event — the same RPC the attendee
  // Events page uses, since registration rows are not broadly readable.
  if (events.length > 0) {
    const { data: countRows } = await supabase.rpc('get_event_registration_counts', {
      event_ids: events.map((e) => e.id),
    })
    for (const row of (countRows as { event_id: string; registration_count: number }[]) ?? []) {
      counts[row.event_id] = Number(row.registration_count) || 0
    }
  }

  return { data: events, counts, error: null }
}

export async function getEvent(
  eventId: string
): Promise<{ data: OrganizerEvent | null; error: string | null }> {
  const { data, error } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle()
  if (error) return { data: null, error: readableError(error, 'Could not load that event.') }
  return { data: (data as OrganizerEvent | null) ?? null, error: null }
}

export type EventInput = {
  name: string
  description: string
  location: string
  start_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
  capacity: number | null
  image_url: string
  timezone: string | null
  visibility: EventVisibility
}

export async function createEvent(
  orgId: string,
  userId: string,
  input: EventInput
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('events')
    .insert({
      ...input,
      organization_id: orgId,
      // Pinned to the caller because the INSERT policy requires it to match
      // auth.uid(); it cannot be forged.
      created_by: userId,
      owner_id: userId,
    })
    .select('id')
    .maybeSingle()

  if (error) return { id: null, error: readableError(error, 'Could not create that event.') }
  return { id: (data as { id: string } | null)?.id ?? null, error: null }
}

export async function updateEvent(
  eventId: string,
  patch: Partial<EventInput>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('events').update(patch).eq('id', eventId)
  if (error) return { error: readableError(error, 'Could not save those changes.') }
  return { error: null }
}

// Lifecycle moves are ordinary column updates; the database trigger decides
// whether each one is legal (publishing needs a name and a start date, an
// archived event is frozen, an event with registrations cannot go back to
// draft). The UI only has to not offer moves that will obviously fail.
export async function publishEvent(
  eventId: string,
  visibility: Exclude<EventVisibility, 'draft'> = 'published'
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('events').update({ visibility }).eq('id', eventId)
  if (error) return { error: readableError(error, 'Could not publish that event.') }
  return { error: null }
}

export async function setEventTimeStatus(
  eventId: string,
  status: 'upcoming' | 'live' | 'past'
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('events').update({ status }).eq('id', eventId)
  if (error) return { error: readableError(error, 'Could not update that event.') }
  return { error: null }
}

export async function setEventArchived(
  eventId: string,
  archived: boolean
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('events')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', eventId)
  if (error) return { error: readableError(error, 'Could not update that event.') }
  return { error: null }
}

export async function listEventAttendees(
  eventId: string
): Promise<{ data: EventAttendee[]; error: string | null }> {
  const { data, error } = await supabase.rpc('event_attendee_list', { target_event_id: eventId })
  if (error) return { data: [], error: readableError(error, 'Could not load attendees.') }
  return { data: (data ?? []) as EventAttendee[], error: null }
}

export async function listEventInvitations(
  eventId: string
): Promise<{ data: EventInvitationRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc('event_invitation_list', { target_event_id: eventId })
  if (error) return { data: [], error: readableError(error, 'Could not load invitations.') }
  return { data: (data ?? []) as EventInvitationRow[], error: null }
}

export async function inviteEventAttendee(
  eventId: string,
  email: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('invite_event_attendee', {
    target_event_id: eventId,
    invitee_email: email,
  })
  if (error) return { error: readableError(error, 'Could not send that invitation.') }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Organizer agenda management
// ---------------------------------------------------------------------------

export type OrganizerSession = {
  id: string
  event_id: string
  title: string
  description: string
  start_at: string
  end_at: string | null
  location: string
  session_type: string
  status: string
  display_order: number
  event_timezone: string | null
}

export const SESSION_TYPE_LABELS: Record<string, string> = {
  session: 'Session',
  keynote: 'Keynote',
  panel: 'Panel',
  workshop: 'Workshop',
  break: 'Break',
  networking: 'Networking',
}

export const SESSION_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  ended: 'Ended',
  cancelled: 'Cancelled',
}

export const SESSION_STATUS_BADGE: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'gray'> = {
  scheduled: 'primary',
  live: 'success',
  ended: 'gray',
  cancelled: 'error',
}

// A database error surfaces as a Postgres code in message/code depending on how
// the constraint or trigger raises it; match on both.
function mapSessionError(error: { message?: string; code?: string } | null, fallback: string): string {
  const code = error?.code ?? ''
  const message = error?.message?.trim() ?? ''
  if (code === '42501' || /manage this event/i.test(message)) return "You don't manage this event."
  if (/event_sessions_time_order|time_order/i.test(message) || code === '23514') {
    if (/time_order|end time/i.test(message)) return 'End time must be after start time.'
  }
  if (/title_not_blank/i.test(message)) return 'Give the session a title.'
  if (/title_length/i.test(message)) return 'Title is too long (200 characters max).'
  if (/archived/i.test(message)) return 'This event is archived. Restore it before changing its agenda.'
  const readable = readableError(error, fallback)
  return readable
}

export async function getEventAgenda(
  eventId: string
): Promise<{ data: OrganizerSession[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_event_agenda', { target_event_id: eventId })
  if (error) return { data: [], error: mapSessionError(error, 'Could not load the agenda.') }
  return { data: (data ?? []) as OrganizerSession[], error: null }
}

export type SessionInput = {
  title: string
  description: string | null
  start_at: string
  end_at: string | null
  location: string | null
  session_type: string
}

export async function createSession(
  eventId: string,
  input: SessionInput
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_sessions')
    .insert({ event_id: eventId, ...input })
  if (error) return { error: mapSessionError(error, 'Could not create that session. Please try again.') }
  return { error: null }
}

export async function updateSession(
  sessionId: string,
  patch: Partial<SessionInput> & { status?: string }
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_sessions').update(patch).eq('id', sessionId)
  if (error) return { error: mapSessionError(error, 'Could not save that session. Please try again.') }
  return { error: null }
}

export async function deleteSession(sessionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_sessions').delete().eq('id', sessionId)
  if (error) return { error: mapSessionError(error, 'Could not delete that session. Please try again.') }
  return { error: null }
}

export async function reorderSessions(
  eventId: string,
  sessionIds: string[]
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('reorder_event_sessions', {
    target_event_id: eventId,
    session_ids: sessionIds,
  })
  if (error) return { error: mapSessionError(error, 'Could not save the new order. Please try again.') }
  return { error: null }
}

export async function listOrganizationPeople(
  orgId: string
): Promise<{ data: OrganizationPerson[]; error: string | null }> {
  const { data, error } = await supabase.rpc('organization_people', { org_id: orgId })
  if (error) return { data: [], error: readableError(error, 'Could not load people.') }
  return { data: (data ?? []) as OrganizationPerson[], error: null }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function formatEventDate(event: OrganizerEvent): string {
  if (!event.start_date) return 'No date set'
  const start = new Date(`${event.start_date}T00:00:00`)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  if (event.end_date && event.end_date !== event.start_date) {
    const end = new Date(`${event.end_date}T00:00:00`)
    return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, opts)}`
  }
  return start.toLocaleDateString(undefined, opts)
}

export function formatEventTime(event: OrganizerEvent): string | null {
  if (!event.start_time) return null
  const trim = (t: string) => t.slice(0, 5)
  return event.end_time ? `${trim(event.start_time)} – ${trim(event.end_time)}` : trim(event.start_time)
}
