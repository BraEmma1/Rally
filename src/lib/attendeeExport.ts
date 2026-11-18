// CSV export of the organizer attendee list. The database does the reading
// (event_attendee_export, migration 20261101000000): the full search/filter
// result, in the list's order, in chunks of up to 1000 rows behind the same gate
// as the list. This module turns those rows into a safe CSV file.
//
// Pure (no Supabase import) so it can be unit-tested in Node.
import { isConfirmedRegistration } from './registrationStatus.ts'

export const EXPORT_CHUNK_SIZE = 1000

// What one exported attendee carries (a subset of the list row).
export type ExportAttendee = {
  user_id: string
  full_name: string
  email: string | null
  phone: string | null
  company: string
  job_title: string
  status: string
  registered_at: string
  checked_in_at: string | null
  marketing_consent: boolean
  marketing_consent_at: string | null
}

// ---- CSV safety ------------------------------------------------------------
// A cell a spreadsheet would read as a formula (=, +, -, @, or a leading tab or
// carriage return) is prefixed with an apostrophe, so it is shown as text and
// never evaluated (OWASP "CSV injection"). Every cell is then quoted, with
// embedded quotes doubled, so commas and line breaks cannot split a row.
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function csvRow(cells: Array<string | number | boolean | null | undefined>): string {
  return cells.map(csvCell).join(',')
}

// ---- columns -----------------------------------------------------------------
export const EXPORT_HEADERS = [
  'Name',
  'Email',
  'Phone',
  'Company',
  'Job title',
  'Registration status',
  'Registered at (UTC)',
  'Checked in',
  'Checked in at (UTC)',
  'Marketing consent',
  'Marketing consent recorded at (UTC)',
] as const

// Registration status in the shared vocabulary: confirmed holds a seat; arrival
// is a separate column, read from checked_in_at (undo leaves status alone).
export function registrationStatusLabel(status: string): string {
  if (isConfirmedRegistration(status)) return 'Confirmed'
  if (status === 'waitlisted') return 'Waitlisted'
  if (status === 'cancelled') return 'Cancelled'
  return status
}

// "2026-11-18 19:25:29" in UTC: unambiguous, sorts as text, and every
// spreadsheet reads it as a date.
export function exportTimestamp(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

export function attendeeCsvRow(a: ExportAttendee): string {
  const arrived = isConfirmedRegistration(a.status) && a.checked_in_at !== null
  return csvRow([
    a.full_name,
    a.email ?? '',
    a.phone ?? '',
    a.company,
    a.job_title,
    registrationStatusLabel(a.status),
    exportTimestamp(a.registered_at),
    arrived ? 'Yes' : 'No',
    arrived ? exportTimestamp(a.checked_in_at) : '',
    a.marketing_consent ? 'Yes' : 'No',
    exportTimestamp(a.marketing_consent_at),
  ])
}

// The whole file. A UTF-8 byte order mark lets Excel read accented names
// correctly; CRLF line ends are what RFC 4180 specifies.
export function attendeesCsv(rows: readonly ExportAttendee[]): string {
  return '﻿' + [csvRow([...EXPORT_HEADERS]), ...rows.map(attendeeCsvRow)].join('\r\n') + '\r\n'
}

// ---- reading every chunk -------------------------------------------------------
export type ExportChunk = { rows: ExportAttendee[]; total: number; error: string | null }

// Reads chunk after chunk until the reported total is reached or a chunk comes
// back short. Rows are de-duplicated by attendee, so a registration that moves
// while the export runs is never written twice.
export async function collectAttendeeExport(
  fetchChunk: (offset: number, size: number) => Promise<ExportChunk>,
  onProgress?: (done: number, total: number) => void,
  size = EXPORT_CHUNK_SIZE
): Promise<{ rows: ExportAttendee[]; error: string | null }> {
  const seen = new Set<string>()
  const rows: ExportAttendee[] = []
  for (let offset = 0; ; offset += size) {
    const chunk = await fetchChunk(offset, size)
    if (chunk.error) return { rows: [], error: chunk.error }
    for (const r of chunk.rows) {
      if (seen.has(r.user_id)) continue
      seen.add(r.user_id)
      rows.push(r)
    }
    onProgress?.(rows.length, chunk.total)
    if (chunk.rows.length < size || offset + size >= chunk.total) break
  }
  return { rows, error: null }
}

// "big-event-attendees-2026-11-18.csv"; filters are named so two exports of the
// same event are told apart.
export function exportFileName(eventName: string, filter: string, today = new Date()): string {
  const slug = eventName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const date = today.toISOString().slice(0, 10)
  const scope = filter && filter !== 'all' ? `-${filter.replace(/_/g, '-')}` : ''
  return `${slug || 'event'}-attendees${scope}-${date}.csv`
}
