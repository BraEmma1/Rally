---
name: Rally (public landing)
description: The signed-out landing page, set as a hand of business cards dealt on a navy table.
colors:
  table: "#0b2554"
  table-deep: "#081c42"
  table-raise: "#12306a"
  table-line: "rgba(201, 214, 234, 0.18)"
  on-table: "#ffffff"
  on-table-2: "#c3d1ea"
  on-table-3: "#93a7cb"
  stock: "#ffffff"
  stock-2: "#f3f6fb"
  stock-3: "#e6edf7"
  ink: "#0b2554"
  ink-2: "#364766"
  ink-3: "#5a6a86"
  line: "#d9e1ec"
  blue: "#0a66c2"
  blue-hover: "#0b70d4"
  blue-deep: "#08529d"
  blue-light: "#7db8f2"
  status-live: "#10b981"
typography:
  display:
    fontFamily: "'Schibsted Grotesk', 'Inter', system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 1.2rem + 4.4vw, 5rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "'Schibsted Grotesk', 'Inter', system-ui, sans-serif"
    fontSize: "clamp(2rem, 1.1rem + 2.7vw, 3.6rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  title:
    fontFamily: "'Schibsted Grotesk', 'Inter', system-ui, sans-serif"
    fontSize: "clamp(1.2rem, 1.05rem + 0.45vw, 1.45rem)"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  lede:
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.06rem, 0.98rem + 0.3vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  fine:
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: "'Schibsted Grotesk', 'Inter', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    letterSpacing: "-0.005em"
  card-label:
    fontFamily: "'Schibsted Grotesk', 'Inter', system-ui, sans-serif"
    fontSize: "max(0.66rem, 3.1cqi)"
    fontWeight: 650
    letterSpacing: "0.08em"
  slug:
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.78rem"
    fontWeight: 400
    letterSpacing: "0.02em"
rounded:
  screen: "2px"
  print: "3px"
  card: "4px"
  sheet: "5px"
  phone-screen: "9px"
  phone: "14px"
spacing:
  gutter: "clamp(16px, 4.4vw, 64px)"
  max: "1280px"
  actions: "12px"
  head: "20px"
  copy-stack: "28px"
  sheet-y: "clamp(56px, 8vw, 128px)"
  section-y: "clamp(80px, 11vw, 168px)"
  head-after: "clamp(40px, 6vw, 80px)"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.on-table}"
    typography: "{typography.button}"
    rounded: "{rounded.card}"
    padding: "12px 22px 15px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.blue-hover}"
  button-card:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.card}"
    padding: "12px 22px 15px"
    height: "48px"
  button-line:
    backgroundColor: "transparent"
    textColor: "{colors.on-table}"
    typography: "{typography.button}"
    rounded: "{rounded.card}"
    padding: "12px 22px"
    height: "48px"
  card:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "clamp(14px, 1.6vw, 22px)"
  card-on-sheet:
    backgroundColor: "{colors.stock-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  card-active:
    backgroundColor: "{colors.table}"
    textColor: "{colors.on-table}"
    rounded: "{rounded.card}"
  turn-button:
    textColor: "{colors.on-table}"
    rounded: "{rounded.print}"
    padding: "8px 14px 8px 12px"
    height: "40px"
  print-mat:
    backgroundColor: "{colors.stock}"
    rounded: "{rounded.print}"
    padding: "clamp(6px, 0.9vw, 12px)"
  sheet:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "clamp(56px, 8vw, 128px) 0"
  nav-link:
    textColor: "{colors.on-table-2}"
    rounded: "{rounded.print}"
    padding: "8px 12px"
---

# Design System: Rally (public landing)

> **Scope.** This file documents the **public, signed-out landing page only** (`/`, built in `src/pages/MarketingHomePage.tsx` and `src/components/landing/`, every rule scoped under the `.rl` root class). The signed-in application (dashboard, organizer, attendee, sponsor and admin screens) has its own older visual system: the Tailwind `primary` / `accent` / `success` / `warning` / `error` scales in `tailwind.config.js`, Plus Jakarta Sans, and the guidance in `design-reference/stitch/rally-event-ui/design-system.md`. This build did not change that system. **Do not apply the card-table world below to app screens**, and do not read the app's tokens as part of this one. The two share only the brand pair (blue `#0A66C2`, navy `#0B2554`).

## Overview

**Creative North Star: "The Card Exchange"**

The landing page is a hand of business cards dealt on a navy table. The event an organizer runs is the table; every connection Rally records is a card with a back to it, where you met, what was said and what comes next. Real product screens appear as proof prints on card-stock mats, with printer's crop marks and a slug naming the screen they come from. Event photography is mounted like a print, white border and all.

The material is paper on a surface. Depth comes only from objects lapping over one another, from small rotations, and from the painted band along the bottom edge of card stock; nothing floats on a drop shadow. Large white "sheets" of stock are laid over the navy table to carry whole sections, and the hero's proof print rises from under the first sheet. Density is moderate and editorial: big Schibsted Grotesk headlines, short ledes, generous section spacing, and every section built around one object (a hand, a stack of prints, a fan of phones, a ledger).

Motion is dealing. Cards arrive with a short translate and a small rotation that settles on a long exponential ease-out, always from a state that is already visible, and the signature interaction is the card turn: the person card flips front to back, operable by keyboard.

**Key Characteristics:**
- Navy table ground, white and cool-tinted card stock laid over it.
- Business cards at true 1.75:1 proportion with a painted blue edge band.
- Depth from overlap, rotation and the painted edge; no drop shadows.
- Brand blue fills only the primary action of a viewport or the element in focus.
- Real screens shown as proof prints with crop marks and a slug caption.
- The card turn and the deal as the only motion vocabulary.

## Colors

Two grounds (navy table, white stock) each with their own three-step text ramp, and one brand blue used sparingly.

### Primary
- **Rally Blue** (`blue`): the fill of the one primary action in a viewport ("Create organizer account", "Join as an attendee"), the painted edge band on business cards, text links on white sheets, the check marks in the "in Rally today" ledger, and text selection. Hover lightens to `blue-hover`.
- **Pressed Blue** (`blue-deep`): the painted band under a primary button and the wordmark tile, and the initials in a person card's avatar.
- **Focus Blue** (`blue-light`): the 2px focus outline on the navy table (on white sheets the outline switches to `blue`).

### Neutral (the table)
- **Table Navy** (`table`): the page ground; also the face of the active card in the "how it works" hand.
- **Under-table Navy** (`table-deep`): the footer and the scrollbar track.
- **Raised Navy** (`table-raise`): reserved for a navy-faced card; defined but not used by any shipped element.
- **Table Rule** (`table-line`): hairline dividers on navy (story steps, nav border once scrolled, footer).
- **On-table text** (`on-table`, `on-table-2`, `on-table-3`): headline white, body and lede, then fine print, slugs and inactive story steps.

### Neutral (the stock)
- **Card Stock** (`stock`): cards, sheets, photo and print mats, the secondary nav button.
- **Tinted Stock** (`stock-2`): cards and print mats when they sit on a white sheet, the phone mats, the "not in Rally yet" ledger panel.
- **Card Edge Stock** (`stock-3`): the painted edge of a card-stock button, the inactive cards in the dealt hand, avatar fill, the turn button on sheets.
- **Ink** (`ink`, `ink-2`, `ink-3`): text on stock, in three steps; `ink` is the same navy as the table.
- **Stock Rule** (`line`): hairlines on white sheets and the drawn edge of tinted stock.

### Status
- **Live Green** (`status-live`): only the 7px dot before a status phrase on a card ("Registration open", "Checked in").

### Named Rules
**The One Blue Fill Rule.** Brand blue fills one thing per viewport: that viewport's primary action, or the active element. The nav's "Create organizer account" is white card stock, not blue, so the hero's blue button owns the first viewport. Small blue ink (edge bands, links, ledger checks) is allowed; a second blue fill is not.

**The Painted Edge Rule.** The blue band belongs to card stock (business cards, buttons, the wordmark tile). Sheets, photos and print mats never carry it.

## Typography

**Display Font:** Schibsted Grotesk (with Inter, system-ui fallback)
**Body Font:** Inter (with system-ui, -apple-system, Segoe UI fallback)

**Character:** A dense, slightly condensed grotesk set tight and heavy for headlines and card faces, over a neutral Inter for reading. Both load from Google Fonts in `index.html`; Schibsted Grotesk 500 to 800, Inter 400 to 700.

### Hierarchy
- **Display** (700, fluid to 5rem, 0.98): the hero headline; the closing headline reuses it at a smaller clamp. At 1440 the hero sets in four lines by design.
- **Headline** (700, fluid to 3.6rem, 1.02): one per section.
- **Title** (650, fluid to 1.45rem, 1.2): story step heads and sub-heads.
- **Lede** (400, fluid to 1.25rem, 1.55, max 38 to 40ch): the sentence or two under a headline.
- **Body** (400, 1rem, 1.6, max 46ch): running copy.
- **Fine** (400, 0.875rem, 1.5): approval notes, "Already on Rally?" lines.
- **Card label** (650, uppercase, 0.08em, container-relative): the field labels printed on a card ("Event", "Met at", "Name"), the back-of-card terms, and footer column heads. They are card fields, not section kickers.
- **Slug** (0.78rem, 0.02em, first item 600): the caption under a proof print naming the screen.

Card faces size type in container units (`cqi`) with rem floors, so a card reads the same at any width.

### Named Rules
**The Card Field Rule.** Uppercase tracked labels live on cards, card backs and the footer only. Never put one above a section headline.

## Layout

A centered wrap of `max` width inside a fluid `gutter` (16px at phone width). Sections alternate between the navy table (`section-y` padding) and white sheets laid on it (`sheet-y` padding, inset from the viewport by 8 to 24px, 6px on phones). The first sheet pulls up over the hero (`margin-top: clamp(-260px, -18vw, -72px)`) so the hero's proof print appears to rise from under it.

Section heads are a headline plus lede, sometimes split into two columns (headline left, lede right, aligned to the baseline). Content layouts are asymmetric two-column grids (roughly 1:1, 0.8:1.2, 1.3:0.7), never a row of equal tiles. Repeated objects are dealt as one hand instead: at 1024px and up the four "how it works" cards lap 30% over each other and step down 18px each; the three phones fan at -3, 0 and 3 degrees.

Responsive: below 1024px every two-column grid stacks, the nav collapses to a toggle panel, and dealt hands become horizontal scroll-snap rows that bleed to the viewport edge. Below 640px the hero hand re-proportions, crop marks are hidden, full-width actions stretch, and wide proof prints swap to phone captures.

## Elevation & Depth

There are no drop shadows. Depth comes from three things only: overlap (z-order within a hand, sheets over the table), small rotations (between -4.5 and 4.5 degrees on cards, photos and prints), and the painted edge band. Where white stock sits on a white sheet, its edge is drawn with an inset 1px `line` hairline and a `stock-2` face. The sticky nav uses 94% navy with a 10px backdrop blur and gains a `table-line` border once scrolled.

### Named Rules
**The Papercut Rule.** Nothing casts a shadow. If an object needs separating, lap it over its neighbor, rotate it, tint its face, or draw its edge with an inset hairline.

**The Recency Rule.** In a stack, the newest object is on top and darkest; earlier ones fade (the organizer story's previous print sits at 38% opacity, its steps dim to `on-table-3`).

## Shapes

Small, paper-true corners: 2px on screen captures inside a mat, 3px on photo and print mats, nav links and the turn button, 4px on cards, buttons, the wordmark tile and the ledger panel, 5px on sheets. Phone prints are the one rounded form (14px mat, 9px screen). Business cards hold a 1.75:1 aspect ratio; photographs crop to 4:5 or 5:4; wide prints to 3:2 or the capture's own ratio. Crop marks are 16px L-shaped hairlines set 22px outside each corner of a print mat.

## Components

### Buttons
Small cards with a painted edge.
- **Shape:** card corners (4px), at least 48px tall, 18px trailing icon that nudges 3px right on hover.
- **Primary:** Rally Blue face with a 3px `blue-deep` band painted along the bottom (a background gradient, so it follows the corner); white Schibsted label. Hover lifts 1px and lightens; press drops 1px and thins the band to 1px.
- **Card (secondary on navy):** white stock face with a 3px `stock-3` band; hover lifts 1px and the band turns blue. Used for the nav's account action.
- **Line (tertiary):** transparent with an inset 1.5px white ring at 55%; full white on hover. On sheets the ring and label become `ink`.
- **Text link:** 600 weight, 1.5px underline at 4px offset, underline at 40% until hover; blue on sheets.

### Business Card (signature)
- **Shape:** 1.75:1, 4px corners, 5px painted band along the bottom in `blue` (each card can override the band color).
- **Face:** three-row grid: uppercase card label, a title in Schibsted 700, then a foot with a status pill or meta line. Type scales with the card's width.
- **On a sheet:** `stock-2` face with an inset `line` hairline.
- **In the dealt hand:** inactive cards use `stock-3`; the active one turns navy with on-table text, straightens to 0 degrees and lifts 6px.

### The Card Turn (signature)
A person card with a front (name, role, a real scannable QR code) and a back (Met at, Note, Follow up). A "Turn over" button below the card flips it on the Y axis (900ms). The hero card turns once on its own after 2.2s unless touched; the hidden face is `aria-hidden`. Reduced motion: no flip transition, and no auto-turn.

### Proof Print (signature)
A real Rally screen on a white stock mat (3px corners), a 1px `line` border around the capture, four crop marks outside the corners, and a slug caption below whose first item names the screen. On a sheet the mat tints to `stock-2`. A phone variant uses 14px corners. Below 640px, prints with a phone capture swap to it.

### Photo Print
Event photography on a white mat (6 to 11px border, 3px corners), rotated slightly. A named person card is never laid over a photographed face.

### Sheet
A large panel of white stock laid on the table, inset from the viewport edge, 5px corners, no painted band and no shadow.

### Navigation
Sticky, 72px tall (64px below 1024px), 94% navy with backdrop blur. Wordmark in Schibsted 800 beside a 32px blue tile with a painted band. Four anchor links in `on-table-2` at 0.94rem, 3px corners, a 7% white wash on hover. Right side: a "Log in" text link and the card-stock account button. Below 1024px a 48px toggle opens a full-width panel of 52px rows in Schibsted 600 and stacked full-width actions (blue primary first).

### Ledger
Two lists with a 2px `ink` rule under each heading and `line` hairlines between rows; blue check icons for what is live, an `ink-3` mark on a `stock-2` panel for what is not yet.

### Motion
One easing, `cubic-bezier(0.16, 1, 0.3, 1)`. Below-the-fold elements are dealt: they wait 48px low, rotated about 3 degrees, nearly transparent, and settle over 1000ms (opacity 600ms), staggered per item. Hero cards are dealt in on load from 60px right, 120px down and 14 degrees. Every dealt element is visible without JavaScript. Under `prefers-reduced-motion: reduce` there is no deal, no intro, no turn transition and no stack transition.

## Do's and Don'ts

### Do:
- **Do** keep every new landing element inside the `.rl` root and its tokens.
- **Do** give card stock its painted band (5px on cards, 3px on buttons), drawn as a background gradient so it follows the corner.
- **Do** keep business cards at 1.75:1 and size their type in container units with rem floors.
- **Do** show product proof as real captures on a print mat with crop marks and a slug that names the screen.
- **Do** separate overlapping stock with lap, rotation, a tinted face or an inset 1px `line` hairline.
- **Do** deal motion from a visible default and remove it under reduced motion.

### Don't:
- **Don't** apply this world to the signed-in application; its screens follow `tailwind.config.js` and `design-reference/stitch/rally-event-ui/design-system.md`.
- **Don't** use outer drop shadows on cards, prints, sheets or buttons.
- **Don't** fill more than one element per viewport with brand blue.
- **Don't** put the painted band on sheets, photos or print mats.
- **Don't** set uppercase labels above section headlines; tracked caps belong to card fields.
- **Don't** lay a named person card over a photographed face.
- **Don't** lay repeated items out as a row of equal tiles; deal them as a hand.

## Open Notes

- **Motion timing is unreviewed.** The finish review returned "ship" on its scored fixes, but it saw reduced-motion captures only. The durations and offsets above are as built, not as approved; a motion review may change them.
- **Contract vs build.** The direction contract named 3px card corners, a 4px painted edge and `#F5F7FB` tinted stock; the build ships 4px card corners, a 5px band on cards (3px on buttons) and `#F3F6FB`. The build values are recorded here.
