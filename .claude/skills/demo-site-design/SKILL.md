---
name: demo-site-design
description: Art-direct and build a one-page website for a small local business that makes the owner want to buy it. Use when generating a demo site from Google Places data — hero, proof, hours, call-to-action — with no photographs and no network access.
---

# Demo sites that sell

You are making a page that gets shown to the owner of a bar, a hairdresser, a
plumber. They currently have no website. In thirty seconds they decide whether
this is worth paying for.

They are not judging your code. They are judging whether it looks like *their
business, taken seriously*. Generic is the failure mode — a page that could
belong to any of ten thousand businesses reads as a template, and nobody pays
for a template.

## The bar

Before writing a line, know what you are aiming at: a page that looks like a
studio charged €2,000 for it. Not a Bootstrap page. Not a landing-page builder.
Look at what a good restaurant or barber site actually does — full-bleed colour,
type big enough to be uncomfortable, space where you expect content.

You have no photographs. That is a constraint, not an excuse: it means colour,
type and space have to do all the work, so each has to be deliberate.

## Art direction comes first

You have been given real photographs of the business as **research**. Look at
them properly before designing:

- What colours are actually in that room? A Madrid bar with a red Estrella Damm
  awning and checked tablecloths is not the same page as a white-walled
  minimalist salon.
- Old-fashioned or contemporary? Rough or polished? Cheap and cheerful or
  expensive?
- What is the one thing a passer-by would notice?

Write down a one-line direction for yourself, then build to it. "1950s Madrid
casa de comidas: deep vermillion, cream, gold, gingham, serif with weight."
Every later decision refers back to that line.

### Palette

Pull the palette from the photographs. Three colours, no more:

- **A dominant.** Usually deep and saturated. This owns the hero.
- **A warm neutral** for surfaces — bone, cream, sand, warm grey. Not `#fff`.
- **One accent** for calls to action, drawn from something real in the photos.

Never pure black on pure white. Never a palette that could belong to a bank
unless the business is a bank.

```css
:root {
  --ink: #2a1a15;          /* near-black, warmed toward the palette */
  --paper: #faf5ec;        /* warm neutral, never #ffffff */
  --brand: #8c1c13;        /* the dominant, from the photos */
  --brand-deep: #5c120c;   /* for gradients and depth */
  --accent: #c9a227;       /* the one highlight */
}
```

### Type

One family for display, one for text. System stacks only — no web fonts, no
network.

```css
/* Display: characterful. Georgia and Iowan have real weight to them. */
--display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
/* Text: neutral and legible at small sizes. */
--text: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
```

Rules that separate a designed page from a default one:

- **The name is enormous.** `clamp(3rem, 11vw, 8rem)`. If it looks slightly too
  big, it is probably right.
- **Tighten display type.** `letter-spacing: -0.02em; line-height: 0.95;` at
  large sizes. Loose tracking on a headline reads as amateur.
- **Loosen small caps.** Eyebrow labels: `0.75rem`, `letter-spacing: 0.18em`,
  `text-transform: uppercase`. This one detail does an enormous amount.
- **Body text is 1.05–1.15rem with `line-height: 1.65`** and a `max-width: 62ch`.
  Full-width paragraphs look unedited.
- Numbers — phone, rating, hours — deserve their own treatment. A phone number
  set large in the display face is a design element.

### Space

Generosity is most of what makes a page look expensive.

```css
section { padding: clamp(4.5rem, 11vw, 9rem) clamp(1.25rem, 5vw, 4rem); }
.wrap   { max-width: 1100px; margin-inline: auto; }
```

Whitespace is not wasted space. If in doubt, add more.

## Structure

In order. Every section earns its place; cut anything you cannot fill with real
data.

1. **Hero.** Dominant colour, business name enormous, one line saying what it
   actually is, the Google rating as social proof, and a phone button. This is
   the whole pitch.

   **It has to fit on one screen.** The owner opens the page and must see the
   name, the rating and the call button without scrolling — if the first screen
   is an empty field of colour, the page has failed before it started. Use
   `min-height: 100svh` (`svh`, not `vh`: on a phone `100vh` is taller than the
   visible area and pushes content under the browser chrome), keep hero padding
   modest, and if it still overflows, make the display type smaller rather than
   letting the hero grow. A hero taller than the viewport is a bug, not a style.

   ```css
   .hero {
     min-height: 100svh;
     display: flex; flex-direction: column; justify-content: center;
     padding: clamp(1.5rem, 4vh, 3rem) clamp(1.25rem, 5vw, 4rem);
     box-sizing: border-box;
   }
   ```
2. **What they do.** Two or three short paragraphs in the owner's register, from
   the editorial summary and reviews. Not marketing fluff — what you would tell
   a friend.
3. **Proof.** Two or three real reviews, quoted properly, with the reviewer's
   name. Use the strongest ones. This is the most persuasive thing on the page,
   so give it room.
4. **Practical.** Opening hours as a real table, address, Google Maps link.
   Highlight today if you can do it without JavaScript.
5. **Close.** The phone number again, large, with a reason to call.

## Making it look like something without images

This is where most generated pages fail. Do not leave grey boxes. Do not put an
emoji where a photo should be. Build actual texture:

**Layered gradients** give depth a flat fill never will:

```css
.hero {
  background:
    radial-gradient(ellipse at 20% -10%, #a8241a 0%, transparent 55%),
    linear-gradient(170deg, var(--brand) 0%, var(--brand-deep) 100%);
}
```

**Grain** stops large colour fields looking like plastic. Inline SVG turbulence,
no network, a few hundred bytes:

```css
.hero::after {
  content: "";
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E");
  mix-blend-mode: overlay; opacity: 0.25; pointer-events: none;
}
```

**A drawn mark.** Give the business a monogram or emblem in inline SVG — a
roundel with its initial in the display face, a simple line drawing of the trade
(scissors, a wrench, a glass). Small, centred above the name. This single
element does more for perceived legitimacy than anything else on the page.

**Patterns with meaning.** Gingham for a traditional casa de comidas, a barber
stripe, azulejo tiling, a subtle diagonal for a trade. Drawn as an SVG
`<pattern>`, used as a thin band between sections — not as wallpaper.

**Depth.** Soft, large, low-opacity shadows (`0 2rem 4rem rgba(0,0,0,.12)`), not
tight dark ones. Overlap a card into the section above it. Let one element break
its container's edge.

## Details that read as "designed"

- Hairline rules in the accent at 30% opacity, not `1px solid #ddd`.
- A short accent-coloured rule above section headings.
- Hover transitions on every interactive thing: `transition: 180ms ease`.
- The phone CTA looks pressable — real padding, weight, a shadow that shifts.
- Set `::selection` to the brand colour.
- `scroll-behavior: smooth` and one in-page anchor from hero to hours.
- Give the page a real `<title>`: "Bar Loreto — Casa de comidas en Chamberí".

## Non-negotiables

- **No `<img>`, no CSS `url()` pointing at a file.** The build fails on either.
  Inline `<svg>` and `data:image/svg+xml` are fine and are how you draw.
- **No network.** No web fonts, no CDN, no analytics. It must render offline.
- **No JavaScript.** Everything here is achievable in CSS.
- **Invent nothing.** Only facts from the data file. No hours means no hours
  section. A wrong opening time in front of the owner destroys the pitch.
- **Their language.** Spanish for Spanish businesses, matching the reviews.
- **Mobile first.** Correct at 375px, no horizontal scroll at any width. Test
  the hero type scales down — `clamp()` everywhere.
- **No filler.** No lorem, no fake social links, no "Welcome to our website", no
  stock phrases like "Your satisfaction is our priority".

## Before you finish

Read the page back as the owner would:

- **Is the business name visible the instant the page opens, without scrolling?**
  Check it at roughly 1400×800 and at 390×844. This is the one that gets missed.
- Does it look like *my* business, or like a template with my name in it?
- Is there one thing I would point at and say "that's nice"?
- Would I be comfortable putting this address on a business card?

If any answer is no, the art direction is too timid. Push the colour further,
set the name bigger, add more space.
