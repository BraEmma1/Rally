// Add Partner with a package (PR-B): the Package dropdown (this event's active packages
// only, plus Custom partnership), the prefill (tier label, value, currency, deliverables),
// editing the terms for one partner, the replace / clear confirmations and what Cancel
// keeps, a package archived or removed between choosing and saving, the exact save
// payloads (package_id + the organizer's own deliverables, never apply_partnership_package),
// the corrected commercial-value wording, Edit Partner unchanged, phone layouts at 390 and
// 320px, and keyboard behaviour.
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

// ---- fixtures ----------------------------------------------------------------
const ev = (id, name, over = {}) => ({
  id, name, description: '', location: 'Accra', start_date: '2027-03-01', end_date: null, start_time: null, end_time: null,
  image_url: '', capacity: null, status: 'upcoming', timezone: 'Africa/Accra', created_at: '2026-06-01', owner_id: null,
  created_by: UID, organization_id: ORG, visibility: 'published', archived_at: null, published_at: '2026-06-01', ...over,
})
const events = [ev('e-a', 'Alpha Summit'), ev('e-b', 'Beta Forum', { start_date: '2027-04-01' })]
const T = '2026-10-01T00:00:00Z'
const pkg = (id, event_id, name, over = {}) => ({
  id, event_id, name, description: null, value_amount: null, value_currency: null, display_order: 0, archived_at: null,
  created_by: UID, created_at: T, updated_at: T, ...over,
})
const dl = (id, package_id, event_id, title, display_order, over = {}) => ({
  id, package_id, event_id, title, description: null, category: null, quantity: null, due_date: null, display_order,
  created_at: T, updated_at: T, ...over,
})
const partnershipRow = (over = {}) => ({
  id: 'p-1', event_id: 'e-a', company_name: 'Existing Co', description: null, logo_url: null, industry: null, website: null,
  linkedin: null, tier_label: 'Gold (2026 deal)', value_amount: 40000, value_currency: 'GHS', internal_notes: null,
  representative_email: null, status: 'draft', sponsor_organization_id: null, acknowledged_at: null, package_id: 'k-gold',
  created_by: UID, created_at: T, updated_at: T, ...over,
})

let state
let log
let seq = 0
function reset(over = {}) {
  state = {
    packages: [
      pkg('k-gold', 'e-a', 'Gold', { value_amount: 50000, value_currency: 'GHS', display_order: 0 }),
      pkg('k-silver', 'e-a', 'Silver', { value_amount: 25000, value_currency: 'GHS', display_order: 1 }),
      pkg('k-old', 'e-a', 'Legacy Bronze', { display_order: 2, archived_at: '2026-09-01T00:00:00Z' }),
      pkg('k-beta', 'e-b', 'Beta Platinum', { display_order: 0 }),
    ],
    deliverables: [
      dl('d-1', 'k-gold', 'e-a', 'Logo on backdrop', 0, { category: 'Branding' }),
      dl('d-2', 'k-gold', 'e-a', 'VIP passes', 1, { quantity: 4 }),
      dl('d-3', 'k-silver', 'e-a', 'Logo in programme', 0),
      dl('d-9', 'k-beta', 'e-b', 'Beta only item', 0),
    ],
    partnerships: [partnershipRow()],
    packagesFail: false,
    insertFk: false, // the next partnership insert fails on the package foreign key
    packageReadDelayMs: 0, // slows reading the package table (the read made when one is chosen)
    ...over,
  }
  log = { rpcs: [], writes: [], packageReads: [] }
}
const err = (code, message, details = null) => ({ code, message, details, hint: null })

function access() {
  return [{
    organization_id: ORG, organization_name: 'Test Org', organization_slug: 'test-org', organization_description: '',
    organization_logo_url: '', organization_website: '', organization_type: 'organizer', approval_status: 'approved',
    archived_at: null, organization_created_by: UID, organization_created_at: '2026-01-01T00:00:00Z',
    organization_updated_at: '2026-01-01T00:00:00Z', organization_role: 'owner', joined_at: '2026-01-01T00:00:00Z',
    event_assignments: [],
  }]
}
function listPackages(eventId) {
  return state.packages
    .filter((p) => p.event_id === eventId)
    .sort((a, b) => a.display_order - b.display_order)
    .map((p) => ({ ...p, deliverable_count: state.deliverables.filter((d) => d.package_id === p.id).length, partnership_count: 0 }))
}
function filtered(rows, url) {
  let r = rows
  for (const [k, v] of new URL(url).searchParams) if (v.startsWith('eq.')) r = r.filter((x) => String(x[k]) === v.slice(3))
  return r
}
function rawRows(url) {
  const p = new URL(url).pathname
  if (p.endsWith('/profiles')) return [{ id: UID, full_name: 'Olu Organizer', photo_url: '', job_title: 'Founder', company: 'Acme', industry: '', location: '', bio: '', looking_for: '', can_offer: '', linkedin: '', website: '', email: 'o@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }]
  if (p.endsWith('/user_accounts')) return [{ account_type: 'organizer', status: 'active' }]
  if (p.endsWith('/events')) return events
  if (p.endsWith('/event_partnership_packages')) return state.packages
  if (p.endsWith('/event_partnership_package_deliverables')) return [...state.deliverables].sort((a, b) => a.display_order - b.display_order)
  if (p.endsWith('/event_partnerships')) return state.partnerships
  if (p.endsWith('/event_partnership_roles')) return [{ role: 'sponsor', partnership_id: 'p-1' }]
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
      if (pathname.endsWith('/event_partnership_packages')) {
        log.packageReads.push(new URL(url).search)
        if (state.packageReadDelayMs) await new Promise((r) => setTimeout(r, state.packageReadDelayMs))
      }
      const r = filtered(rawRows(url), url)
      return json(200, single ? r[0] ?? null : r)
    }
    const body = JSON.parse(req.postData() || 'null')

    if (m === 'POST' && pathname.includes('/rpc/')) {
      const name = pathname.split('/rpc/')[1]
      log.rpcs.push({ name, body })
      if (name === 'can_manage_event' || name === 'account_is_active') return json(200, true)
      if (name === 'get_event_partnership_packages') {
        if (state.packagesFail) return json(400, err('XX000', 'boom'))
        return json(200, listPackages(body.target_event_id))
      }
      if (name === 'set_event_partnership_roles') return json(200, null)
      return json(200, rawRows(url))
    }

    log.writes.push({ m, path: pathname, query: new URL(url).search, body })
    if (pathname.endsWith('/event_partnerships')) {
      if (m === 'POST') {
        if (state.insertFk) {
          state.insertFk = false
          return json(409, err('23503', 'insert or update on table "event_partnerships" violates foreign key constraint "event_partnerships_package_fk"',
            'Key (package_id, event_id) is not present in table "event_partnership_packages".'))
        }
        const row = partnershipRow({ ...body, id: 'p-new-' + ++seq })
        state.partnerships.push(row)
        return json(201, single ? { id: row.id } : [{ id: row.id }])
      }
      if (m === 'PATCH') return json(200, [{ id: 'p-1' }])
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
  const wizard = (page) => page.getByRole('dialog', { name: 'Add Partner' })
  const confirmBox = (page) => page.getByRole('alertdialog')
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  const sheetFits = (page) => page.evaluate(() => [...document.querySelectorAll('[role=dialog] > div, [role=alertdialog] > div')].every((el) => el.scrollWidth <= el.clientWidth + 1))
  const statusText = (page) => page.getByTestId('package-status').textContent()
  const statusIs = (page, re, timeout = 4000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid=package-status]')?.textContent ?? ''), re.source, { timeout }).then(() => true, () => false)
  const fields = async (page) => ({
    tier: await page.locator('#pt-tier').inputValue(),
    value: await page.locator('#pt-value').inputValue(),
    currency: await page.locator('#pt-currency').inputValue(),
    pkg: await page.locator('#pt-package').inputValue(),
  })
  const optionTexts = (page) => page.locator('#pt-package option').allTextContents()
  const draftTitles = (page, list = 'Deliverables') => page.getByRole('list', { name: list }).locator(':scope > li p:first-child').allTextContents()

  // Partners tab -> Add Partner -> company -> the Partnership step.
  async function toPartnershipStep(page, company = 'Acme Bank') {
    await button(page, 'Partners').first().click()
    await settle(page)
    await button(page, 'Add Partner').first().click()
    const w = wizard(page)
    await w.locator('#pt-company').fill(company)
    await button(w, 'Continue').click()
    await appears(w.locator('#pt-package'))
    await settle(page)
    return w
  }
  // Choose a package and wait for its prefill (or for nothing to change).
  // Focus first, as a click on the dropdown would: selectOption alone does not move focus.
  async function choose(page, value) {
    await page.locator('#pt-package').focus()
    await page.locator('#pt-package').selectOption(value)
    await page.waitForFunction(() => !document.querySelector('#pt-package')?.hasAttribute('aria-busy'), null, { timeout: 4000 }).catch(() => {})
    await settle(page)
  }

  // ================= 1. Options, prefill, customize, save (desktop) =============
  {
    const g = 'select and save'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    const w = await toPartnershipStep(page)
    const opts = await optionTexts(page)
    rec(g, 'the Package dropdown offers Custom partnership and this event\'s active packages, in order',
      opts.length === 3 && opts[0] === 'Custom partnership' && /^Gold · GHS 50,000 · 2 deliverables$/.test(opts[1]) && /^Silver · GHS 25,000 · 1 deliverable$/.test(opts[2]), JSON.stringify(opts))
    rec(g, 'archived and other-event packages are not offered', !opts.some((o) => /Legacy Bronze|Beta Platinum/.test(o)))
    rec(g, 'Custom partnership is the starting choice, with empty terms', JSON.stringify(await fields(page)) === JSON.stringify({ tier: '', value: '', currency: '', pkg: 'custom' }))
    rec(g, 'the tier label stays a separate editable field, below the package', await page.evaluate(() => {
      const sel = document.querySelector('#pt-package'); const tier = document.querySelector('#pt-tier')
      return !!sel && !!tier && !tier.disabled && !tier.readOnly && (sel.compareDocumentPosition(tier) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    }))
    rec(g, 'the value wording names who can see it, and says attendees never do', await appears(w.getByText(/Visible to your event team, to the representative you invite and, once they accept, to authorized members of their organization\. Never shown to attendees\./)) &&
      (await w.getByText(/private to your team/i).count()) === 0)

    await choose(page, 'k-gold')
    rec(g, 'choosing Gold reads that package for THIS event, fresh', log.packageReads.some((q) => q.includes('id=eq.k-gold') && q.includes('event_id=eq.e-a')), JSON.stringify(log.packageReads))
    rec(g, '...and fills the tier label, value and currency', JSON.stringify(await fields(page)) === JSON.stringify({ tier: 'Gold', value: '50000', currency: 'GHS', pkg: 'k-gold' }), JSON.stringify(await fields(page)))
    rec(g, '...and says what it filled in', /Filled in from Gold: the tier label, GHS 50,000 and 2 deliverables/.test(await statusText(page)), await statusText(page))
    rec(g, 'the tier hint says where the label came from', await appears(w.getByText('Filled in from Gold. Change it for this partner if you like.')))

    // Customize: tier label and, on the next step, the deliverables.
    await w.locator('#pt-tier').fill('Gold (founding)')
    await w.getByLabel('Sponsor', { exact: true }).check()
    await button(w, 'Continue').click()
    rec(g, 'the Deliverables step holds the package\'s deliverables, in order', JSON.stringify(await draftTitles(page)) === JSON.stringify(['Logo on backdrop', 'VIP passes']), JSON.stringify(await draftTitles(page)))
    rec(g, '...and says they are this partner\'s own copy', await appears(w.getByText(/Started from the Gold package\. Changes here apply to this partner only/)))
    await button(w, 'Edit VIP passes').click()
    const edit = page.getByRole('dialog', { name: 'Edit Deliverable' })
    await edit.locator('#ob-quantity').fill('6')
    await button(edit, 'Save').click()
    await gone(edit)
    await button(w, 'Remove Logo on backdrop').click()
    await button(w, 'Add Deliverable').click()
    const add = page.getByRole('dialog', { name: 'Add Deliverable' })
    await add.locator('#ob-title').fill('Panel seat')
    await button(add, 'Add').click()
    await gone(add)
    rec(g, 'deliverables can be edited, removed and added for this partner', JSON.stringify(await draftTitles(page)) === JSON.stringify(['VIP passes', 'Panel seat']))
    await button(w, 'Continue').click()
    await button(w, 'Add Requirement').click()
    const req = page.getByRole('dialog', { name: 'Add Requirement' })
    await req.locator('#ob-title').fill('High-resolution logo')
    await button(req, 'Add').click()
    await gone(req)
    await button(w, 'Continue').click()
    rec(g, 'Review names the package and that it was customized', await appears(w.getByText('Gold · customized for this partner')) && await appears(w.getByText('Gold (founding)')))
    const readsBeforeSave = log.packageReads.length
    await button(w, 'Save Partner').click()
    await gone(wizard(page), 6000)
    await settle(page)

    const insert = log.writes.find((x) => x.m === 'POST' && x.path.endsWith('/event_partnerships'))
    rec(g, 'the package was checked again just before saving', log.packageReads.length > readsBeforeSave && log.packageReads.slice(readsBeforeSave).some((q) => q.includes('id=eq.k-gold')))
    rec(g, 'the partnership is saved with the package id and the customized terms', !!insert &&
      JSON.stringify(insert.body) === JSON.stringify({ event_id: 'e-a', company_name: 'Acme Bank', description: null, logo_url: null, industry: null, website: null, linkedin: null,
        tier_label: 'Gold (founding)', value_amount: 50000, value_currency: 'GHS', internal_notes: null, representative_email: null, package_id: 'k-gold' }), JSON.stringify(insert?.body))
    rec(g, '...never a status, sponsor link or acknowledgement', !!insert && !('status' in insert.body) && !('sponsor_organization_id' in insert.body) && !('acknowledged_at' in insert.body))
    const roles = log.rpcs.find((r) => r.name === 'set_event_partnership_roles')
    rec(g, 'roles are set as before', !!roles && JSON.stringify(roles.body) === JSON.stringify({ target_partnership_id: 'p-new-1', new_roles: ['sponsor'] }), JSON.stringify(roles?.body))
    const obligations = log.writes.filter((x) => x.m === 'POST' && x.path.endsWith('/event_partnership_obligations'))
    rec(g, 'the actual deliverables and requirement are saved, in ONE insert, exactly as edited', obligations.length === 1 &&
      JSON.stringify(obligations[0].body) === JSON.stringify([
        { partnership_id: 'p-new-1', event_id: 'e-a', direction: 'organizer_to_partner', title: 'VIP passes', description: null, category: null, quantity: 6, due_date: null, display_order: 0 },
        { partnership_id: 'p-new-1', event_id: 'e-a', direction: 'organizer_to_partner', title: 'Panel seat', description: null, category: null, quantity: null, due_date: null, display_order: 1 },
        { partnership_id: 'p-new-1', event_id: 'e-a', direction: 'partner_to_organizer', title: 'High-resolution logo', description: null, category: null, quantity: null, due_date: null, display_order: 0 },
      ]), JSON.stringify(obligations[0]?.body))
    rec(g, 'apply_partnership_package is never called, so nothing is duplicated', !log.rpcs.some((r) => r.name === 'apply_partnership_package'))
    rec(g, 'no package or template row is written', !log.writes.some((x) => /event_partnership_package/.test(x.path)))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 2. Switching packages, and Custom ===========================
  {
    const g = 'switching'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    const w = await toPartnershipStep(page)

    await choose(page, 'k-gold')
    await choose(page, 'k-silver')
    rec(g, 'untouched package terms are replaced without asking', (await confirmBox(page).count()) === 0 &&
      JSON.stringify(await fields(page)) === JSON.stringify({ tier: 'Silver', value: '25000', currency: 'GHS', pkg: 'k-silver' }), JSON.stringify(await fields(page)))

    await w.locator('#pt-tier').fill('Silver Plus')
    await w.locator('#pt-tier').fill('Silver')
    await choose(page, 'k-gold')
    rec(g, 'an edit changed back is not a customization: no question', (await confirmBox(page).count()) === 0 && (await fields(page)).tier === 'Gold')

    await w.locator('#pt-value').fill('45000')
    await choose(page, 'k-silver')
    const box = confirmBox(page)
    rec(g, 'after customizing, choosing another package asks first', await appears(box) && await appears(box.getByText('Replace your changes with Silver?')) &&
      await appears(box.getByText(/You changed the commercial value\./)))
    rec(g, '...with focus on the safe choice', await button(box, 'Keep my changes').evaluate((el) => el === document.activeElement))
    await button(box, 'Keep my changes').click()
    rec(g, 'Keep preserves every edit and the current package', await gone(box) && JSON.stringify(await fields(page)) === JSON.stringify({ tier: 'Gold', value: '45000', currency: 'GHS', pkg: 'k-gold' }), JSON.stringify(await fields(page)))
    rec(g, '...and gives focus back to the dropdown', await page.locator('#pt-package').evaluate((el) => el === document.activeElement))

    await choose(page, 'k-silver')
    await appears(confirmBox(page))
    await page.keyboard.press('Escape')
    rec(g, 'Escape dismisses only the question, keeping the wizard and the edits', await gone(confirmBox(page)) && await wizard(page).isVisible() &&
      JSON.stringify(await fields(page)) === JSON.stringify({ tier: 'Gold', value: '45000', currency: 'GHS', pkg: 'k-gold' }))

    await choose(page, 'k-silver')
    await button(confirmBox(page), 'Use Silver').click()
    rec(g, 'confirming replaces the terms with the new package', await gone(confirmBox(page)) && JSON.stringify(await fields(page)) === JSON.stringify({ tier: 'Silver', value: '25000', currency: 'GHS', pkg: 'k-silver' }))

    // Custom keeps everything; clearing is explicit.
    await choose(page, 'custom')
    rec(g, 'Custom partnership keeps the current terms', JSON.stringify(await fields(page)) === JSON.stringify({ tier: 'Silver', value: '25000', currency: 'GHS', pkg: 'custom' }) &&
      /Your current tier label, value and deliverables are kept/.test(await statusText(page)))
    rec(g, '...and offers to clear them', await appears(button(w, 'Clear tier, value and deliverables')))
    await choose(page, 'k-gold')
    rec(g, 'untouched values kept under Custom are still replaced without asking', (await confirmBox(page).count()) === 0 && (await fields(page)).tier === 'Gold')
    await choose(page, 'custom')
    await button(w, 'Clear tier, value and deliverables').click()
    rec(g, 'Clear asks first', await appears(confirmBox(page).getByText('Clear the tier, value and deliverables?')))
    await button(confirmBox(page), 'Keep them').click()
    rec(g, '...and Keep leaves everything', (await fields(page)).tier === 'Gold')
    await button(w, 'Clear tier, value and deliverables').click()
    await button(confirmBox(page), 'Clear').click()
    rec(g, 'Clear empties the tier, value and currency', JSON.stringify(await fields(page)) === JSON.stringify({ tier: '', value: '', currency: '', pkg: 'custom' }))
    rec(g, '...and the offer to clear goes away', (await button(w, 'Clear tier, value and deliverables').count()) === 0)

    // Typing into a Custom partnership is work a package would overwrite.
    await w.locator('#pt-tier').fill('Media partner')
    await choose(page, 'k-gold')
    rec(g, 'terms typed into a Custom partnership are protected too', await appears(confirmBox(page).getByText(/You changed the tier label\./)))
    await button(confirmBox(page), 'Keep my changes').click()
    rec(g, '...and Keep leaves them, still Custom', JSON.stringify(await fields(page)) === JSON.stringify({ tier: 'Media partner', value: '', currency: '', pkg: 'custom' }))

    // Deliverables edited on the next step count too.
    await choose(page, 'custom')
    await w.locator('#pt-tier').fill('')
    await choose(page, 'k-gold')
    await w.getByLabel('Sponsor', { exact: true }).check()
    await button(w, 'Continue').click()
    await button(w, 'Remove VIP passes').click()
    await button(w, 'Back').click()
    await choose(page, 'k-silver')
    rec(g, 'a removed deliverable counts as a customization', await appears(confirmBox(page).getByText(/You changed the deliverables\./)))
    await button(confirmBox(page), 'Use Silver').click()
    await button(w, 'Continue').click()
    rec(g, 'replacing swaps in the new package\'s deliverables, and only those', JSON.stringify(await draftTitles(page)) === JSON.stringify(['Logo in programme']), JSON.stringify(await draftTitles(page)))
    rec(g, 'nothing was saved while choosing', log.writes.length === 0, JSON.stringify(log.writes))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }
  {
    // An edit typed while a chosen package is still loading must count too.
    const g = 'edit during load'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    const w = await toPartnershipStep(page)
    await choose(page, 'k-gold')
    state.packageReadDelayMs = 800
    await page.locator('#pt-package').selectOption('k-silver')
    await w.locator('#pt-tier').fill('Gold, as negotiated')
    const asked = await appears(confirmBox(page).getByText('Replace your changes with Silver?'), 5000)
    state.packageReadDelayMs = 0
    rec(g, 'a tier label typed while the next package loads is protected by the question', asked)
    if (asked) await button(confirmBox(page), 'Keep my changes').click()
    rec(g, '...and Keep leaves it', (await fields(page)).tier === 'Gold, as negotiated' && (await fields(page)).pkg === 'k-gold', JSON.stringify(await fields(page)))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 3. Unavailable packages =====================================
  {
    const g = 'unavailable'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    let w = await toPartnershipStep(page)
    // Archived after the list loaded, before it was chosen.
    state.packages.find((p) => p.id === 'k-silver').archived_at = '2026-11-25T00:00:00Z'
    await choose(page, 'k-silver')
    rec(g, 'a package archived since the list loaded is refused when chosen', await appears(w.getByRole('alert').filter({ hasText: 'Silver was archived and can no longer be used.' })))
    rec(g, '...nothing is filled in and the choice stays Custom', JSON.stringify(await fields(page)) === JSON.stringify({ tier: '', value: '', currency: '', pkg: 'custom' }), JSON.stringify(await fields(page)))
    rec(g, '...and the list is refreshed without it', await page.waitForFunction(() => ![...document.querySelectorAll('#pt-package option')].some((o) => o.textContent.startsWith('Silver')), null, { timeout: 4000 }).then(() => true, () => false))

    // Removed between choosing and saving.
    await choose(page, 'k-gold')
    await w.locator('#pt-tier').fill('Gold (kept)')
    await w.getByLabel('Sponsor', { exact: true }).check()
    for (let i = 0; i < 3; i++) await button(w, 'Continue').click()
    state.packages = state.packages.filter((p) => p.id !== 'k-gold')
    await button(w, 'Save Partner').click()
    await settle(page)
    rec(g, 'a package removed before Save stops the save with a clear message', await appears(w.getByRole('alert').filter({ hasText: 'Gold was removed after you chose it, so nothing was saved.' })))
    rec(g, '...nothing was written', log.writes.length === 0, JSON.stringify(log.writes))
    rec(g, '...the wizard returns to the Partnership step with the edits intact', await w.locator('#pt-package').isVisible() && (await fields(page)).tier === 'Gold (kept)')
    rec(g, '...showing the package as no longer available', (await optionTexts(page)).includes('Gold (no longer available)'), JSON.stringify(await optionTexts(page)))
    await choose(page, 'custom')
    for (let i = 0; i < 3; i++) await button(w, 'Continue').click()
    await button(w, 'Save Partner').click()
    await gone(wizard(page), 6000)
    const insert = log.writes.find((x) => x.m === 'POST' && x.path.endsWith('/event_partnerships'))
    const obs = log.writes.find((x) => x.m === 'POST' && x.path.endsWith('/event_partnership_obligations'))
    rec(g, 'switching to Custom saves the same terms with no package', !!insert && !('package_id' in insert.body) && insert.body.tier_label === 'Gold (kept)' && insert.body.value_amount === 50000, JSON.stringify(insert?.body))
    rec(g, '...and the deliverables that came from it', !!obs && JSON.stringify(obs.body.map((o) => o.title)) === JSON.stringify(['Logo on backdrop', 'VIP passes']), JSON.stringify(obs?.body))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }
  {
    const g = 'removed at insert'
    reset({ insertFk: true })
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    const w = await toPartnershipStep(page)
    await choose(page, 'k-gold')
    await w.getByLabel('Sponsor', { exact: true }).check()
    for (let i = 0; i < 3; i++) await button(w, 'Continue').click()
    await button(w, 'Save Partner').click()
    await settle(page)
    rec(g, 'a package deleted between the check and the insert is reported, not a generic failure',
      await appears(w.getByRole('alert').filter({ hasText: 'The package you chose is no longer available, so nothing was saved.' })))
    rec(g, '...no roles or deliverables were sent after the failed insert', !log.rpcs.some((r) => r.name === 'set_event_partnership_roles') &&
      !log.writes.some((x) => x.path.endsWith('/event_partnership_obligations')))
    rec(g, '...and the wizard is back on the Partnership step', await w.locator('#pt-package').isVisible())
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }
  {
    const g = 'packages fail to load'
    reset({ packagesFail: true })
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    const w = await toPartnershipStep(page)
    rec(g, 'the failure is said, and a custom partnership is still possible', await appears(w.getByRole('alert').filter({ hasText: 'You can still add a custom partnership.' })) &&
      JSON.stringify(await optionTexts(page)) === JSON.stringify(['Custom partnership']))
    state.packagesFail = false
    await button(w, 'Try again').click()
    rec(g, 'Try again loads them', await page.waitForFunction(() => document.querySelectorAll('#pt-package option').length === 3, null, { timeout: 4000 }).then(() => true, () => false))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }
  {
    const g = 'no packages'
    reset({ packages: [], deliverables: [] })
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    const w = await toPartnershipStep(page)
    rec(g, 'an event without packages offers Custom only, and says how to add packages',
      JSON.stringify(await optionTexts(page)) === JSON.stringify(['Custom partnership']) && await appears(w.getByText(/This event has no packages yet\./)))
    await w.getByLabel('Sponsor', { exact: true }).check()
    await w.locator('#pt-tier').fill('Community partner')
    for (let i = 0; i < 3; i++) await button(w, 'Continue').click()
    await button(w, 'Save Partner').click()
    await gone(wizard(page), 6000)
    const insert = log.writes.find((x) => x.m === 'POST' && x.path.endsWith('/event_partnerships'))
    rec(g, 'a custom partner saves exactly as before: no package id', !!insert && !('package_id' in insert.body) && insert.body.tier_label === 'Community partner')
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 4. Edit Partner is unchanged ================================
  {
    const g = 'edit partner'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a/partners/p-1')
    await appears(page.getByText('Existing Co'), 8000)
    await button(page, 'Edit').first().click().catch(() => {})
    const dlg = page.getByRole('dialog').filter({ has: page.locator('#pt-tier') })
    const opened = await appears(dlg, 5000)
    rec(g, 'Edit Partner opens with the saved tier label as a plain editable field', opened && (await dlg.locator('#pt-tier').inputValue()) === 'Gold (2026 deal)')
    rec(g, '...and no Package dropdown', opened && (await dlg.locator('#pt-package').count()) === 0)
    rec(g, '...and keeps its own tier hint', opened && await appears(dlg.getByText('Your own wording. Rally does not keep a list of tiers.')))
    rec(g, 'the value wording is corrected here too', opened && await appears(dlg.getByText(/Never shown to attendees\./)))
    if (opened) {
      await dlg.locator('#pt-tier').fill('Gold (renewed)')
      await button(dlg, 'Save changes').click()
      await settle(page)
    }
    const patch = log.writes.find((x) => x.m === 'PATCH' && x.path.endsWith('/event_partnerships'))
    rec(g, 'saving sends the new tier label and never a package id', !!patch && patch.body.tier_label === 'Gold (renewed)' && !('package_id' in patch.body),
      JSON.stringify({ body: patch?.body, writes: log.writes.map((x) => x.m + ' ' + x.path), alert: await page.getByRole('alert').allTextContents() }))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 5. Phone layout ==============================================
  for (const w of [390, 320]) {
    const g = 'phone ' + w
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a', { w, h: 800, touch: true })
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    const wz = await toPartnershipStep(page)
    const sel = await page.locator('#pt-package').boundingBox()
    const tier = await page.locator('#pt-tier').boundingBox()
    rec(g, 'the Package dropdown spans the form width, above the tier label', !!sel && !!tier && Math.abs(sel.width - tier.width) < 2 && sel.y < tier.y, JSON.stringify({ sel, tier }))
    // Form fields share the app-wide input height (input-base); the dropdown matches the tier field beside it.
    rec(g, '...as tall as the other form fields, and full width', !!sel && !!tier && Math.abs(sel.height - tier.height) < 2 && sel.height >= 36, JSON.stringify({ sel, tier }))
    await choose(page, 'k-gold')
    rec(g, 'the Partnership step fits the screen after a prefill', await sheetFits(page) && await noOverflow(page))
    await page.screenshot({ path: path.join(OUT, `pr-b-partnership-${w}.png`), fullPage: false })
    await wz.locator('#pt-value').fill('42000')
    await choose(page, 'k-silver')
    await appears(confirmBox(page))
    const keep = await button(confirmBox(page), 'Keep my changes').boundingBox()
    const use = await button(confirmBox(page), 'Use Silver').boundingBox()
    rec(g, 'the replace question fits, with 44px buttons', await sheetFits(page) && await noOverflow(page) && !!keep && !!use && keep.height >= 44 && use.height >= 44, JSON.stringify({ keep, use }))
    await page.screenshot({ path: path.join(OUT, `pr-b-confirm-${w}.png`), fullPage: false })
    await button(confirmBox(page), 'Keep my changes').tap()
    await wz.getByLabel('Sponsor', { exact: true }).check()
    await button(wz, 'Continue').tap()
    await appears(wz.getByText('VIP passes'))
    const sizes = await page.getByRole('list', { name: 'Deliverables' }).getByRole('button').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
    rec(g, 'prefilled deliverables have move, Edit and Remove controls, each at least 44 x 44', sizes.length === 8 && sizes.every(([bw, bh]) => bw >= 44 && bh >= 44), JSON.stringify(sizes))
    rec(g, 'the Deliverables step fits the screen', await sheetFits(page) && await noOverflow(page))
    await button(wz, 'Move VIP passes up').tap()
    rec(g, 'a prefilled deliverable can be reordered by touch', JSON.stringify(await draftTitles(page)) === JSON.stringify(['VIP passes', 'Logo on backdrop']) &&
      (await page.getByTestId('draft-order-status-organizer_to_partner').textContent()) === 'VIP passes moved to position 1 of 2.')
    await page.screenshot({ path: path.join(OUT, `pr-b-deliverables-${w}.png`), fullPage: false })
    await button(wz, 'Continue').tap()
    await button(wz, 'Continue').tap()
    rec(g, 'the Review step fits', await appears(wz.getByText('Gold · customized for this partner')) && await sheetFits(page) && await noOverflow(page))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 6. Keyboard and accessibility ================================
  {
    const g = 'keyboard'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    const w = await toPartnershipStep(page)
    const a11y = await page.evaluate(() => {
      const sel = document.querySelector('#pt-package')
      const label = document.querySelector('label[for=pt-package]')?.textContent
      const hint = document.getElementById(sel.getAttribute('aria-describedby') ?? '')?.textContent
      const status = document.querySelector('[data-testid=package-status]')
      const value = document.querySelector('#pt-value')
      return { label, hint: !!hint, status: status?.getAttribute('role'), live: status?.getAttribute('aria-live'), valueHint: document.getElementById(value.getAttribute('aria-describedby') ?? '')?.textContent ?? '' }
    })
    rec(g, 'the dropdown is labelled "Package" and described by its hint', a11y.label === 'Package' && a11y.hint, JSON.stringify(a11y))
    rec(g, 'what a choice did is announced politely', a11y.status === 'status' && a11y.live === 'polite')
    rec(g, 'the value field is described by the visibility wording', /Never shown to attendees/.test(a11y.valueHint))
    // Keyboard: focus the dropdown and change it with the arrow key.
    await page.locator('#pt-package').focus()
    await page.keyboard.press('ArrowDown')
    rec(g, 'the arrow key on the focused dropdown chooses a package and fills it in', await statusIs(page, /Filled in from Gold/) && (await fields(page)).tier === 'Gold', JSON.stringify(await fields(page)))
    await page.keyboard.press('Tab')
    rec(g, 'Tab moves from the dropdown into the tier label', await page.locator('#pt-tier').evaluate((el) => el === document.activeElement) ||
      await page.evaluate(() => document.activeElement?.textContent?.includes('Clear') ?? false))
    await page.locator('#pt-tier').fill('Gold, our wording')
    await page.locator('#pt-package').focus()
    await page.keyboard.press('ArrowDown')
    const box = confirmBox(page)
    rec(g, 'the replace question is an alertdialog, named and described', await appears(box) &&
      await box.evaluate((el) => !!document.getElementById(el.getAttribute('aria-labelledby')) && !!document.getElementById(el.getAttribute('aria-describedby'))))
    rec(g, '...and focus lands on Keep my changes', await button(box, 'Keep my changes').evaluate((el) => el === document.activeElement))
    await page.keyboard.press('Enter')
    rec(g, 'Enter on Keep keeps the edit and the package', await gone(box) && JSON.stringify(await fields(page)) === JSON.stringify({ tier: 'Gold, our wording', value: '50000', currency: 'GHS', pkg: 'k-gold' }), JSON.stringify(await fields(page)))
    rec(g, '...and focus is back on the dropdown', await page.locator('#pt-package').evaluate((el) => el === document.activeElement))
    await w.getByLabel('Sponsor', { exact: true }).check()
    await button(w, 'Continue').click()
    const up = button(w, 'Move VIP passes up')
    await up.focus()
    await page.keyboard.press('Enter')
    rec(g, 'a deliverable moves with Enter and focus stays on its button at the edge', JSON.stringify(await draftTitles(page)) === JSON.stringify(['VIP passes', 'Logo on backdrop']) &&
      await up.evaluate((el) => el === document.activeElement) && (await up.getAttribute('aria-disabled')) === 'true')
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${results.length - fails} passed, ${fails} failed. Screenshots: ${OUT}`)
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
