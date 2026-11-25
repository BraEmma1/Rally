// Unit tests for choosing a package in Add Partner (src/lib/packageSelection.ts):
// what a package fills in, and when replacing the terms on screen would discard
// something the organizer did.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_TERMS,
  customizedFields,
  deliverableValuesOf,
  deliverablesPhrase,
  listFields,
  termsAreEmpty,
  termsFromPackage,
} from '../src/lib/packageSelection.ts'

const gold = { name: 'Gold', value_amount: 50000, value_currency: 'ghs' }
const goldItems = [
  { title: 'Logo on backdrop', description: null, category: 'Branding', quantity: null, due_date: null },
  { title: 'VIP passes', description: 'For the CEO', category: null, quantity: 4, due_date: '2027-02-01' },
]

test('a package fills the tier label, value, currency and deliverables, in template order', () => {
  const t = termsFromPackage(gold, goldItems)
  assert.equal(t.tier_label, 'Gold')
  assert.equal(t.value_amount, '50000')
  assert.equal(t.value_currency, 'GHS')
  assert.deepEqual(t.deliverables, [
    { title: 'Logo on backdrop', description: '', category: 'Branding', quantity: '', due_date: '' },
    { title: 'VIP passes', description: 'For the CEO', category: '', quantity: '4', due_date: '2027-02-01' },
  ])
})

test('a package with no suggested value fills no value and no currency', () => {
  const t = termsFromPackage({ name: 'Bronze', value_amount: null, value_currency: 'GHS' }, [])
  assert.equal(t.value_amount, '')
  assert.equal(t.value_currency, '')
  assert.deepEqual(t.deliverables, [])
})

test('untouched package terms are not customized', () => {
  const t = termsFromPackage(gold, goldItems)
  assert.deepEqual(customizedFields(structuredClone(t), t), [])
})

test('each kind of edit is reported, in a fixed order', () => {
  const base = termsFromPackage(gold, goldItems)
  const edited = structuredClone(base)
  edited.tier_label = 'Gold Plus'
  assert.deepEqual(customizedFields(edited, base), ['tier label'])
  edited.value_amount = '60000'
  assert.deepEqual(customizedFields(edited, base), ['tier label', 'commercial value'])
  edited.deliverables[1].quantity = '6'
  assert.deepEqual(customizedFields(edited, base), ['tier label', 'commercial value', 'deliverables'])
})

test('a changed currency alone counts as a changed commercial value', () => {
  const base = termsFromPackage(gold, goldItems)
  assert.deepEqual(customizedFields({ ...base, value_currency: 'USD' }, base), ['commercial value'])
})

test('adding, removing and reordering deliverables are all customizations', () => {
  const base = termsFromPackage(gold, goldItems)
  const extra = { title: 'Booth', description: '', category: '', quantity: '', due_date: '' }
  assert.deepEqual(customizedFields({ ...base, deliverables: [...base.deliverables, extra] }, base), ['deliverables'])
  assert.deepEqual(customizedFields({ ...base, deliverables: base.deliverables.slice(1) }, base), ['deliverables'])
  assert.deepEqual(customizedFields({ ...base, deliverables: [...base.deliverables].reverse() }, base), ['deliverables'])
})

test('an edit changed back is not a customization, and spacing or number format is not one', () => {
  const base = termsFromPackage(gold, goldItems)
  const same = structuredClone(base)
  same.tier_label = '  Gold '
  same.value_amount = '50000.00'
  same.value_currency = 'ghs'
  same.deliverables[1].quantity = ' 4'
  assert.deepEqual(customizedFields(same, base), [])
})

test('anything typed into a custom partnership counts against the empty baseline', () => {
  assert.deepEqual(customizedFields(EMPTY_TERMS, EMPTY_TERMS), [])
  assert.deepEqual(customizedFields({ ...EMPTY_TERMS, tier_label: 'Media partner' }, EMPTY_TERMS), ['tier label'])
  assert.deepEqual(customizedFields({ ...EMPTY_TERMS, value_amount: '100', value_currency: 'USD' }, EMPTY_TERMS), ['commercial value'])
})

test('termsAreEmpty is true only when nothing at all is filled in', () => {
  assert.equal(termsAreEmpty(EMPTY_TERMS), true)
  assert.equal(termsAreEmpty({ ...EMPTY_TERMS, tier_label: '  ' }), true)
  assert.equal(termsAreEmpty({ ...EMPTY_TERMS, value_currency: 'GHS' }), false)
  assert.equal(termsAreEmpty(termsFromPackage(gold, [])), false)
})

test('deliverableValuesOf drops the local draft key and nothing else', () => {
  const item = { key: 'k1', title: 'A', description: 'd', category: 'c', quantity: '2', due_date: '2027-01-01' }
  assert.deepEqual(deliverableValuesOf(item), { title: 'A', description: 'd', category: 'c', quantity: '2', due_date: '2027-01-01' })
})

test('field lists and counts read as English', () => {
  assert.equal(listFields(['tier label']), 'tier label')
  assert.equal(listFields(['tier label', 'deliverables']), 'tier label and deliverables')
  assert.equal(listFields(['tier label', 'commercial value', 'deliverables']), 'tier label, commercial value and deliverables')
  assert.equal(deliverablesPhrase(0), 'no deliverables')
  assert.equal(deliverablesPhrase(1), '1 deliverable')
  assert.equal(deliverablesPhrase(3), '3 deliverables')
})
