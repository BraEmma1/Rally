// Session time helpers shared by the Agenda and My Schedule pages.
// Times render in the event's timezone when set; when it is not, callers pass
// undefined and the browser's zone is used silently — the page discloses that
// rather than inventing a timezone abbreviation.

export function dayKey(date: Date, timeZone: string | undefined): string {
  // en-CA gives a stable YYYY-MM-DD wall-clock date for grouping.
  return date.toLocaleDateString('en-CA', { timeZone })
}

export function formatTime(date: Date, timeZone: string | undefined): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
}

export function formatRange(start: Date, end: Date | null, timeZone: string | undefined): string {
  if (!end || end.getTime() === start.getTime()) return formatTime(start, timeZone)
  return `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)}`
}

export function formatDayChip(
  date: Date,
  timeZone: string | undefined
): { weekday: string; day: string } {
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'short', timeZone }),
    day: date.toLocaleDateString('en-US', { day: 'numeric', timeZone }),
  }
}

export function formatDayHeading(date: Date, timeZone: string | undefined): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  })
}

export function isSessionLive(
  session: { start_at: string; end_at: string | null; status: string },
  now: number
): boolean {
  if (session.status === 'cancelled') return false
  if (!session.end_at) return false
  const start = new Date(session.start_at).getTime()
  const end = new Date(session.end_at).getTime()
  return now >= start && now < end
}

// ---------------------------------------------------------------------------
// Wall-clock <-> absolute instant conversion for the event's timezone.
//
// The organizer enters session dates and times as they appear on the wall in
// the event's timezone; event_sessions stores timestamptz instants. These
// helpers convert explicitly through the event's zone rather than letting the
// browser's zone decide silently.
// ---------------------------------------------------------------------------

function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  )
  return asUtc - instant.getTime()
}

// "2026-10-05" + "09:00" in the event zone -> UTC instant.
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const naive = Date.parse(`${date}T${time}:00Z`)
  return new Date(naive - tzOffsetMs(new Date(naive), timeZone)).toISOString()
}

// UTC instant -> "YYYY-MM-DD" calendar date in the event zone.
export function utcToZonedDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone })
}

// UTC instant -> "HH:mm" wall-clock time in the event zone.
export function utcToZonedTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
