// Unit tests for the organization partner list (src/lib/partnerDirectory.ts):
// name matching that mirrors the database's uniqueness rule, the list's order and
// search, the Add Partner picker, the delivery label, who may edit a partner, and
// the update payload for a partnership whose company details belong to a partner.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BASIC_PARTNER_FIELDS,
  buildDirectoryRows,
  canEditPartners,
  deliveredLabel,
  findPartnerByName,
  linkedPartnershipPatch,
  newPartnerName,
  normalizePartnerName,
  pickerRows,
} from '../src/lib/partnerDirectory.ts'

const T = '2026-10-01T00:00:00Z'
const partner = (id, company_name, over = {}) => ({
  id, organization_id: 'org-1', company_name, description: null, logo_url: null, industry: null, website: null,
  linkedin: null, contact_email: null, archived_at: null, created_at: T, updated_at: T, ...over,
})
const link = (partnership_id, partner_id, event_id, event_name, event_start_date, over = {}) => ({
  partnership_id, partner_id, event_id, event_name, event_start_date, event_lifecycle: 'published',
  event_archived: false, tier_label: null, status: 'active', owed_total: 0, owed_completed: 0, ...over,
})

const kora = partner('k-kora', 'Kora Payments', { industry: 'Fintech' })
const baobab = partner('k-baobab', 'Baobab Ventures', { industry: 'Investment' })
const sahel = partner('k-sahel', 'Sahel Cloud')
const zebra = partner('k-zebra', 'zebra Media')
const oldCo = partner('k-old', 'Old Co', { archived_at: '2026-09-01T00:00:00Z' })
const all = [zebra, kora, oldCo, baobab, sahel]

const links = [
  link('p-1', 'k-kora', 'e-ats', 'Africa Tech Summit 2027', '2027-03-01'),
  link('p-2', 'k-kora', 'e-fin', 'Africa FinTech 2027', '2027-06-01'),
  link('p-3', 'k-baobab', 'e-ats', 'Africa Tech Summit 2027', '2027-03-01'),
  link('p-4', 'k-sahel', 'e-energy', 'West Africa Energy', '2026-11-01'),
  link('p-5', 'k-old', 'e-old', 'Old Expo', '2027-09-01'),
]

test('a partner name is compared the way the database index compares it', () => {
  assert.equal(normalizePartnerName('  Kora   Payments '), 'kora payments')
  assert.equal(normalizePartnerName('kora payments'), 'kora payments')
  assert.equal(normalizePartnerName('KORA\tPayments'), 'kora payments')
})

test('findPartnerByName finds an active partner whatever the case or spacing', () => {
  assert.equal(findPartnerByName(all, 'KORA  payments'), kora)
  assert.equal(findPartnerByName(all, 'Zuri Logistics'), null)
})

test('findPartnerByName ignores archived partners, as the uniqueness rule does', () => {
  assert.equal(findPartnerByName(all, 'old co'), null)
})

test('the list leaves archived partners out unless they are asked for', () => {
  const ids = (rows) => rows.map((r) => r.partner.id)
  assert.ok(!ids(buildDirectoryRows(all, links, { query: '', showArchived: false })).includes('k-old'))
  assert.ok(ids(buildDirectoryRows(all, links, { query: '', showArchived: true })).includes('k-old'))
})

test('the list is ordered by most recent event, then name, with partners without events last', () => {
  const rows = buildDirectoryRows(all, links, { query: '', showArchived: false })
  assert.deepEqual(rows.map((r) => r.partner.id), ['k-kora', 'k-baobab', 'k-sahel', 'k-zebra'])
  assert.equal(rows[0].lastEventDate, '2027-06-01')
  assert.equal(rows[3].lastEventDate, null)
})

test('names tie-break without regard to case', () => {
  const a = partner('a', 'alpha'), b = partner('b', 'Beta'), c = partner('c', 'charlie')
  const rows = buildDirectoryRows([c, b, a], [], { query: '', showArchived: false })
  assert.deepEqual(rows.map((r) => r.partner.company_name), ['alpha', 'Beta', 'charlie'])
})

test("a partner's events are listed most recent first, then by name", () => {
  const extra = [...links, link('p-6', 'k-kora', 'e-aaa', 'Accra Fin Day', '2027-06-01')]
  const row = buildDirectoryRows(all, extra, { query: '', showArchived: false })[0]
  assert.deepEqual(row.events.map((e) => e.event_name), ['Accra Fin Day', 'Africa FinTech 2027', 'Africa Tech Summit 2027'])
})

test('search matches the name or the industry, ignoring case', () => {
  const q = (query) => buildDirectoryRows(all, links, { query, showArchived: false }).map((r) => r.partner.id)
  assert.deepEqual(q('fin'), ['k-kora'])
  assert.deepEqual(q('BAOBAB'), ['k-baobab'])
  assert.deepEqual(q('  '), ['k-kora', 'k-baobab', 'k-sahel', 'k-zebra'])
})

test('the picker offers active partners by name, with event counts and those already on the event', () => {
  const rows = pickerRows(all, links, 'e-ats', '')
  assert.deepEqual(rows.map((r) => r.partner.id), ['k-baobab', 'k-kora', 'k-sahel', 'k-zebra'])
  const byId = Object.fromEntries(rows.map((r) => [r.partner.id, r]))
  assert.equal(byId['k-kora'].eventCount, 2)
  assert.equal(byId['k-kora'].alreadyOnEvent, true)
  assert.equal(byId['k-baobab'].alreadyOnEvent, true)
  assert.equal(byId['k-sahel'].alreadyOnEvent, false)
  assert.equal(byId['k-zebra'].eventCount, 0)
})

test('the picker filters by the search', () => {
  assert.deepEqual(pickerRows(all, links, 'e-ats', 'sah').map((r) => r.partner.id), ['k-sahel'])
})

test('the picker counts an event once even with two partnerships on it', () => {
  const twice = [...links, link('p-7', 'k-sahel', 'e-energy', 'West Africa Energy', '2026-11-01')]
  assert.equal(pickerRows(all, twice, 'e-ats', 'sahel')[0].eventCount, 1)
})

test('a new partner is offered only for a name not already in the list', () => {
  assert.equal(newPartnerName('  Zuri Logistics ', all), 'Zuri Logistics')
  assert.equal(newPartnerName('', all), null)
  assert.equal(newPartnerName('   ', all), null)
  assert.equal(newPartnerName('kora  payments', all), null)
  // An archived name may be reused, as the database allows.
  assert.equal(newPartnerName('Old Co', all), 'Old Co')
})

test('the delivery label counts completed deliverables over all of them', () => {
  assert.equal(deliveredLabel(3, 5), '3/5 delivered')
  assert.equal(deliveredLabel(0, 2), '0/2 delivered')
  assert.equal(deliveredLabel(0, 0), null)
})

test('only owners and admins edit partners', () => {
  assert.equal(canEditPartners('owner'), true)
  assert.equal(canEditPartners('admin'), true)
  assert.equal(canEditPartners('manager'), false)
  assert.equal(canEditPartners(null), false)
})

test("a linked partnership's update carries the event's own fields and none of the partner's", () => {
  const input = {
    company_name: 'Kora Payments', description: 'd', logo_url: 'https://x/logo.png', industry: 'Fintech',
    website: 'https://kora.example/', linkedin: null, tier_label: 'Gold', value_amount: 100, value_currency: 'GHS',
    internal_notes: 'note', representative_email: 'rep@kora.example',
  }
  const patch = linkedPartnershipPatch(input)
  assert.deepEqual(Object.keys(patch).sort(), ['internal_notes', 'representative_email', 'tier_label', 'value_amount', 'value_currency'])
  assert.deepEqual(patch, { tier_label: 'Gold', value_amount: 100, value_currency: 'GHS', internal_notes: 'note', representative_email: 'rep@kora.example' })
  for (const f of BASIC_PARTNER_FIELDS) assert.ok(!(f in patch), f)
  assert.deepEqual([...BASIC_PARTNER_FIELDS], ['company_name', 'description', 'logo_url', 'industry', 'website', 'linkedin'])
})
