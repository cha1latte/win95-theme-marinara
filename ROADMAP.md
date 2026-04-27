# Win95 Theme — Future Plans

Notes on what's _not_ in the current release but worth doing in a future round.

> **v3.0 reset:** the theme is now CSS-only. The JS-dependent items
> below (icon swap, boot splash, sounds, working titlebar buttons)
> are deferred to a hypothetical v4 if anyone wants to bring back a
> JS layer. They worked at v2.x; their source lives in git history.

---

## Tier 1 — In scope for CSS-only

### A. Wider class-utility coverage

Each new audit reveals more Tailwind utilities the engine sprinkles
that we haven't flattened yet. The CSS already handles the obvious
ones (rounded, gradient, shadow, named text/bg colors), but the
catalog grows over time. Easy iterative additions.

**Cost:** ~30 min per audit pass.

### B. README screenshots

Replace the placeholder section in the README with real images of
each surface (chat, sidebar, settings, modal, roleplay). Drop into
a `docs/` subfolder, link from README. Makes the repo look
professional for anyone who finds it on GitHub.

**Cost:** ~1 hour.

### C. Theme variants

Derive sibling themes from the Win95 base, sharing most of the CSS:
- **Win98** — slight gradient titlebars, Plus! pack palette
- **Win2K** — refined chrome, smoother gradients
- **WinXP Luna** — blue/green Bliss palette, rounded chrome (irony intentional)

Each shippable as its own JSON entry. CSS-only means each variant
is a single file fork, no JS dependencies to copy.

**Cost:** Per variant, ~half-day if the Win95 base does most of the
heavy lifting through token overrides.

---

## Tier 2 — Out of scope without JS (deferred to v4 if revived)

Each of these worked in v2.x. The full JS layer is preserved in git
history at the v2.9.1 tag if anyone wants to fork it back.

- **Pixel-art icon swap.** 160+ Lucide → 16×16 pixel-art SVG
  replacements with a tightly-scoped MutationObserver per chrome
  surface. Lost: visual authenticity of the icon layer. Lucide
  monoline icons stay.
- **Window chrome.** Decorative Win95 titlebars on chat surfaces +
  sidebar with `_ □ ×` buttons. Status bar at the bottom of the
  chat with `Ready` / `Generating…` state.
- **Working titlebar buttons.** Click `_` to minimize a surface to
  titlebar height; `□` to maximize chat (hide siblings); `×` to
  collapse with grey-titlebar "closed" cue. State persisted.
- **Boot splash.** Win95-style "Starting Marinara Engine…" splash
  on first session — black bg, 4-color flag, W95FA wordmark,
  segmented blue progress bar. Auto-dismiss at 2.6s.
- **System sounds.** Boot chime (C-major arpeggio), new-message
  ding (two-tone bell), error buzz (descending dyad). Synthesized
  via Web Audio OscillatorNode — no bundled WAVs.
- **Settings panel.** Ctrl+Shift+9 / `#win95` URL hash opened a
  Win95 dialog with toggles for chrome, status bar, boot splash,
  sounds, and a "Restore all windows" button.
- **Sparkle stripper.** Walked text nodes inside `.retro-glow-text`
  and removed `✦/✧/✨/⋆` decoration.
- **GIF → PNG logo swap.** Replaced `/logo-splash.gif` (animated)
  with `/logo.png` (static) since CSS can't pause GIF playback.
- **Engine-ping suppressor.** Patched
  `AudioContext.prototype.createOscillator` to silence the engine's
  own new-message notification ping (sine 880/1320 Hz) when our
  Win95 sounds were enabled.

If any of those are worth bringing back, fork from a v2.x tag and
re-publish under a different `id`.
