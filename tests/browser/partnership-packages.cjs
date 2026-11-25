// Partnership packages on the organizer Partners tab: the Partners / Packages switch,
// creating a package and its deliverables (exact payloads), editing details with the
// unsaved-changes guard, archive / restore / delete and when each is offered, the
// database's refusal shown as written, package isolation between events, an archived
// event (read-only), and the phone layout at 390 and 320px.
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
const events = [
  ev('e-a', 'Alpha Summit'),
  ev('e-b', 'Beta Forum', { start_date: '2027-04-01' }),
  ev('e-arch', 'Old Expo', { start_date: '2026-01-01', archived_at: '2026-02-01T00:00:00Z' }),
]
const T = '2026-10-01T00:00:00Z'
const pkg = (id, event_id, name, over = {}) => ({
  id, event_id, name, description: null, value_amount: null, value_currency: null, display_order: 0, archived_at: null,
  created_by: UID, created_at: T, updated_at: T, ...over,
})
const dl = (id, package_id, event_id, title, display_order, over = {}) => ({
  id, package_id, event_id, title, description: null, category: null, quantity: null, due_date: null, display_order,
  created_at: T, updated_at: T, ...over,
})

let state
let log
let seq = 0
function reset(over = {}) {
  state = {
    packages: [
      pkg('k-gold', 'e-a', 'Gold', { value_amount: 50000, value_currency: 'GHS', display_order: 0, description: 'Headline placement across the venue.' }),
      pkg('k-silver', 'e-a', 'Silver', { value_amount: 25000, value_currency: 'GHS', display_order: 1 }),
      pkg('k-old', 'e-a', 'Legacy Bronze', { display_order: 2, archived_at: '2026-09-01T00:00:00Z' }),
      pkg('k-beta', 'e-b', 'Beta Platinum', { display_order: 0 }),
      pkg('k-frozen', 'e-arch', 'Frozen Gold', { display_order: 0 }),
    ],
    deliverables: [
      dl('d-1', 'k-gold', 'e-a', 'Logo on backdrop', 0, { category: 'Branding' }),
      dl('d-2', 'k-gold', 'e-a', 'VIP passes', 1, { quantity: 4 }),
      dl('d-3', 'k-frozen', 'e-arch', 'Frozen item', 0),
    ],
    usage: { 'k-gold': 2, 'k-old': 1 },
    refuseDelete: null,
    refuseReorder: null, // a message: the next reorder call fails with it, and changes nothing
    reorderDelayMs: 0,
    ...over,
  }
  log = { listCalls: [], writes: [], rpcs: [] }
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

function listPackages(eventId) {
  return state.packages
    .filter((p) => p.event_id === eventId)
    .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
    .map((p) => ({
      ...p,
      deliverable_count: state.deliverables.filter((d) => d.package_id === p.id).length,
      partnership_count: state.usage[p.id] ?? 0,
    }))
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
  if (p.endsWith('/event_partnership_package_deliverables')) return [...state.deliverables].sort((a, b) => a.display_order - b.display_order)
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
      const r = filtered(rawRows(url), url)
      return json(200, single ? r[0] ?? null : r)
    }
    const body = JSON.parse(req.postData() || '{}')

    if (m === 'POST' && pathname.includes('/rpc/')) {
      const name = pathname.split('/rpc/')[1]
      log.rpcs.push({ name, body })
      if (name === 'can_manage_event') return json(200, true)
      if (name === 'account_is_active') return json(200, true)
      if (name === 'get_event_partnership_packages') {
        log.listCalls.push(body.target_event_id)
        return json(200, listPackages(body.target_event_id))
      }
      if (name === 'reorder_event_partnership_packages') {
        if (state.reorderDelayMs) await new Promise((r) => setTimeout(r, state.reorderDelayMs))
        if (state.refuseReorder) { const msg = state.refuseReorder; state.refuseReorder = null; return json(400, err('P0001', msg)) }
        body.package_ids.forEach((id, i) => { const p = state.packages.find((x) => x.id === id); if (p) p.display_order = i })
        return json(200, null)
      }
      if (name === 'reorder_package_deliverables') {
        body.deliverable_ids.forEach((id, i) => { const d = state.deliverables.find((x) => x.id === id); if (d) d.display_order = i })
        return json(200, null)
      }
      return json(200, rawRows(url))
    }

    log.writes.push({ m, path: pathname, query: new URL(url).search, body })
    const id = new URL(url).searchParams.get('id')?.replace(/^eq\./, '')

    if (pathname.endsWith('/event_partnership_packages')) {
      if (m === 'POST') {
        const row = pkg('k-new-' + ++seq, body.event_id, body.name, { ...body, name: body.name.trim() })
        state.packages.push(row)
        return json(201, single ? row : [row])
      }
      const row = state.packages.find((p) => p.id === id)
      if (!row) return json(200, [])
      if (m === 'PATCH') { Object.assign(row, body); return json(200, [{ id }]) }
      if (m === 'DELETE') {
        if (state.refuseDelete) return json(400, err('P0001', state.refuseDelete))
        state.packages = state.packages.filter((p) => p.id !== id)
        state.deliverables = state.deliverables.filter((d) => d.package_id !== id)
        return json(200, [{ id }])
      }
    }
    if (pathname.endsWith('/event_partnership_package_deliverables')) {
      if (m === 'POST') {
        const row = dl('d-new-' + ++seq, body.package_id, body.event_id, body.title, body.display_order, body)
        state.deliverables.push(row)
        return json(201, [row])
      }
      const row = state.deliverables.find((d) => d.id === id)
      if (!row) return json(200, [])
      if (m === 'PATCH') { Object.assign(row, body); return json(200, [{ id }]) }
      if (m === 'DELETE') { state.deliverables = state.deliverables.filter((d) => d.id !== id); return json(200, [{ id }]) }
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
  async function packagesView(page) {
    await button(page, 'Partners').first().click()
    await settle(page)
    await page.getByRole('group', { name: 'Show partners or packages' }).getByRole('button', { name: 'Packages' }).click()
    await settle(page)
  }
  const sheet = (page, name) => page.getByRole('dialog', { name })
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  const sheetFits = (page) => page.evaluate(() => {
    const panels = [...document.querySelectorAll('[role=dialog] > div')]
    return panels.every((el) => el.scrollWidth <= el.clientWidth + 1)
  })

  // ================= 1. The switch, and the list for this event only ===============
  {
    const g = 'list'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await button(page, 'Partners').first().click()
    await settle(page)
    rec(g, 'the Partners view is the default and still offers Add Partner', await appears(button(page, 'Add Partner')))
    const toggle = page.getByRole('group', { name: 'Show partners or packages' })
    rec(g, 'a Partners / Packages switch is offered', (await toggle.getByRole('button').count()) === 2)
    rec(g, '...with Partners pressed', (await toggle.getByRole('button', { name: 'Partners' }).getAttribute('aria-pressed')) === 'true')
    rec(g, 'no package data is requested until Packages is opened', log.listCalls.length === 0)
    await toggle.getByRole('button', { name: 'Packages' }).click()
    await settle(page)
    rec(g, 'Packages is pressed after switching', (await toggle.getByRole('button', { name: 'Packages' }).getAttribute('aria-pressed')) === 'true')
    rec(g, 'Add Partner is not shown in the Packages view', (await button(page, 'Add Partner').count()) === 0)
    // Every request, not exactly one: React.StrictMode runs effects twice on the dev server.
    rec(g, 'the list asks for THIS event only', log.listCalls.length > 0 && log.listCalls.every((e) => e === 'e-a'), JSON.stringify(log.listCalls))
    rec(g, 'both active packages are listed, in order', await appears(page.getByRole('button', { name: /^Gold/ })) &&
      (await page.locator('li button').allInnerTexts()).filter((t) => /Gold|Silver/.test(t)).map((t) => t.split('\n')[0]).join(',') === 'Gold,Silver')
    rec(g, 'the value, deliverable count and usage are shown', await appears(page.getByText('GHS 50,000')) && await appears(page.getByText('2 deliverables · Used by 2 partners')) &&
      await appears(page.getByText('No deliverables yet · Not used by any partner yet')))
    rec(g, 'another event\'s package is not listed', (await page.getByText('Beta Platinum').count()) === 0)
    rec(g, 'archived packages are collapsed', await appears(page.getByRole('button', { name: 'Archived packages (1)' })) && (await page.getByText('Legacy Bronze').count()) === 0)
    await page.getByRole('button', { name: 'Archived packages (1)' }).click()
    rec(g, '...and listed with an Archived badge when expanded', await appears(page.getByText('Legacy Bronze')) && await appears(page.locator('li').filter({ hasText: 'Legacy Bronze' }).getByText('Archived', { exact: true })))
    rec(g, 'the copy says a package never changes an existing agreement', await appears(page.getByText(/changing a package never changes an agreement already made/)))
    await page.screenshot({ path: path.join(OUT, 'packages-list-desktop.png'), fullPage: true })

    // Reorder (desktop): Silver up.
    await page.getByRole('button', { name: 'Move Silver up' }).click()
    await settle(page)
    const reorder = log.rpcs.find((r) => r.name === 'reorder_event_partnership_packages')
    rec(g, 'moving a package sends the whole new order, archived last', !!reorder && reorder.body.target_event_id === 'e-a' &&
      JSON.stringify(reorder.body.package_ids) === JSON.stringify(['k-silver', 'k-gold', 'k-old']), JSON.stringify(reorder?.body))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 2. Create a package, then its deliverables =====================
  {
    const g = 'create'
    reset({ packages: [], deliverables: [] })
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await packagesView(page)
    rec(g, 'an empty event shows the empty state', await appears(page.getByText('No packages yet')))
    await button(page, 'New Package').first().click()
    const dlg = sheet(page, 'New Package')
    rec(g, 'New Package opens the package sheet', await appears(dlg))
    rec(g, '...without a deliverables section until the package exists', (await dlg.getByRole('heading', { name: 'Deliverables' }).count()) === 0)

    await dlg.locator('#pkg-name').fill('Gold')
    await dlg.locator('#pkg-value').fill('50000')
    await button(dlg, 'Create package').click()
    rec(g, 'an amount without a currency is refused before saving', await appears(dlg.getByText('Add the currency for this amount, such as GHS or USD.')) &&
      log.writes.length === 0)
    await dlg.locator('#pkg-currency').fill('ghs')
    rec(g, 'the currency is upper-cased as it is typed', (await dlg.locator('#pkg-currency').inputValue()) === 'GHS')
    await button(dlg, 'Create package').click()
    await settle(page)
    const created = log.writes.find((w) => w.m === 'POST' && w.path.endsWith('/event_partnership_packages'))
    rec(g, 'Create sends exactly the package fields, for this event, after the others', !!created &&
      JSON.stringify(created.body) === JSON.stringify({ event_id: 'e-a', name: 'Gold', description: null, value_amount: 50000, value_currency: 'GHS', display_order: 0 }), JSON.stringify(created?.body))
    rec(g, '...and never a creator or archive state', !!created && !('created_by' in created.body) && !('archived_at' in created.body))
    const gold = sheet(page, 'Gold')
    rec(g, 'the sheet becomes the new package', await appears(gold) && await appears(gold.getByText('Package created. Now add the deliverables it includes.')))
    rec(g, 'its deliverables section appears, empty', await appears(gold.getByText('No deliverables in this package yet.')))
    rec(g, 'the list behind refreshes with the new package', await appears(page.locator('li').filter({ hasText: 'Gold' })))

    await button(gold, 'Add Deliverable').click()
    const add = sheet(page, 'Add Deliverable')
    rec(g, 'Add Deliverable opens the shared deliverable form', await appears(add) && (await add.locator('#ob-due').count()) === 1)
    await add.locator('#ob-title').fill('Logo on backdrop')
    await add.locator('#ob-category').fill('Branding')
    await add.locator('#ob-quantity').fill('2')
    await button(add, 'Add').click()
    await settle(page)
    const item = log.writes.find((w) => w.m === 'POST' && w.path.endsWith('/event_partnership_package_deliverables'))
    rec(g, 'the deliverable is saved to this package and event, first in order', !!item &&
      JSON.stringify(item.body) === JSON.stringify({ package_id: 'k-new-1', event_id: 'e-a', display_order: 0, title: 'Logo on backdrop', description: null, category: 'Branding', quantity: 2, due_date: null }), JSON.stringify(item?.body))
    rec(g, '...and listed in the sheet', await gone(add) && await appears(gold.getByText('Logo on backdrop')) && await appears(gold.getByText('Branding · Qty 2')))

    await button(gold, 'Add Deliverable').click()
    await sheet(page, 'Add Deliverable').locator('#ob-title').fill('VIP passes')
    await button(sheet(page, 'Add Deliverable'), 'Add').click()
    await settle(page)
    const second = log.writes.filter((w) => w.m === 'POST' && w.path.endsWith('/event_partnership_package_deliverables'))[1]
    rec(g, 'a second deliverable goes after the first', second?.body.display_order === 1, JSON.stringify(second?.body))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 3. Edit details; the unsaved-changes guard =====================
  {
    const g = 'edit'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await packagesView(page)
    await page.getByRole('button', { name: /^Gold/ }).click()
    const gold = sheet(page, 'Gold')
    rec(g, 'opening a package shows its details and deliverables', await appears(gold.getByText('VIP passes')) && (await gold.locator('#pkg-name').inputValue()) === 'Gold')
    rec(g, 'a used package says its partners keep their own copy', await appears(gold.getByText(/Used by 2 partners\. Each of them keeps the deliverables and value it was created with/)))
    rec(g, 'Save details is disabled until something changes', await button(gold, 'Save details').isDisabled())
    await gold.locator('#pkg-name').fill(' Gold ')
    rec(g, '...and stays disabled for a whitespace-only change', await button(gold, 'Save details').isDisabled())
    await gold.locator('#pkg-name').fill('Gold 2027')
    await page.keyboard.press('Escape')
    rec(g, 'closing with unsaved details asks first', await appears(page.getByRole('dialog', { name: 'Discard your changes?' })))
    await button(page, 'Keep').click()
    rec(g, 'Keep returns to the sheet with the edit intact', (await gold.locator('#pkg-name').inputValue()) === 'Gold 2027')
    await button(gold, 'Save details').click()
    await settle(page)
    const patch = log.writes.find((w) => w.m === 'PATCH' && w.path.endsWith('/event_partnership_packages'))
    rec(g, 'Save details updates only the package fields', !!patch && patch.query.includes('id=eq.k-gold') &&
      JSON.stringify(patch.body) === JSON.stringify({ name: 'Gold 2027', description: 'Headline placement across the venue.', value_amount: 50000, value_currency: 'GHS' }), JSON.stringify(patch?.body))
    rec(g, '...and confirms it', await appears(page.getByRole('dialog', { name: 'Gold 2027' }).getByText('Package details saved.')))

    const renamed = sheet(page, 'Gold 2027')
    await button(renamed, 'Edit VIP passes').click()
    const edit = sheet(page, 'Edit Deliverable')
    await edit.locator('#ob-quantity').fill('6')
    await button(edit, 'Save').click()
    await settle(page)
    const itemPatch = log.writes.find((w) => w.m === 'PATCH' && w.path.endsWith('/event_partnership_package_deliverables'))
    rec(g, 'editing a deliverable updates that template row only', !!itemPatch && itemPatch.query.includes('id=eq.d-2') && itemPatch.body.quantity === 6 && !('package_id' in itemPatch.body) && !('event_id' in itemPatch.body), JSON.stringify(itemPatch))
    await button(renamed, 'Remove Logo on backdrop').click()
    rec(g, 'removing a deliverable says existing partners keep their copy', await appears(page.getByText('It is removed from this package only. Partners already created from the package keep their own copy.')))
    await button(page, 'Remove').click()
    await settle(page)
    rec(g, '...and deletes that template row', log.writes.some((w) => w.m === 'DELETE' && w.path.endsWith('/event_partnership_package_deliverables') && w.query.includes('id=eq.d-1')) &&
      await gone(renamed.getByText('Logo on backdrop')))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 4. Archive, restore, delete ===================================
  {
    const g = 'lifecycle'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await packagesView(page)
    await page.getByRole('button', { name: /^Gold/ }).click()
    let s = sheet(page, 'Gold')
    rec(g, 'a used package can be archived but is not offered for deletion', await appears(button(s, 'Archive package')) && (await button(s, 'Delete package').count()) === 0 &&
      await appears(s.getByText('Used by 2 partners, so it can be archived but not deleted. Archiving never changes those partners.')))
    await button(s, 'Archive package').click()
    await settle(page)
    const archive = log.writes.find((w) => w.m === 'PATCH' && 'archived_at' in w.body)
    rec(g, 'Archive sets archived_at and nothing else', !!archive && Object.keys(archive.body).join() === 'archived_at' && /^\d{4}-/.test(archive.body.archived_at), JSON.stringify(archive?.body))
    rec(g, '...and the sheet says so, offering Restore', await appears(s.getByText('Package archived.')) && await appears(button(s, 'Restore package')))
    await button(s, 'Restore package').click()
    await settle(page)
    const restore = log.writes.filter((w) => w.m === 'PATCH' && 'archived_at' in w.body)[1]
    rec(g, 'Restore clears archived_at', !!restore && restore.body.archived_at === null, JSON.stringify(restore?.body))
    await button(s, 'Close dialog').click()

    await page.getByRole('button', { name: /^Silver/ }).click()
    s = sheet(page, 'Silver')
    rec(g, 'an unused package offers Delete', await appears(button(s, 'Delete package')))
    state.refuseDelete = 'This package has been used by 1 partnership(s). Archive it instead of deleting it.'
    await button(s, 'Delete package').click()
    await button(page.getByRole('dialog', { name: 'Delete "Silver"?' }), 'Delete package').click()
    await settle(page)
    rec(g, 'the database\'s refusal is shown as written', await appears(s.getByText('This package has been used by 1 partnership(s). Archive it instead of deleting it.')))
    state.refuseDelete = null
    await button(s, 'Delete package').click()
    await button(page.getByRole('dialog', { name: 'Delete "Silver"?' }), 'Delete package').click()
    await settle(page)
    rec(g, 'a permitted delete removes the package and closes the sheet', await gone(s) && (await page.getByRole('button', { name: /^Silver/ }).count()) === 0 &&
      log.writes.some((w) => w.m === 'DELETE' && w.path.endsWith('/event_partnership_packages') && w.query.includes('id=eq.k-silver')))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 5. Another event, and an archived event ========================
  {
    const g = 'isolation'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-b')
    await page.waitForSelector('h1:has-text("Beta Forum")')
    await packagesView(page)
    rec(g, 'another event lists only its own packages', await appears(page.getByText('Beta Platinum')) && (await page.getByText('Gold', { exact: true }).count()) === 0 &&
      log.listCalls.length > 0 && log.listCalls.every((e) => e === 'e-b'), JSON.stringify(log.listCalls))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }
  {
    const g = 'archived event'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-arch')
    await page.waitForSelector('h1:has-text("Old Expo")')
    await packagesView(page)
    rec(g, 'packages are readable', await appears(page.getByText('Frozen Gold')))
    rec(g, 'New Package is not offered', (await button(page, 'New Package').count()) === 0)
    await page.getByRole('button', { name: /^Frozen Gold/ }).click()
    const s = sheet(page, 'Frozen Gold')
    rec(g, 'the sheet is read-only: no form, no Add Deliverable, no Archive or Delete', await appears(s.getByText('Frozen item')) &&
      (await s.locator('#pkg-name').count()) === 0 && (await button(s, 'Add Deliverable').count()) === 0 &&
      (await button(s, 'Archive package').count()) === 0 && (await button(s, 'Delete package').count()) === 0 &&
      (await s.getByRole('button', { name: /^(Edit|Remove) / }).count()) === 0)
    rec(g, 'nothing was written', log.writes.length === 0, JSON.stringify(log.writes))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 6. Phone layout ===============================================
  for (const w of [390, 320]) {
    const g = 'phone ' + w
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a', { w, h: 800 })
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await packagesView(page)
    await appears(page.getByRole('button', { name: /^Gold/ }))
    rec(g, 'the package list does not scroll sideways', await noOverflow(page))
    rec(g, 'reorder controls are shown on a phone', await page.getByRole('button', { name: 'Move Silver up' }).isVisible() &&
      await page.getByRole('button', { name: 'Move Gold down' }).isVisible())
    await page.screenshot({ path: path.join(OUT, `packages-list-${w}.png`), fullPage: true })
    await page.getByRole('button', { name: /^Gold/ }).click()
    const s = sheet(page, 'Gold')
    await appears(s.getByText('VIP passes'))
    rec(g, 'the package sheet fits the screen', await sheetFits(page) && await noOverflow(page))
    const box = await button(s, 'Save details').boundingBox()
    rec(g, 'Save details is full width on a phone', !!box && box.width >= w - 2 * 24, JSON.stringify(box))
    await page.screenshot({ path: path.join(OUT, `packages-sheet-${w}.png`), fullPage: false })
    await button(s, 'Add Deliverable').click()
    await appears(sheet(page, 'Add Deliverable'))
    rec(g, 'the nested deliverable form fits too', await sheetFits(page) && await noOverflow(page))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 7. Reordering on a phone (touch) ================================
  // The names in the ACTIVE list, top to bottom (the archived list is a separate list).
  const shownOrder = (page) => page.getByRole('list', { name: 'Packages', exact: true }).locator(':scope > li').evaluateAll((lis) => lis
    .map((li) => li.querySelector(':scope > button p span')?.textContent ?? ''))
  const status = (page) => page.getByTestId('package-order-status').textContent()
  const reorders = () => log.rpcs.filter((r) => r.name === 'reorder_event_partnership_packages')
  // A move is finished when its result is announced; networkidle alone can return before React applies it.
  const announced = (page, text, timeout = 4000) => page.waitForFunction((t) => document.querySelector('[data-testid=package-order-status]')?.textContent === t, text, { timeout }).then(() => true, () => false)
  for (const w of [390, 320]) {
    const g = 'phone reorder ' + w
    // Three active packages with an archived one stored BETWEEN them, so a move
    // that leaked archived packages into the active order would show up.
    reset({
      packages: [
        pkg('k-gold', 'e-a', 'Gold', { value_amount: 50000, value_currency: 'GHS', display_order: 0, description: 'Headline placement across the venue.' }),
        pkg('k-old', 'e-a', 'Legacy Bronze', { display_order: 1, archived_at: '2026-09-01T00:00:00Z' }),
        pkg('k-silver', 'e-a', 'Silver', { value_amount: 25000, value_currency: 'GHS', display_order: 2 }),
        pkg('k-bronze', 'e-a', 'Bronze', { display_order: 3 }),
      ],
    })
    const { page, ctx, errors } = await open('/organizer/events/e-a', { w, h: 800, touch: true })
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await packagesView(page)
    await appears(page.getByRole('button', { name: /^Gold/ }))
    rec(g, 'the active list shows only active packages, in order', JSON.stringify(await shownOrder(page)) === JSON.stringify(['Gold', 'Silver', 'Bronze']), JSON.stringify(await shownOrder(page)))

    // Touch targets: every move button is at least 44 x 44.
    const boxes = await page.getByRole('button', { name: /^Move .* (up|down)$/ }).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
    rec(g, 'six move buttons, each at least 44 x 44', boxes.length === 6 && boxes.every(([bw, bh]) => bw >= 44 && bh >= 44), JSON.stringify(boxes))

    // Compact: no sideways scroll, the controls cost one 44px column, and a row
    // with no description is no taller than the two stacked buttons.
    rec(g, 'no sideways scroll with the controls shown', await noOverflow(page))
    const silverRow = await page.locator('ul li').filter({ hasText: 'Silver' }).first().boundingBox()
    const silverMain = await page.getByRole('button', { name: /^Silver/ }).boundingBox()
    rec(g, 'a short row stays compact (at most 2 x 44px tall)', !!silverRow && silverRow.height <= 90, JSON.stringify(silverRow))
    rec(g, 'the package itself keeps most of the row width', !!silverRow && !!silverMain && silverMain.width >= silverRow.width - 46, JSON.stringify({ silverRow, silverMain }))
    rec(g, 'the name and value are not clipped', await page.getByRole('button', { name: /^Silver/ }).evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    await page.screenshot({ path: path.join(OUT, `packages-reorder-${w}.png`), fullPage: true })

    // Edges: Gold cannot move up, Bronze cannot move down, and tapping them sends nothing.
    const goldUp = page.getByRole('button', { name: 'Move Gold up' })
    const bronzeDown = page.getByRole('button', { name: 'Move Bronze down' })
    rec(g, 'the first package\'s up and the last package\'s down are marked unavailable',
      (await goldUp.getAttribute('aria-disabled')) === 'true' && (await bronzeDown.getAttribute('aria-disabled')) === 'true' &&
      (await page.getByRole('button', { name: 'Move Gold down' }).getAttribute('aria-disabled')) === null)
    // force: Playwright itself treats aria-disabled as "not enabled" and would refuse
    // to tap. A finger does not, so tap anyway and prove nothing happens.
    await goldUp.tap({ force: true })
    await bronzeDown.tap({ force: true })
    await settle(page)
    rec(g, '...and tapping them sends no reorder and changes nothing', reorders().length === 0 && JSON.stringify(await shownOrder(page)) === JSON.stringify(['Gold', 'Silver', 'Bronze']))

    // A tap moves Silver up: whole active order, archived last.
    await page.getByRole('button', { name: 'Move Silver up' }).tap()
    const upDone = await announced(page, 'Silver moved to position 1 of 3.')
    rec(g, 'tapping up sends the new active order with the archived package last', reorders().length === 1 &&
      reorders()[0].body.target_event_id === 'e-a' &&
      JSON.stringify(reorders()[0].body.package_ids) === JSON.stringify(['k-silver', 'k-gold', 'k-bronze', 'k-old']), JSON.stringify(reorders()[0]?.body))
    rec(g, '...the list shows it', JSON.stringify(await shownOrder(page)) === JSON.stringify(['Silver', 'Gold', 'Bronze']), JSON.stringify(await shownOrder(page)))
    rec(g, '...it is announced', upDone, await status(page))
    rec(g, '...and Silver is now the edge one', (await page.getByRole('button', { name: 'Move Silver up' }).getAttribute('aria-disabled')) === 'true' &&
      (await page.getByRole('button', { name: 'Move Gold up' }).getAttribute('aria-disabled')) === null)

    // A tap moves Gold down.
    await page.getByRole('button', { name: 'Move Gold down' }).tap()
    rec(g, 'tapping down moves the package one place down', await announced(page, 'Gold moved to position 3 of 3.') && reorders().length === 2 &&
      JSON.stringify(reorders()[1].body.package_ids) === JSON.stringify(['k-silver', 'k-bronze', 'k-gold', 'k-old']) &&
      JSON.stringify(await shownOrder(page)) === JSON.stringify(['Silver', 'Bronze', 'Gold']), JSON.stringify(reorders()[1]?.body))

    // The archived section is never reorderable and stays out of the active list.
    await page.getByRole('button', { name: 'Archived packages (1)' }).tap()
    await appears(page.getByText('Legacy Bronze'))
    rec(g, 'archived packages have no move controls', (await page.getByRole('button', { name: /^Move Legacy Bronze/ }).count()) === 0)
    rec(g, 'no sideways scroll with archived packages open', await noOverflow(page))

    // A refused move: the error is shown and the order on screen goes back.
    state.refuseReorder = 'Those packages do not all belong to this event'
    await page.getByRole('button', { name: 'Move Gold up' }).tap()
    const failDone = await announced(page, 'Gold was not moved.')
    rec(g, 'a failed move shows the error', await appears(page.getByRole('alert').filter({ hasText: 'Those packages do not all belong to this event' })),
      await page.getByRole('alert').first().textContent({ timeout: 500 }).catch(() => 'no alert'))
    rec(g, '...and restores the previous order', JSON.stringify((await shownOrder(page)).slice(0, 3)) === JSON.stringify(['Silver', 'Bronze', 'Gold']), JSON.stringify(await shownOrder(page)))
    rec(g, '...and says it was not moved', failDone, await status(page))
    rec(g, '...and the stored order is untouched', JSON.stringify(listPackages('e-a').map((p) => p.id)) === JSON.stringify(['k-silver', 'k-bronze', 'k-gold', 'k-old']))

    // The next successful move clears the error.
    await page.getByRole('button', { name: 'Move Gold up' }).tap()
    rec(g, 'a later successful move clears the error', await announced(page, 'Gold moved to position 2 of 3.') && (await page.getByRole('alert').filter({ hasText: 'belong' }).count()) === 0 &&
      JSON.stringify((await shownOrder(page)).slice(0, 3)) === JSON.stringify(['Silver', 'Gold', 'Bronze']))

    // A second tap while the first is still saving is ignored, not raced.
    state.reorderDelayMs = 600
    const before = reorders().length
    await page.getByRole('button', { name: 'Move Bronze up' }).tap()
    await page.getByRole('button', { name: 'Move Silver down' }).tap()
    await announced(page, 'Bronze moved to position 2 of 3.')
    await page.waitForTimeout(300) // room for a second, wrongly queued save to arrive
    state.reorderDelayMs = 0
    rec(g, 'a second tap during a save is ignored', reorders().length === before + 1 &&
      JSON.stringify((await shownOrder(page)).slice(0, 3)) === JSON.stringify(['Silver', 'Bronze', 'Gold']), JSON.stringify({ calls: reorders().length - before, order: await shownOrder(page) }))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 8. Reordering from the keyboard =================================
  {
    const g = 'keyboard reorder'
    reset()
    const { page, ctx, errors } = await open('/organizer/events/e-a')
    await page.waitForSelector('h1:has-text("Alpha Summit")')
    await packagesView(page)
    await appears(page.getByRole('button', { name: /^Gold/ }))
    const silverUp = page.getByRole('button', { name: 'Move Silver up' })
    await silverUp.focus()
    await page.keyboard.press('Enter')
    rec(g, 'Enter on a move button reorders', await announced(page, 'Silver moved to position 1 of 2.') && reorders().length === 1 && JSON.stringify(await shownOrder(page)) === JSON.stringify(['Silver', 'Gold']))
    rec(g, 'focus stays on the moved package\'s button, even at the edge', await silverUp.evaluate((el) => el === document.activeElement))
    await page.keyboard.press('Enter')
    await page.keyboard.press(' ')
    await settle(page)
    rec(g, '...and pressing it again at the edge sends nothing', reorders().length === 1)
    await page.keyboard.press('Tab')
    rec(g, 'Tab reaches the same package\'s down button next', await page.getByRole('button', { name: 'Move Silver down' }).evaluate((el) => el === document.activeElement))
    rec(g, 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${results.length - fails} passed, ${fails} failed. Screenshots: ${OUT}`)
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
