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
