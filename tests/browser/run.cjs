// Runs every browser suite against the app served by Vite, with the Supabase URL
// pointed at a port nothing listens on: each suite intercepts those requests and
// answers from its own fixtures. No real project is contacted and no credential is
// needed.
//
//   npm run test:browser
//
// Environment (all optional):
//   CHROME_PATH   Chrome / Chromium / Edge executable (default: installed Chrome)
//   BASE_URL      test an already running server instead of starting Vite
//   SHOTS_DIR     where suites write screenshots (default: the OS temp dir)
const { spawn, spawnSync } = require('child_process')
const http = require('http')
const path = require('path')

const PORT = 5199
const SUITES = [
  'events-and-invitations.cjs',
  'event-mode-shell.cjs',
  'dashboard-and-event-mode-pages.cjs',
  'attendee-sweep.cjs',
  'connection-requests.cjs',
  'event-registration.cjs',
]

const reachable = (url) =>
  new Promise((resolve) => {
    http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500) }).on('error', () => resolve(false))
  })

async function main() {
  let server = null
  let base = process.env.BASE_URL
  if (!base) {
    // The stub API lives at this address; the app only needs to be told where "Supabase" is.
    const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
    server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'stub-anon-key' },
      stdio: 'ignore',
    })
    base = `http://localhost:${PORT}`
    for (let i = 0; i < 80 && !(await reachable(base)); i++) await new Promise((r) => setTimeout(r, 250))
    if (!(await reachable(base))) { server.kill(); throw new Error(`Vite did not start on port ${PORT} (is it already in use?)`) }
  }

  let pass = 0
  let fail = 0
  const failed = []
  for (const suite of SUITES) {
    const r = spawnSync(process.execPath, [path.join(__dirname, suite), base], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const lines = (r.stdout || '').split('\n')
    const p = lines.filter((l) => l.startsWith('PASS')).length
    const f = lines.filter((l) => l.startsWith('FAIL')).length
    pass += p
    fail += f
    const crashed = r.status !== 0 && f === 0
    console.log(`${f === 0 && !crashed ? 'ok  ' : 'FAIL'}  ${suite}: ${p} passed, ${f} failed${crashed ? ' (suite crashed)' : ''}`)
    for (const l of lines.filter((x) => x.startsWith('FAIL'))) failed.push(`  ${suite}: ${l}`)
    if (crashed) { failed.push(`  ${suite}: ${(r.stderr || r.stdout).trim().split('\n').slice(-4).join(' | ')}`); fail++ }
  }
  if (server) server.kill()
  console.log(`\nTOTAL ${pass + fail}  PASS ${pass}  FAIL ${fail}`)
  failed.forEach((l) => console.log(l))
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
