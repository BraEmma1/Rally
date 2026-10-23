# Stitch design → Rally route mapping

Status: **for review. Nothing has been implemented, no routes added, no database changes.**
Date: 2026-10-23. Branch at time of writing: `fix/admin-partnership-privacy`.

Evidence base: `CLAUDE.md`; `src/App.tsx` (all routes and guards); `src/lib/routing.ts`;
the layouts in `src/components/`; the pages in `src/pages/`; `src/lib/supabase.ts` types;
`supabase/migrations/`; and the retrieved designs in `design-reference/stitch/`
(`rally-event-ui/screens.json` is the index). No `AGENTS.md` exists in the repository.
Where this document says a backend capability exists, it names the RPC, table or column
that proves it. Where it says "none", no migration or `src` reference was found.
Anything not verified is marked **unverified**.

---

## 0. Corrections after owner review (2026-10-23)

The mapping was approved with the decisions below. Several details were corrected before
implementation.

### 0.1 Decisions recorded
1. **Branding:** "Events. People. Opportunities." with the existing navigation items; Stitch
   tokens from `rally-event-ui/design-system.md`.
2. **Existing functionality first:** restyle existing routes on working data. Omit unsupported
   controls, invented metrics and any action that cannot complete. No fake data or success states.
3. **`/opportunities` keeps its meaning.** It is not renamed "Meetings & Deals". Meetings are a
   separate, future feature.
4. **Privacy:** omit sponsor tiers, mutual connections, presence indicators and private contact
   details. No public sponsor field; no permission changes.
5. **Exports** (CSV / vCard) deferred until the existing-route UI is complete.
6. **Data Import landing page (#27) excluded.** (#28 is empty and also excluded.)
7. **Hidden Stitch screens:** fetch only to resolve a real design gap or conflicting variant.
8. **Mobile:** derive from existing mobile components and the supplied mobile reference (#24);
   verify at mobile widths.

### 0.2 Existing routes vs proposed destinations
Only the routes below exist in `src/App.tsx`. Anything else in this document is a **proposal** and
must not be linked to from the UI until it exists.

| Existing routes (verified in `src/App.tsx`) | |
|---|---|
| Attendee shell (`AppLayout`) | `/dashboard`, `/scan`, `/profile`, `/connections`, `/connections/:id`, `/events`, `/events/:id`, `/follow-ups`, `/opportunities`, `/opportunities/:id`, `/messages`, `/messages/:conversationId`, `/notifications`, `/invitations/organizations` |
| Event Mode shell (`EventModeLayout`) | `/events/:eventId/home`, `/events/:eventId/network`, `/events/:eventId/connections/:connectionId`, `/events/:eventId/info`, `/events/:eventId/agenda`, `/events/:eventId/schedule`, `/events/:eventId/speakers`, `/events/:eventId/speakers/:speakerId`, `/events/:eventId/exhibitors`, `/events/:eventId/exhibitors/:exhibitorId`, `/events/:eventId/map`, `/events/:eventId/deal-room`, `/events/:eventId/messages`, `/events/:eventId/messages/:conversationId` |
| Public / other | `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/p/:id`, `/account`, `/onboarding` |

`/events/:eventId/info`, `/map` and `/deal-room` exist but render `EventComingSoonPage`.
`/events?tab=past` and `/events?tab=invitations` are query states of `/events`, not routes.

**Proposed only (do not exist):** `/events/:eventId/attendees/:userId`, a My Notes page,
a Saved page, a Meetings page. Event destinations are always written with the full
`/events/:eventId/…` path; the shorthand forms in earlier drafts were corrected.

### 0.3 New pages vs new backend features
These are different kinds of work and are tracked separately.

| New **page / route** (frontend only, backend exists) | Backend it would use |
|---|---|
| In-event attendee profile — *proposed* `/events/:eventId/attendees/:userId` | `get_public_profile`, `connect_with_event_attendee`, `create_direct_conversation` (no mutual connections, per decision 4) |
| My Notes list (read-only, across connections) | `notes` owner-scoped SELECT |

| New **backend feature** (needs a reviewed migration/RPC; may or may not add a page) | Needed by |
|---|---|
| Meetings model | #4, #7, #9, #19, #25 |
| Saved events / saved people | #3, #11, "Saved" |
| Event categories / tags | #3 |
| Ticket / pass / interests / consent opt-in | #17, #23, #24 |
| Connection tags, priority, lead score | #2, #13, #20 |
| Q&A, polls, collaborative session notes | #10 |
| Event announcements readable by attendees (**unverified** against existing broadcast messaging) | #8 |
| Standalone notes (notes not tied to a connection) | My Notes composer |

Phase 1 contains **neither**. It restyles existing pages on existing data.

### 0.4 My Notes — verification
The earlier "backend-ready" claim was too broad. Verified against
`supabase/migrations/20260918234517_create_rally_schema.sql`:
- `notes.connection_id uuid NOT NULL REFERENCES connections(id)` — **every note belongs to a connection**.
- RLS: `select_own_notes`, `insert_own_notes`, `update_own_notes`, `delete_own_notes` — owner-only.
- Therefore a **read-only list of the user's own notes across connections** is possible with no
  backend change. A **standalone note** (not attached to a connection) is **not** possible without
  a schema change. The app today reads/writes notes only on `ConnectionDetailPage`,
  `ConnectionsPage` (add-with-note) and `ScanQRPage` (context note).

### 0.5 Unresolved HTML / screenshot pairings
Screenshots were matched to screens by exact pixel size; HTML files by page title / content.
Both pairings are reliable except where recorded here:
- **Screen 04 ×2 (`d4a41f69…`, `11609335…`) and Screen 08 ×2 (`32d93ab6…`, `5000b2a1…`):** the two
  versions of each share a title, so the HTML↔screen association for these four rests on the
  copied URL, not on a unique title. Not visually cross-checked.
- **Screen 03 (`5f78af5e…`):** its screenshot is 1920×4360 JPEG while the list reports 2560×5840,
  so it could not be matched by dimensions; it was identified as the only remaining file.
- **Screens with empty `<title>`** (S17, S02, S16, S03b, S13, S10, S06, S21, S20, S18, S19, mobile
  `8a960f`): paired by headings/keywords only (checked for the generic ones).
- **`image.png` (`16405481722405147295`)** has a screenshot only. **Rally Design System** screens
  `5865b128…` / `15dd7ba1…` are excluded (decision 6).
Anything that the first batch relies on must be re-checked against the *screenshot* for that
screen, not the HTML alone.

---

## 1. Ground rules that shape the mapping

1. **Every Stitch screen is an attendee-facing screen.** There is no organizer, sponsor,
   vendor or admin design. All routes the designs touch sit behind
   `ProtectedRoute` → `RequireAccount(isActiveAttendee)` → `RequireCompleteProfile`
   (`src/App.tsx:376-440`). Organizer, sponsor, vendor and platform-admin accounts are
   redirected to their own home by `accountHomePath()` and never see these screens. That
   must not change.
2. **Admin partnership privacy (`20261021000000`) is untouched by the designs**, but several
   designs surface partnership-like information to attendees (sponsor tiers, "Founding
   Sponsors", exhibitor representatives). Those are flagged in §6.
3. **Sponsor/partnership data is organizer-private** (CLAUDE.md §4). Attendee pages must not
   read `event_partnerships`, packages, obligations or documents. The only public
   exhibitor/sponsor-like source is `event_exhibitors` via `get_event_exhibitors`.
4. **The designs are desktop mock-ups at ~1440px.** Only one mobile design exists
   (`8a960f`). The app is mobile-first (`BottomNav`, `EventModeBottomNav`), so every
   implemented screen needs a mobile layout the designs do not provide.
5. **The designs contain hard-coded sample content** (James Wilson, Ama Mensah, "ATIS 2027",
   counts like 48 / 1,854 / 1,240). None of it is data. Copy structure, never content.
6. **Do not import design HTML.** It loads Tailwind from a CDN, Material Symbols and remote
   avatar images. The app uses its own Tailwind config and `lucide-react`.

### Design tokens already agree
`tailwind.config.js` `primary-600` is `#0A66C2`, the same as the Stitch `primary-container`
`#0a66c2`; both use Inter. The designs add **Plus Jakarta Sans** for headings (not loaded;
`index.html` loads Inter only) and a Material-3 surface palette (`#f8f9ff` background,
`#e5eeff` containers, `#004e99` primary). Token work is small and does not need new routes.

---

## 2. Mapping table

Legend — Status: **existing match** · **partial match** · **new page** · **duplicate** ·
**unclear**. "Route" is an existing route in `src/App.tsx` unless marked *proposed*.
IDs are the Stitch screen ids (project `3523556768242095343`, "Rally Event UI") unless noted;
`screens.json` has the full list.

| # | Stitch screen · ID | Audience | Existing page / component | Existing route | How users reach it today | Where its buttons/links should lead | Status | Backend readiness / missing |
|---|---|---|---|---|---|---|---|---|
| 1 | **image.png** · `16405481722405147295` (screenshot only, no HTML) | Attendee | `DashboardPage` | `/dashboard` | Sidebar "Dashboard"; login redirect (`accountHomePath`) | Same as #9 | **duplicate** of #9 (third dashboard variant: dark sidebar, calendar, "Upgrade to Rally Pro") | Same as #9. Also needs: calendar widget, networking-progress chart (no data), Pro upsell (no billing) |
| 2 | **Screen 17 — My Network Directory** · `7b38dcee…` | Attendee | `ConnectionsPage` (605 lines; tabs All/Overdue/Upcoming, filters, add-connection form) | `/connections` | Sidebar "Connections"; bottom nav "Network"; dashboard "Recent Connections → see all" | Row/Dossier → `/connections/:id`. Message → `create_direct_conversation` → `/messages/:conversationId`. Add Connection → existing add form / `/scan`. Pagination: none today | **partial match** | **Ready:** `connections` (owner-scoped RLS), `relationship_type`, `event_name`/`event_id`, `follow_up_date`, `create_direct_conversation`. **Missing:** tags and "Assign Tag"; "High Priority" (no priority column); bulk follow-up action; CRM sync (Salesforce/HubSpot/Google/Outlook — no integration); CSV export (own rows only is feasible client-side; needs a decision, §6); server pagination (list loads all rows) |
| 3 | **Screen 02 — Events Discovery** · `b53f81ba…` | Attendee | `EventsPage` (tabs upcoming / past / invitations, register/unregister, registration counts) | `/events` | Sidebar "Events"; dashboard "Browse events"; event-mode "Exit" | Card → `/events/:id`. Register Now → existing register (insert `event_registrations`). Sync to Calendar / Saved Summits: no target | **partial match** | **Ready:** `events` list, `get_event_registration_counts`, `event_invitations`. **Missing:** category chips (`events` has no category/tags column), "Saved Summits"/bookmarks for events (only *session* bookmarks exist), calendar sync, grid/list toggle (UI only), numbered pagination, "Upgrade to Pro" (no billing) |
| 4 | **Screen 16 — In-Event Attendee Networking Profile** · `d78fb7ee…` | Attendee (registered, in Event Mode) | None. Nearest: `EventModeConnectFlow` (connect flow launched from the directory), `PublicProfilePage` (`/p/:id`, outside the event shell) | **none** (*proposed* `/events/:eventId/attendees/:userId`) | Would be opened from the Event Mode attendee directory (#15/#18) | Back → `/events/:eventId/network`. Send Direct Message → `create_direct_conversation` → `/events/:eventId/messages/:id`. Save to Network → `connect_with_event_attendee`. Add sessions to schedule → attendee's sessions: no source | **new page** | **Ready:** `get_public_profile(s)` (name, title, company, industry, location, bio, `looking_for`, `can_offer`, linkedin, website — **no email/phone by design**), `connect_with_event_attendee`, `create_direct_conversation`. **Missing / conflicts:** attendee's session list (bookmarks are private), mutual connections / warm intro (connections are owner-private — §6), bilateral 1-on-1 request (no meetings table), "Private Lead Memo" only possible after connecting (notes need a connection), "Verified Credentials" (no data), attendee Day 1/Day 2 presence (none) |
| 5 | **Screen 03b — Event Details (Pre-Registration)** · `23e08d42…` | Attendee, not yet registered | `EventDetailPage` (745 lines; tabs about / attendees / networking; Register button; "Enter Event Mode" when registered) | `/events/:id` | `/events` card; dashboard "My Upcoming Events"; invitation link | Register → existing register action. Speaker/agenda/exhibitor sections → same page. "Enter Event Mode" (after register) → `/events/:id/home` | **partial match** — *state* of the page (pre-registration). Variant of #24, #26 | **Ready:** `events` row, `get_event_agenda`, `get_event_speakers`, `get_event_exhibitors` (all `anon, authenticated`), registration counts. **Missing:** pass tiers / prices (no ticket model), "Your Network" attendee preview before registering (directory RPC requires registration — correct, keep), venue/travel guide, "Backed by Industry Leaders" sponsors (conflict §6), FAQ |
| 6 | **Screen 09 — Event Agenda & Schedule** · `eefa2398…` | Attendee (registered) | `EventAgendaPage` (day tabs, `SessionRow`, `SessionDetailDialog`, bookmark add/remove) | `/events/:eventId/agenda` | Event Mode home tile "Agenda"; event-mode nav | Session → opens `SessionDetailDialog`. "+ Add to Schedule" → `save_event_session` / `remove_event_session`. "My Schedule (5)" → `/events/:eventId/schedule` | **partial match** | **Ready:** `get_event_agenda`, `get_my_saved_session_ids`, `save_event_session`, `remove_event_session`, `session_type` (usable as a track filter — verify its values). **Missing:** "Live Q&A", "Reserved (Table 4)", PDF program download, Google/Outlook calendar sync (an `.ics` export would be client-only), "next session alert" |
| 7 | **Screen 13 — Speaker Profile & Bilateral Dossier** · `9780a757…` | Attendee (registered) | `SpeakerDetailPage` | `/events/:eventId/speakers/:speakerId` | Speakers list card; session dialog speaker chip (`SessionSpeakersSection`) | Back → `/events/:eventId/speakers`. Send Direct Message: speakers are not necessarily users — **unverified**. Session links → `/events/:eventId/agenda` | **partial match** | **Ready:** `get_event_speakers`, `get_event_speaker_sessions`. **Missing:** bilateral/VIP meeting request (no meetings backend), observer pass, publications/policy briefs, mutual connections, "Follow Updates", print brief |
| 8 | **Screen 07 — Event Mode Home** · `e1041ae8…` | Attendee (registered) | `EventHomePage` (hero, greeting, 6-tile grid, My Schedule link) | `/events/:eventId/home` | `/events/:id` "Enter Event Mode"; dashboard; registration confirmation | Tiles → `/events/:eventId/agenda`, `/events/:eventId/network`, `/events/:eventId/map`, `/events/:eventId/speakers`, `/events/:eventId/exhibitors`, `/events/:eventId/deal-room`; My Schedule → `/events/:eventId/schedule`. Badge QR → profile QR (`/profile`). Scan Badge → `/scan` | **partial match** | **Ready:** event row, checked-in flag (`event_registrations.checked_in_at`), agenda (a "now/next" strip is derivable from `get_event_agenda`), notifications count. **Missing:** live stage/broadcast stream, "Live Announcements" (a broadcast message mechanism exists in messaging — `20261001000000_broadcast_read_receipts` — whether attendees can read event announcements is **unverified**), Wi-Fi/help desk/concierge content, "Delegates in your room" (presence — conflict §6), 1-on-1 slot booking, vCard export to CRM |
| 9 | **Attendee Dashboard — Desktop (Refined)** · `a2790981…` | Attendee | `DashboardPage` (stats, recent connections, follow-ups, upcoming events, opportunities) | `/dashboard` | Login redirect; sidebar | Cards link to `/connections`, `/follow-ups`, `/events`, `/opportunities` (as today). "Join" meetings: no target | **partial match** | **Ready:** connections, follow-ups (`follow_ups`), events+registrations, `opportunities`. **Missing:** "Upcoming Meetings & Syncs" (no meetings), "Upgrade Plan", recommended-steps, networking-progress chart |
| 10 | **Screen 10 — Session Details** · `4854861769058641374` | Attendee (registered) | `SessionDetailDialog` (in `components/eventmode/SessionRow.tsx`), opened from `EventAgendaPage` and `EventMySchedulePage` | **none — it is a dialog, not a route** | Tap a session row | Close → returns to agenda. Add/Remove → `save_event_session`/`remove_event_session`. Speaker → `/events/:eventId/speakers/:speakerId` | **partial match** — a *state/dialog* of #6/#19, not a page | **Ready:** session fields, `get_event_session_speakers`. **Missing:** audience Q&A + upvotes, live polls, collaborative notes, slides download, live audio/translation, "peers in this session", map |
| 11 | **Screen 06 — My Events** · `9b8bf9eb…` | Attendee | `EventsPage` (registered state shown on cards; upcoming/past tabs) | `/events` | Sidebar "Events" | Launch Event Mode → `/events/:id/home`. View Details → `/events/:id`. My Badge Pass → `/profile` QR. Event Notes → no target | **partial match** — a *view/filter* of `/events`, not a second route | **Ready:** registrations (`event_registrations` select), past/upcoming split. **Missing:** "Saved & Watchlist", year filter UI (derivable), "Register New Event" CTA (→ `/events`), per-event notes, meeting counts, "Complete Registration" (no draft registrations), Sync All Calendars |
| 12 | **Screen 05 — Registration Confirmation** · `b5a45e9a…` | Attendee | `EventDetailPage` after `handleRegister` (shows registered state and "Enter Event Mode") | `/events/:id` (state) | After clicking Register | Enter Event Mode → `/events/:id/home`. Explore Attendee Directory → `/events/:id/network`. Go to My Events → `/events`. Meeting Scheduler / Hotel Deals / wallets: no target | **partial match** — a *post-registration state or dialog*, not a route | **Ready:** registration insert; `event_registration` notification type exists. **Missing:** Apple Wallet / Google Pay passes, PDF badge/ticket, LinkedIn share, calendar file, meeting scheduler, hotel deals |
| 13 | **Screen 21 — Scanned Connection Intake & Rapid Lead Logger** · `0bc08435…` | Attendee | `ScanQRPage` "Add Context" step (note, relationship type, follow-up date) | `/scan` | Sidebar "Scan QR"; Event Mode scan/connect | Save → creates `connections` row + optional `notes` + follow-up date, then back to `/scan`. Open Full Dossier → `/connections/:id`. Discard/Rescan → `/scan` | **partial match** — a *step* of the scan flow (the design also lists it as its own sidebar item "Rapid Lead Logger") | **Ready:** `get_connect_profile`, `connections` insert, `notify_new_connection`, `notes` insert, `follow_up_date`. **Missing:** lead-score L1–L5 (no column), follow-up presets (UI only — maps to `follow_up_date`), "next action" types, AI summary / re-summarize, bullet observations (could be one note), voice memo |
| 14 | **Screen 20 — Badge Scanner & Instant Lead Capture** · `96aed465…` | Attendee | `ScanQRPage` + `components/ui/QRScanner.tsx` (jsQR camera scan, link entry) | `/scan` | Sidebar "Scan QR"; bottom-nav scan | Capture → same as #13. Upload/Quick Lookup → existing "Enter Profile Link" step | **partial match** | **Ready:** camera QR scan, link/ID entry, `get_connect_profile`. **Missing:** NFC tap mode (Web NFC — device-specific, **unverified** feasibility), OCR badge capture, VCF import, illumination toggle, "Recent Scans Today" (derivable from `connections.created_at`) |
| 15 | **Screen 08 — Event Attendee Directory (variant A, top-tabs)** · `32d93ab6…` | Attendee (registered) | `EventNetworkPage` (tabs attendees / connections; search) | `/events/:eventId/network` | Event Mode tile "Attendees"; bottom nav "Network" | Request 1-on-1 → no meetings backend. Chat → `create_direct_conversation` → `/events/:eventId/messages/:id` | **duplicate** of #18 | See #18 |
| 16 | **Screen 14 — Event Exhibitors & Sponsors Directory** · `25fa091e…` | Attendee (registered) | `EventExhibitorsPage` (search, cards) | `/events/:eventId/exhibitors` | Event Mode tile "Exhibitors" | Card → `/events/:eventId/exhibitors/:exhibitorId`. Book Booth Meeting / Pitch / Claim credits / Virtual Booth: no target | **partial match** | **Ready:** `get_event_exhibitors` (name, description, logo, industry, `booth`, website, linkedin). **Missing:** sponsor tiers (Diamond/Platinum/Gold — conflict §6), saved exhibitors, floor map, startup pavilion, PDF directory, "Claim AWS Credits". **Do not derive tiers from `event_partnerships`.** |
| 17 | **Screen 04 — Event Registration (variant A, "Rally Network" portal)** · `d4a41f69…` | Attendee | `EventDetailPage` register action (a one-click insert; no form) | `/events/:id` (no registration route) | Back to Event Details | Complete Free Registration → insert `event_registrations` → `/events/:id` (confirmed state). Cancel → back | **duplicate** of #23 | See #23 |
| 18 | **Screen 08 — Event Attendee Directory (variant B, Event Mode sidebar)** · `5000b2a1…` | Attendee (registered) | `EventNetworkPage` | `/events/:eventId/network` | As #15 | Card → `EventModeConnectFlow` / connection → `/events/:eventId/connections/:id`. Message → `/events/:eventId/messages/:id`. Scan Badge → `/scan` | **partial match** (recommended variant) | **Ready:** `event_attendee_directory` (registered-only; name, title, company, industry, location, photo, `already_connected`), `connect_with_event_attendee`. **Missing:** Sector/Role/Country filters (industry and location exist; role is free text), "Thesis match score/%" (no matching engine; `looking_for`/`can_offer` exist), "Checked-in on-site" segment and count (no RPC exposes others' check-in — §6), "Speakers & VIPs" segment, "Bookmarked" (no attendee bookmarks), saved views, Export Directory (§6), server pagination (RPC returns everyone) |
| 19 | **Screen 11 — My Event Schedule** · `5f98cb2a…` | Attendee (registered) | `EventMySchedulePage` | `/events/:eventId/schedule` | Event Mode home "My Schedule" link; drawer | Remove → `remove_event_session`. Session → `SessionDetailDialog`. Browse catalog → `/events/:eventId/agenda` | **partial match** | **Ready:** `get_my_event_schedule`. **Missing:** bilateral meeting items (Curated Bilateral Sync, meeting brief, reschedule, message host), pre-read deck attachments, PDF export, share itinerary, calendar sync, conflict banner |
| 20 | **Screen 18 — Connection CRM Dossier & Relationship Engine** · `07bd907a…` | Attendee (owner of the connection) | `ConnectionDetailPage` (977 lines; tabs overview / notes / meetings / history; notes, follow-ups, opportunities) | `/connections/:id` and `/events/:eventId/connections/:connectionId` | Connections list row; event-mode "connections" tab | Back → `/connections`. Create Opportunity → existing opportunity form (`opportunities`). Schedule Next Sync → follow-up (`follow_ups`). Log note → `notes` | **partial match** (closest existing match of all designs) | **Ready:** notes, follow-ups (with "Mark done"), opportunities (title, type, stage, value, expected close), history timeline, share contact. **Missing:** AI synergy/draft email, tags, relationship "strength", shared documents/contracts upload, voice memo, "Meetings" tab content (exists but empty: "No meetings tracked"), mutual network (§6), reminders beyond follow-up date |
| 21 | **Screen 12 — Event Speakers** · `1b9c8a9d…` | Attendee (registered) | `EventSpeakersPage` | `/events/:eventId/speakers` | Event Mode tile "Speakers" | Card → `/events/:eventId/speakers/:speakerId`. Add Session → `save_event_session`. VIP Portal / Deal Room → no target (`/deal-room` is a placeholder) | **partial match** | **Ready:** `get_event_speakers`, `get_event_speaker_sessions`. **Missing:** featured-keynote ordering flag (`display_order` only), VIP deal-room access, speaker directory PDF |
| 22 | **Screen 19 — My Digital Business Card & QR Pass** · `f2516d6e…` | Attendee | `ProfilePage` ("My QR Code", "Share Profile" cards), `PublicProfilePage` | `/profile`, `/p/:id` | Sidebar "My Profile"; drawer; event-mode "My Badge" | Copy Link → `/p/:id`. Export .vcf / wallets: no target | **partial match** (QR + link exist; "card persona" and recent-scans do not) | **Ready:** `profiles`, QR generation (`qrcode`), public share link, `PublicProfile` type. **Missing:** card personas, per-field "dynamic disclosures", recent scans of *my* QR (no scan log), vCard/wallet export. **Privacy:** public view deliberately omits email/phone (§6) |
| 23 | **Screen 04 — Event Registration (variant B, Rally Events shell)** · `11609335…` | Attendee | `EventDetailPage` register action | `/events/:id` | Back to Event Details | Complete → insert `event_registrations`; success state "You're Attending!" → View Pass (`/profile` QR) / Return to Events → `/events` | **partial match** (recommended variant; includes the success state) | **Ready:** registration insert (`event_id`, `user_id` only — column grants in `20260919150400`). **Missing:** pass selection (no tickets), attendee badge details, track/session interests, "Rally In-Person Networking Opt-in" (consent columns `share_contact`/`contact_*` exist but are **write-locked** until a reviewed design lands), Save Draft |
| 24 | **Event Details — Pre-Registration (Mobile)** · `8a960fc1…` | Attendee, not registered | `EventDetailPage` | `/events/:id` | As #5 | Claim Complimentary Pass → Register. VIP upgrade ($450): no target | **partial match** — the only mobile design; mobile *state* of #5 | As #5; also paid tiers (no pricing/payments) |
| 25 | **Screen 15 — Exhibitor Details & Booth Showcase** · `7a14a95b…` | Attendee (registered) | `ExhibitorDetailPage` (131 lines) | `/events/:eventId/exhibitors/:exhibitorId` | Exhibitor card | Back → `/events/:eventId/exhibitors`. Visit Portal → exhibitor `website`. Book meeting / Start Nav: no target | **partial match** | **Ready:** `get_event_exhibitors` fields only. **Missing:** products, live booth schedule, downloads, on-site representatives (would expose org members — §6), sponsor-exclusive offer, booth map |
| 26 | **Screen 03 — Event Details** · `5f78af5e…` | Attendee, registered | `EventDetailPage` | `/events/:id` | As #5 | Enter Event Mode → `/events/:id/home`. Explore Attendee Directory → `/events/:id/network`. View Full Schedule → `/events/:id/agenda` | **duplicate** of #5/#24 (registered state) | As #5. Plus Add to Calendar / wallet pass (none) |
| 27 | **Rally — Data Import Platform Landing Page** · project `6681074392350283230`, `5865b128…` | Developers / B2B buyers | None. Nearest: `MarketingHomePage` | `/` | — | — | **unclear — appears to be a different product** (customer-spreadsheet importer, "Book a Demo", API keys) not Rally events networking | None. Recommend excluding; confirm with the owner |
| 28 | **Extracted text from braemma1-rally-impor-g1an.bolt.host** · `15dd7ba1…` | — | — | — | — | — | **unclear** — no HTML, no screenshot (width 0) | Nothing to map |

Hidden Stitch instances (18, listed in `rally-event-ui/project.json`) were **not retrieved** and
are not mapped. They include an App Store listing and "App Store Assets.md", which are marketing
assets, not app screens.

---

## 3. Existing project pages with no Stitch design

These keep their current design until a design exists. They must not be restyled "to match" by
guesswork, but they will inherit new shared tokens/shells.

| Area | Pages / routes |
|---|---|
| Public & auth | `MarketingHomePage` `/`; `LoginPage`, `SignUpPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `AuthCallbackPage`; `PublicProfilePage` `/p/:id` (partly covered by #22); `AccountStatusPage` `/account` |
| Attendee, undesigned | `OnboardingPage` `/onboarding`; `FollowUpsPage` `/follow-ups`; `OpportunitiesPage` + `OpportunityDetailPage` `/opportunities[/:id]`; `MessagesInboxPage` + `ConversationPage` `/messages[/:conversationId]` (and event-scoped copies); `NotificationsPage` `/notifications`; `OrganizationInvitationsPage` `/invitations/organizations` |
| Event Mode placeholders | `EventComingSoonPage` serves `/events/:eventId/info`, `/events/:eventId/map`, `/events/:eventId/deal-room` — routes exist, no design, no content |
| Organizer area | `OrganizerDashboardPage`, `EventsListPage`, `EventFormPage`, `OrganizerEventDetailPage`, `PartnerDetailPage`, `PeoplePage`, `TeamPage`, `OrganizationSettingsPage`, `OrganizationSetupPage`, `MyInvitationsPage` |
| Sponsor workspace | `SponsorHomePage`, `SponsorPartnershipsPage` |
| Platform admin | all of `/admin/*` |

Design nav items **with no page today** (the designs' sidebar lists them; none is a route):
**My Notes** (no aggregate view; notes are per-connection — see §0.4 for the verified backend position), **Saved** (nothing saves events or
people), **Meetings & Deals** (opportunities exist; meetings do not), **Past Events**
(`/events?tab=past` already exists — a link, not a page), **Settings** (→ `/profile`),
**Rapid Lead Logger** (a step of `/scan`).

---

## 4. Designs that are tabs, dialogs or states — not separate routes

| Design | Belongs inside | As |
|---|---|---|
| #10 Session Details | `EventAgendaPage` / `EventMySchedulePage` | Existing `SessionDetailDialog` |
| #12 Registration Confirmation | `EventDetailPage` | Post-register state or dialog |
| #17 / #23 Event Registration | `EventDetailPage` | Registration sheet/dialog (today a one-click button) |
| #5 / #24 / #26 Event Details | `EventDetailPage` | Not-registered vs registered states (+ mobile layout) |
| #11 My Events | `EventsPage` | A "My events" filter beside the existing upcoming / past / invitations tabs |
| #13 Intake & Lead Logger | `ScanQRPage` | The existing "Add Context" step |
| #20 CRM Dossier "All Activity / Meetings / Notes" | `ConnectionDetailPage` | Existing tabs (overview / notes / meetings / history) |
| #2 Network "All / High Priority / Event / Type" chips | `ConnectionsPage` | Filter chips (partly existing filters) |
| #18 directory segments (All / Checked-in / Matches / Speakers / Bookmarked) | `EventNetworkPage` | Segmented filter (only "All" is backed today) |
| #6 / #19 "Day 1 / Day 2 / Day 3" | Agenda / My Schedule | Existing day tabs |
| #19 "Open Meeting Brief", "Acknowledge & Ready" | `EventMySchedulePage` | Modals (no backend) |
| #22 card "persona switcher", "privacy disclosures" | `ProfilePage` | Sections |

---

## 5. Shared layouts and components

### Layouts (the biggest decision — the designs contain several shells)

| Design shell | Used by | Existing counterpart |
|---|---|---|
| **A. "Rally Executive Hub" attendee sidebar** (Home, Events, Network 48, Messages, Follow-ups 3, Meetings & Deals 2, My Notes, Past Events, Saved, Profile & Settings; top bar: bell, user menu, "Sync CRM") | #2, #4, #20, #22 (+#13/#14 variant with "My Digital Card & QR / Badge Scanner / Rapid Lead Logger") | `AppLayout` (sidebar: Dashboard, Connections, Messages, Scan QR, Events, Follow-ups, Opportunities, Notifications, My Profile) |
| **B. "Rally — Events. People. Opportunities." attendee sidebar** (same items, lighter) | #3, #5, #11, #23, #26, #9 | `AppLayout` |
| **C. Event Mode sidebar** "Live Event Mode 2027" (Event Home, Attendee Directory, Agenda & Schedule, Speakers, Exhibitors & Sponsors; Home, All Events, Messages, Follow-ups, Meetings & Deals, My Notes; Exit Event Mode) | #7, #10, #18, #19 | `EventModeLayout` + `EventModeBottomNav` + `EventModeDrawer` |
| D. Event Mode top-bar + bottom bar (Stage / Agenda / scan / People / Venue) | #8 | `EventModeLayout` (bottom nav: Home, Network, Connect, Messages, More) |
| E. Event Mode sidebar "Live Stage / Schedule & Agenda / Exhibitors / Speakers & VIPs / Networking Lounge / My Badge / Event Info" | #16 | `EventModeLayout` |
| F. Event Mode sidebar "Main Stage Live / Agenda & Tracks / Exhibitors / Networking Hub / Floorplan" | #25 | `EventModeLayout` |
| G. Marketing-style top nav + footer (Overview / Schedule / Speakers / Sponsors / Deal Room) | #6, #21 | none — and none should be introduced inside the app |
| H. Standalone "Rally Network — Executive FinTech Portal" / "Rally" top-nav (Dashboard / Events / Community / Messages) | #17, #12 | none |

### Shared components the designs repeat

| Component | Where | Existing basis |
|---|---|---|
| Person/attendee row-card (avatar, name, title·company, tags, Message / Request sync / bookmark) | #2, #15, #18, #8, #4 | `Avatar`, `Card`, `Badge`; `EventNetworkPage` row |
| Segmented filter chips with counts + search + sort | #2, #3, #15, #18, #16 | tab/filter code inline in `ConnectionsPage`, `EventsPage`, `EventNetworkPage` (not shared) |
| Numbered pagination | #2, #3, #15, #18 | none in attendee pages (admin has `AdminPagination`) |
| Session card with time rail, track badge, Add/Remove | #6, #19, #10, #8 | `SessionRow` |
| Stat tile / KPI card | #9, #1, #8 | admin `StatCard` (admin-only); dashboard inline tiles |
| Speaker card, exhibitor card, logo grid | #21, #7, #16, #25 | cards in `EventSpeakersPage`, `EventExhibitorsPage` |
| Status pills ("Happening Now", "LIVE", "Starting in 35 mins") | #8, #6 | `Badge` |
| QR / badge pass card | #22, #8, #12, #23 | `ProfilePage` QR card |
| Page header with title + action buttons | nearly all | per-page markup |
| Right rail widgets (calendar, next steps, pulse) | #9, #1, #8 | none |
| Top bar: global search, bell with count, user menu | A, B | `AppLayout` header, `GlobalSearchDialog`, `NotificationContext` |
| Dialog / bottom sheet | #10, #19, #13 | `SheetDialog` is organizer-scoped; attendee uses inline dialogs |

---

## 6. Conflicts

### 6a. Conflicting design variants and recommendations

| Conflict | Recommendation |
|---|---|
| **Three dashboard designs** (#9 refined desktop, #1 dark-sidebar with calendar, plus the existing page) | Use #9 as the visual reference; keep today's data (connections, follow-ups, events, opportunities). Take nothing from #1 that needs meetings, Pro or charts. |
| **Two attendee shells, A vs B** (labels "Rally Executive Hub" vs "Events. People. Opportunities.") | Pick **B's branding with A's information architecture**; the product name in the repo is "Rally". One shell, one nav. Never ship both. |
| **Nav items with no backing page** (Meetings & Deals, My Notes, Saved) | Do not add dead links. Map: Network → `/connections`, Events → `/events`, Past Events → `/events?tab=past`, Follow-ups → `/follow-ups`, Messages → `/messages`, Meetings & Deals → `/opportunities` (rename decision needed), Profile & Settings → `/profile`. Hide My Notes / Saved until they exist (Phase 3). |
| **Four Event Mode shells** (C, D, E, F) | Use **C** (Event Navigation: Event Home, Attendee Directory, Agenda & Schedule, Speakers, Exhibitors) — it is the one that maps one-to-one onto the existing `EventModeLayout` routes (`home`, `network`, `agenda`, `speakers`, `exhibitors`, `schedule`, `messages`, `info`, `map`, `deal-room`). Keep the existing mobile bottom nav. |
| **Directory ×2** (#15 top-tabs "Agenda/Directory/Meetings/Venues/Floor Plan"; #18 Event Mode sidebar) | **#18.** #15's tab strip invents Meetings/Venues/Floor Plan pages that do not exist. |
| **Registration ×2** (#17 standalone portal with Save Draft; #23 in-shell with success state) | **#23.** #17 introduces a separate portal shell and drafts (no table). Either way, only fields the backend accepts today may be submitted (`event_id`, `user_id`). |
| **Event Details ×3** (#5 pre-registration, #26 registered, #24 mobile) | One `EventDetailPage` with two states; #24 is the mobile reference for both. #5 and #26 differ in event, not in design — treat as the same layout. |
| **#10 shown as a full page** (route-like) while the app uses a dialog | Keep it a dialog (it is not a navigable page in the app and would otherwise need a new route and Q&A/poll backends). |
| **Exhibitors page: "Exhibitors & Sponsors"** (#16) vs app's exhibitors-only | Keep exhibitors-only until a *public sponsor listing* is explicitly designed (§6b-1). |

### 6b. Design elements that conflict with security, permissions or existing behaviour

1. **Sponsor tiers / "Diamond–Platinum–Gold", "Founding Sponsors", "Backed by Industry Leaders" (#16, #5, #24, #26)** —
   tier and package data is organizer-private (CLAUDE.md §4; the package library has no sponsor
   or attendee read path). Attendee pages must not read `event_partnerships`. A public sponsor
   display would need a deliberate, separate public-facing field added by a reviewed migration.
   **Needs owner decision; default = omit tiers.**
2. **Mutual connections, "Request Warm Intro via Kwame" (#4, #7, #20)** — `connections` is
   owner-only under RLS. Showing someone else's contacts would need a new consent-aware RPC.
   Default = omit.
3. **"Checked-In On-Site (1,240)", "Delegates In Your Room / Ping" (#18, #8)** — nothing exposes
   other people's check-in state or location, and presence of individuals is a privacy decision.
   At most an aggregate count RPC; default = omit.
4. **Contact details on the digital card and elsewhere (#22, #4, #20)** — `PublicProfile`
   deliberately omits email and phone, and `event_registrations` consent columns
   (`share_contact`, `contact_email`, `contact_phone`) are write-locked. The public card
   (`/p/:id`, QR) must stay within `PublicProfile`; email/phone only through the existing
   deliberate-exchange flow (`get_connect_profile`).
5. **Exports (#2 CSV, #18 "Export Directory", #16 "Download Directory (PDF)", #22 `.vcf`)** —
   exporting *other people's* directory data is not supported and should not be built.
   Exporting the user's *own* connections is technically feasible client-side but is a
   product/privacy decision.
6. **On-site representatives, "Contact booth team" (#25)** — would expose organization members
   to attendees; `organization_members` is readable only under its member-scoped RLS policy (`select_org_members`). Default = omit.
7. **Role gating the designs imply** — "VIP Deal Room", "Observer Pass", "Pitch Your Startup",
   "Speaker Protocol Office": no VIP/role model exists. `vendor` and `sponsor` account types
   have no attendee access at all (`RequireAccount(isActiveAttendee)`), so a vendor/exhibitor
   cannot use #16/#25 "booth" features as designed.
8. **Billing and tiers** — "Upgrade to Pro", "Upgrade Plan", "Upgrade to VIP Deal Maker ($450)",
   paid passes: no payments or ticket model. Omit.
9. **AI and third-party integrations** — "AI Thesis Synergy", "Draft Email with AI",
   "Re-summarize", Salesforce/HubSpot/Google/Outlook sync, Apple/Google Wallet: no backend, and
   sending personal notes to an AI service is a privacy decision. Omit until decided.
10. **Registration extras** — pass selection, interests, networking opt-in, Save Draft: columns
    and tables do not exist; the opt-in touches the locked consent columns.
11. **Admin partnership privacy** — no design touches `/admin`, and nothing in this mapping adds
    admin routes or reads. Keep it that way: no attendee-facing screen may call
    `admin_*` functions, and no new screen may call `admin_list_partnerships` (revoked for every
    client role including `service_role`).
12. **Preserve existing functionality** — the designs' sidebars omit **Scan QR**, **Opportunities**
    and **Notifications** as top-level items. Those pages and their data must stay reachable.
    The organizer-workspace switch links in `AppLayout` (for attendees who are org members) must
    also be preserved.

---

## 7. Implementation order

Principle: shared shell and tokens first; then pages whose data already works; each phase a set of
small PRs (one concern each, per CLAUDE.md §8). No phase changes authorization.

### Phase 1 — existing routes, working data (no backend change)

Order matters: build the foundations before any page.

| Step | Work | Notes |
|---|---|---|
| 1.0 | **Tokens** — add Plus Jakarta Sans to `index.html` and Tailwind `fontFamily`; extend surface colours only if needed. | Keep `primary-600 = #0A66C2`. |
| 1.1 | **Attendee shell** — restyle `AppLayout` nav/header to the chosen shell (§6a); keep every current item and the organizer-workspace links; map labels per §6a. | No new routes, no dead links. |
| 1.2 | **Event Mode shell** — restyle `EventModeLayout` toward shell C; keep the mobile bottom nav. | |
| 1.3 | **Shared components** — `PageHeader`, `FilterChips`/segmented control, `PersonCard`, `StatTile`, `StatusPill`; reuse `Card`, `Badge`, `Avatar`, `Button`, `States`. | Extract from `ConnectionsPage`/`EventsPage`/`EventNetworkPage`; do not copy the admin components. |
| 1.4 | `/dashboard` — #9 | Existing data only; drop meetings/Pro/chart. |
| 1.5 | `/events` — #3 and #11 (My events view) | Existing tabs; no category chips. |
| 1.6 | `/events/:id` — #5, #26, #24 (+ #12/#23 confirmation state) | Registration stays a one-click insert. |
| 1.7 | `/events/:eventId/home` — #8 | Tiles and now/next only. |
| 1.8 | `/events/:eventId/agenda` + `SessionDetailDialog` — #6, #10 | Existing bookmarks and speakers. |
| 1.9 | `/events/:eventId/schedule` — #19 | Existing sessions only. |
| 1.10 | `/events/:eventId/speakers[/:id]` — #21, #7 | |
| 1.11 | `/events/:eventId/exhibitors[/:id]` — #16, #25 | Exhibitors only; no tiers. |
| 1.12 | `/events/:eventId/network` — #18 | Search + industry/location filter only. |
| 1.13 | `/connections` — #2 | Existing filters; no tags/CRM/export. |
| 1.14 | `/connections/:id` — #20 | Notes, follow-ups, opportunities, history. |
| 1.15 | `/profile` QR card — #22 | Public card fields only. |
| 1.16 | `/scan` — #14, #13 | Camera/link scan + the existing context step. |

### Phase 2 — existing routes that need additional functionality
Each needs a reviewed backend design first; none is started by Phase 1.

| Item | Needs |
|---|---|
| Event categories + saved events (#3, #11) | `events` category/tags column; saved-events table + RLS |
| Real registration form (#17/#23) | Ticket/pass model, interests, consent opt-in via a reviewed path to the locked consent columns |
| Connection tags, priority, lead score (#2, #13, #20) | Columns/tables on `connections` (owner-scoped) |
| Directory filters beyond industry/location; match score (#18) | Role/sector taxonomy; matching approach (`looking_for`/`can_offer`) |
| Live Q&A, polls, collaborative notes (#10) | New tables + moderation |
| Event announcements on Event Mode home (#8) | Confirm/extend the broadcast mechanism for attendees |
| Meetings/bilateral requests and "Upcoming Meetings" (#4, #7, #9, #19, #25) | A meetings model (shared by several designs — design it once) |
| Calendar export, PDF agenda/ticket (#6, #12, #19) | Client-side `.ics`/PDF is feasible without a backend; wallets are not |
| Sponsor display on exhibitors/event pages (#16, #5) | A public-facing sponsor field — owner decision (§6b-1) |
| Placeholder routes `/events/:eventId/info`, `/events/:eventId/map`, `/events/:eventId/deal-room` | Content models; no designs yet |

### Phase 3 — new pages and routes (none created yet)

| Page | Basis |
|---|---|
| In-event attendee profile (#4) — *proposed* `/events/:eventId/attendees/:userId` | `get_public_profile`, `connect_with_event_attendee`; no mutual connections |
| My Notes (design nav) | Read-only aggregate of the user's existing connection notes is possible with today's RLS; standalone notes are **not** (see §0.4). Needs a route and a design |
| Saved (design nav) | Needs Phase 2 saved-events/people storage |
| Meetings & Deals (design nav) | Needs the Phase 2 meetings model; deals = `/opportunities` |
| Dedicated "Rapid Lead Logger" and standalone "My Digital Card" routes (#13, #22) | Only if the owner wants them outside `/scan` and `/profile` |

---

## 8. Questions for the owner

1. **Which shell/branding** — "Rally Executive Hub" or "Rally Events. People. Opportunities."? (§6a recommends B's brand with A's IA.)
2. **Meetings & Deals** — rename `/opportunities`, or is a separate meetings feature intended?
3. **Sponsor visibility to attendees** — omit tiers, or approve a public sponsor field?
4. **Own-data CSV/.vcf export** — wanted, and if so scoped to the user's own connections only?
5. **Rally Data Import Platform landing page** (#27) — is it part of this product, or a stray project?
6. **Hidden Stitch instances** — fetch them, or leave them out?
7. **Mobile designs** — only one exists; should mobile layouts be designed in Stitch first, or derived from the existing mobile-first components?

---

## 9. Future work recorded during Phase 1

- **Server-side pagination for `/events`.** Batch 1 paginates client-side (6 per page, `?page=` in the URL):
  `EventsPage` loads every event, every registration and every count in one request, then slices.
  That is acceptable at today's volume. When the event list grows, move to a paged query
  (`.range()` with a total count) and a paged `get_event_registration_counts` call, keep the same
  `?page=` contract, and move search and sort server-side so the footer total stays correct.
- The same client-side approach applies to the attendee directory (`event_attendee_directory` returns every
  registered attendee); it will need the same treatment before directory pagination ships.
- Registration / invitation failures on `/events` are shown inline (`role="alert"`). Other attendee pages still
  replace the whole page on an action error; align them when each is restyled.

---

## 10. Stitch revisit — 2026-10-23 (five new screens)

Project "Rally Event UI" now has 31 screen instances. Five are new since the first retrieval.
Files 27-30 are saved in `design-reference/stitch/rally-event-ui/screens/`; Screen 25 (Messages)
was reviewed from the fetched HTML but its file was not persisted (response was returned inline).

| Stitch screen | Existing route | Backend today | Notes |
| --- | --- | --- | --- |
| 22 Follow-ups Hub | `/follow-ups` | follow-up dates on connections | Pipeline value, velocity %, AI batch draft, Google/Outlook sync, delegation: no backend, omit or "Coming soon" |
| 23 Meetings & Bilaterals Hub | none | none | Needs a meetings table; whole screen is "Coming soon" until backend exists |
| 24 Opportunities & Deals Pipeline | `/opportunities` | opportunities table | Kanban/list can use real stages; $ forecast, probability, HubSpot/SFDC export: only if fields exist |
| 25 Messages & Direct Chat | `/messages` | direct conversations | 3-pane layout; AI quick replies, video call, document vault, "AI thesis match %": omit |
| 26 My Notes & Knowledge Base | none (notes are per connection) | connection notes only | Voice memos, transcripts, AI synthesizer: omit; a cross-connection notes list is possible |

Designs use a "Rally Executive Hub" shell (Home, Events, Network, Digital Card, Badge Scanner, Rapid
Lead Logger, Messages, Follow-ups, Meetings & Deals, My Notes, Past Events, Saved) and a "RALLY PRO"
tier card; neither exists in the product. Still without any design: Notifications, Onboarding,
organizer, sponsor and admin surfaces.
