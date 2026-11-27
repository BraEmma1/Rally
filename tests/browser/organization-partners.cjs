// The organization partner list: Partners in the organizer navigation (sidebar, More
// drawer, bottom nav), the Partners page (order, event tags, search, archived, what a
// manager sees, empty and error states), creating a partner (exact payload, the
// duplicate-name message), the partner page with its event history, Add Partner's
// Partner step (choose or create, the exact saves, retrying after a partial save, an
// event without an organization), and linked partnerships managed on the partner.
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
const T = '2026-10-01T00:00:00Z'
fs.mkdirSync(OUT, { recursive: true })

// ---- fixtures ----------------------------------------------------------------
const ev = (id, name, start_date, over = {}) => ({
  id, name, description: '', location: 'Accra', start_date, end_date: null, start_time: null, end_time: null,
  image_url: '', capacity: null, status: 'upcoming', timezone: 'Africa/Accra', created_at: '2026-06-01', owner_id: null,
  created_by: UID, organization_id: ORG, visibility: 'published', archived_at: null, published_at: '2026-06-01', ...over,
})
const EVENTS = {
  ats: ev('e-ats', 'Africa Tech Summit 2027', '2027-03-01'),
  fin: ev('e-fin', 'Africa FinTech 2027', '2027-06-01'),
  energy: ev('e-energy', 'West Africa Energy', '2026-11-01', { status: 'past' }),
  arch: ev('e-arch', 'Archived Expo', '2026-05-01', { archived_at: '2026-08-01T00:00:00Z', status: 'past' }),
  legacy: ev('e-legacy', 'Legacy Meetup', '2027-08-01', { organization_id: null }),
}
const partner = (id, company_name, over = {}) => ({
  id, organization_id: ORG, company_name, description: null, logo_url: null, industry: null, website: null,
  linkedin: null, contact_email: null, archived_at: null, created_by: UID, created_at: T, updated_at: T, ...over,
})
const obligations = (owed, done, required = 0) => [
  ...Array.from({ length: owed }, (_, i) => ({ direction: 'organizer_to_partner', status: i < done ? 'completed' : 'pending' })),
  ...Array.from({ length: required }, () => ({ direction: 'partner_to_organizer', status: 'completed' })),
]
const partnership = (id, partner_id, event, over = {}) => ({
  id, event_id: event.id, partner_id, company_name: 'x', description: null, logo_url: null, industry: null, website: null,
  linkedin: null, tier_label: null, value_amount: null, value_currency: null, internal_notes: null,
  representative_email: null, status: 'active', sponsor_organization_id: null, acknowledged_at: null, package_id: null,
  display_order: 0, created_by: UID, created_at: T, updated_at: T, event, obligations: [], ...over,
})

let state
let log
let seq = 0
function reset(over = {}) {
  const partners = [
    partner('k-kora', 'Kora Payments', { industry: 'Fintech', website: 'https://kora.example', contact_email: 'contact@kora.example', description: 'Payments for Africa' }),
    partner('k-baobab', 'Baobab Ventures', { industry: 'Investment' }),
    partner('k-sahel', 'Sahel Cloud', { industry: 'Cloud', contact_email: 'team@sahel.example' }),
    partner('k-zebra', 'Zebra Media', { industry: 'Media' }),
    partner('k-old', 'Old Co', { archived_at: '2026-09-01T00:00:00Z' }),
  ]
  const byId = Object.fromEntries(partners.map((p) => [p.id, p]))
  const linked = (id, pid, event, over2 = {}) => {
    const p = byId[pid]
    return partnership(id, pid, event, { company_name: p.company_name, industry: p.industry, website: p.website, description: p.description, ...over2 })
  }
  state = {
    role: 'owner',
    managedEvents: ['e-fin'], // what a manager is assigned to
    partners,
    partnerships: [
      linked('p-k1', 'k-kora', EVENTS.ats, { tier_label: 'Diamond', obligations: obligations(5, 3, 1) }),
      linked('p-k2', 'k-kora', EVENTS.fin, { tier_label: 'Platinum', obligations: obligations(3, 1) }),
      linked('p-b1', 'k-baobab', EVENTS.ats, { tier_label: 'Gold' }),
      linked('p-s1', 'k-sahel', EVENTS.energy, { tier_label: 'Silver', status: 'completed' }),
      linked('p-o1', 'k-old', EVENTS.arch, { status: 'completed' }),
      partnership('p-u1', null, EVENTS.ats, { company_name: 'Unlinked Ltd', website: 'https://unlinked.example', status: 'draft' }),
    ],
    partnersFail: false,
    partnerPostError: null, // { status, body } returned once by the next organization_partners POST
    partnershipPostFailOnce: false,
    patchError: null,
    ...over,
  }
  log = { writes: [], rpcs: [] }
}
const err = (code, message, details = null) => ({ code, message, details, hint: null })

function access() {
  const manager = state.role === 'manager'
  return [{
    organization_id: ORG, organization_name: 'Test Org', organization_slug: 'test-org', organization_description: '',
    organization_logo_url: '', organization_website: '', organization_type: 'organizer', approval_status: 'approved',
    archived_at: null, organization_created_by: UID, organization_created_at: '2026-01-01T00:00:00Z',
    organization_updated_at: '2026-01-01T00:00:00Z', organization_role: state.role, joined_at: '2026-01-01T00:00:00Z',
    event_assignments: manager ? state.managedEvents.map((id) => ({ event_id: id, event_name: id })) : [],
  }]
}

// What event_partnerships RLS returns: every event of the organization for an owner
// or admin, the assigned events for a manager.
function visiblePartnerships() {
  if (state.role !== 'manager') return state.partnerships
  return state.partnerships.filter((p) => state.managedEvents.includes(p.event_id))
}
function get(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}
function filtered(rows, url) {
  let r = rows
  for (const [k, v] of new URL(url).searchParams) {
    if (k === 'select' || k === 'order') continue
    if (v.startsWith('eq.')) r = r.filter((x) => String(get(x, k)) === v.slice(3))
    if (v === 'not.is.null') r = r.filter((x) => get(x, k) != null)
  }
  return r
}
function rawRows(url) {
  const p = new URL(url).pathname
  if (p.endsWith('/profiles')) return [{ id: UID, full_name: 'Olu Organizer', photo_url: '', job_title: 'Founder', company: 'Acme', industry: '', location: '', bio: '', looking_for: '', can_offer: '', linkedin: '', website: '', email: 'o@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }]
  if (p.endsWith('/user_accounts')) return [{ account_type: 'organizer', status: 'active' }]
  if (p.endsWith('/events')) return Object.values(EVENTS)
  if (p.endsWith('/organization_partners')) return [...state.partners].sort((a, b) => a.company_name.localeCompare(b.company_name))
  if (p.endsWith('/event_partnerships')) return visiblePartnerships()
  if (p.endsWith('/event_partnership_roles')) return [{ role: 'sponsor' }]
  if (p.endsWith('/event_partnership_packages')) return []
  if (p.endsWith('/rpc/get_my_organization_access')) return access()
  if (p.endsWith('/rpc/event_activity_counts')) return [{ registrations: 0, checked_in: 0, cancelled: 0, connections_made: 0, invitations_pending: 0, invitations_accepted: 0 }]
  return []
}

async function wire(ctx) {
  await ctx.route(API + '/**', async (route) => {
    const req = route.request(); const url = req.url(); const m = req.method()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
    const json = (status, b) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(b) })
    const single = (req.headers()['accept'] || '').includes('pgrst.object')
    const pathname = new URL(url).pathname
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (m === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': '0-0/0' } })
    if (m === 'GET') {
      if (pathname.endsWith('/organization_partners') && state.partnersFail) return json(500, err('XX000', 'boom'))
      const r = filtered(rawRows(url), url)
      return json(200, single ? r[0] ?? null : r)
    }
    const body = JSON.parse(req.postData() || 'null')

    if (m === 'POST' && pathname.includes('/rpc/')) {
      const name = pathname.split('/rpc/')[1]
      log.rpcs.push({ name, body })
      if (name === 'can_manage_event') {
        const id = body.target_event_id ?? body.event_id
        return json(200, state.role !== 'manager' || state.managedEvents.includes(id))
      }
      if (name === 'account_is_active') return json(200, true)
      if (name === 'get_event_partnership_packages') return json(200, [])
      if (name === 'get_event_partnership_summary') return json(200, [])
      if (name === 'set_event_partnership_roles') return json(200, null)
      return json(200, rawRows(url))
    }

    log.writes.push({ m, path: pathname, query: new URL(url).search, body })
    if (pathname.endsWith('/organization_partners')) {
      if (m === 'POST') {
        if (state.partnerPostError) {
          const e = state.partnerPostError; state.partnerPostError = null
          return json(e.status, e.body)
        }
        const row = partner('k-new-' + ++seq, body.company_name, { ...body })
        state.partners.push(row)
        return json(201, single ? row : [row])
      }
      if (m === 'PATCH') {
        if (state.patchError) { const e = state.patchError; state.patchError = null; return json(e.status, e.body) }
        const id = new URL(url).searchParams.get('id')?.slice(3)
        const row = state.partners.find((p) => p.id === id)
        if (row) Object.assign(row, body)
        return json(200, row ? [{ id }] : [])
      }
    }
    if (pathname.endsWith('/event_partnerships')) {
      if (m === 'POST') {
        if (state.partnershipPostFailOnce) {
          state.partnershipPostFailOnce = false
          return json(500, err('XX000', 'Something went wrong'))
        }
        const event = Object.values(EVENTS).find((e) => e.id === body.event_id)
        const row = partnership('p-new-' + ++seq, body.partner_id ?? null, event, { ...body })
        state.partnerships.push(row)
        return json(201, single ? { id: row.id } : [{ id: row.id }])
      }
      if (m === 'PATCH') return json(200, [{ id: new URL(url).searchParams.get('id')?.slice(3) }])
      if (m === 'DELETE') return json(200, [])
    }
    if (pathname.endsWith('/event_partnership_obligations') && m === 'POST') return json(201, null)
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
  async function open(url, { w = 1440, h = 900, touch = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) })
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
  const button = (scope, name) => scope.getByRole('button', { name, exact: true })
  const appears = (locator, timeout = 4000) => locator.first().waitFor({ timeout }).then(() => true, () => false)
  const gone = (locator, timeout = 4000) => locator.first().waitFor({ state: 'detached', timeout }).then(() => true, () => false)
  const settle = (page) => page.waitForLoadState('networkidle')
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  const sheetFits = (page) => page.evaluate(() => [...document.querySelectorAll('[role=dialog] > div')].every((el) => el.scrollWidth <= el.clientWidth + 1))
  const rowNames = (page) => page.getByRole('list', { name: 'Partners' }).locator(':scope > li [data-testid=partner-name]').allTextContents()
  const rowOf = (page, name) => page.getByRole('list', { name: 'Partners' }).locator(':scope > li').filter({ hasText: name })
  const writes = (pathEnd, method) => log.writes.filter((w) => w.path.endsWith(pathEnd) && (!method || w.m === method))

  try {
    // ======================================================================
    // nav
    // ======================================================================
    {
      reset()
      const { page, ctx } = await open('/organizer')
      const sidebar = page.locator('aside nav, nav').filter({ has: page.getByRole('link', { name: 'Dashboard' }) }).first()
      const labels = (await sidebar.getByRole('link').allTextContents()).map((s) => s.trim())
      const people = labels.indexOf('People')
      rec('nav', 'Partners is in the sidebar, right after People', people >= 0 && labels[people + 1] === 'Partners', JSON.stringify(labels))
      await sidebar.getByRole('link', { name: 'Partners' }).click()
      await settle(page)
      rec('nav', 'the sidebar link opens /organizer/partners', new URL(page.url()).pathname === '/organizer/partners', page.url())
      const active = await sidebar.getByRole('link', { name: 'Partners' }).getAttribute('class')
      rec('nav', 'Partners is highlighted on the Partners page', /primary-50|primary-700/.test(active ?? ''), active)
      await ctx.close()
    }
    for (const w of [390, 320]) {
      reset()
      const { page, ctx } = await open('/organizer', { w, h: 800, touch: true })
      const bar = page.getByRole('navigation', { name: 'Organizer' })
      const items = (await bar.locator(':scope > a, :scope > button').allTextContents()).map((s) => s.trim())
      rec('nav', `bottom nav at ${w}px has Partners after People`, items[items.indexOf('People') + 1] === 'Partners', JSON.stringify(items))
      const widths = await bar.locator(':scope > a, :scope > button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
      rec('nav', `bottom nav at ${w}px: every item at least 44px wide`, widths.every((x) => x >= 44), JSON.stringify(widths.map(Math.round)))
      rec('nav', `bottom nav at ${w}px: no sideways overflow`, await noOverflow(page))
      if (w === 390) {
        await button(page, 'More menu').click()
        const drawer = page.getByRole('dialog', { name: 'Organizer menu' })
        await appears(drawer)
        const rows = (await drawer.getByRole('link').allTextContents()).map((s) => s.trim())
        rec('nav', 'the More drawer lists Partners after People', rows[rows.indexOf('People') + 1] === 'Partners', JSON.stringify(rows))
      }
      await ctx.close()
    }

    // ======================================================================
    // list
    // ======================================================================
    {
      reset()
      const { page, ctx, errors } = await open('/organizer/partners')
      await appears(page.getByRole('list', { name: 'Partners' }))
      rec('list', 'the heading is Partners', (await page.locator('h1').first().textContent())?.trim() === 'Partners')
      rec('list', 'most recent event first, then name; partners without events last; archived hidden',
        JSON.stringify(await rowNames(page)) === JSON.stringify(['Kora Payments', 'Baobab Ventures', 'Sahel Cloud', 'Zebra Media']), JSON.stringify(await rowNames(page)))
      const kora = rowOf(page, 'Kora Payments')
      const tags = (await kora.locator('[data-testid=partner-tag]').allTextContents()).map((s) => s.trim())
      rec('list', "a partner's events are tagged, most recent first", tags.length === 2 && /Africa FinTech 2027/.test(tags[0]) && /Africa Tech Summit 2027/.test(tags[1]), JSON.stringify(tags))
      rec('list', 'each tag carries the event lifecycle as a badge', /Published/i.test(tags[0]), tags[0])
      rec('list', 'the event count is shown', /2 events/.test(await kora.textContent()))
      rec('list', 'a partner with no events says so to an owner', /No events yet/.test(await rowOf(page, 'Zebra Media').textContent()))
      rec('list', 'a row links to its partner page', (await kora.getByRole('link', { name: /Kora Payments/ }).getAttribute('href')) === '/organizer/partners/k-kora')
      const search = page.getByRole('searchbox', { name: 'Search partners' })
      await search.fill('fin')
      rec('list', 'search matches the industry', JSON.stringify(await rowNames(page)) === JSON.stringify(['Kora Payments']), JSON.stringify(await rowNames(page)))
      await search.fill('BAOBAB')
      rec('list', 'search matches the name, ignoring case', JSON.stringify(await rowNames(page)) === JSON.stringify(['Baobab Ventures']))
      await search.fill('')
      await page.getByRole('checkbox', { name: 'Show archived' }).check()
      rec('list', 'Show archived adds the archived partner', (await rowNames(page)).includes('Old Co'))
      rec('list', 'an archived partner is marked as archived', /Archived/.test(await rowOf(page, 'Old Co').textContent()))
      rec('list', 'nothing was written by reading the list', log.writes.length === 0, JSON.stringify(log.writes))
      rec('list', 'no console errors', errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
    {
      reset({ role: 'manager' })
      const { page, ctx } = await open('/organizer/partners')
      await appears(page.getByRole('list', { name: 'Partners' }))
      const koraTags = (await rowOf(page, 'Kora Payments').locator('[data-testid=partner-tag]').allTextContents()).map((s) => s.trim())
      rec('list', 'a manager sees tags for their own events only', koraTags.length === 1 && /Africa FinTech 2027/.test(koraTags[0]), JSON.stringify(koraTags))
      rec('list', 'a manager sees "No events you manage" for a partner of other events', /No events you manage/.test(await rowOf(page, 'Baobab Ventures').textContent()))
      rec('list', 'a manager still sees every partner', (await rowNames(page)).length === 4, JSON.stringify(await rowNames(page)))
      await ctx.close()
    }
    {
      reset({ partners: [], partnerships: [] })
      const { page, ctx } = await open('/organizer/partners')
      rec('list', 'an empty list explains how partners get here',
        await appears(page.getByText('Partners you add to events appear here, so you can choose them again for your next event.')))
      await ctx.close()
    }
    {
      reset({ partnersFail: true })
      const { page, ctx } = await open('/organizer/partners')
      const retry = button(page, 'Try again')
      rec('list', 'a failed load shows an error with Try again', await appears(retry))
      state.partnersFail = false
      await retry.click()
      rec('list', 'Try again loads the list', await appears(page.getByRole('list', { name: 'Partners' })))
      await ctx.close()
    }
    for (const w of [390, 320]) {
      reset()
      const { page, ctx } = await open('/organizer/partners', { w, h: 800, touch: true })
      await appears(page.getByRole('list', { name: 'Partners' }))
      rec('list', `no sideways overflow at ${w}px`, await noOverflow(page))
      await ctx.close()
    }

    // ======================================================================
    // create
    // ======================================================================
    {
      reset()
      const { page, ctx } = await open('/organizer/partners')
      await button(page, 'New partner').click()
      const dialog = page.getByRole('dialog', { name: 'New partner' })
      rec('create', 'New partner opens the form', await appears(dialog))
      await button(dialog, 'Save partner').click()
      rec('create', 'a blank name is refused before saving', await appears(dialog.getByRole('alert').filter({ hasText: 'Give this partner a company name.' })))
      rec('create', '...and nothing is sent', writes('/organization_partners').length === 0)
      await dialog.locator('#pt-company').fill('Zuri Logistics')
      await dialog.locator('#pt-industry').fill('Logistics')
      await dialog.locator('#pt-website').fill('zuri.example')
      await dialog.locator('#pt-contact').fill('Hello@Zuri.example')
      await button(dialog, 'Save partner').click()
      await gone(dialog)
      const post = writes('/organization_partners', 'POST')[0]
      rec('create', 'the partner is created with exactly the form\'s fields and the organization',
        post && JSON.stringify(Object.keys(post.body).sort()) === JSON.stringify(['company_name', 'contact_email', 'description', 'industry', 'linkedin', 'logo_url', 'organization_id', 'website']),
        JSON.stringify(post?.body))
      rec('create', '...normalized as the database stores it',
        post?.body.organization_id === ORG && post.body.company_name === 'Zuri Logistics' && post.body.website === 'https://zuri.example/' &&
        post.body.contact_email === 'hello@zuri.example' && post.body.description === null && post.body.linkedin === null, JSON.stringify(post?.body))
      rec('create', 'the new partner is listed', await appears(rowOf(page, 'Zuri Logistics')))
      await ctx.close()
    }
    {
      reset({ partnerPostError: { status: 409, body: err('23505', 'duplicate key value violates unique constraint "organization_partners_active_name_unique"') } })
      const { page, ctx } = await open('/organizer/partners')
      await button(page, 'New partner').click()
      const dialog = page.getByRole('dialog', { name: 'New partner' })
      await dialog.locator('#pt-company').fill('Kora Payments')
      await button(dialog, 'Save partner').click()
      rec('create', 'a duplicate name gets the "already one of your partners" message',
        await appears(dialog.getByRole('alert').filter({ hasText: 'Kora Payments is already one of your partners.' })))
      rec('create', '...and the form stays open with the name kept', (await dialog.locator('#pt-company').inputValue()) === 'Kora Payments')
      await ctx.close()
    }
    for (const w of [390, 320]) {
      reset()
      const { page, ctx } = await open('/organizer/partners', { w, h: 800, touch: true })
      await button(page, 'New partner').click()
      await appears(page.getByRole('dialog', { name: 'New partner' }))
      rec('create', `the form fits at ${w}px`, (await sheetFits(page)) && (await noOverflow(page)))
      await ctx.close()
    }
    // ======================================================================
    // profile
    // ======================================================================
    const history = (page, name) => page.getByRole('list', { name: 'Events with ' + name })
    {
      reset()
      const { page, ctx, errors } = await open('/organizer/partners/k-kora')
      rec('profile', 'the partner page shows the partner', (await page.locator('h1').first().textContent())?.trim() === 'Kora Payments')
      const ident = await page.getByTestId('partner-identity').textContent()
      rec('profile', 'with industry, website and contact email', /Fintech/.test(ident) && /kora\.example/.test(ident) && /contact@kora\.example/.test(ident), ident)
      const list = history(page, 'Kora Payments')
      await appears(list)
      const rows = list.locator(':scope > li')
      rec('profile', 'every event the partner was on is listed, most recent first', (await rows.count()) === 2 && /Africa FinTech 2027/.test(await rows.nth(0).textContent()), await list.textContent())
      const ats = rows.filter({ hasText: 'Africa Tech Summit 2027' })
      const atsText = await ats.textContent()
      rec('profile', 'a row shows the tier, the status and the deliveries', /Diamond/.test(atsText) && /Active/.test(atsText) && /3\/5 delivered/.test(atsText), atsText)
      rec('profile', 'a row opens that event\'s partnership', (await ats.getByRole('link').first().getAttribute('href')) === '/organizer/events/e-ats/partners/p-k1')
      rec('profile', 'an owner can edit and archive', (await button(page, 'Edit').count()) === 1 && (await button(page, 'Archive').count()) === 1)
      rec('profile', 'no manager note for an owner', (await page.getByText('Only events you manage are listed.').count()) === 0)
      const sidebar = page.locator('nav').filter({ has: page.getByRole('link', { name: 'Dashboard' }) }).first()
      rec('profile', 'Partners stays highlighted in the sidebar', /primary-50|primary-700/.test((await sidebar.getByRole('link', { name: 'Partners' }).getAttribute('class')) ?? ''))
      rec('profile', 'nothing was written by reading', log.writes.length === 0, JSON.stringify(log.writes))

      await button(page, 'Edit').click()
      const dialog = page.getByRole('dialog', { name: 'Edit partner' })
      await appears(dialog)
      rec('profile', 'the edit form says it changes every event', await appears(dialog.getByText('Changes apply to this partner at every event, including what the partner sees.')))
      rec('profile', 'no archived-events line when no linked event is archived', (await dialog.getByText('Archived events keep their details until restored.').count()) === 0)
      rec('profile', 'the form starts from the partner', (await dialog.locator('#pt-website').inputValue()) === 'https://kora.example' && (await dialog.locator('#pt-contact').inputValue()) === 'contact@kora.example')
      await dialog.locator('#pt-website').fill('https://kora.io')
      await button(dialog, 'Save changes').click()
      await gone(dialog)
      const patch = writes('/organization_partners', 'PATCH')[0]
      rec('profile', 'the edit sends exactly the partner\'s seven fields',
        patch && JSON.stringify(Object.keys(patch.body).sort()) === JSON.stringify(['company_name', 'contact_email', 'description', 'industry', 'linkedin', 'logo_url', 'website']), JSON.stringify(patch?.body))
      rec('profile', '...to this partner only', patch?.query.includes('id=eq.k-kora'), patch?.query)
      rec('profile', 'the page shows the saved website', /kora\.io/.test(await page.getByTestId('partner-identity').textContent()))

      await button(page, 'Archive').click()
      await settle(page)
      const arch = writes('/organization_partners', 'PATCH')[1]
      rec('profile', 'Archive sends an archive time and nothing else', arch && Object.keys(arch.body).join() === 'archived_at' && typeof arch.body.archived_at === 'string', JSON.stringify(arch?.body))
      rec('profile', 'an archived partner says it is not offered for events', await appears(page.getByText('This partner is archived. It is not offered when adding partners to events.')))
      state.patchError = { status: 400, body: err('P0001', 'Kora Payments already exists. Rename one of them first.') }
      await button(page, 'Restore').click()
      rec('profile', 'a refused restore shows the database\'s message as written', await appears(page.getByRole('alert').filter({ hasText: 'Kora Payments already exists. Rename one of them first.' })))
      const rest = writes('/organization_partners', 'PATCH')[2]
      rec('profile', 'Restore sends archived_at: null', rest && rest.body.archived_at === null, JSON.stringify(rest?.body))
      rec('profile', 'no console errors', errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
    {
      reset()
      const { page, ctx } = await open('/organizer/partners/k-old')
      await appears(history(page, 'Old Co'))
      await button(page, 'Edit').click()
      const dialog = page.getByRole('dialog', { name: 'Edit partner' })
      rec('profile', 'with an archived linked event, the edit form says those keep their details', await appears(dialog.getByText('Archived events keep their details until restored.')))
      rec('profile', 'an archived partner offers Restore, not Archive', (await button(page, 'Restore').count()) === 1 && (await button(page, 'Archive').count()) === 0)
      await ctx.close()
    }
    {
      reset()
      const { page, ctx } = await open('/organizer/partners/k-sahel')
      await appears(history(page, 'Sahel Cloud'))
      rec('profile', 'a partnership without deliverables says so', /No deliverables/.test(await history(page, 'Sahel Cloud').textContent()))
      await ctx.close()
    }
    {
      reset({ role: 'manager' })
      const { page, ctx } = await open('/organizer/partners/k-kora')
      await appears(history(page, 'Kora Payments'))
      rec('profile', 'a manager sees only the events they manage', (await history(page, 'Kora Payments').locator(':scope > li').count()) === 1)
      rec('profile', '...and is told so', await appears(page.getByText('Only events you manage are listed.')))
      rec('profile', 'a manager cannot edit or archive', (await button(page, 'Edit').count()) === 0 && (await button(page, 'Archive').count()) === 0)
      await ctx.close()
    }
    {
      reset()
      const { page, ctx } = await open('/organizer/partners/k-nope')
      rec('profile', 'an unknown partner shows not found', await appears(page.getByText('This partner could not be found.')))
      rec('profile', '...with a way back to Partners', (await page.getByRole('link', { name: /Partners/ }).filter({ hasText: /Back|Partners/ }).count()) > 0)
      await ctx.close()
    }
    for (const w of [390, 320]) {
      reset()
      const { page, ctx } = await open('/organizer/partners/k-kora', { w, h: 800, touch: true })
      await appears(history(page, 'Kora Payments'))
      rec('profile', `no sideways overflow at ${w}px`, await noOverflow(page))
      await ctx.close()
    }

    // ======================================================================
    // add -- Add Partner's Partner step
    // ======================================================================
    const wizard = (page) => page.getByRole('dialog', { name: 'Add Partner' })
    const picker = (w) => w.getByRole('list', { name: 'Your partners' })
    async function openWizard(page) {
      await button(page, 'Partners').first().click()
      await settle(page)
      await button(page, 'Add Partner').first().click()
      const w = wizard(page)
      await appears(w)
      await settle(page)
      return w
    }
    // From the Partner step to Review, with one role (the only required field).
    async function finish(page, w) {
      await button(w, 'Continue').click()
      await w.getByLabel('Sponsor', { exact: true }).check()
      for (let i = 0; i < 3; i++) await button(w, 'Continue').click()
      await button(w, 'Save Partner').click()
      // A new partner is two saves in a row; the network goes idle between them.
      await w.getByRole('button', { name: 'Saving…' }).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
      await settle(page)
    }
    {
      reset()
      const { page, ctx, errors } = await open('/organizer/events/e-ats?tab=partners')
      const w = await openWizard(page)
      rec('add', 'the first step is Partner', /Partner/.test(await w.getByRole('navigation', { name: 'Add Partner progress' }).locator('[aria-current=step]').textContent()))
      await appears(picker(w))
      const names = (await picker(w).locator(':scope > li button').allTextContents()).map((s) => s.trim())
      rec('add', 'the organization\'s active partners are offered, by name', names.length === 4 && /^Baobab Ventures/.test(names[0]) && /^Kora Payments/.test(names[1]) && /^Sahel Cloud/.test(names[2]) && /^Zebra Media/.test(names[3]), JSON.stringify(names))
      rec('add', 'archived partners are not offered', !names.some((n) => /Old Co/.test(n)))
      const kora = picker(w).locator(':scope > li button').filter({ hasText: 'Kora Payments' })
      rec('add', 'a partner already on this event is shown but cannot be chosen', (await kora.isDisabled()) && /\(already on this event\)/.test(await kora.textContent()))
      rec('add', 'each partner shows industry and events', /Cloud · 1 event/.test(names[2]), names[2])
      await button(w, 'Continue').click()
      rec('add', 'Continue without a partner asks for one', await appears(w.getByRole('alert').filter({ hasText: 'Choose a partner, or create a new one.' })))
      const search = w.getByRole('searchbox', { name: "Search your organization's partners" })
      await search.fill('kora  payments')
      rec('add', 'an existing name in other case and spacing is not offered as new', (await w.getByRole('button', { name: /New partner/ }).count()) === 0)
      await search.fill('Zuri Logistics')
      rec('add', 'a new name is offered as + New partner "<name>"', await appears(w.getByRole('button', { name: '+ New partner "Zuri Logistics"' })))
      await search.fill('')
      await picker(w).locator(':scope > li button').filter({ hasText: 'Sahel Cloud' }).click()
      const chosen = w.getByTestId('chosen-partner')
      rec('add', 'choosing a partner shows their details read-only', await appears(chosen) && /Sahel Cloud/.test(await chosen.textContent()) && (await w.locator('#pt-company').count()) === 0)
      rec('add', 'the representative is filled from the partner\'s contact email', (await w.locator('#pt-rep').inputValue()) === 'team@sahel.example')
      rec('add', '...and can be changed for this event', await w.locator('#pt-rep').isEditable())
      await finish(page, w)
      const post = writes('/event_partnerships', 'POST')[0]
      rec('add', 'the partnership is saved linked to the chosen partner', post?.body.partner_id === 'k-sahel', JSON.stringify(post?.body))
      rec('add', '...with the representative from the form', post?.body.representative_email === 'team@sahel.example')
      rec('add', 'no partner is created when one was chosen', writes('/organization_partners', 'POST').length === 0)
      rec('add', 'the wizard closes on success', await gone(wizard(page)))
      rec('add', 'no console errors', errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
    {
      reset()
      const { page, ctx } = await open('/organizer/events/e-ats?tab=partners')
      const w = await openWizard(page)
      await w.getByRole('searchbox', { name: "Search your organization's partners" }).fill('Zuri Logistics')
      await w.getByRole('button', { name: '+ New partner "Zuri Logistics"' }).click()
      rec('add', 'a new partner starts with the typed name', (await w.locator('#pt-company').inputValue()) === 'Zuri Logistics')
      await w.locator('#pt-industry').fill('Logistics')
      await w.locator('#pt-rep').fill('Ops@Zuri.example')
      await finish(page, w)
      const created = writes('/organization_partners', 'POST')
      const linked = writes('/event_partnerships', 'POST')
      rec('add', 'a new partner is created for the organization', created.length === 1 && created[0].body.organization_id === ORG && created[0].body.company_name === 'Zuri Logistics' && created[0].body.industry === 'Logistics',
        JSON.stringify(created[0]?.body ?? { writes: log.writes.map((x) => x.m + ' ' + x.path) }))
      rec('add', '...with the representative as its contact email', created[0]?.body.contact_email === 'ops@zuri.example')
      rec('add', 'then the partnership is saved linked to it', linked.length === 1 && /^k-new-/.test(linked[0].body.partner_id ?? ''), JSON.stringify(linked[0]?.body))
      rec('add', 'the partner is created before the partnership', log.writes.indexOf(created[0]) < log.writes.indexOf(linked[0]))
      await ctx.close()
    }
    {
      reset({ partnerPostError: { status: 409, body: err('23505', 'duplicate key value violates unique constraint "organization_partners_active_name_unique"') } })
      const { page, ctx } = await open('/organizer/events/e-ats?tab=partners')
      const w = await openWizard(page)
      await w.getByRole('searchbox', { name: "Search your organization's partners" }).fill('Zuri Logistics')
      await w.getByRole('button', { name: '+ New partner "Zuri Logistics"' }).click()
      await finish(page, w)
      rec('add', 'a name taken meanwhile returns to the Partner step with a message',
        await appears(w.getByRole('alert').filter({ hasText: 'Zuri Logistics is already one of your partners. Choose it from the list.' })))
      rec('add', '...and nothing is saved to the event', writes('/event_partnerships', 'POST').length === 0)
      rec('add', '...with the search set to the name', (await w.getByRole('searchbox', { name: "Search your organization's partners" }).inputValue()) === 'Zuri Logistics')
      await ctx.close()
    }
    {
      reset()
      const { page, ctx } = await open('/organizer/events/e-ats?tab=partners')
      const w = await openWizard(page)
      await w.getByRole('searchbox', { name: "Search your organization's partners" }).fill('Zuri Logistics')
      await w.getByRole('button', { name: '+ New partner "Zuri Logistics"' }).click()
      // Someone else adds Zuri Logistics while this wizard is open.
      state.partners.push(partner('k-zuri', 'Zuri Logistics'))
      await finish(page, w)
      rec('add', 'a partner added meanwhile is found before creating a duplicate', writes('/organization_partners', 'POST').length === 0)
      rec('add', '...and the person is asked to choose it',
        await appears(w.getByRole('alert').filter({ hasText: 'Zuri Logistics is already one of your partners. Choose it from the list.' })))
      await ctx.close()
    }
    {
      reset({ partnershipPostFailOnce: true })
      const { page, ctx } = await open('/organizer/events/e-ats?tab=partners')
      const w = await openWizard(page)
      await w.getByRole('searchbox', { name: "Search your organization's partners" }).fill('Zuri Logistics')
      await w.getByRole('button', { name: '+ New partner "Zuri Logistics"' }).click()
      await finish(page, w)
      rec('add', 'when only the partner saved, the wizard says so',
        await appears(w.getByRole('alert').filter({ hasText: "Zuri Logistics was added to your organization's partners, but not to this event. Save again to add it." })))
      await button(w, 'Save Partner').click()
      await settle(page)
      const created = writes('/organization_partners', 'POST')
      const linked = writes('/event_partnerships', 'POST')
      rec('add', 'saving again creates no second partner', created.length === 1, String(created.length))
      rec('add', '...and links the partnership to the one created', linked.length === 2 && linked[1].body.partner_id === linked[0].body.partner_id && /^k-new-/.test(linked[1].body.partner_id), JSON.stringify(linked.map((l) => l.body.partner_id)))
      rec('add', '...then closes', await gone(wizard(page)))
      await ctx.close()
    }
    {
      reset()
      const { page, ctx } = await open('/organizer/events/e-legacy?tab=partners')
      const w = await openWizard(page)
      rec('add', 'an event without an organization asks for the company directly', await appears(w.locator('#pt-company')) && (await w.getByRole('searchbox').count()) === 0)
      await w.locator('#pt-company').fill('Legacy Sponsor')
      await finish(page, w)
      const post = writes('/event_partnerships', 'POST')[0]
      rec('add', '...and saves it unlinked', post && !('partner_id' in post.body) && post.body.company_name === 'Legacy Sponsor', JSON.stringify(post?.body))
      rec('add', '...creating no partner', writes('/organization_partners', 'POST').length === 0)
      await ctx.close()
    }
    for (const w of [390, 320]) {
      reset()
      const { page, ctx } = await open('/organizer/events/e-ats?tab=partners', { w, h: 800, touch: true })
      const wz = await openWizard(page)
      await appears(picker(wz))
      rec('add', `the Partner step fits at ${w}px`, (await sheetFits(page)) && (await noOverflow(page)))
      await ctx.close()
    }

    // ======================================================================
    // linked -- a partnership's company details are managed on its partner
    // ======================================================================
    const BASIC = ['company_name', 'description', 'logo_url', 'industry', 'website', 'linkedin']
    const editDialog = (page) => page.getByRole('dialog', { name: 'Edit Partner' })
    {
      reset()
      const { page, ctx, errors } = await open('/organizer/events/e-ats/partners/p-k1')
      rec('linked', 'the event partner page says the details are managed on the partner', await appears(page.getByText('Managed on the partner.')))
      const link = page.getByRole('link', { name: 'Edit partner' })
      rec('linked', '...with a link to the partner for an owner', (await link.first().getAttribute('href')) === '/organizer/partners/k-kora')
      await button(page, 'Edit').first().click()
      const d = editDialog(page)
      await appears(d)
      rec('linked', 'Edit Partner shows no company inputs for a linked partnership',
        (await d.locator('#pt-company, #pt-website, #pt-linkedin, #pt-industry, #pt-description').count()) === 0)
      rec('linked', '...shows the partner\'s details read-only, managed on the partner', /Kora Payments/.test(await d.getByTestId('linked-partner').textContent()) && await appears(d.getByText('Managed on the partner.')))
      rec('linked', '...links to the partner for an owner', (await d.getByRole('link', { name: 'Edit partner' }).getAttribute('href')) === '/organizer/partners/k-kora')
      rec('linked', '...and keeps the representative editable', await d.locator('#pt-rep').isEditable())
      await d.locator('#pt-notes').fill('Renewing for 2028')
      await button(d, 'Save changes').click()
      await gone(d)
      const patch = writes('/event_partnerships', 'PATCH')[0]
      rec('linked', 'the save sends none of the partner\'s fields', patch && BASIC.every((k) => !(k in patch.body)), JSON.stringify(patch?.body))
      rec('linked', '...and the event\'s own fields', patch && patch.body.internal_notes === 'Renewing for 2028' && 'tier_label' in patch.body && 'representative_email' in patch.body, JSON.stringify(patch?.body))
      rec('linked', 'no console errors', errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
    {
      reset()
      const { page, ctx } = await open('/organizer/events/e-ats/partners/p-u1')
      rec('linked', 'an unlinked partnership has no managed-on-partner note', (await page.getByText('Managed on the partner.').count()) === 0)
      await button(page, 'Edit').first().click()
      const d = editDialog(page)
      await appears(d)
      rec('linked', 'Edit Partner on an unlinked partnership keeps the company inputs', (await d.locator('#pt-company').inputValue()) === 'Unlinked Ltd')
      await d.locator('#pt-notes').fill('note')
      await button(d, 'Save changes').click()
      await gone(d)
      const patch = writes('/event_partnerships', 'PATCH')[0]
      rec('linked', '...and saves them as before', patch && BASIC.every((k) => k in patch.body) && patch.body.company_name === 'Unlinked Ltd', JSON.stringify(patch?.body))
      await ctx.close()
    }
    {
      reset({ role: 'manager' })
      const { page, ctx } = await open('/organizer/events/e-fin/partners/p-k2')
      rec('linked', 'a manager sees that the details are managed on the partner', await appears(page.getByText('Managed on the partner.')))
      rec('linked', '...without a link to edit it', (await page.getByRole('link', { name: 'Edit partner' }).count()) === 0)
      await button(page, 'Edit').first().click()
      const d = editDialog(page)
      await appears(d)
      rec('linked', '...in Edit Partner too', (await d.getByRole('link', { name: 'Edit partner' }).count()) === 0 && (await d.locator('#pt-company').count()) === 0)
      await ctx.close()
    }
    {
      reset()
      state.partnerships.push(partnership('p-o2', 'k-old', EVENTS.ats, { company_name: 'Old Co', status: 'active' }))
      const { page, ctx } = await open('/organizer/events/e-ats/partners/p-o2')
      rec('linked', 'a partnership whose partner is archived stays managed on the partner', await appears(page.getByText('Managed on the partner.')))
      rec('linked', '...and still links to it', (await page.getByRole('link', { name: 'Edit partner' }).first().getAttribute('href')) === '/organizer/partners/k-old')
      await ctx.close()
    }

  } catch (e) {
    rec('crash', String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e), false)
  } finally {
    await browser.close()
    console.log(`\n${results.length - fails} passed, ${fails} failed`)
    process.exit(fails ? 1 : 0)
  }
})()
