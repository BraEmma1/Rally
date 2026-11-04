// Event-manager assignment on the organizer Team page: who sees the controls, assign and
// remove (payloads, in-flight state, success and failure), archived events, owner/admin
// rows, a manager caller, and a phone viewport.
// Runs against a STUBBED API (see the fixtures below). Nothing here reaches a real Supabase
// project, and no credential is used: the session is a fabricated token for a fake user id.
// Run all suites with: npm run test:browser
const { launchBrowser } = require('./launch.cjs')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || process.argv[2]
const OUT = process.env.SHOTS_DIR || process.argv[3] || path.join(require('os').tmpdir(), 'rally-browser-shots')
const UID = '11111111-1111-1111-1111-111111111111' // the signed-in organizer
const API = 'http://localhost:54321'
const ORG = 'org-1'
fs.mkdirSync(OUT, { recursive: true })

// ---- fixtures ----------------------------------------------------------------
const MGR = '22222222-2222-2222-2222-222222222222'
const ADM = '33333333-3333-3333-3333-333333333333'
const member = (user_id, full_name, role, over = {}) => ({
  user_id, role, full_name, job_title: 'Staff', company: 'Acme', photo_url: '', created_at: '2026-06-01T00:00:00Z', is_self: false, ...over,
})
const ev = (id, name, over = {}) => ({
  id, name, description: '', location: 'Accra', start_date: '2027-03-01', end_date: null, start_time: null, end_time: null,
  image_url: '', capacity: null, status: 'upcoming', timezone: null, created_at: '2026-06-01', owner_id: null, created_by: UID,
  organization_id: ORG, visibility: 'published', archived_at: null, published_at: '2026-06-01', ...over,
})
const events = [
  ev('e-a', 'Alpha Summit', { start_date: '2027-03-01' }),
  ev('e-b', 'Beta Forum', { start_date: '2027-04-01' }),
  ev('e-arch', 'Old Expo', { start_date: '2026-01-01', archived_at: '2026-02-01T00:00:00Z' }),
  ev('e-arch-held', 'Frozen Fair', { start_date: '2026-02-01', archived_at: '2026-03-01T00:00:00Z' }),
]

// ---- mock state --------------------------------------------------------------
const ctl = { callerRole: 'admin', delay: 0, assignError: null, teamError: false }
let team, log
function reset() {
  team = [{ user_id: MGR, event_id: 'e-a' }, { user_id: MGR, event_id: 'e-arch-held' }]
  log = { assign: [], unassign: [] }
  ctl.callerRole = 'admin'
  ctl.delay = 0
  ctl.assignError = null
  ctl.teamError = false
}
reset()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const err = (code, message) => ({ code, message, details: null, hint: null })

function directory() {
  return [
    member(UID, 'Olu Owner', ctl.callerRole === 'manager' ? 'manager' : ctl.callerRole, { is_self: true }),
    member(ADM, 'Ada Admin', 'admin'),
    member(MGR, 'Mia Manager', 'manager'),
  ]
}
function access() {
  return [{
    organization_id: ORG, organization_name: 'Test Org', organization_slug: 'test-org', organization_description: '',
    organization_logo_url: '', organization_website: '', organization_type: 'organizer', approval_status: 'approved',
    archived_at: null, organization_created_by: UID, organization_created_at: '2026-01-01T00:00:00Z',
    organization_updated_at: '2026-01-01T00:00:00Z', organization_role: ctl.callerRole, joined_at: '2026-01-01T00:00:00Z',
    event_assignments: [],
  }]
}

function rawRows(url) {
  const p = new URL(url).pathname
  if (p.endsWith('/profiles')) return [{ id: UID, full_name: 'Olu Owner', photo_url: '', job_title: 'Founder', company: 'Acme', industry: '', location: '', bio: '', looking_for: '', can_offer: '', linkedin: '', website: '', email: 'o@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }]
  if (p.endsWith('/user_accounts')) return [{ account_type: 'organizer', status: 'active' }]
  if (p.endsWith('/events')) return events
  if (p.endsWith('/event_team')) return team
  if (p.endsWith('/rpc/get_my_organization_access')) return access()
  if (p.endsWith('/rpc/organization_member_directory')) return directory()
  if (p.endsWith('/rpc/organization_invitation_list')) return []
  return []
}
function rows(url, single) {
  let r = rawRows(url)
  if (Array.isArray(r) && r.length) {
    for (const [k, v] of new URL(url).searchParams) if (v.startsWith('eq.') && k in r[0]) r = r.filter((x) => String(x[k]) === v.slice(3))
  }
  return single ? (Array.isArray(r) ? r[0] ?? null : r) : r
}

async function wire(ctx) {
  await ctx.route(API + '/**', async (route) => {
    const req = route.request(); const url = req.url(); const m = req.method()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
    const json = (status, b) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(b) })
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (m === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-0/${rows(url).length}` } })
    if (m === 'GET') {
      if (url.includes('/event_team') && ctl.teamError) return json(500, err('XX000', 'boom'))
      return json(200, rows(url, (req.headers()['accept'] || '').includes('pgrst.object')))
    }
    if (m === 'POST' && url.includes('/rpc/')) {
      const body = JSON.parse(req.postData() || '{}')
      if (url.endsWith('/rpc/assign_event_manager')) {
        if (ctl.delay) await sleep(ctl.delay)
        log.assign.push(body)
        if (ctl.assignError) return json(400, err('P0001', ctl.assignError))
        if (!team.some((t) => t.event_id === body.target_event_id && t.user_id === body.target_user_id)) team.push({ user_id: body.target_user_id, event_id: body.target_event_id })
        return json(200, null)
      }
      if (url.endsWith('/rpc/unassign_event_manager')) {
        if (ctl.delay) await sleep(ctl.delay)
        log.unassign.push(body)
        if (ctl.assignError) return json(400, err('P0001', ctl.assignError))
        team = team.filter((t) => !(t.event_id === body.target_event_id && t.user_id === body.target_user_id))
        return json(200, null)
      }
      return json(200, rows(url))
    }
    return route.fulfill({ status: 201, headers: cors, body: '' })
  })
}

const results = []
let fails = 0
function rec(group, name, pass, detail = '') {
  if (!pass) fails++
  results.push({ group, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? '  -> ' + detail : ''}`)
}

;(async () => {
  const browser = await launchBrowser()
  async function open(w, h, url) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()) })
    await ctx.addInitScript(([uid]) => {
      const session = { access_token: btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: uid, exp: 4102444800, role: 'authenticated' })) + '.fake', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'o@example.test', app_metadata: {}, user_metadata: {} } }
      localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session))
    }, [UID])
    await wire(ctx)
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForSelector('h1, [role=alert], main', { timeout: 8000 }).catch(() => {})
    return { page, ctx, errors }
  }
  const vis = (page, sel) => page.isVisible(sel).catch(() => false)
  const dialog = '[role=dialog]'
  const section = `${dialog} section[aria-labelledby="event-access-heading"]`
  const rowOf = (name) => `${section} li:has-text("${name}")`
  const manageFor = (page, name) => page.locator(`tr:has-text("${name}") button:has-text("Manage")`)

  // ================= 1. Admin: the section and its rows ============================
  {
    reset()
    const { page, ctx, errors } = await open(1440, 900, '/organizer/team')
    await page.waitForSelector('text=Mia Manager')
    rec('list', 'the manager row shows the assignment count (2 events)', await vis(page, 'tr:has-text("Mia Manager") >> text=2 events'))
    await manageFor(page, 'Mia Manager').click()
    await page.waitForSelector(section)
    rec('section', 'the dialog has an "Event access" section for a manager', await vis(page, `${section} >> text=Event access`))
    rec('section', 'live events are listed', (await vis(page, rowOf('Alpha Summit'))) && (await vis(page, rowOf('Beta Forum'))))
    rec('section', 'an assigned event shows "Assigned" and Remove, not Assign', (await vis(page, `${rowOf('Alpha Summit')} >> text=Assigned`)) && (await vis(page, `${rowOf('Alpha Summit')} button:has-text("Remove")`)) && !(await vis(page, `${rowOf('Alpha Summit')} button:has-text("Assign")`)))
    rec('section', 'an unassigned event offers Assign, not Remove', (await vis(page, `${rowOf('Beta Forum')} button:has-text("Assign")`)) && !(await vis(page, `${rowOf('Beta Forum')} button:has-text("Remove")`)))
    rec('section', 'an archived event the manager does not hold is not listed', (await page.locator(rowOf('Old Expo')).count()) === 0)
    rec('section', 'an archived event the manager holds is listed with Remove only', (await vis(page, `${rowOf('Frozen Fair')} button:has-text("Remove")`)) && !(await vis(page, `${rowOf('Frozen Fair')} button:has-text("Assign")`)) && (await vis(page, `${rowOf('Frozen Fair')} >> text=Archived`)))
    rec('section', 'buttons have accessible names that say who and what', (await page.locator('button[aria-label="Assign Mia Manager to Beta Forum"]').count()) === 1 && (await page.locator('button[aria-label="Remove Mia Manager from Alpha Summit"]').count()) === 1)
    await page.screenshot({ path: path.join(OUT, 'assignment-dialog-desktop.jpg'), type: 'jpeg', quality: 70 })

    // ---- assign ----------------------------------------------------------------
    ctl.delay = 400
    await page.click('button[aria-label="Assign Mia Manager to Beta Forum"]')
    rec('assign', 'while in flight the button says so and every row is disabled', (await vis(page, `${rowOf('Beta Forum')} button:has-text("Assigning…")`)) && (await page.locator(`${section} button:disabled`).count()) >= 3)
    await page.waitForSelector(`${section} [role=status]`)
    ctl.delay = 0
    rec('assign', 'sent exactly the event and the member to assign_event_manager', log.assign.length === 1 && log.assign[0].target_event_id === 'e-b' && log.assign[0].target_user_id === MGR, JSON.stringify(log.assign))
    rec('assign', 'a success message names the member and the event', await vis(page, `${section} [role=status]:has-text("Mia Manager can now manage Beta Forum")`))
    rec('assign', 'the row flips to Assigned / Remove', (await vis(page, `${rowOf('Beta Forum')} button:has-text("Remove")`)) && (await vis(page, `${rowOf('Beta Forum')} >> text=Assigned`)))
    rec('assign', 'the summary behind the dialog updated to 3 events without a reload', await vis(page, 'tr:has-text("Mia Manager") >> text=3 events'))
    rec('assign', 'the team page did not drop back to a loading state', !(await vis(page, 'text=Loading team')))

    // ---- remove ----------------------------------------------------------------
    await page.click('button[aria-label="Remove Mia Manager from Alpha Summit"]')
    await page.waitForSelector(`${section} [role=status]:has-text("no longer manages Alpha Summit")`)
    rec('remove', 'sent the right ids to unassign_event_manager', log.unassign.length === 1 && log.unassign[0].target_event_id === 'e-a' && log.unassign[0].target_user_id === MGR, JSON.stringify(log.unassign))
    rec('remove', 'the row flips back to Assign and the summary drops to 2 events', (await vis(page, `${rowOf('Alpha Summit')} button:has-text("Assign")`)) && (await vis(page, 'tr:has-text("Mia Manager") >> text=2 events')))

    // ---- archived: remove still works, and the row disappears -------------------
    await page.click('button[aria-label="Remove Mia Manager from Frozen Fair"]')
    await page.waitForSelector(`${section} [role=status]:has-text("no longer manages Frozen Fair")`)
    rec('remove', 'removing an archived assignment works and the archived row then disappears', (await page.locator(rowOf('Frozen Fair')).count()) === 0)

    // ---- failure ---------------------------------------------------------------
    ctl.assignError = 'This event is archived'
    await page.click('button[aria-label="Assign Mia Manager to Alpha Summit"]')
    await page.waitForSelector(`${section} [role=alert]`)
    rec('error', 'a server refusal is shown in the dialog, in the server\'s words', await vis(page, `${section} [role=alert]:has-text("This event is archived")`))
    rec('error', 'nothing changed on failure (still Assign, no success message)', (await vis(page, `${rowOf('Alpha Summit')} button:has-text("Assign")`)) && !(await vis(page, `${section} [role=status]`)))
    rec('error', 'buttons are usable again after a failure', (await page.locator(`${section} button:disabled`).count()) === 0)
    ctl.assignError = null
    await page.click('button[aria-label="Assign Mia Manager to Alpha Summit"]')
    await page.waitForSelector(`${section} [role=status]`)
    rec('error', 'retry succeeds and clears the error', !(await vis(page, `${section} [role=alert]`)))

    rec('a11y', 'Escape closes the dialog', await (async () => { await page.keyboard.press('Escape'); await page.waitForSelector(dialog, { state: 'detached' }); return true })())
    rec('health', 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 2. Owner/admin rows have no assignment controls ================
  {
    reset()
    const { page, ctx } = await open(1440, 900, '/organizer/team')
    await page.waitForSelector('text=Ada Admin')
    rec('rows', 'an admin row reads "All events"', await vis(page, 'tr:has-text("Ada Admin") >> text=All events'))
    await manageFor(page, 'Ada Admin').click()
    await page.waitForSelector(dialog)
    rec('rows', 'the admin\'s dialog has no Event access section', (await page.locator(section).count()) === 0)
    await ctx.close()
  }

  // ================= 3. Event access is the only way a manager gets in ==============
  {
    reset()
    team = []
    const { page, ctx } = await open(1440, 900, '/organizer/team')
    await page.waitForSelector('text=Mia Manager')
    rec('empty', 'a manager with nothing assigned reads "No events"', await vis(page, 'tr:has-text("Mia Manager") >> text=No events'))
    await manageFor(page, 'Mia Manager').click()
    await page.waitForSelector(section)
    rec('empty', 'every live event is offered for assignment', (await page.locator(`${section} button:has-text("Assign")`).count()) === 2)
    await ctx.close()
  }

  // ================= 4. The assignments cannot be loaded ============================
  {
    reset()
    ctl.teamError = true
    const { page, ctx } = await open(1440, 900, '/organizer/team')
    await page.waitForSelector('text=Mia Manager')
    await manageFor(page, 'Mia Manager').click()
    await page.waitForSelector(section)
    rec('unavailable', 'a failed lookup says so instead of showing empty or guessed access', (await vis(page, `${section} >> text=could not be loaded`)) && (await page.locator(`${section} button:has-text("Assign")`).count()) === 0 && (await page.locator(`${section} button:has-text("Remove")`).count()) === 0)
    await ctx.close()
  }

  // ================= 5. A manager can see the team but change nothing ===============
  {
    reset()
    ctl.callerRole = 'manager'
    const { page, ctx } = await open(1440, 900, '/organizer/team')
    await page.waitForSelector('text=Mia Manager')
    const manageButtons = await page.getByRole('button', { name: 'Manage', exact: true }).count()
    rec('manager', 'a manager caller sees no Manage buttons', manageButtons === 0, String(manageButtons))
    rec('manager', 'a manager caller sees the team read-only (rows still listed)', await vis(page, 'tr:has-text("Mia Manager")'))
    rec('manager', 'no dialog, no assignment calls', (await page.locator(dialog).count()) === 0 && log.assign.length === 0 && log.unassign.length === 0)
    await ctx.close()
  }

  // ================= 6. Phone viewport ==============================================
  {
    reset()
    const { page, ctx } = await open(390, 844, '/organizer/team')
    await page.waitForSelector('li:has-text("Mia Manager") button')
    await page.click('li:has-text("Mia Manager") button')
    await page.waitForSelector(section)
    const box = await page.$eval(dialog, (d) => { const r = d.firstElementChild.nextElementSibling.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: window.innerHeight, vw: window.innerWidth } })
    rec('phone', 'the dialog is a sheet that fits the screen (390x844)', box.top >= 0 && box.bottom <= box.vh + 1 && box.left >= 0 && box.right <= box.vw + 1, JSON.stringify(box))
    rec('phone', 'no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await page.locator(`${section} button:has-text("Assign")`).first().scrollIntoViewIfNeeded()
    const small = await page.locator(`${section} button`).evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 32).length)
    rec('phone', 'action buttons are at least 32px tall', small === 0, `small=${small}`)
    await page.screenshot({ path: path.join(OUT, 'assignment-dialog-phone.jpg'), type: 'jpeg', quality: 70 })
    await ctx.close()
  }

  await browser.close()
  fs.writeFileSync(path.join(OUT, '..', 'event-manager-assignment-results.json'), JSON.stringify(results, null, 2))
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - fails}  FAIL ${fails}`)
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
