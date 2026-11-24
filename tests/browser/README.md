# Browser suites (stubbed API)

Automated browser checks for the attendee experience. They drive a real Chrome
against the app, with **every Supabase request intercepted and answered from
fixtures** in each suite file.

- No real project is contacted, no database state changes, and **no credentials
  are used or stored**. The "signed-in" session is a fabricated token for a fake
  user id, and the stub treats it as valid.
- These are **mocked** checks. They prove the UI behaves correctly against the
  API contract the fixtures encode. They do not prove the backend (RLS, RPCs)
  behaves that way, so they are not a substitute for a signed-in check against a
  development project.
- Not covered: camera / QR scanning, Safari / WebKit, real devices.

## Run

```bash
npm install
npm run test:browser
```

Needs Google Chrome (or set `CHROME_PATH` to a Chrome / Chromium / Edge binary).
`BASE_URL=http://localhost:5173 npm run test:browser` tests a server you already
started (it must have been started with `VITE_SUPABASE_URL=http://localhost:54321`,
otherwise the stub will not see the traffic). `SHOTS_DIR` sets where screenshots go.

## Suites

| File | Covers |
| --- | --- |
| `events-and-invitations.cjs` | Events search / filter / sort / pagination / counts; invitation Accept and Decline including in-flight, failure and partial success |
| `event-mode-shell.cjs` | Event Mode sidebar, bottom nav, More drawer, tablet layout, signed-out and wrong-account access |
| `dashboard-and-event-mode-pages.cjs` | Dashboard, Event Home (phone), Agenda and Schedule, Speakers, Exhibitors, Directory |
| `connection-requests.cjs` | Connection requests: Connect choice (scan or send a request), send / accept / decline / cancel, the Requests tab, Connections page, notifications, and the fallback when the backend feature is missing |
| `event-registration.cjs` | Registration dialog: organizer-defined form (all five question kinds), validation, the exact answers sent, confirmation, capacity -> waitlist, leaving the waitlist, cancelling, server error mapping, keyboard handling, the Event Detail waitlisted state, phone layout |
| `event-manager-assignment.cjs` | Organizer Team page: assigning and removing a manager's events (payloads, in-flight state, success and error messages, archived events), no controls on owner/admin rows or for a manager caller, failed assignment lookup, phone layout |
| `event-manager-access.cjs` | Organizer event pages (Event detail, Edit, Partner detail) for owner, admin, assigned manager, unassigned manager and a suspended account: the controls offered, direct links vs navigation, archived events (Restore only), a failed and a slow `can_manage_event` check (fail closed, retry), creating events stays owner/admin, no organizer data requested without access, phone layout |
| `event-capacity-counts.cjs` | Edit event form, Capacity field: confirmed and waitlisted counts from the `event_attendee_page` totals (exact request), help text on the confirmed-only minimum, a warning below the confirmed count that does not block saving, the database's refusal shown, counts unavailable, zero counts, no counts on the create form, phone layout |
| `workspace-switcher.cjs` | Organization workspace switching: the list is exactly the memberships `get_my_organization_access` returns, with the person's own role; selecting opens that organization's dashboard / section with its data and nothing of the previous one (including a deliberately slow previous response); sections kept, event pages left; a direct link to an event follows its organization, also when the membership was granted after the list loaded; refresh keeps the choice (stored per person); a membership revoked while the tab was away, or while moving between pages, is noticed and the workspace moves on with a notice; losing every membership; a re-check that finds nothing new changes nothing (an unsaved Settings edit survives, the dashboard reloads nothing); a failed first load and a failed or rejected background re-check; an expired session; two tabs (switching in one, returning to the other, a tab opened later); signing out in another tab; a different person signing in in another tab (each person's workspace and stored choice kept apart, no screen mixing the two); another person's token arriving without a sign-out (neither workspace shown, a reload notice); accepting an invitation selects the new organization; Personal for an attendee account; all 9 organizer routes on direct links; keyboard; phone at 390 and 320px (top-bar sheet, More drawer, bottom nav, 44px targets, top bar fits) |
| `attendee-sweep.cjs` | Every attendee route at 320 / 390 / 820 / 1440px, Event Detail flows, Messages regression, Follow-ups, Opportunities, Notifications, Profile, Scan, keyboard focus, role access |

Each suite prints `PASS` / `FAIL` lines; `run.cjs` totals them and exits non-zero
on any failure or crash.

## Known failures (pre-existing)

These fail on `development` without any change, and are tracked separately. A run that shows them has **not** passed; a run that shows anything else has a new failure.

| Suite | Failure | Since |
| --- | --- | --- |
| `attendee-sweep.cjs` | *no horizontal overflow on 29 routes x 4 widths*: at 320px, `/events/:id` (by 56px) and `/events/:id/network` (by 15px) overflow sideways | Before PR #91; identical on `development` |
| `event-registration.cjs` | Intermittent: *[keyboard] an event with no questions still shows a confirmation step* reads the dialog immediately after it opens, sometimes before its content renders | Before PR #91; failed in 6 of 8 runs on unchanged `development` |
| `event-manager-access.cjs` | Crashes (timeout) at *clicking the event in the list gives the same refusal*, after 54 passing checks: an event manager's Events list shows assigned events only (read from `event_team`), the suite's stub serves no `event_team` rows, so the list is empty and there is no "Beta Forum" to click | Before PR #91; identical on `development` |

Also observed, not asserted by any suite: the organizer dashboard's content is 339px wide at a 320px viewport when events are listed.

## Writing a check

Prefer asserting on `aria-current`, roles and labels over class names: an earlier
version matched `bg-primary-600` in `className` and broke when a hover style
containing that substring was added.
