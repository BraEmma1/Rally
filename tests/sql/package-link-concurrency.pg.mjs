// Spec A on a REAL PostgreSQL server, with two sessions racing: archiving or deleting a
// package while a partnership is being linked to it (migration 20261128000000).
// PGlite has one connection and cannot show this, so this file is not a *.test.mjs and
// CI does not run it.
//
//   1. archive first, then link: the link waits for the archive, then is refused
//   2. link first, then archive: the archive waits, then succeeds (linked while active)
//   3. apply_partnership_package racing an archive: refused, nothing copied
//   4. delete first, then link: the link waits, then fails on the foreign key
//   5. link first, then delete: the delete waits, then the delete guard refuses it
//   6. REPEATABLE READ: a link racing an archive fails with a serialization error
//   7. two first assignments of the same partnership: the second is refused
//   8. two apply_partnership_package calls on the same partnership: the second is refused
//   9. without Spec A (revert applied): scenario 1 links an archived package -- the gap
//
// Run it with a throwaway server, which it starts and deletes itself:
//   npm i --no-save pg@8.13.1 embedded-postgres@17.10.0-beta.17     (or, to keep the
//   project's node_modules untouched, install them elsewhere and set RALLY_PG_MODULES
//   to that directory)
//   node tests/sql/package-link-concurrency.pg.mjs
// or point it at an EMPTY, disposable local server you own (it replays every migration):
//   RALLY_PG_URL=postgres://postgres:pw@localhost:5432/scratch node tests/sql/package-link-concurrency.pg.mjs
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
const MIGRATION = path.join(MIGRATIONS, '20261128000000_partnership_package_link_integrity.sql')
const REVERT = path.resolve(MIGRATIONS, '../reverts/20261128000000_partnership_package_link_integrity.revert.sql')

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
  ok(`every migration, Spec A included, applies on PostgreSQL ${version}`, true)

  // ---- fixtures ---------------------------------------------------------------
  const q = async (sql, params = []) => (await S.query(sql, params)).rows
  const owner = (await q(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), 'owner@race.test', now()) RETURNING id`))[0].id
  await q(`UPDATE user_accounts SET account_type = 'organizer', status = 'active' WHERE user_id = $1`, [owner])
  const org = (await q(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ('Race Org', 'organizer', 'approved', $1) RETURNING id`, [owner]))[0].id
  await q(`SET session_replication_role = replica`)
  const ev = (await q(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date)
                       VALUES ('Race Summit', 'upcoming', 'published', $1, $2, '2030-01-01', '2030-01-02') RETURNING id`, [org, owner]))[0].id
  await q(`SET session_replication_role = origin`)

  // Each session acts as the organizer inside its own transaction.
  const claims = JSON.stringify({ sub: owner, role: 'authenticated' })
  const begin = async (c, level = '') => {
    await c.query(`BEGIN ${level}`)
    await c.query(`SET LOCAL ROLE authenticated`)
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims])
  }
  const asOwner = async (sql, params = []) => {
    await begin(S); try { const r = await S.query(sql, params); await S.query('COMMIT'); return r.rows } catch (e) { await S.query('ROLLBACK'); throw e }
  }
  let seq = 0
  const mkPackage = async (name) => (await asOwner(`INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, $2) RETURNING id`, [ev, `${name} ${++seq}`]))[0].id
  const mkTemplate = (pkg, title) => asOwner(`INSERT INTO event_partnership_package_deliverables (package_id, event_id, title) VALUES ($1, $2, $3)`, [pkg, ev, title])
  const mkPartnership = async (name) => (await asOwner(`INSERT INTO event_partnerships (event_id, company_name) VALUES ($1, $2) RETURNING id`, [ev, name]))[0].id
  const pid = async (c) => (await c.query(`SELECT pg_backend_pid() AS p`)).rows[0].p
  const PID_A = await pid(A), PID_B = await pid(B)

  // Settle a statement that may be waiting on a lock: { value } or { error }.
  const pending = (promise) => promise.then((r) => ({ value: r.rows }), (e) => ({ error: { message: e.message, code: e.code } }))
  // True once `waiter` is waiting on a lock held by `holder` (checked by a third session).
  async function waitsFor(waiter, holder) {
    for (let i = 0; i < 100; i++) {
      const r = await S.query(`SELECT $2::int = ANY (pg_blocking_pids($1)) AS b`, [waiter, holder])
      if (r.rows[0].b) return true
      await new Promise((res) => setTimeout(res, 50))
    }
    return false
  }
  const linkSql = `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, $2, $3) RETURNING id`
  const count = async (sql, params) => Number((await q(sql, params))[0].n)

  // ---- 1. archive first, then link ----------------------------------------------
  {
    const pkg = await mkPackage('Gold')
    await begin(B)
    await B.query(`UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1`, [pkg])
    await begin(A)
    const link = pending(A.query(linkSql, [ev, 'Race 1', pkg]))
    const waited = await waitsFor(PID_A, PID_B)
    await B.query('COMMIT')
    const r = await link
    await A.query('ROLLBACK')
    ok('1. archive first: the link waits for the uncommitted archive', waited)
    ok('...then sees the committed archive and is refused (23503, naming the package)',
      r.error && /archived/.test(r.error.message) && /package/.test(r.error.message) && r.error.code === '23503', JSON.stringify(r))
    ok('...and nothing is linked', await count(`SELECT count(*) AS n FROM event_partnerships WHERE company_name = 'Race 1'`) === 0)
  }

  // ---- 2. link first, then archive ----------------------------------------------
  {
    const pkg = await mkPackage('Silver')
    await begin(A)
    const linked = (await A.query(linkSql, [ev, 'Race 2', pkg])).rows[0].id
    await begin(B)
    const arch = pending(B.query(`UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1 RETURNING id`, [pkg]))
    const waited = await waitsFor(PID_B, PID_A)
    await A.query('COMMIT')
    const r = await arch
    await B.query('COMMIT')
    const row = (await q(`SELECT p.package_id, k.archived_at FROM event_partnerships p JOIN event_partnership_packages k ON k.id = p.package_id WHERE p.id = $1`, [linked]))[0]
    ok('2. link first: the archive waits for the uncommitted link', waited)
    ok('...then succeeds, leaving a partnership linked while the package was active', r.value?.length === 1 && row?.package_id === pkg && row.archived_at !== null, JSON.stringify({ r, row }))
  }

  // ---- 3. apply_partnership_package racing an archive ------------------------------
  {
    const pkg = await mkPackage('Bronze')
    await mkTemplate(pkg, 'Banner')
    await mkTemplate(pkg, 'Booth')
    const p = await mkPartnership('Race 3')
    await begin(B)
    await B.query(`UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1`, [pkg])
    await begin(A)
    // The function's own archived check reads its snapshot, where the package is still
    // active; only the trigger's locked read sees the archive.
    const apply = pending(A.query(`SELECT apply_partnership_package($1, $2) AS n`, [p, pkg]))
    const waited = await waitsFor(PID_A, PID_B)
    await B.query('COMMIT')
    const r = await apply
    await A.query('ROLLBACK')
    ok('3. apply_partnership_package racing an archive waits at the link', waited)
    ok('...and is refused once the archive commits', r.error && /archived/.test(r.error.message), JSON.stringify(r))
    ok('...with no link and no copied deliverable', (await q(`SELECT package_id FROM event_partnerships WHERE id = $1`, [p]))[0].package_id === null &&
      await count(`SELECT count(*) AS n FROM event_partnership_obligations WHERE partnership_id = $1`, [p]) === 0)
  }

  // ---- 4. delete first, then link ------------------------------------------------
  {
    const pkg = await mkPackage('Doomed')
    await begin(B)
    await B.query(`DELETE FROM event_partnership_packages WHERE id = $1`, [pkg])
    await begin(A)
    const link = pending(A.query(linkSql, [ev, 'Race 4', pkg]))
    const waited = await waitsFor(PID_A, PID_B)
    await B.query('COMMIT')
    const r = await link
    await A.query('ROLLBACK')
    ok('4. delete first: the link waits for the uncommitted delete', waited)
    ok('...then fails on the package foreign key, the error the wizard expects',
      r.error && r.error.code === '23503' && /event_partnerships_package_fk/.test(r.error.message), JSON.stringify(r))
  }

  // ---- 5. link first, then delete ------------------------------------------------
  {
    const pkg = await mkPackage('Kept')
    await begin(A)
    await A.query(linkSql, [ev, 'Race 5', pkg])
    await begin(B)
    const del = pending(B.query(`DELETE FROM event_partnership_packages WHERE id = $1`, [pkg]))
    const waited = await waitsFor(PID_B, PID_A)
    await A.query('COMMIT')
    const r = await del
    await B.query('ROLLBACK')
    ok('5. link first: the delete waits for the uncommitted link', waited)
    ok('...then the delete guard counts the committed link and refuses', r.error && /used by 1 partnership\(s\)/.test(r.error.message), JSON.stringify(r))
    ok('...so the package and the link both remain', await count(`SELECT count(*) AS n FROM event_partnerships WHERE company_name = 'Race 5' AND package_id = $1`, [pkg]) === 1)
  }

  // ---- 6. REPEATABLE READ ---------------------------------------------------------
  {
    const pkg = await mkPackage('Snapshot')
    await begin(A, 'ISOLATION LEVEL REPEATABLE READ')
    await A.query(`SELECT count(*) FROM event_partnership_packages`)   // takes the snapshot
    await asOwner(`UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1`, [pkg])
    const r = await pending(A.query(linkSql, [ev, 'Race 6', pkg]))
    await A.query('ROLLBACK')
    ok('6. under REPEATABLE READ, a link to a package archived after the snapshot fails with a serialization error',
      r.error && r.error.code === '40001', JSON.stringify(r))
  }

  // ---- 7. two first assignments of one partnership -----------------------------------
  {
    const gold = await mkPackage('First'), silver = await mkPackage('Second')
    const p = await mkPartnership('Race 7')
    await begin(A)
    await A.query(`UPDATE event_partnerships SET package_id = $2 WHERE id = $1`, [p, gold])
    await begin(B)
    const second = pending(B.query(`UPDATE event_partnerships SET package_id = $2 WHERE id = $1`, [p, silver]))
    const waited = await waitsFor(PID_B, PID_A)
    await A.query('COMMIT')
    const r = await second
    await B.query('ROLLBACK')
    ok('7. two sessions setting the first link: the second waits for the first', waited)
    ok('...then re-reads the row, finds it linked and is refused', r.error && /cannot be changed/.test(r.error.message), JSON.stringify(r))
    ok('...so the first link stands', (await q(`SELECT package_id FROM event_partnerships WHERE id = $1`, [p]))[0].package_id === gold)
  }

  // ---- 8. two apply_partnership_package calls -----------------------------------------
  {
    const gold = await mkPackage('Apply A'), silver = await mkPackage('Apply B')
    await mkTemplate(gold, 'One')
    await mkTemplate(silver, 'Two')
    const p = await mkPartnership('Race 8')
    await begin(A)
    await A.query(`SELECT apply_partnership_package($1, $2)`, [p, gold])
    await begin(B)
    const second = pending(B.query(`SELECT apply_partnership_package($1, $2)`, [p, silver]))
    const waited = await waitsFor(PID_B, PID_A)
    await A.query('COMMIT')
    const r = await second
    await B.query('ROLLBACK')
    ok('8. two apply_partnership_package calls: the second waits, then is refused', waited && r.error && /already has a package applied/.test(r.error.message), JSON.stringify(r))
    ok('...and only the first package\'s deliverables were copied',
      await count(`SELECT count(*) AS n FROM event_partnership_obligations WHERE partnership_id = $1`, [p]) === 1)
  }

  // ---- 9. the same race without Spec A ------------------------------------------------
  {
    await S.query(fs.readFileSync(REVERT, 'utf8'))
    const pkg = await mkPackage('Unguarded')
    await begin(B)
    await B.query(`UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1`, [pkg])
    await begin(A)
    const r = await pending(A.query(linkSql, [ev, 'Race 9', pkg]))   // does not wait
    await B.query('COMMIT')
    await A.query('COMMIT')
    const row = (await q(`SELECT k.archived_at FROM event_partnerships p JOIN event_partnership_packages k ON k.id = p.package_id WHERE p.company_name = 'Race 9'`))[0]
    ok('9. without Spec A the link does not wait, and an archived package ends up linked (the gap this closes)',
      r.value?.length === 1 && row?.archived_at != null, JSON.stringify({ r, row }))
    await S.query(fs.readFileSync(MIGRATION, 'utf8'))
    ok('...and the migration re-applies on top of that state', (await q(`SELECT count(*) AS n FROM pg_trigger WHERE tgname = 'check_partnership_package_link'`))[0].n === '1')
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
