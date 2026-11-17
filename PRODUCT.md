# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Event organizers** (primary audience for acquisition): people and organizations
  running conferences, seminars, exhibitions and professional gatherings. They work in an
  organizer organization with a team of owners, admins and event managers (managers are
  scoped to the events assigned to them).
- **Attendees**: professionals who register for events and, through Rally, meet people
  there and keep those relationships going afterwards.
- **Sponsors and exhibitors**: organizations that fund events or take booths. Sponsors work
  in a sponsor workspace that opens only after they accept a partnership invitation from an
  organizer.
- **Platform admins** approve accounts and organizations. Not a marketing audience.

## Product Purpose

Rally turns event attendance into tracked professional relationships. Organizers run the
event on Rally; attendees meet one another through it; what happens to those connections
after the event is the point. Product thesis (from CLAUDE.md): the value of an event is
not the event, it is what happens to the connections afterwards.

## Positioning

One record joins the organizer's operations to the attendee's network. The same event that
an organizer publishes, registers and checks people into becomes the context attached to
every connection an attendee makes there, so a contact is remembered as "met at X" and
carried into notes, follow-ups and opportunities. Neighboring ticketing tools stop at the
door; contact apps never knew there was an event.

## Operating Context

- Organizer flow (verified in code): create an organization (account needs admin approval),
  create events (draft, published or unlisted), build a registration form (five question
  kinds), set capacity with an automatic waitlist, manage the attendee list, check people
  in at the door (with undo), build the agenda with sessions and speakers, list
  exhibitors, assign event managers, and manage partnerships (packages, obligations with
  evidence, shared and internal documents). Per-event networking analytics.
- Attendee flow (verified): discover and register for events, Event Mode for a live event
  (home, agenda, my schedule, speakers, exhibitors, attendee network, messages), connect by
  QR scan or connection request (30-day cool-off after a decline), connection detail with
  notes, follow-ups, opportunities pipeline, realtime messaging, notifications, .ics
  calendar export, public profile at /p/:id.
- Sponsor flow: the sponsor home and partnerships list exist, but there is no working way for a
  sponsor to accept a partnership yet (no in-app acceptance screen; the invitation email links to a
  missing /partner route). Treat the sponsor workspace as not yet available.

## Capabilities and Constraints

- Planned, not available (must not be marketed as live): Event Mode "Info", "Map" and
  "Deal room" render a coming-soon page. Meetings, saved events/people, event categories,
  tickets/passes, Q&A/polls, standalone notes, CSV/vCard export do not exist.
- Sponsor invitation emails currently deep-link to a missing /partner route (known issue).
- There is no public, signed-out event discovery page: /events requires an attendee account.
- Signup: /signup (attendee) and /signup?type=organizer. Organizer accounts start pending
  admin approval. /login for both.
- No payment or ticket sales.

## Brand Commitments

- Name: Rally. Brand blue `#0A66C2` with deep navy `#0B2554`; tagline in use inside the app:
  "Events. People. Opportunities."
- The landing page must keep the blue/navy palette recognizable (owner brief, 2026-11-17).

## Evidence on Hand

- The real application UI, capturable locally against the stubbed Supabase API with
  synthetic fixtures (the method in tests/browser). Owner-approved 2026-11-17. No real
  data, no credentials, no database writes.
- No customers, testimonials, partner logos, user counts or metrics exist. Never invent
  them. `public/partner-*.webp` are not evidence of real partners.
- No contact address, demo-request process, pricing or legal policies exist. Do not invent
  them; the old homepage's demo form submitted nowhere and was removed (owner decision).
- Photography: free-licence stock (Unsplash/Pexels), self-hosted, provenance recorded.

## Product Principles

1. Truth over polish: never show a success state, metric or control that does not work.
2. Privacy is a feature: public surfaces omit email, phone and organizer-private data.
3. The connection carries its context: where you met is part of the relationship.
4. Organizers and attendees are served by the same event, not two products.
