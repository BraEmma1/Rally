// Unit tests for the partnership package form (src/lib/packageForm.ts).
// The database is the authority (migration 20261007000000, phase 5A); these check
// that the screen states the same rules before a write is attempted, normalizes
// the way the trigger does, and only offers Delete when the trigger would allow it.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_PACKAGE_VALUES,
  PACKAGE_NAME_MAX,
  deliverableCountLabel,
  movedIds,
  nextDisplayOrder,
  packageCanBeDeleted,
  packageFormChanged,
  packageInputFrom,
  packageUsageLabel,
  packageValuesFrom,
  splitPackages,
  validatePackage,
} from '../src/lib/packageForm.ts'

const v = (over = {}) => ({ ...EMPTY_PACKAGE_VALUES, name: 'Gold', ...over })

test('a package needs a name, within the 80 characters the table allows', () => {
  assert.match(validatePackage(v({ name: '' })), /name/)
  assert.match(validatePackage(v({ name: '   ' })), /name/)
  assert.equal(validatePackage(v({ name: 'x'.repeat(PACKAGE_NAME_MAX) })), null)
  assert.match(validatePackage(v({ name: 'x'.repeat(PACKAGE_NAME_MAX + 1) })), /80 characters/)
  // Trimmed before measuring, as the trigger trims before the CHECK.
  assert.equal(validatePackage(v({ name: '  ' + 'x'.repeat(PACKAGE_NAME_MAX) + '  ' })), null)
})

test('the description is capped at 4000 characters', () => {
  assert.equal(validatePackage(v({ description: 'd'.repeat(4000) })), null)
  assert.match(validatePackage(v({ description: 'd'.repeat(4001) })), /4000/)
})

test('a suggested value is optional, but amount and currency go together', () => {
  assert.equal(validatePackage(v()), null)
  assert.equal(validatePackage(v({ value_amount: '50000', value_currency: 'GHS' })), null)
  assert.equal(validatePackage(v({ value_amount: '0', value_currency: 'usd' })), null)
  assert.match(validatePackage(v({ value_amount: '50000' })), /currency/)
  assert.match(validatePackage(v({ value_currency: 'GHS' })), /amount/)
})

test('the amount is a non-negative number and the currency three letters', () => {
  assert.match(validatePackage(v({ value_amount: '-1', value_currency: 'GHS' })), /not negative/)
  assert.match(validatePackage(v({ value_amount: 'abc', value_currency: 'GHS' })), /number/)
  assert.match(validatePackage(v({ value_amount: '10', value_currency: 'GH' })), /three-letter/)
  assert.match(validatePackage(v({ value_amount: '10', value_currency: 'GH5' })), /three-letter/)
  assert.match(validatePackage(v({ value_amount: '10', value_currency: 'CEDI' })), /three-letter/)
})

test('form values become the row the trigger would store', () => {
  assert.deepEqual(
    packageInputFrom({ name: '  Gold  ', description: '  ', value_amount: ' 12500.5 ', value_currency: ' ghs ' }),
    { name: 'Gold', description: null, value_amount: 12500.5, value_currency: 'GHS' }
  )
  assert.deepEqual(packageInputFrom(v()), {
    name: 'Gold',
    description: null,
    value_amount: null,
    value_currency: null,
  })
  // A zero amount is a recorded value, not a blank.
  assert.equal(packageInputFrom(v({ value_amount: '0', value_currency: 'USD' })).value_amount, 0)
})

test('a saved package round-trips through the form unchanged', () => {
  const pkg = { name: 'Silver', description: null, value_amount: 25000, value_currency: 'USD' }
  const values = packageValuesFrom(pkg)
  assert.deepEqual(values, { name: 'Silver', description: '', value_amount: '25000', value_currency: 'USD' })
  assert.equal(packageFormChanged(values, values), false)
})

test('only a real change counts as unsaved', () => {
  const saved = packageValuesFrom({ name: 'Gold', description: 'Top tier', value_amount: 100, value_currency: 'GHS' })
  assert.equal(packageFormChanged(saved, { ...saved, name: ' Gold ' }), false)
  assert.equal(packageFormChanged(saved, { ...saved, value_currency: 'ghs' }), false)
  assert.equal(packageFormChanged(saved, { ...saved, value_amount: '100.00' }), false)
  assert.equal(packageFormChanged(saved, { ...saved, name: 'Gold Plus' }), true)
  assert.equal(packageFormChanged(saved, { ...saved, description: '' }), true)
  assert.equal(packageFormChanged(saved, { ...saved, value_amount: '101' }), true)
})

test('Delete is offered only for a package no partnership was created from', () => {
  assert.equal(packageCanBeDeleted({ partnership_count: 0 }), true)
  assert.equal(packageCanBeDeleted({ partnership_count: 1 }), false)
  assert.equal(packageCanBeDeleted({ partnership_count: 12 }), false)
})

test('archived packages are listed apart, in their saved order', () => {
  const rows = [
    { id: 'a', archived_at: null },
    { id: 'b', archived_at: '2026-11-01T00:00:00Z' },
    { id: 'c', archived_at: null },
  ]
  const { active, archived } = splitPackages(rows)
  assert.deepEqual(active.map((r) => r.id), ['a', 'c'])
  assert.deepEqual(archived.map((r) => r.id), ['b'])
})

test('a new row goes after everything already there', () => {
  assert.equal(nextDisplayOrder([]), 0)
  assert.equal(nextDisplayOrder([{ display_order: 0 }, { display_order: 1 }]), 2)
  // Gaps and duplicates left by earlier edits do not cause a collision.
  assert.equal(nextDisplayOrder([{ display_order: 4 }, { display_order: 1 }, { display_order: 4 }]), 5)
})

test('moving an item reorders the ids, and never past either end', () => {
  assert.deepEqual(movedIds(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'])
  assert.deepEqual(movedIds(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b'])
  assert.equal(movedIds(['a', 'b', 'c'], 0, -1), null)
  assert.equal(movedIds(['a', 'b', 'c'], 2, 1), null)
  assert.equal(movedIds(['a'], 0, 1), null)
  assert.equal(movedIds(['a', 'b'], 5, -1), null)
})

test('counts read naturally', () => {
  assert.equal(packageUsageLabel(0), 'Not used by any partner yet')
  assert.equal(packageUsageLabel(1), 'Used by 1 partner')
  assert.equal(packageUsageLabel(3), 'Used by 3 partners')
  assert.equal(deliverableCountLabel(0), 'No deliverables yet')
  assert.equal(deliverableCountLabel(1), '1 deliverable')
  assert.equal(deliverableCountLabel(4), '4 deliverables')
})
