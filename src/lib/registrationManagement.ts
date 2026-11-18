// Organizer registration management: what the detail dialog says and offers.
// The database decides (migration 20261102000000: event_registration_detail,
// organizer_cancel_event_registration, organizer_promote_waitlisted_registration);
// this module only words its answers, so the screen never offers an action the
// server would refuse and always says why one is missing.
//
// Pure (no Supabase import) so it can be unit-tested in Node.

export type RegistrationDetailAnswer = {
  question_id: string
  label: string
  kind: string
  archived: boolean
  answer: string | boolean | string[]
}

export type RegistrationDetail = {
  registration_id: string
  user_id: string
  full_name: string
  status: string
  registered_at: string
  checked_in_at: string | null
  cancelled_at: string | null
  cancelled_by_organizer: boolean
  waitlist_position: number | null
  waitlist_length: number
  capacity: number | null
  seats_taken: number
  event_open: boolean
  can_cancel: boolean
  can_promote: boolean
  answers: RegistrationDetailAnswer[]
}

// Status in the shared vocabulary: confirmed holds a seat; arrival is read from
// checked_in_at (undo clears it and leaves status alone).
export function detailStatusLabel(d: Pick<RegistrationDetail, 'status' | 'checked_in_at' | 'waitlist_position'>): string {
  if (d.status === 'cancelled') return 'Cancelled'
  if (d.status === 'waitlisted') return d.waitlist_position ? `Waitlisted · #${d.waitlist_position}` : 'Waitlisted'
  return d.checked_in_at ? 'Confirmed · checked in' : 'Confirmed'
}

export function seatsLine(d: Pick<RegistrationDetail, 'capacity' | 'seats_taken' | 'waitlist_length'>): string {
  const seats = d.capacity === null
    ? `${d.seats_taken.toLocaleString()} confirmed (no capacity limit)`
    : `${d.seats_taken.toLocaleString()} of ${d.capacity.toLocaleString()} places taken`
  return d.waitlist_length > 0 ? `${seats} · ${d.waitlist_length.toLocaleString()} waiting` : seats
}

// Why there is no Cancel button, or null when there is one.
export function cancelUnavailableReason(d: RegistrationDetail): string | null {
  if (d.can_cancel) return null
  if (d.status === 'cancelled') return null // nothing to explain: already cancelled
  if (!d.event_open) return 'This event is finished or archived, so its registrations are kept as they are.'
  if (d.checked_in_at) return 'This person has checked in. Undo the check-in on the Check-in tab first if they did not attend.'
  return 'This registration cannot be cancelled.'
}

// Why there is no Promote button for a waitlisted person, or null.
export function promoteUnavailableReason(d: RegistrationDetail): string | null {
  if (d.can_promote || d.status !== 'waitlisted') return null
  if (!d.event_open) return 'This event is finished or archived, so the waitlist cannot move.'
  if (d.capacity !== null && d.seats_taken >= d.capacity) {
    return 'The event is full. When someone cancels, or you raise the capacity, the waitlist moves up in order automatically.'
  }
  if ((d.waitlist_position ?? 0) > 1) return 'Places go to the waitlist in order, and someone has been waiting longer.'
  return 'This person cannot be promoted right now.'
}

export function cancelConfirmCopy(d: Pick<RegistrationDetail, 'status' | 'full_name'>): { title: string; body: string; action: string } {
  if (d.status === 'waitlisted') {
    return {
      title: 'Remove from the waitlist?',
      body: `${d.full_name} will lose their place on the waitlist and be notified. The record is kept. They can register again while registration is open, at the back of the queue.`,
      action: 'Remove from waitlist',
    }
  }
  return {
    title: 'Cancel this registration?',
    body: `${d.full_name} will lose their place and be notified. If anyone is waiting, the first person on the waitlist gets the place. The record is kept for reporting.`,
    action: 'Cancel registration',
  }
}

export function cancelResultMessage(name: string, previousStatus: string, promoted: number): string {
  const what = previousStatus === 'waitlisted' ? `${name} was removed from the waitlist.` : `${name}'s registration was cancelled.`
  if (promoted === 1) return `${what} The next person on the waitlist got the place.`
  if (promoted > 1) return `${what} ${promoted} people moved up from the waitlist.`
  return what
}
