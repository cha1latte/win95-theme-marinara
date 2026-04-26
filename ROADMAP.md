# Win95 Theme — Future Plans

Notes on what's _not_ in the current release but worth doing in a future round.
Ordered by impact-to-effort ratio.

---

## Tier 1 — Biggest authenticity wins

### A. Pixel-art icon swap

The remaining "this is a modern app" tell. JS walks the DOM, finds every
`<svg class="lucide-*">`, replaces it with a hand-drawn 16×16 Win95 pixel-art
equivalent. Probably ~25–30 icons total to cover the engine's surface (gear,
person, folder, message, paperclip, image, send, trash, etc).

**Cost:** Real engineering. Needs the icon set drawn or sourced (existing
Win95 icon packs may be reusable). JS DOM-swap layer ~50 lines.

### B. W95FA / Pixel-MS-Sans-Serif font bundle

Embed a real Win95-era pixel font as base64 `@font-face` in the CSS so
MS Sans Serif renders truly pixel-perfect on every machine, not as the
fuzzy fallback Tahoma we're currently shipping. Closes the "text looks
blurry" complaint definitively.

**Cost:** Adds ~30–80 KB to the bundle. License-check needed on whichever
font is chosen (W95FA is open-license; some others aren't).

---

## Tier 2 — Period flair

### C. System sounds

Chime on theme load, error sound on failed generation, "ding" on new
message. Off by default, toggle in settings.

Two implementation paths:
- Bundle WAVs as base64 data URIs (~20–50 KB total, more authentic)
- Use Web Audio synthesis (no payload, slightly less authentic)

**Cost:** Half-day. Browser autoplay policy means first load is silent
until user interacts — document this.

### D. Boot splash

Win95-style "Starting Marinara…" splash on first session, dismissed after
a few seconds or on click. Pure CSS + JS, no assets needed.

**Cost:** ~1–2 hours.

---

## Tier 3 — Functional chrome

### E. Working titlebar buttons

Right now `_` `□` `×` are decorative. Make:
- `_` collapse the panel (set height: 22px or hide content)
- `□` toggle full-width on the chat surface
- `×` hide-but-not-destroy

State persists in localStorage so reloads remember what was minimized.

**Cost:** ~half-day. Carefully-scoped DOM mutations (don't disturb React tree).

### F. Draggable / resizable windows

Heavy lift — would conflict with the engine's React layout, and probably
needs a lot of guard rails to avoid breaking things.

**Cost:** Multi-day. Honestly skip unless there's a strong reason.

---

## Tier 4 — Repo polish

### G. README screenshots

Replace the placeholder section in the README with real images of each
surface (chat, sidebar, settings, modal, roleplay). Drop into a `docs/`
subfolder, link from README.

**Cost:** ~1 hour.

### H. Theme variants

Derive sibling themes from the Win95 base, sharing most of the CSS:
- **Win98** — taskbar, gradient titlebars, Plus! pack icons
- **Win2K** — slightly refined chrome, smoother gradients
- **WinXP Luna** — blue/green Bliss palette, rounded chrome

Each shippable as its own JSON entry.

**Cost:** Per variant, ~half-day if the Win95 base does most of the
heavy lifting through token overrides.

---

## Recommended next session

**A + B together** would give the biggest jump in authenticity from the
current state — they're complementary (pixel font for text, pixel icons
for chrome) and remove the two remaining things that read as "modern app
pretending to be Win95." After that, **C** (sounds) is a fun half-day
add-on, and **G** (screenshots) makes the repo look professional.

If picking only one: **A**. The icons are the most-noticed remaining tell.

---

## Loose threads (debt to clear before v2)

These came up during v1 development and aren't blocking, but worth noting:

- **Search blackout in Marinara**: typing in the chat-list search box blacks
  out the viewport. Confirmed engine bug (reproduces with the theme
  disabled), not ours. Worth filing upstream.
- **Native color picker**: `<input type="color">` styling is wrapped in a
  Win95 sunken bevel, but the actual picker dialog opening is the
  browser's native one (Chrome / Firefox dialog). Replacing with a true
  Win95 color picker would need a real picker implementation in JS.
- **`mari-chat-send-btn` class missing in rendered DOM**: the engine source
  declares it but it doesn't reach the DOM (twMerge or build-time
  transform appears to strip it). We currently target via
  `button[title="Send"]` instead — fragile if the engine ever stops setting
  that title attribute.
