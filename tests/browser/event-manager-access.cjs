// What an organizer may do on ONE event: owner, admin, assigned manager, unassigned
// manager, suspended account, archived event, a failed or slow permission check, and
// direct links vs navigation. The screens ask the database the same two questions
// every organizer write policy asks — can_manage_event(event) and account_is_active()
// — and this suite answers them from fixtures.
// Runs against a STUBBED API. Nothing here reaches a real Supabase project, and no
// credential is used: the session is a fabricated token for a fake user id.
// Run all suites with: npm run test:browser
const { launchBrowser } = require('./launch.cjs')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || process.argv[2]
const OUT = process.env.SHOTS_DIR || process.argv[3] || path.join(require('os').tmpdir(), 'rally-browser-shots')
const UID = '11111111-1111-1111-1111-111111111111' // the signed-in organization member
const API = 'http://localhost:54321'
const ORG = 'org-1'
fs.mkdirSync(OUT, { recursive: true })

// ---- fixtures ----------------------------------------------------------------
const ev = (id, name, over = {}) => ({
  id, name, description: '', location: 'Accra', start_date: '2027-03-01', end_date: null, start_time: null, end_time: null,
  image_url: '', capacity: null, status: 'upcoming', timezone: 'Africa/Accra', created_at: '2026-06-01', owner_id: null,
  created_by: UID, organization_id: ORG, visibility: 'published', archived_at: null, published_at: '2026-06-01', ...over,
})
const events = [
  ev('e-a', 'Alpha Summit'),
  ev('e-b', 'Beta Forum', { start_date: '2027-04-01' }),
  ev('e-draft', 'Gamma Draft', { visibility: 'draft', published_at: null }),
  ev('e-arch', 'Old Expo', { start_date: '2026-01-01', archived_at: '2026-02-01T00:00:00Z' }),
]
const partnership = {
  id: 'p-1', event_id: 'e-a', sponsor_organization_id: null, company_name: 'Acme Corp', description: null, logo_url: null,
  industry: null, website: null, linkedin: null, tier_label: 'Gold', status: 'draft', acknowledged_at: null,
  value_amount: null, value_currency: null, internal_notes: null, representative_email: null, display_order: 0,
  created_by: UID, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
}

// ---- mock state --------------------------------------------------------------
// role: the caller's organization role. manages: the events can_manage_event says yes
// to (owner/admin: all; manager: their assignments). active: account_is_active().
const ctl = {}
let log
function reset(over = {}) {
  Object.assign(ctl, {
    role: 'owner', manages: events.map((e) => e.id), active: true, accountStatus: 'active',
    checkError: false, checkDelay: 0, archiveRefused: false,
  }, over)
  log = { canManage: [], organizerData: [], writes: [] }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const err = (code, message) => ({ code, message, details: null, hint: null })

function access() {
  return [{
    organization_id: ORG, organization_name: 'Test Org', organization_slug: 'test-org', organization_description: '',
    organization_logo_url: '', organization_website: '', organization_type: 'organizer', approval_status: 'approved',
    archived_at: null, organization_created_by: UID, organization_created_at: '2026-01-01T00:00:00Z',
    organization_updated_at: '2026-01-01T00:00:00Z', organization_role: ctl.role, joined_at: '2026-01-01T00:00:00Z',
    event_assignments: [],
  }]
}

// Organizer-only reads. If any of these is requested for an event the caller may
// not manage, the page loaded data it should not have asked for.
const ORGANIZER_DATA = ['event_attendee_list', 'event_invitation_list', 'event_activity_counts', 'find_event_attendees', 'get_event_registration_answers']

function rawRows(url) {
  const p = new URL(url).pathname
  if (p.endsWith('/profiles')) return [{ id: UID, full_name: 'Olu Organizer', photo_url: '', job_title: 'Founder', company: 'Acme', industry: '', location: '', bio: '', looking_for: '', can_offer: '', linkedin: '', website: '', email: 'o@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }]
  if (p.endsWith('/user_accounts')) return [{ account_type: 'organizer', status: ctl.accountStatus }]
  if (p.endsWith('/events')) return events
  if (p.endsWith('/event_partnerships')) return [partnership]
  if (p.endsWith('/rpc/get_my_organization_access')) return access()
  if (p.endsWith('/rpc/event_activity_counts')) return [{ registrations: 0, checked_in: 0, cancelled: 0, connections_made: 0, invitations_pending: 0, invitations_accepted: 0 }]
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
    if (m === 'GET') return json(200, rows(url, (req.headers()['accept'] || '').includes('pgrst.object')))
    if (m === 'POST' && url.includes('/rpc/')) {
      const body = JSON.parse(req.postData() || '{}')
      const name = new URL(url).pathname.split('/rpc/')[1]
      if (name === 'can_manage_event') {
        log.canManage.push(body.target_event_id)
        if (ctl.checkDelay) await sleep(ctl.checkDelay)
        if (ctl.checkError) return json(500, err('XX000', 'boom'))
        return json(200, ctl.manages.includes(body.target_event_id))
      }
      if (name === 'account_is_active') return json(200, ctl.active)
      if (ORGANIZER_DATA.includes(name)) log.organizerData.push({ name, event: body.target_event_id ?? body.p_event_id })
      return json(200, rows(url))
    }
    const body = req.postData() || ''
    log.writes.push({ m, url, body })
    // What check_event_archive_authority raises (ERRCODE 42501 -> HTTP 403).
    if (m === 'PATCH' && url.includes('/events') && body.includes('archived_at') && ctl.archiveRefused) {
      return json(403, err('42501', 'Only an organization owner or admin can archive or restore an event'))
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
  async function open(url, { w = 1440, h = 900, wait = 'h1, [role=alert], main', until = 'networkidle' } = {}) {
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
    await page.goto(BASE + url, { waitUntil: until })
    if (wait) await page.waitForSelector(wait, { timeout: 8000 }).catch(() => {})
    return { page, ctx, errors }
  }
  const vis = (page, sel) => page.isVisible(sel).catch(() => false)
  const denied = 'text=You don\'t manage this event'
  const button = (page, name) => page.getByRole('button', { name, exact: true })
  const has = async (page, name) => (await button(page, name).count()) > 0
  // Panels load their own rows before drawing their actions, so a control that
  // should be there is given a moment to appear.
  const appears = (page, name) => button(page, name).first().waitFor({ timeout: 4000 }).then(() => true, () => false)
  const tab = async (page, name) => { await page.getByRole('button', { name, exact: true }).first().click(); await page.waitForLoadState('networkidle') }

  // Everything an event manager works with on a live, published event.
  // `archive`: whether the caller has organization authority (owner/admin).
  async function fullControls(group, page, { archive }) {
    rec(group, 'Edit event is offered', (await page.getByRole('link', { name: /Edit event/ }).count()) > 0)
    rec(group, 'the Lifecycle card offers Mark as live', await has(page, 'Mark as live'))
    if (archive) {
      rec(group, 'Archive is offered (organization authority)', await has(page, 'Archive'))
    } else {
      rec(group, 'Archive is NOT offered to a manager', !(await has(page, 'Archive')))
      rec(group, 'the Lifecycle card says who can archive', await vis(page, 'text=Only an owner or admin of the organization can archive this event.'))
    }
    await tab(page, 'Agenda')
    rec(group, 'Agenda: Add Session', await appears(page, 'Add Session'))
    await tab(page, 'Speakers')
    rec(group, 'Speakers: Add Speaker', await appears(page, 'Add Speaker'))
    await tab(page, 'Exhibitors')
    rec(group, 'Exhibitors: Add Exhibitor', await appears(page, 'Add Exhibitor'))
    await tab(page, 'Partners')
    rec(group, 'Partners: Add Partner', await appears(page, 'Add Partner'))
    await tab(page, 'Registrations')
    rec(group, 'Registrations: the form can be edited (Add question)', await appears(page, 'Add question'))
    await tab(page, 'Invitations')
    rec(group, 'Invitations: the invite form is offered', await vis(page, 'button:has-text("Send invitation")'))
  }

  // ================= 1. Owner and admin: unchanged, full control ======================
  for (const role of ['owner', 'admin']) {
    reset({ role })
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await fullControls(role, page, { archive: true })
    rec(role, 'asked can_manage_event for this event', log.canManage.includes('e-a'))
    rec(role, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()

    // Archive sends exactly one update setting archived_at.
    reset({ role })
    const a = await open('/organizer/events/e-a')
    await a.page.waitForSelector('h1:has-text("Alpha Summit")')
    await button(a.page, 'Archive').click()
    await a.page.waitForLoadState('networkidle')
    const patch = log.writes.find((w) => w.m === 'PATCH' && w.url.includes('/events'))
    rec(role, 'Archive sends an update of archived_at', !!patch && /"archived_at":"\d{4}-/.test(patch.body ?? ''), JSON.stringify(patch))
    await a.ctx.close()

    // Restore on an archived event.
    reset({ role })
    const r = await open('/organizer/events/e-arch')
    await r.page.waitForSelector('h1:has-text("Old Expo")')
    rec(role, 'Restore is offered on an archived event', await has(r.page, 'Restore'))
    await button(r.page, 'Restore').click()
    await r.page.waitForLoadState('networkidle')
    const restore = log.writes.find((w) => w.m === 'PATCH' && w.url.includes('/events'))
    rec(role, 'Restore sends archived_at: null', !!restore && /"archived_at":null/.test(restore.body ?? ''), JSON.stringify(restore))
    await r.ctx.close()
  }

  // The database is the authority: if it refuses an archive (say the caller's
  // role changed since the page loaded), the refusal is shown in its own words.
  {
    reset({ role: 'admin', archiveRefused: true })
    const { page, ctx } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await button(page, 'Archive').click()
    await page.waitForSelector('text=Only an organization owner or admin can archive or restore an event', { timeout: 5000 }).catch(() => {})
    rec('refused', 'a database refusal of an archive is shown to the user', await vis(page, 'text=Only an organization owner or admin can archive or restore an event'))
    await ctx.close()
  }

  // ================= 2. Assigned manager: the controls the database allows ===========
  {
    reset({ role: 'manager', manages: ['e-a', 'e-arch', 'e-draft'] })
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await fullControls('assigned', page, { archive: false })
    await page.screenshot({ path: path.join(OUT, 'manager-event-detail.jpg'), type: 'jpeg', quality: 70 })
    rec('assigned', 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()

    // The edit form, reached directly.
    const edit = await open('/organizer/events/e-a/edit')
    await edit.page.waitForSelector('h1:has-text("Edit event")')
    rec('assigned', 'a direct link to /edit opens the form, enabled', (await edit.page.isEnabled('#name')) && (await edit.page.inputValue('#name')) === 'Alpha Summit')
    await edit.ctx.close()

    // A draft can be published by the manager running it.
    const d = await open('/organizer/events/e-draft')
    await d.page.waitForSelector('h1:has-text("Gamma Draft")')
    rec('assigned', 'a draft offers Publish publicly', await has(d.page, 'Publish publicly'))
    await tab(d.page, 'Invitations')
    rec('assigned', 'a draft offers no invite form (publish first)', !(await vis(d.page, 'button:has-text("Send invitation")')))
    await d.ctx.close()

    // Partner detail is event-scoped too.
    const p = await open('/organizer/events/e-a/partners/p-1')
    await p.page.waitForSelector('text=Acme Corp')
    rec('assigned', 'Partner detail: Edit partnership is enabled', await p.page.isEnabled('button:has-text("Edit partnership")'))
    await p.ctx.close()

    // Creating is still an owner/admin act.
    const n = await open('/organizer/events/new')
    rec('assigned', '/events/new refuses a manager', await vis(n.page, 'text=Only owners and admins can create events'))
    rec('assigned', '/events/new shows no form', (await n.page.locator('#name').count()) === 0)
    await n.ctx.close()
    const list = await open('/organizer/events')
    rec('assigned', 'the events list offers no Create event to a manager', (await list.page.getByRole('link', { name: /Create event/i }).count()) === 0 && (await list.page.getByRole('button', { name: /Create event/i }).count()) === 0)
    await list.ctx.close()
  }

  // ================= 3. Unassigned manager: direct links and navigation alike ========
  {
    reset({ role: 'manager', manages: ['e-a'] })
    const { page, ctx, errors } = await open('/organizer/events/e-b')
    await page.waitForSelector(denied)
    rec('unassigned', 'a direct link to another event is refused', await vis(page, denied))
    rec('unassigned', 'no event name, tabs or controls are shown', !(await vis(page, 'h1:has-text("Beta Forum")')) && !(await has(page, 'Agenda')) && (await page.getByRole('link', { name: /Edit event/ }).count()) === 0)
    rec('unassigned', 'no organizer data was requested for it', log.organizerData.length === 0, JSON.stringify(log.organizerData))
    rec('unassigned', 'nothing was written', log.writes.length === 0)
    await page.screenshot({ path: path.join(OUT, 'manager-event-denied.jpg'), type: 'jpeg', quality: 70 })
    rec('unassigned', 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()

    const edit = await open('/organizer/events/e-b/edit')
    await edit.page.waitForSelector(denied)
    rec('unassigned', 'a direct link to /edit is refused, with no form', (await vis(edit.page, denied)) && (await edit.page.locator('#name').count()) === 0)
    await edit.ctx.close()

    const partner = await open('/organizer/events/e-b/partners/p-1')
    await partner.page.waitForSelector(denied)
    rec('unassigned', 'a direct link to a partner of that event is refused', (await vis(partner.page, denied)) && !(await vis(partner.page, 'text=Acme Corp')))
    await partner.ctx.close()

    // Navigating from the events list lands on the same answer.
    const list = await open('/organizer/events')
    await list.page.getByRole('link', { name: /Beta Forum/ }).first().click()
    await list.page.waitForSelector(denied)
    rec('unassigned', 'clicking the event in the list gives the same refusal', await vis(list.page, denied))
    await list.page.click('text=Back to events')
    await list.page.getByRole('link', { name: /Alpha Summit/ }).first().click()
    await list.page.waitForSelector('h1:has-text("Alpha Summit")')
    rec('unassigned', 'moving on to an assigned event shows its controls', (await list.page.getByRole('link', { name: /Edit event/ }).count()) > 0)
    await list.ctx.close()
  }

  // ================= 4. Archived event: frozen except Restore ========================
  {
    reset({ role: 'manager', manages: ['e-arch'] })
    const { page, ctx } = await open('/organizer/events/e-arch')
    await page.waitForSelector('h1:has-text("Old Expo")')
    rec('archived', 'Restore is NOT offered to the assigned manager', !(await has(page, 'Restore')))
    rec('archived', 'the banner says who can restore it', await vis(page, 'text=Only an owner or admin of the organization can restore it.'))
    rec('archived', 'no Edit event, no Lifecycle actions', (await page.getByRole('link', { name: /Edit event/ }).count()) === 0 && !(await has(page, 'Archive')) && !(await has(page, 'Mark as live')))
    // Absence is only meaningful once the panel has drawn: wait for its own
    // archived notice before checking that the action is missing.
    await tab(page, 'Agenda')
    await page.waitForSelector('text=/archived/i', { timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(500)
    rec('archived', 'Agenda offers no Add Session', !(await has(page, 'Add Session')))
    await tab(page, 'Partners')
    await page.waitForTimeout(800)
    rec('archived', 'Partners offers no Add Partner', !(await has(page, 'Add Partner')))
    await ctx.close()

    const edit = await open('/organizer/events/e-arch/edit')
    await edit.page.waitForSelector('h1:has-text("Edit event")')
    rec('archived', 'the edit form says it is archived and cannot be saved', (await vis(edit.page, 'text=This event is archived and cannot be edited')) && (await edit.page.isDisabled('button[type=submit]')))
    await edit.ctx.close()
  }

  // ================= 5. Suspended account ============================================
  {
    // A suspended account keeps its rows but not its access: account_is_active() is
    // false, so every organizer policy refuses, assigned or not.
    reset({ role: 'manager', manages: ['e-a'], active: false, accountStatus: 'suspended' })
    const { page, ctx } = await open('/organizer/events/e-a', { wait: null })
    await page.waitForTimeout(1500)
    const onEventPage = new URL(page.url()).pathname === '/organizer/events/e-a'
    const noControls = (await page.getByRole('link', { name: /Edit event/ }).count()) === 0 && !(await has(page, 'Add Session'))
    rec('suspended', onEventPage ? 'the event page refuses a suspended account' : 'a suspended account is sent away from the event page',
      noControls && (!onEventPage || (await vis(page, denied))), page.url())
    rec('suspended', 'no organizer data was requested', log.organizerData.length === 0, JSON.stringify(log.organizerData))
    await ctx.close()
  }

  // ================= 6. The check fails, then succeeds on retry ======================
  {
    reset({ role: 'manager', manages: ['e-a'], checkError: true })
    const { page, ctx } = await open('/organizer/events/e-a')
    await page.waitForSelector('text=We could not confirm your access to this event.')
    rec('failed', 'a failed check says so', true)
    rec('failed', 'and shows no controls and loads no data', (await page.getByRole('link', { name: /Edit event/ }).count()) === 0 && log.organizerData.length === 0)
    ctl.checkError = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    rec('failed', 'Try again re-asks and unlocks the page once the database says yes', (await page.getByRole('link', { name: /Edit event/ }).count()) > 0)
    await ctx.close()

    reset({ role: 'manager', manages: ['e-a'], checkError: true })
    const edit = await open('/organizer/events/e-a/edit')
    await edit.page.waitForSelector('text=We could not confirm your access to this event.')
    rec('failed', 'the edit form shows no fields when the check fails', (await edit.page.locator('#name').count()) === 0)
    await edit.ctx.close()
  }

  // ================= 7. Nothing restricted shows while the check is in flight ========
  {
    reset({ role: 'manager', manages: ['e-a'], checkDelay: 1500 })
    const { page, ctx } = await open('/organizer/events/e-a', { wait: null, until: 'domcontentloaded' })
    await page.waitForSelector('text=Checking your access', { timeout: 5000 }).catch(() => {})
    rec('in-flight', 'shows "Checking your access…" while waiting', await vis(page, 'text=Checking your access'))
    rec('in-flight', 'no controls and no data before the answer', (await page.getByRole('link', { name: /Edit event/ }).count()) === 0 && log.organizerData.length === 0)
    await page.waitForSelector('h1:has-text("Alpha Summit")', { timeout: 8000 })
    rec('in-flight', 'controls appear once the answer is yes', (await page.getByRole('link', { name: /Edit event/ }).count()) > 0)
    await ctx.close()
  }

  // ================= 8. Phone viewport ===============================================
  {
    reset({ role: 'manager', manages: ['e-a'] })
    const { page, ctx } = await open('/organizer/events/e-a', { w: 390, h: 844 })
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    rec('phone', 'an assigned manager gets Edit event on a phone', (await page.getByRole('link', { name: /Edit event/ }).count()) > 0)
    rec('phone', 'no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await ctx.close()
    const d = await open('/organizer/events/e-b', { w: 390, h: 844 })
    await d.page.waitForSelector(denied)
    rec('phone', 'the refusal fits a phone without horizontal scroll', await d.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await d.page.screenshot({ path: path.join(OUT, 'manager-event-denied-phone.jpg'), type: 'jpeg', quality: 70 })
    await d.ctx.close()
  }

  await browser.close()
  fs.writeFileSync(path.join(OUT, '..', 'event-manager-access-results.json'), JSON.stringify(results, null, 2))
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - fails}  FAIL ${fails}`)
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
