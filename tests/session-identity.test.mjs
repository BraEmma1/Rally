// Unit tests for Q-33 (src/lib/sessionIdentity.ts): which person a tab is for,
// decided from the session actually stored, so no tab shows one person while its
// requests go out as another. The server still authorizes every request; these
// check only that what the tab shows follows the stored token.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identityStep, sessionOwnerFromStored } from '../src/lib/sessionIdentity.ts'

const A = '11111111-0000-4000-8000-000000000001'
const B = '22222222-0000-4000-8000-000000000002'
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (sub) => `${b64url({ alg: 'none' })}.${b64url({ sub, exp: 4102444800 })}.sig`
const stored = (sub, userId = sub) => JSON.stringify({ access_token: token(sub), refresh_token: 'r', user: userId ? { id: userId } : null })

test('the stored session owner is the access token subject', () => {
  assert.equal(sessionOwnerFromStored(stored(A)), A)
  // The token is what requests carry, so it wins over a stale user object.
  assert.equal(sessionOwnerFromStored(stored(B, A)), B)
})

test('falls back to the stored user when the token cannot be read', () => {
  assert.equal(sessionOwnerFromStored(JSON.stringify({ access_token: 'not-a-jwt', user: { id: A } })), A)
  assert.equal(sessionOwnerFromStored(JSON.stringify({ user: { id: A } })), A)
})

test('nothing stored means nobody; an unreadable value means "cannot tell"', () => {
  assert.equal(sessionOwnerFromStored(null), null)
  assert.equal(sessionOwnerFromStored('not json'), undefined)
  assert.equal(sessionOwnerFromStored('null'), undefined)
  assert.equal(sessionOwnerFromStored(JSON.stringify({ access_token: 'x.y.z' })), undefined)
  assert.equal(sessionOwnerFromStored(JSON.stringify({})), undefined)
})

test('base64url tokens with padding-free payloads decode', () => {
  // A subject whose JSON length forces '-' / '_' and no padding in base64url.
  const sub = 'a?b>c~d' + A
  assert.equal(sessionOwnerFromStored(JSON.stringify({ access_token: token(sub) })), sub)
})

test('first event: the stored person is loaded from the event', () => {
  assert.deepEqual(identityStep(null, { userId: A }, A), { kind: 'switch', userId: A, session: 'event' })
  assert.deepEqual(identityStep(null, { userId: null }, null), { kind: 'signed-out' })
})

test('the same person again (resume, token refresh) is a quiet refresh, never a switch', () => {
  assert.deepEqual(identityStep(A, { userId: A }, A), { kind: 'same', userId: A })
})

test('a different person signing in: switch, using the event when it matches storage', () => {
  assert.deepEqual(identityStep(A, { userId: B }, B), { kind: 'switch', userId: B, session: 'event' })
})

test('a sign-in message that arrives before storage shows it is not acted on', () => {
  // Chromium can deliver the cross-tab message before this tab sees the write:
  // storage still says nobody, so the tab stays signed out until it does.
  assert.deepEqual(identityStep(null, { userId: B }, null), { kind: 'signed-out' })
  // ...or still says the previous person: nothing to do yet.
  assert.equal(identityStep(A, { userId: B }, A), null)
})

test('a stale message about someone else changes nothing', () => {
  assert.equal(identityStep(B, { userId: A }, B), null)
  // A stale sign-out while storage still holds the person shown.
  assert.equal(identityStep(B, { userId: null }, B), null)
})

test('an event that disagrees with storage follows storage, reading the session', () => {
  assert.deepEqual(identityStep(A, { userId: A }, B), { kind: 'switch', userId: B, session: 'read' })
  assert.deepEqual(identityStep(A, { userId: B }, null), { kind: 'signed-out' })
})

test('without readable storage the event is trusted as before', () => {
  assert.deepEqual(identityStep(A, { userId: B }, undefined), { kind: 'switch', userId: B, session: 'event' })
  assert.deepEqual(identityStep(A, { userId: A }, undefined), { kind: 'same', userId: A })
  assert.deepEqual(identityStep(A, { userId: null }, undefined), { kind: 'signed-out' })
})

test('a check with no event (storage changed, focus) acts only on a disagreement', () => {
  assert.equal(identityStep(A, null, A), null)
  assert.equal(identityStep(null, null, null), null)
  assert.equal(identityStep(A, null, undefined), null)
  assert.deepEqual(identityStep(A, null, null), { kind: 'signed-out' })
  assert.deepEqual(identityStep(A, null, B), { kind: 'switch', userId: B, session: 'read' })
  assert.deepEqual(identityStep(null, null, B), { kind: 'switch', userId: B, session: 'read' })
})
