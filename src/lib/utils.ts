import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatRelativeDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`
  if (diffDays <= 7) return `In ${diffDays} days`
  return formatDate(d)
}

export function initials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:'])

// Returns an https(s) URL, or null when the value cannot be made into one.
// A bare domain gets an https:// prefix; javascript:, data: and friends are rejected.
export function normalizeUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw || '').trim().replace(/^\/+/, '')
  if (!trimmed) return null
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
  try {
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    if (!SAFE_URL_PROTOCOLS.has(url.protocol) || !url.hostname) return null
    return url.toString()
  } catch {
    return null
  }
}

export function isSafeUrl(raw: string | null | undefined): boolean {
  return normalizeUrl(raw) !== null
}

export function displayUrl(raw: string): string {
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

const PROFILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Extracts a Rally profile id from a bare UUID or a /p/<uuid> profile URL.
// Mirrors the logic ScanQRPage uses to resolve scanned or pasted QR payloads.
export function extractProfileId(raw: string): string | null {
  const trimmed = raw.trim()
  const urlMatch = trimmed.match(/\/p\/([0-9a-f-]{36})/i)
  if (urlMatch && PROFILE_ID_RE.test(urlMatch[1])) return urlMatch[1]
  if (PROFILE_ID_RE.test(trimmed)) return trimmed
  return null
}

// Parses a date-only string (YYYY-MM-DD) as a local calendar date so it does
// not slip a day in time zones behind UTC; anything else falls back to Date.
function parseCalendarDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
  return isNaN(d.getTime()) ? null : d
}

// "Apr 14, 2027", "Apr 14–16, 2027" or "Apr 30 – May 2, 2027".
export function formatDateRange(start: string | null | undefined, end?: string | null): string {
  if (!start) return 'Dates to be announced'
  const s = parseCalendarDate(start)
  if (!s) return 'Dates to be announced'
  const e = end ? parseCalendarDate(end) : null
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const year = s.getFullYear()
  if (!e || e.getTime() === s.getTime()) return `${md(s)}, ${year}`
  if (e.getFullYear() !== year) return `${md(s)}, ${year} – ${md(e)}, ${e.getFullYear()}`
  if (e.getMonth() === s.getMonth()) return `${md(s)}–${e.getDate()}, ${year}`
  return `${md(s)} – ${md(e)}, ${year}`
}

// "10:30 AM" from an HH:MM[:SS] time string.
export function formatClock(time: string | null | undefined): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return time
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
