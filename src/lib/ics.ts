// Builds a calendar file (.ics) for an event entirely in the browser, so
// "Add to Calendar" needs no backend. Times are written as floating local time
// (no zone), which every calendar app opens at the wall-clock time shown on
// the event; an event with no start time becomes an all-day entry.

type IcsEvent = {
  id: string
  name: string
  description: string
  location: string
  start_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/

function ymd(value: string): [number, number, number] | null {
  const m = DATE_RE.exec(value)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function p2(n: number): string {
  return String(n).padStart(2, '0')
}

function dateOnly(y: number, m: number, d: number): string {
  return `${y}${p2(m)}${p2(d)}`
}

function clock(time: string): string {
  const [h, m, s] = time.split(':').map(Number)
  return `${p2(h || 0)}${p2(m || 0)}${p2(s || 0)}`
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

const encoder = new TextEncoder()

// Descriptions are capped at 1000 characters. Counted in code points, not UTF-16
// units, so the cut can never land between the halves of an emoji.
function truncate(value: string, max = 1000): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max).join('')
}

// Lines longer than 75 octets are folded, per RFC 5545. The limit is in UTF-8
// bytes, not characters: Japanese is 3 bytes a character and emoji are 4, so a
// character count would let non-English text overshoot. Folding walks whole
// code points, so a character (or a surrogate pair) is never split across
// lines. A continuation line begins with one space, which counts toward its 75.
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const size = encoder.encode(ch).length
    if (bytes + size > limit) {
      parts.push(current)
      current = ''
      bytes = 0
      limit = 74
    }
    current += ch
    bytes += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function buildEventIcs(event: IcsEvent): string | null {
  const start = event.start_date ? ymd(event.start_date) : null
  if (!start) return null
  const end = (event.end_date ? ymd(event.end_date) : null) ?? start
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rally//Events//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@rally`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${escapeText(event.name)}`,
  ]

  if (event.start_time) {
    lines.push(`DTSTART:${dateOnly(...start)}T${clock(event.start_time)}`)
    lines.push(`DTEND:${dateOnly(...end)}T${clock(event.end_time || event.start_time)}`)
  } else {
    // All-day: the end date is exclusive, so it is the day after the last day.
    const after = new Date(end[0], end[1] - 1, end[2] + 1)
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(...start)}`)
    lines.push(`DTEND;VALUE=DATE:${dateOnly(after.getFullYear(), after.getMonth() + 1, after.getDate())}`)
  }

  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
  if (event.description) lines.push(`DESCRIPTION:${escapeText(truncate(event.description))}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function downloadIcs(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type IcsSession = {
  id: string
  title: string
  description: string
  location: string
  start_at: string
  end_at: string | null
}

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// One calendar entry per session, written as absolute UTC instants so every
// calendar app shows the right local time whatever zone the event is in.
export function buildSessionsIcs(calendarName: string, sessions: IcsSession[]): string | null {
  if (sessions.length === 0) return null
  const stamp = utcStamp(new Date().toISOString())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rally//Schedule//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeText(calendarName)}`]
  for (const s of sessions) {
    lines.push('BEGIN:VEVENT', `UID:${s.id}@rally`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(s.title)}`, `DTSTART:${utcStamp(s.start_at)}`)
    lines.push(`DTEND:${utcStamp(s.end_at ?? s.start_at)}`)
    if (s.location) lines.push(`LOCATION:${escapeText(s.location)}`)
    if (s.description) lines.push(`DESCRIPTION:${escapeText(truncate(s.description))}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
