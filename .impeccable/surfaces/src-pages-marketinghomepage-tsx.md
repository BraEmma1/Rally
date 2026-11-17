---
version: 1
slug: "src-pages-marketinghomepage-tsx"
primary_target: "src/pages/MarketingHomePage.tsx"
related_targets: []
---

# Surface brief: public landing page (`/`, signed out)

Mode: Persuade. Audience order: organizers first, then attendees, then sponsors/exhibitors.
Job: make an organizer want to run their next event on Rally, and show attendees why
it is worth joining. Actions: create an organizer account (`/signup?type=organizer`),
join as an attendee (`/signup`), log in (`/login`). No demo form, no invented proof.
Proof: real Rally screens captured against the stubbed API with fictional sample data
(labelled as such), licensed event photography (Pexels, Pavel Danilyuk shoot), and an
honest "in Rally today / not yet" ledger.
Constraints: blue/navy brand kept; no customers, logos, metrics or testimonials; planned
features (map, deal room, info, meetings, ticket sales) never shown as available.

## Direction contract

THESIS: The page is a hand of business cards dealt on a navy table: every connection
Rally records is a card that keeps its back (where you met, what was said, what is
next), and the event the organizer runs is the table they land on. It refuses the
centred headline over a floating dashboard and the row of equal icon cards.

OWN-WORLD: Navy table ground #0B2554 (deeper #081C42 at the footer); cool white card
stock #FFFFFF / #F5F7FB at true business-card proportion with 3px corners and a 4px
brand-blue painted edge; depth only from overlap and the painted edge, no drop
shadows; brand blue #0A66C2 reserved for the one element in focus; real screens shown
as proof prints on card-stock mats with printer's crop marks and a slug caption;
Schibsted Grotesk display, Inter text.

STORY: An organizer sees the event they run and the connections it creates on one
surface, follows registration, door check-in, programme, team and partners through
real screens, sees what attendees and sponsors get from the same event, reads exactly
what is live today, and creates an organizer account.

FIRST VIEWPORT: 1440x900, nav row on navy (wordmark, four anchors, Log in, blue
"Create organizer account"). Left six columns: three-line display headline "Run the
event. Keep every connection it makes." around 84px, a two-sentence subhead, blue
primary + white secondary action. Right six columns: a portrait event photograph
mounted as a print at -3deg, an event card and a person card dealt over its lower
edge; the person card turns over to its back (Met at / Note / Follow up). A wide proof
print of the real organizer event workspace rises from the bottom edge.

FORM: assigned direction "The Card Exchange", position 5 of 7 on the grounded list;
seed:3ce91d3ec860f6df. Signature interaction: the card turn (front to back), keyboard
operable, in the hero and the connection story only. Motion grammar: cards are dealt
(translate + small rotation settling with exponential ease-out) from an already-visible
default; the organizer story deals each new proof print over the last, the active step
darkest (recency is density). Raises kept: overlap-only depth (papercut); blue only on
focus (poster); recency is density (ink basin); one product truth per section (six-
pack); dated ledger of what is live (shrine). Reduced motion: no turn or deal animation.

ADAPTATIONS (cited, after the first finish review): the headline sets in four lines at 1440
("Run the event. / Keep every / connection / it makes.") because a three-line set needs ~830px
of copy column and would starve the dealt hand; the nav's "Create organizer account" is white
card stock, not blue, under the "blue only on focus" raise, so each viewport's blue belongs to
its own primary action; the person card sits on the table below the photo, never over it
(Pexels: a named card over a face reads as naming that person a Rally user); the white
"sheets" carry no painted edge, which belongs to card stock alone.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
