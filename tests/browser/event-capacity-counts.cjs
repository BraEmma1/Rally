// The capacity field on the organizer Edit event form: it shows the confirmed and
// waitlisted counts (event_attendee_page 'confirmed' / 'waitlisted' totals, the
// same rules as the database's capacity floor, migration 20261103000000),
// explains that confirmed registrations set the minimum, warns before a value
// below it, and passes the database's refusal through. The create form shows no
// counts and asks for none.
// Runs against a STUBBED API. Nothing here reaches a real Supabase project, and no
// credential is used: the session is a fabricated token for a fake user id.
// Run all suites with: npm run test:browser
const { launchBrowser } = require('./launch.cjs')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || process.argv[2]
const OUT = process.env.SHOTS_DIR || process.argv[3] || path.join(require('os').tmpdir(), 'rally-browser-shots')
const UID = '11111111-1111-1111-1111-111111111111'
const API = 'http://localhost:54321'
const ORG = 'org-1'
fs.mkdirSync(OUT, { recursive: true })

const event = {
  id: 'e-a', name: 'Alpha Summit', description: '', location: 'Accra', start_date: '2027-03-01', end_date: null,
  start_time: null, end_time: null, image_url: '', capacity: 100, status: 'upcoming', timezone: 'Africa/Accra',
  created_at: '2026-06-01', owner_id: null, created_by: UID, organization_id: ORG, visibility: 'published',
  archived_at: null, published_at: '2026-06-01',
}

const ctl = {}
let log
function reset(over = {}) {
  Object.assign(ctl, { confirmed: 100, waitlisted: 20, countError: false, refuseCapacityBelow: null }, over)
  log = { counts: [], patches: [] }
}
const err = (code, message) => ({ code, message, details: null, hint: null })

function access() {
  return [{
    organization_id: ORG, organization_name: 'Test Org', organization_slug: 'test-org', organization_description: '',
    organization_logo_url: '', organization_website: '', organization_type: 'organizer', approval_status: 'approved',
    archived_at: null, organization_created_by: UID, organization_created_at: '2026-01-01T00:00:00Z',
    organization_updated_at: '2026-01-01T00:00:00Z', organization_role: 'owner', joined_at: '2026-01-01T00:00:00Z',
    event_assignments: [],
  }]
}
function rows(url, single) {
  const p = new URL(url).pathname
  let r = []
  if (p.endsWith('/profiles')) r = [{ id: UID, full_name: 'Olu Organizer', photo_url: '', job_title: '', company: '', industry: '', location: '', bio: '', looking_for: '', can_offer: '', linkedin: '', website: '', email: 'o@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }]
  if (p.endsWith('/user_accounts')) r = [{ account_type: 'organizer', status: 'active' }]
  if (p.endsWith('/events')) r = [event]
  if (p.endsWith('/rpc/get_my_organization_access')) r = access()
  return single ? r[0] ?? null : r
}

async function wire(ctx) {
  await ctx.route(API + '/**', async (route) => {
    const req = route.request(); const url = req.url(); const m = req.method()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
    const json = (status, b) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(b) })
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (m === 'GET') return json(200, rows(url, (req.headers()['accept'] || '').includes('pgrst.object')))
    if (m === 'POST' && url.includes('/rpc/')) {
      const body = JSON.parse(req.postData() || '{}')
      const name = new URL(url).pathname.split('/rpc/')[1]
      if (name === 'can_manage_event' || name === 'account_is_active') return json(200, true)
      if (name === 'event_attendee_page') {
        log.counts.push(body)
        if (ctl.countError) return json(400, err('P0001', 'You do not manage this event'))
        const total = body.status_filter === 'confirmed' ? ctl.confirmed : body.status_filter === 'waitlisted' ? ctl.waitlisted : 0
        return json(200, [{ total_count: total, attendees: [] }])
      }
      return json(200, rows(url))
    }
    if (m === 'PATCH' && url.includes('/events')) {
      const body = JSON.parse(req.postData() || '{}')
      log.patches.push(body)
      // What enforce_event_write_rules raises (P0001 -> HTTP 400).
      if (ctl.refuseCapacityBelow !== null && body.capacity < ctl.refuseCapacityBelow) {
        return json(400, err('P0001', `Capacity cannot be lower than the ${ctl.refuseCapacityBelow} people already confirmed`))
      }
      return route.fulfill({ status: 204, headers: cors, body: '' })
    }
    return route.fulfill({ status: 204, headers: cors, body: '' })
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
  async function open(url, { w = 1440, h = 900 } = {}) {
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
    await page.waitForSelector('h1', { timeout: 8000 }).catch(() => {})
    return { page, ctx, errors }
  }
  const text = (page, t) => page.getByText(t, { exact: false }).first().isVisible().catch(() => false)
  const capacity = (page) => page.locator('#capacity')
  const counts = (page) => page.locator('p[aria-live="polite"]').first().innerText().catch(() => '')

  // ================= 1. Counts and help text ========================================
  {
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a/edit')
    await page.waitForSelector('#capacity')
    await page.waitForFunction(() => document.querySelector('p[aria-live="polite"]'), null, { timeout: 4000 }).catch(() => {})
    const shown = (await counts(page)).replace(/\s+/g, ' ').trim()
    rec('counts', 'shows "100 confirmed · 20 waitlisted" under Capacity', shown === '100 confirmed · 20 waitlisted', shown)
    const filters = log.counts.map((c) => c.status_filter).sort().join(',')
    rec('counts', 'asks event_attendee_page for the confirmed and waitlisted totals only',
      filters === 'confirmed,waitlisted' && log.counts.every((c) => c.target_event_id === 'e-a' && c.search === '' && c.page_size === 1 && c.page_offset === 0),
      JSON.stringify(log.counts))
    rec('counts', 'help text: confirmed registrations set the minimum',
      await text(page, 'Confirmed registrations (registered or checked in) set the minimum capacity'))
    rec('counts', 'help text: waitlisted people do not count; raising moves them in',
      await text(page, 'waitlisted people do not count, and raising the capacity moves them in, longest-waiting first'))
    rec('counts', 'the old "closes automatically" wording is gone', !(await text(page, 'Registration closes automatically')))
    rec('counts', 'no warning at the current capacity', !(await text(page, 'so capacity cannot be lower than that')))

    // ================= 2. Warning below the confirmed count =====================
    await capacity(page).fill('99')
    rec('warning', 'warns at 99 (below 100 confirmed)', await text(page, '100 people are already confirmed, so capacity cannot be lower than that.'))
    await capacity(page).fill('110')
    rec('warning', 'no warning at 110 even with 20 waitlisted', !(await text(page, 'so capacity cannot be lower than that')))
    await capacity(page).fill('100')
    rec('warning', 'no warning at exactly the confirmed count', !(await text(page, 'so capacity cannot be lower than that')))
    await page.screenshot({ path: path.join(OUT, 'capacity-counts-desktop.jpg'), type: 'jpeg', quality: 70 })

    // ================= 3. Saving 110 sends it ===================================
    await capacity(page).fill('110')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.waitForURL('**/organizer/events/e-a', { timeout: 5000 }).catch(() => {})
    rec('save', 'saving 110 sends capacity 110', log.patches.some((p) => p.capacity === 110), JSON.stringify(log.patches))
    rec('save', 'returns to the event page after saving', page.url().endsWith('/organizer/events/e-a'), page.url())
    rec('save', 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 4. The database's refusal is shown =============================
  {
    reset({ refuseCapacityBelow: 100 })
    const { page, ctx } = await open('/organizer/events/e-a/edit')
    await page.waitForSelector('#capacity')
    await capacity(page).fill('90')
    rec('refusal', 'the warning does not block saving (the database decides)',
      await page.getByRole('button', { name: 'Save changes', exact: true }).isEnabled())
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    // Wait for the message itself: under a loaded machine the refusal can land
    // after the network first goes idle.
    rec('refusal', 'shows "Capacity cannot be lower than the 100 people already confirmed"',
      await page.getByText('Capacity cannot be lower than the 100 people already confirmed').first()
        .waitFor({ timeout: 8000 }).then(() => true, () => false))
    rec('refusal', 'stays on the form', page.url().endsWith('/organizer/events/e-a/edit'), page.url())
    await ctx.close()
  }

  // ================= 5. Counts unavailable ===========================================
  {
    reset({ countError: true })
    const { page, ctx, errors } = await open('/organizer/events/e-a/edit')
    await page.waitForSelector('#capacity')
    await page.waitForLoadState('networkidle')
    rec('count error', 'says the counts could not be loaded', await text(page, 'Current registration counts could not be loaded.'))
    rec('count error', 'no counts and no warning shown', (await page.locator('p[aria-live="polite"]').count()) === 0)
    rec('count error', 'the form can still be saved', await page.getByRole('button', { name: 'Save changes', exact: true }).isEnabled())
    rec('count error', 'no page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 6. Zero counts ==================================================
  {
    reset({ confirmed: 0, waitlisted: 0 })
    const { page, ctx } = await open('/organizer/events/e-a/edit')
    await page.waitForSelector('#capacity')
    await page.waitForFunction(() => document.querySelector('p[aria-live="polite"]'), null, { timeout: 4000 }).catch(() => {})
    const shown = (await counts(page)).replace(/\s+/g, ' ').trim()
    rec('empty', 'an event nobody has registered for shows "0 confirmed · 0 waitlisted"', shown === '0 confirmed · 0 waitlisted', shown)
    await ctx.close()
  }

  // ================= 7. Create form ==================================================
  {
    reset()
    const { page, ctx } = await open('/organizer/events/new')
    await page.waitForSelector('#capacity')
    await page.waitForLoadState('networkidle')
    rec('create', 'no counts requested', log.counts.length === 0, JSON.stringify(log.counts))
    rec('create', 'no counts shown', (await page.locator('p[aria-live="polite"]').count()) === 0)
    rec('create', 'the same help text explains the minimum', await text(page, 'Confirmed registrations (registered or checked in) set the minimum capacity'))
    await ctx.close()
  }

  // ================= 8. Phone ========================================================
  {
    reset()
    const { page, ctx } = await open('/organizer/events/e-a/edit', { w: 390, h: 844 })
    await page.waitForSelector('#capacity')
    await page.waitForFunction(() => document.querySelector('p[aria-live="polite"]'), null, { timeout: 4000 }).catch(() => {})
    await capacity(page).scrollIntoViewIfNeeded()
    rec('phone', 'counts shown on a phone', (await counts(page)).includes('100 confirmed'))
    rec('phone', 'no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await page.screenshot({ path: path.join(OUT, 'capacity-counts-phone.jpg'), type: 'jpeg', quality: 70 })
    await ctx.close()
  }

  await browser.close()
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - fails}  FAIL ${fails}`)
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
