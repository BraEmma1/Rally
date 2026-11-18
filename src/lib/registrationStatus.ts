// What a registration's status means, in one place, for every organizer screen.
//
// The statuses are the four the database allows
// (event_registrations_status_allowed): registered, waitlisted, cancelled,
// checked_in. There is no "rejected".
//
// - CONFIRMED = registered or checked_in. It holds a seat: it counts toward
//   capacity, toward "N registered", and it may check in. This is the same rule
//   as is_registered_for_event, get_event_registration_counts, the capacity
//   check and the organizer count functions (migration 20261030000000).
// - waitlisted and cancelled are not confirmed and never check in. The database
//   refuses both (check_in_event_attendee, guard_registration_status_change);
//   the screens mirror it so they do not offer a button that will fail.
// - Arrival is read from checked_in_at, never from status: undoing a check-in
//   clears the timestamp and leaves status as 'checked_in'.
//
// Pure (no Supabase import) so it can be unit-tested in Node.

export type RegistrationStatus = 'registered' | 'waitlisted' | 'cancelled' | 'checked_in'

type Registration = { status: string; checked_in_at: string | null }

export function isConfirmedRegistration(status: string): boolean {
  return status === 'registered' || status === 'checked_in'
}

export function hasCheckedIn(r: Registration): boolean {
  return isConfirmedRegistration(r.status) && r.checked_in_at !== null
}

// May be checked in now: confirmed and not already arrived.
export function canCheckIn(r: Registration): boolean {
  return isConfirmedRegistration(r.status) && r.checked_in_at === null
}

export type RegistrationSummary = {
  confirmed: number
  checkedIn: number
  notCheckedIn: number
  waitlisted: number
  cancelled: number
}

export function summarizeRegistrations(rows: readonly Registration[]): RegistrationSummary {
  let confirmed = 0
  let checkedIn = 0
  let waitlisted = 0
  let cancelled = 0
  for (const r of rows) {
    if (isConfirmedRegistration(r.status)) {
      confirmed++
      if (r.checked_in_at !== null) checkedIn++
    } else if (r.status === 'waitlisted') {
      waitlisted++
    } else if (r.status === 'cancelled') {
      cancelled++
    }
  }
  return { confirmed, checkedIn, notCheckedIn: confirmed - checkedIn, waitlisted, cancelled }
}
