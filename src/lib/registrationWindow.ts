// Registration open/close controls (migration 20261104000000), the pieces the
// pages share. No Supabase or React here, so the unit tests can import it.
//
// The database is the authority on whether registration is open: it decides
// inside register_for_event, and get_event_registration_states reports the
// same decision (event_registration_state) for display. The page never works
// the state out on its own. The one client-side calculation, eventEndsAt,
// only powers a form warning while the organizer is still typing dates that
// have not been saved yet.
import { utcToZonedDate, utcToZonedTime } from './sessionTime.ts'

export type RegistrationState = 'open' | 'closed' | 'deadline_passed' | 'ended' | 'unavailable'

const STATES: ReadonlySet<string> = new Set(['open', 'closed', 'deadline_passed', 'ended', 'unavailable'])

// One row of get_event_registration_states.
export type RegistrationWindow = {
  event_id: string
  registration_state: RegistrationState
  registration_closed_at: string | null
  registration_deadline: string | null
  ends_at: string | null
  // least(deadline, ends_at): when registration closes by itself.
  closes_at: string | null
  // The stored timezone is missing or not recognised, so the end is read in
  // UTC-12 (it can only close late, never early).
  timezone_fallback: boolean
}

// The function returns at most 200 events per call.
export const STATES_BATCH = 200

// Rows the page can trust, keyed by event. A row with a state this build does
// not know is dropped: an unknown state means "ask the server", not "open".
export function parseRegistrationWindows(data: unknown): Map<string, RegistrationWindow> {
  const out = new Map<string, RegistrationWindow>()
  if (!Array.isArray(data)) return out
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.event_id !== 'string' || typeof r.registration_state !== 'string') continue
    if (!STATES.has(r.registration_state)) continue
    const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
    out.set(r.event_id, {
      event_id: r.event_id,
      registration_state: r.registration_state as RegistrationState,
      registration_closed_at: text(r.registration_closed_at),
      registration_deadline: text(r.registration_deadline),
      ends_at: text(r.ends_at),
      closes_at: text(r.closes_at),
      timezone_fallback: r.timezone_fallback === true,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// What the attendee pages show
// ---------------------------------------------------------------------------

// The page's view of one event. When the server's state could not be read
// (the request failed, or the event was not returned) the page keeps its old
// date rule, `fallbackPast`, and leaves the final word to register_for_event.
export type RegistrationView = {
  // Registration has ended because the event is over.
  ended: boolean
  // A Register / Join waitlist button may be offered.
  open: boolean
  // Why it is closed, when it is closed but the event is not over.
  closedReason: 'closed' | 'deadline_passed' | null
}

export function registrationView(window: RegistrationWindow | undefined, fallbackPast: boolean): RegistrationView {
  if (!window) return { ended: fallbackPast, open: !fallbackPast, closedReason: null }
  const state = window.registration_state
  return {
    ended: state === 'ended',
    open: state === 'open',
    closedReason: state === 'closed' || state === 'deadline_passed' ? state : null,
  }
}

// The sentence an attendee reads instead of a Register button.
export function attendeeClosedMessage(window: RegistrationWindow | undefined, timeZone: string | null): string | null {
  if (!window) return null
  switch (window.registration_state) {
    case 'closed':
      return 'Registration for this event is closed.'
    case 'deadline_passed':
      return window.registration_deadline
        ? `Registration closed on ${formatInstant(window.registration_deadline, timeZone)}.`
        : 'The registration deadline for this event has passed.'
    case 'ended':
      return 'This event has ended, so registration is closed.'
    case 'unavailable':
      return 'This event is not open for registration.'
    default:
      return null
  }
}

// Shown next to an open Register button when a deadline will close it before
// the event ends. The end itself needs no announcement.
export function attendeeDeadlineNote(window: RegistrationWindow | undefined, timeZone: string | null): string | null {
  if (!window || window.registration_state !== 'open') return null
  if (!window.registration_deadline || !closesAtDeadline(window)) return null
  return `Registration closes ${formatInstant(window.registration_deadline, timeZone)}.`
}

// For a card with no room for a sentence.
export function shortClosedLabel(window: RegistrationWindow | undefined): string | null {
  if (!window) return null
  if (window.registration_state === 'closed' || window.registration_state === 'deadline_passed') return 'Registration closed'
  if (window.registration_state === 'ended') return 'Event ended'
  return null
}

function closesAtDeadline(window: RegistrationWindow): boolean {
  if (!window.registration_deadline) return false
  if (!window.ends_at) return true
  return Date.parse(window.registration_deadline) <= Date.parse(window.ends_at)
}

// ---------------------------------------------------------------------------
// What the organizer sees
// ---------------------------------------------------------------------------

export type OrganizerStatus = {
  // The headline: Open / Closed / Opens on publishing / Not available.
  label: string
  tone: 'success' | 'warning' | 'gray'
  // One sentence of detail.
  detail: string
  // What would have to change for registration to open again, when it is
  // closed for a reason Reopen cannot lift.
  hint: string | null
}

export function organizerStatus(
  window: RegistrationWindow,
  event: { visibility: string; archived_at: string | null; timezone: string | null; registration_closed_by?: string | null },
  me: string | null
): OrganizerStatus {
  const tz = event.timezone
  const by = (id: string | null | undefined) => (id && me && id === me ? ' by you' : id ? ' by a member of your team' : '')
  switch (window.registration_state) {
    case 'open': {
      const at = window.closes_at
      const detail = !at
        ? 'Open. No closing date yet.'
        : closesAtDeadline(window)
          ? `Open until the registration deadline, ${formatInstant(at, tz)}.`
          : `Open until the event ends, ${formatInstant(at, tz)}.`
      return { label: 'Open', tone: 'success', detail, hint: null }
    }
    case 'closed':
      return {
        label: 'Closed',
        tone: 'warning',
        detail: window.registration_closed_at
          ? `Closed${by(event.registration_closed_by)} on ${formatInstant(window.registration_closed_at, tz)}.`
          : 'Closed.',
        hint: null,
      }
    case 'deadline_passed':
      return {
        label: 'Closed',
        tone: 'warning',
        detail: window.registration_deadline
          ? `The registration deadline passed on ${formatInstant(window.registration_deadline, tz)}.`
          : 'The registration deadline has passed.',
        hint: 'Move or remove the deadline to open registration again.',
      }
    case 'ended':
      return {
        label: 'Closed',
        tone: 'gray',
        detail: 'The event has ended.',
        hint: 'Registration cannot reopen after an event ends. If the dates are wrong, correct them.',
      }
    default:
      if (event.archived_at) {
        return { label: 'Not available', tone: 'gray', detail: 'Archived events take no registrations.', hint: null }
      }
      return {
        label: window.registration_closed_at ? 'Closed' : 'Opens on publishing',
        tone: 'gray',
        detail: window.registration_closed_at
          ? 'Registration is closed and stays closed when you publish.'
          : 'Attendees can register once the event is published.',
        hint: null,
      }
  }
}

export const TIMEZONE_FALLBACK_WARNING =
  'This event has no recognised timezone, so Rally keeps registration open until its end in the latest timezone on Earth (UTC−12). That can be up to a day late. Set the event timezone so registration closes on time.'

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

// Postgres's legacy fallback zone (event_effective_timezone): UTC-12.
export const FALLBACK_TIMEZONE = 'Etc/GMT+12'

// A timezone the browser can format in, or null. Intl accepts IANA names
// (case-insensitively, as Postgres reads stored values). This is advisory: the
// database decides which names it accepts.
export function usableTimeZone(timeZone: string | null | undefined): string | null {
  const tz = timeZone?.trim()
  if (!tz) return null
  // IANA-style names only: Intl also accepts offsets such as "+05:00", which
  // Postgres refuses for an event.
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

// An instant in the event's timezone, with the zone named. Without one, the
// viewer's own clock is used and the text says so.
export function formatInstant(iso: string, timeZone: string | null | undefined): string {
  const date = new Date(iso)
  const tz = usableTimeZone(timeZone)
  const opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
  if (tz) return `${date.toLocaleString('en-US', { ...opts, timeZone: tz })} (${tz})`
  return `${date.toLocaleString('en-US', opts)} (your time)`
}

// How far the zone's wall clock is ahead of UTC at an instant, in ms.
function offsetAt(instant: number, timeZone: string): number {
  const parts: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))) {
    parts[p.type] = p.value
  }
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return wall - Math.floor(instant / 1000) * 1000
}

// "2027-03-01" + "17:00" on the wall in `timeZone` -> the UTC instant, as
// Postgres's `timestamp AT TIME ZONE` reads it. The offset is taken at the
// result, not at the naive guess, so a time near a daylight-saving change is
// not an hour out. (sessionTime's zonedToUtc takes it once, at the guess.)
export function wallClockToUtc(date: string, time: string, timeZone: string): string {
  const naive = Date.parse(`${date}T${time}:00Z`)
  const first = naive - offsetAt(naive, timeZone)
  const second = naive - offsetAt(first, timeZone)
  return new Date(second).toISOString()
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const hhmm = (time: string) => time.slice(0, 5)

// When the event ends: the same rule as event_ends_at in the database, for a
// form that is being edited. Last day = the later of the start and end dates;
// no end time = midnight after that day; a one-day event whose end time is not
// after its start time ends the next day; no start date = no end.
export function eventEndsAt(event: {
  start_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
  timezone: string | null
}): Date | null {
  if (!event.start_date) return null
  const tz = usableTimeZone(event.timezone) ?? FALLBACK_TIMEZONE
  const last = event.end_date && event.end_date > event.start_date ? event.end_date : event.start_date
  if (!event.end_time) return new Date(wallClockToUtc(nextDay(last), '00:00', tz))
  if (!event.end_date && event.start_time && hhmm(event.end_time) <= hhmm(event.start_time)) {
    return new Date(wallClockToUtc(nextDay(event.start_date), hhmm(event.end_time), tz))
  }
  return new Date(wallClockToUtc(last, hhmm(event.end_time), tz))
}

// The deadline as the date and time inputs show it, in the event's timezone.
export function deadlineInputs(iso: string | null, timeZone: string | null): { date: string; time: string } {
  const tz = usableTimeZone(timeZone)
  if (!iso || !tz) return { date: '', time: '' }
  return { date: utcToZonedDate(iso, tz), time: utcToZonedTime(iso, tz) }
}

// The inputs back to an instant. An empty date means "no deadline".
export function deadlineFromInputs(date: string, time: string, timeZone: string): string | null {
  if (!date) return null
  return wallClockToUtc(date, time, timeZone)
}
