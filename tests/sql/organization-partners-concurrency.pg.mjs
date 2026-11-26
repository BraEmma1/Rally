// The organization partner list on a REAL PostgreSQL server, with two sessions racing
// (migration 20261129000000). PGlite has one connection and cannot show this, so this
// file is not a *.test.mjs and CI does not run it.
//
// The invariant every case checks afterwards: on every event that is not archived, each
// linked partnership's six basic columns equal its partner's, and no partnership was
// newly linked to an archived partner.
//
//   1. a partner rename racing an edit of a linked partnership, both orders
//   2. archiving a partner racing a new link to it, both orders
//   3. a partner rename racing a new partnership linked to it, both orders
//   4. a partner rename racing the restore of an archived event, both orders
//   5. a partner rename racing the archive of an event, both orders
//
// A deadlock (40P01) on one side is allowed, provided the invariant holds.
//
// Run it with a throwaway server, which it starts and deletes itself:
//   npm i --no-save pg@8.13.1 embedded-postgres@17.10.0-beta.17     (or install them
//   elsewhere and set RALLY_PG_MODULES to that directory)
//   node tests/sql/organization-partners-concurrency.pg.mjs
// or point it at an EMPTY, disposable local server you own (it replays every migration):
//   RALLY_PG_URL=postgres://postgres:pw@localhost:5432/scratch node tests/sql/organization-partners-concurrency.pg.mjs
// It refuses any host other than localhost, and any database that already has tables.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { STUBS, MIGRATIONS } from './boot.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const modulesBase = process.env.RALLY_PG_MODULES || path.resolve(here, '../..')
const req = createRequire(path.join(modulesBase, 'noop.js'))
let pgLib
try { pgLib = req('pg') } catch {
  console.log('This suite needs the `pg` client (and `embedded-postgres` unless RALLY_PG_URL is set). See the header.')
  process.exit(1)
}
const { Client } = pgLib

// ---- the server -------------------------------------------------------------
let url = process.env.RALLY_PG_URL
let server = null
let dataDir = null
if (!url) {
  const { default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve('embedded-postgres')).href)
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rally-pg-'))
  const port = 55000 + Math.floor(Math.random() * 1000)
  server = new EmbeddedPostgres({ databaseDir: dataDir, port, user: 'postgres', password: 'rally-local', persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} })
  await server.initialise()
  await server.start()
  await server.createDatabase('rally')
  url = `postgres://postgres:rally-local@localhost:${port}/rally`
}
const host = new URL(url).hostname
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.log(`Refusing to run against ${host}: this suite replays every migration and writes test rows. Use a local, disposable server.`)
  process.exit(1)
}

const clients = []
const connect = async () => { const c = new Client({ connectionString: url }); await c.connect(); clients.push(c); return c }
const S = await connect()   // setup and observation, as the server owner
const A = await connect()   // session A
const B = await connect()   // session B

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}

try {
  const existing = Number((await S.query(`SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n)
  if (existing > 0) throw new Error('The target database already has tables in public. Use an empty, disposable database.')
  await S.query(STUBS)
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    try { await S.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')) } catch (e) { throw new Error(`${f}: ${e.message}`) }
  }
  const version = (await S.query(`SHOW server_version`)).rows[0].server_version
  ok(`every migration, the partner list included, applies on PostgreSQL ${version}`, true)

  // ---- fixtures ---------------------------------------------------------------
  const q = async (sql, params = []) => (await S.query(sql, params)).rows
  const owner = (await q(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), 'owner@race.test', now()) RETURNING id`))[0].id
  await q(`UPDATE user_accounts SET account_type = 'organizer', status = 'active' WHERE user_id = $1`, [owner])
  const org = (await q(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ('Race Org', 'organizer', 'approved', $1) RETURNING id`, [owner]))[0].id
  const mkEvent = async (name) => {
    await q(`SET session_replication_role = replica`) // a superuser seed: skip event-creation rules
    try {
      return (await q(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date)
                       VALUES ($1, 'upcoming', 'published', $2, $3, '2030-01-01', '2030-01-02') RETURNING id`, [name, org, owner]))[0].id
    } finally { await q(`SET session_replication_role = origin`) }
  }

  // Each session acts as the organization owner inside its own transaction.
  const claims = JSON.stringify({ sub: owner, role: 'authenticated' })
  const begin = async (c) => {
    await c.query(`BEGIN`)
    await c.query(`SET LOCAL ROLE authenticated`)
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims])
  }
  const asOwner = async (sql, params = []) => {
    await begin(S); try { const r = await S.query(sql, params); await S.query('COMMIT'); return r.rows } catch (e) { await S.query('ROLLBACK'); throw e }
  }
  let seq = 0
  const mkPartner = async () => (await asOwner(`INSERT INTO organization_partners (organization_id, company_name, website) VALUES ($1, $2, 'https://v0.example') RETURNING id`, [org, `Race Partner ${++seq}`]))[0].id
  const mkLinked = async (ev, partner) => (await asOwner(`INSERT INTO event_partnerships (event_id, partner_id) VALUES ($1, $2) RETURNING id`, [ev, partner]))[0].id
  const pid = async (c) => (await c.query(`SELECT pg_backend_pid() AS p`)).rows[0].p
  const PID_A = await pid(A), PID_B = await pid(B)

  // Settle a statement that may be waiting on a lock: { value } or { error }.
  const pending = (promise) => promise.then((r) => ({ value: r.rows }), (e) => ({ error: { message: e.message, code: e.code } }))
  async function waitsFor(waiter, holder) {
    for (let i = 0; i < 100; i++) {
      const r = await S.query(`SELECT $2::int = ANY (pg_blocking_pids($1)) AS b`, [waiter, holder])
      if (r.rows[0].b) return true
      await new Promise((res) => setTimeout(res, 50))
    }
    return false
  }
  // Finish a session's transaction whatever state it is in.
  const finish = async (c, r) => { await c.query(r?.error ? 'ROLLBACK' : 'COMMIT').catch(() => c.query('ROLLBACK')) }
  const deadlockOr = (r, cond) => cond || r?.error?.code === '40P01'

  // The invariant, on the whole database.
  const drifted = async () => q(`
    SELECT p.id FROM event_partnerships p
      JOIN organization_partners op ON op.id = p.partner_id
      JOIN events e ON e.id = p.event_id
     WHERE e.archived_at IS NULL
       AND (p.company_name IS DISTINCT FROM op.company_name OR p.description IS DISTINCT FROM op.description
         OR p.logo_url IS DISTINCT FROM op.logo_url OR p.industry IS DISTINCT FROM op.industry
         OR p.website IS DISTINCT FROM op.website OR p.linkedin IS DISTINCT FROM op.linkedin)`)
  const invariant = async (label) => {
    const d = await drifted()
    ok(`${label}: every live linked copy equals its partner`, d.length === 0, JSON.stringify(d))
  }
  const name = async (table, id) => (await q(`SELECT company_name FROM ${table} WHERE id = $1`, [id]))[0]?.company_name
  const renameSql = `UPDATE organization_partners SET company_name = $2 WHERE id = $1`

  // ---- 1. a partner rename racing an edit of a linked partnership -----------------
  for (const first of ['rename', 'edit']) {
    const EV = await mkEvent(`Race 1 ${first}`)
    const P = await mkPartner()
    const L = await mkLinked(EV, P)
    const newName = `Renamed 1 ${first}`
    const rename = (c) => c.query(renameSql, [P, newName])
    const edit = (c) => c.query(`UPDATE event_partnerships SET tier_label = 'Gold' WHERE id = $1`, [L])
    await begin(A); await begin(B)
    let ra, rb, waited
    if (first === 'rename') {
      ra = await pending(rename(A))
      const p = pending(edit(B)); waited = await waitsFor(PID_B, PID_A)
      await finish(A, ra); rb = await p; await finish(B, rb)
    } else {
      rb = await pending(edit(B))
      const p = pending(rename(A)); waited = await waitsFor(PID_A, PID_B)
      await finish(B, rb); ra = await p; await finish(A, ra)
    }
    const row = (await q(`SELECT company_name, tier_label FROM event_partnerships WHERE id = $1`, [L]))[0]
    ok(`1. ${first} first: the second statement waits for the first`, waited)
    ok(`...both commit (or one deadlocks), and the partnership has the new name and the new tier`,
      deadlockOr(ra, !ra.error) && deadlockOr(rb, !rb.error) &&
      (ra.error || row.company_name === newName) && (rb.error || row.tier_label === 'Gold'), JSON.stringify({ ra, rb, row }))
    await invariant(`1. ${first} first`)
  }

  // ---- 2. archiving a partner racing a new link to it ----------------------------
  for (const first of ['archive', 'link']) {
    const EV = await mkEvent(`Race 2 ${first}`)
    const P = await mkPartner()
    const archive = (c) => c.query(`UPDATE organization_partners SET archived_at = now() WHERE id = $1`, [P])
    const link = (c) => c.query(`INSERT INTO event_partnerships (event_id, partner_id) VALUES ($1, $2) RETURNING id`, [EV, P])
    await begin(A); await begin(B)
    let ra, rb, waited
    if (first === 'archive') {
      ra = await pending(archive(A))
      const p = pending(link(B)); waited = await waitsFor(PID_B, PID_A)
      await finish(A, ra); rb = await p; await finish(B, rb)
      ok('2. archive first: the link waits for the uncommitted archive', waited)
      ok('...then sees the committed archive and is refused, and nothing is linked',
        !ra.error && /archived/.test(rb.error?.message ?? '') &&
        Number((await q(`SELECT count(*) AS n FROM event_partnerships WHERE event_id = $1`, [EV]))[0].n) === 0, JSON.stringify({ ra, rb }))
    } else {
      rb = await pending(link(B))
      const p = pending(archive(A)); waited = await waitsFor(PID_A, PID_B)
      await finish(B, rb); ra = await p; await finish(A, ra)
      ok('2. link first: the archive waits for the uncommitted link', waited)
      ok('...the link (made while the partner was active) stands, and the archive then succeeds',
        !rb.error && !ra.error &&
        Number((await q(`SELECT count(*) AS n FROM event_partnerships WHERE event_id = $1 AND partner_id = $2`, [EV, P]))[0].n) === 1, JSON.stringify({ ra, rb }))
    }
    await invariant(`2. ${first} first`)
  }

  // ---- 3. a partner rename racing a new partnership linked to it -----------------
  for (const first of ['rename', 'link']) {
    const EV = await mkEvent(`Race 3 ${first}`)
    const P = await mkPartner()
    const newName = `Renamed 3 ${first}`
    const rename = (c) => c.query(renameSql, [P, newName])
    const link = (c) => c.query(`INSERT INTO event_partnerships (event_id, partner_id) VALUES ($1, $2) RETURNING id`, [EV, P])
    await begin(A); await begin(B)
    let ra, rb, waited
    if (first === 'rename') {
      ra = await pending(rename(A))
      const p = pending(link(B)); waited = await waitsFor(PID_B, PID_A)
      await finish(A, ra); rb = await p; await finish(B, rb)
    } else {
      rb = await pending(link(B))
      const p = pending(rename(A)); waited = await waitsFor(PID_A, PID_B)
      await finish(B, rb); ra = await p; await finish(A, ra)
    }
    const linked = rb.value?.[0]?.id
    ok(`3. ${first} first: the second statement waits for the first`, waited)
    ok('...both commit (or one deadlocks), and the new partnership carries the new name',
      deadlockOr(ra, !ra.error) && deadlockOr(rb, !rb.error) &&
      (ra.error || rb.error || await name('event_partnerships', linked) === newName), JSON.stringify({ ra, rb }))
    await invariant(`3. ${first} first`)
  }

  // ---- 4. a partner rename racing the restore of an archived event ---------------
  for (const first of ['rename', 'restore']) {
    const EV = await mkEvent(`Race 4 ${first}`)
    const P = await mkPartner()
    const L = await mkLinked(EV, P)
    await asOwner(`UPDATE events SET archived_at = now() WHERE id = $1`, [EV])
    const newName = `Renamed 4 ${first}`
    const rename = (c) => c.query(renameSql, [P, newName])
    const restore = (c) => c.query(`UPDATE events SET archived_at = NULL WHERE id = $1`, [EV])
    await begin(A); await begin(B)
    let ra, rb, waited
    if (first === 'rename') {
      ra = await pending(rename(A))
      const p = pending(restore(B)); waited = await waitsFor(PID_B, PID_A)
      await finish(A, ra); rb = await p; await finish(B, rb)
    } else {
      rb = await pending(restore(B))
      const p = pending(rename(A)); waited = await waitsFor(PID_A, PID_B)
      await finish(B, rb); ra = await p; await finish(A, ra)
    }
    ok(`4. ${first} first: the second statement waits for the first`, waited)
    ok('...both commit (or one deadlocks), and the restored event\'s partnership carries the new name',
      deadlockOr(ra, !ra.error) && deadlockOr(rb, !rb.error) &&
      (ra.error || rb.error || await name('event_partnerships', L) === newName), JSON.stringify({ ra, rb, now: await name('event_partnerships', L) }))
    await invariant(`4. ${first} first`)
  }

  // ---- 5. a partner rename racing the archive of an event ------------------------
  // Archiving locks only the event row, so neither statement waits. Whatever the
  // order of commits, the rename either reaches the event's copy (it was not yet
  // archived when the rename ran) or fails; it never leaves a live copy behind.
  for (const first of ['rename', 'archive']) {
    const EV = await mkEvent(`Race 5 ${first}`)
    const P = await mkPartner()
    const L = await mkLinked(EV, P)
    const newName = `Renamed 5 ${first}`
    const rename = (c) => c.query(renameSql, [P, newName])
    const archive = (c) => c.query(`UPDATE events SET archived_at = now() WHERE id = $1`, [EV])
    await begin(A); await begin(B)
    let ra, rb
    if (first === 'rename') {
      ra = await pending(rename(A)); rb = await pending(archive(B))
      await finish(A, ra); await finish(B, rb)
    } else {
      rb = await pending(archive(B)); ra = await pending(rename(A))
      await finish(B, rb); await finish(A, ra)
    }
    ok(`5. ${first} first: the archive commits, and the rename either commits or fails cleanly`,
      !rb.error && (ra.error === undefined || typeof ra.error.message === 'string'), JSON.stringify({ ra, rb }))
    await asOwner(`UPDATE events SET archived_at = NULL WHERE id = $1`, [EV])
    ok('...after a restore, the partnership carries the partner\'s current name',
      await name('event_partnerships', L) === await name('organization_partners', P))
    await invariant(`5. ${first} first`)
  }
} catch (e) {
  fail++
  console.log('ERROR', e.message)
} finally {
  for (const c of clients) await c.end().catch(() => {})
  if (server) {
    await server.stop().catch(() => {})
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
