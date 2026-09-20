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
