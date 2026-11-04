// Unit tests for what the Team page offers when assigning a manager to events
// (src/lib/eventAssignment.ts). The database is the authority; this only checks
// the page never offers an action that is certain to be refused.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventAssignmentRows } from '../src/lib/eventAssignment.ts'

const ev = (id, start, archived = false) => ({ id, name: id, start_date: start, archived_at: archived ? '2030-01-01T00:00:00Z' : null })
const rows = (events, assigned = []) => eventAssignmentRows(events, new Set(assigned))

test('a live, unassigned event can be assigned but not removed', () => {
  const [r] = rows([ev('a', '2030-01-01')])
  assert.deepEqual([r.assigned, r.canAssign, r.canRemove], [false, true, false])
})

test('an assigned event can be removed but not assigned again', () => {
  const [r] = rows([ev('a', '2030-01-01')], ['a'])
  assert.deepEqual([r.assigned, r.canAssign, r.canRemove], [true, false, true])
})

test('an archived, unassigned event is not listed at all', () => {
  assert.deepEqual(rows([ev('a', '2030-01-01', true)]), [])
})

test('an archived event the manager still holds can be removed, never assigned', () => {
  const [r] = rows([ev('a', '2030-01-01', true)], ['a'])
  assert.deepEqual([r.assigned, r.canAssign, r.canRemove], [true, false, true])
})

test('assigned events come first, then by start date; undated last', () => {
  const out = rows([ev('late', '2031-01-01'), ev('none', null), ev('mine', '2032-01-01'), ev('early', '2030-01-01')], ['mine'])
  assert.deepEqual(out.map((r) => r.event.id), ['mine', 'early', 'late', 'none'])
})

test('ids the manager holds in other organizations are ignored', () => {
  const out = rows([ev('a', '2030-01-01')], ['elsewhere'])
  assert.equal(out.length, 1)
  assert.equal(out[0].assigned, false)
})

test('no events gives an empty list', () => {
  assert.deepEqual(rows([]), [])
})
