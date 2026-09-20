import { supabase } from '@/lib/supabase'

// Front-end bindings for the Phase D organizer RPCs. Every read and write here
// goes through those functions — the client never updates event_registrations
// directly, and check-in state is always read from checked_in_at, never from
// status (undo clears the timestamp and leaves the status alone).
//
// The RPC messages are written for a person to read, so they are passed through
// unchanged; Postgres internals get a neutral fallback.
function readableError(error: { message?: string } | null, fallback: string): string {
  const message = error?.message?.trim()
  if (!message) return fallback
  if (/^(permission denied|new row violates|duplicate key|null value|invalid input|violates)/i.test(message)) {
    return fallback
  }
  return message
}

// One row of the door list, from find_event_attendees. checked_in_at is the
// authoritative "did this person arrive" signal.
export type CheckInRow = {
  user_id: string
  full_name: string
  job_title: string
  company: string
  photo_url: string
  status: string
  registered_at: string
  checked_in_at: string | null
}

export type CheckInResult = {
  already_checked_in: boolean
  checked_in_at: string | null
  error: string | null
}

export async function listCheckInRows(eventId: string): Promise<{
  data: CheckInRow[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('find_event_attendees', {
    target_event_id: eventId,
    search: '',
  })
  if (error) return { data: [], error: readableError(error, 'Could not load the check-in list.') }
  return { data: (data ?? []) as CheckInRow[], error: null }
}

export async function searchCheckInRows(
  eventId: string,
  search: string
): Promise<{ data: CheckInRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc('find_event_attendees', {
    target_event_id: eventId,
    search,
  })
  if (error) return { data: [], error: readableError(error, 'Could not search the attendee list.') }
  return { data: (data ?? []) as CheckInRow[], error: null }
}

export async function checkInAttendee(eventId: string, userId: string): Promise<CheckInResult> {
  const { data, error } = await supabase
    .rpc('check_in_event_attendee', {
      target_event_id: eventId,
      target_user_id: userId,
    })
    .maybeSingle()

  if (error) {
    return { already_checked_in: false, checked_in_at: null, error: readableError(error, 'Check-in failed.') }
  }
  const row = data as { already_checked_in: boolean; checked_in_at: string | null } | null
  return {
    already_checked_in: row?.already_checked_in ?? false,
    checked_in_at: row?.checked_in_at ?? null,
    error: null,
  }
}

export async function undoCheckIn(eventId: string, userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('undo_event_check_in', {
    target_event_id: eventId,
    target_user_id: userId,
  })
  if (error) return { error: readableError(error, 'Could not undo that check-in.') }
  return { error: null }
}

// Real counts over real rows, from event_activity_counts: registrations,
// checked in (by timestamp), and connections made at the event.
export type ActivityCounts = {
  registrations: number
  checked_in: number
  cancelled: number
  connections_made: number
  invitations_pending: number
  invitations_accepted: number
}

export async function fetchActivityCounts(eventId: string): Promise<{
  data: ActivityCounts | null
  error: string | null
}> {
  const { data, error } = await supabase
    .rpc('event_activity_counts', { target_event_id: eventId })
    .maybeSingle()

  if (error) return { data: null, error: readableError(error, 'Could not load activity counts.') }
  if (!data) return { data: null, error: null }
  const row = data as {
    registrations: string | number
    checked_in: string | number
    cancelled: string | number
    connections_made: string | number
    invitations_pending: string | number
    invitations_accepted: string | number
  }
  return {
    data: {
      registrations: Number(row.registrations) || 0,
      checked_in: Number(row.checked_in) || 0,
      cancelled: Number(row.cancelled) || 0,
      connections_made: Number(row.connections_made) || 0,
      invitations_pending: Number(row.invitations_pending) || 0,
      invitations_accepted: Number(row.invitations_accepted) || 0,
    },
    error: null,
  }
}

// The event networking directory, from event_attendee_directory. Returns the
// public professional card only — no email or phone — plus whether the caller
// is already connected. Available only to people registered for the event.
export type EventDirectoryEntry = {
  user_id: string
  full_name: string
  job_title: string
  company: string
  industry: string
  location: string
  photo_url: string
  already_connected: boolean
}

export async function listEventDirectory(eventId: string): Promise<{
  data: EventDirectoryEntry[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('event_attendee_directory', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: readableError(error, 'Could not load the attendee directory.') }
  return { data: (data ?? []) as EventDirectoryEntry[], error: null }
}

// An ordinary connection carrying event context, created through the existing
// connect_with_event_attendee path. Not a separate connection system.
export async function connectEventAttendee(
  eventId: string,
  userId: string,
  relationship: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('connect_with_event_attendee', {
    target_event_id: eventId,
    target_user_id: userId,
    relationship,
  })
  if (error) return { error: readableError(error, 'Could not create that connection.') }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Event networking analytics — organizer-facing reads over the Phase D
// analytics RPCs. Every function is scoped to one event id; authorization is
// the backend's (require_event_analytics_access).
// ---------------------------------------------------------------------------

export type NetworkingOverview = {
  registered_attendees: number
  checked_in_attendees: number
  networking_participants: number
  attendees_without_networking: number
  participation_percent: number
  connections_made: number
  opportunities_total: number
  opportunities_value: number
  unavailable_metrics: string[]
}

export async function fetchNetworkingOverview(eventId: string): Promise<{
  data: NetworkingOverview | null
  error: string | null
}> {
  const { data, error } = await supabase
    .rpc('event_networking_overview', { target_event_id: eventId })
    .maybeSingle()

  if (error) return { data: null, error: readableError(error, 'Could not load networking analytics.') }
  if (!data) return { data: null, error: null }
  const row = data as {
    registered_attendees: string | number
    checked_in_attendees: string | number
    networking_participants: string | number
    attendees_without_networking: string | number
    participation_percent: string | number
    connections_made: string | number
    opportunities_total: string | number
    opportunities_value: string | number
    unavailable_metrics: string[] | null
  }
  return {
    data: {
      registered_attendees: Number(row.registered_attendees) || 0,
      checked_in_attendees: Number(row.checked_in_attendees) || 0,
      networking_participants: Number(row.networking_participants) || 0,
      attendees_without_networking: Number(row.attendees_without_networking) || 0,
      participation_percent: Number(row.participation_percent) || 0,
      connections_made: Number(row.connections_made) || 0,
      opportunities_total: Number(row.opportunities_total) || 0,
      opportunities_value: Number(row.opportunities_value) || 0,
      unavailable_metrics: row.unavailable_metrics ?? [],
    },
    error: null,
  }
}

export type NetworkingTimelineBucket = {
  bucket_start: string
  bucket_interval: string
  connections_made: number
}

export async function fetchNetworkingTimeline(eventId: string): Promise<{
  data: NetworkingTimelineBucket[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('event_networking_timeline', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: readableError(error, 'Could not load the activity timeline.') }
  return {
    data: (data ?? []).map((row: Record<string, unknown>) => {
      const r = row as {
        bucket_start: string
        bucket_interval: string
        connections_made: string | number
      }
      return {
        bucket_start: r.bucket_start,
        bucket_interval: r.bucket_interval,
        connections_made: Number(r.connections_made) || 0,
      }
    }),
    error: null,
  }
}

export type IndustryActivityRow = {
  industry: string
  participants: number
  connections_made: number
  participant_share: number
  industry_known: boolean
}

export async function fetchIndustryActivity(eventId: string): Promise<{
  data: IndustryActivityRow[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('event_industry_activity', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: readableError(error, 'Could not load industry activity.') }
  return {
    data: (data ?? []).map((row: Record<string, unknown>) => {
      const r = row as {
        industry: string | null
        participants: string | number
        connections_made: string | number
        participant_share: string | number
        industry_known: boolean
      }
      return {
        industry: r.industry ?? 'Unknown',
        participants: Number(r.participants) || 0,
        connections_made: Number(r.connections_made) || 0,
        participant_share: Number(r.participant_share) || 0,
        industry_known: r.industry_known,
      }
    }),
    error: null,
  }
}

export type IndustryConnectionRow = {
  industry_from: string
  industry_to: string
  connections_made: number
}

export async function fetchIndustryConnections(eventId: string): Promise<{
  data: IndustryConnectionRow[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('event_industry_connections', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: readableError(error, 'Could not load industry connections.') }
  return {
    data: (data ?? []).map((row: Record<string, unknown>) => {
      const r = row as {
        industry_from: string | null
        industry_to: string | null
        connections_made: string | number
      }
      return {
        industry_from: r.industry_from ?? 'Unknown',
        industry_to: r.industry_to ?? 'Unknown',
        connections_made: Number(r.connections_made) || 0,
      }
    }),
    error: null,
  }
}

export type OpportunityBreakdownRow = {
  stage: string
  opportunities: number
  total_value: number
}

export async function fetchOpportunityBreakdown(eventId: string): Promise<{
  data: OpportunityBreakdownRow[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('event_opportunity_breakdown', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: readableError(error, 'Could not load the opportunity breakdown.') }
  return {
    data: (data ?? []).map((row: Record<string, unknown>) => {
      const r = row as {
        stage: string | null
        opportunities: string | number
        total_value: string | number
      }
      return {
        stage: r.stage ?? 'Unspecified',
        opportunities: Number(r.opportunities) || 0,
        total_value: Number(r.total_value) || 0,
      }
    }),
    error: null,
  }
}
