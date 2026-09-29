# Changelog

## 0.5.0

First release of `@kugouming/ghostty-web` (the `ghostty-web` library
published under the `@kugouming` scope), a fork of
[coder/ghostty-web](https://github.com/coder/ghostty-web) focused on rendering
parity with the native Ghostty app.

Everything below is relative to upstream `ghostty-web@0.4.0`; the upstream
history is preserved in the git log and in
[the upstream changelog](https://github.com/coder/ghostty-web/blob/main/CHANGELOG.md).

**Rendering**

- Font metrics now follow Ghostty's algorithm (`src/font/Metrics.zig`): cell
  width is the rounded maximum ASCII advance, cell height comes from the font's
  line height (ascent + descent + line gap) instead of a single glyph's bounding
  box, the baseline is measured from the bottom of the cell, and `adjust-*`
  deltas are applied in device pixels. Rows were previously ~20% too short,
  which broke TUI layouts.
- Defaults match Ghostty: the built-in theme (`#282c34` background, Tomorrow
  Night palette), a blinking block cursor, and font size 13 on macOS / 12
  elsewhere.
- Box drawing (U+2500–U+257F) and block elements (U+2580–U+259F) are drawn as
  sprites ported from Ghostty, so borders and bars line up with the grid.
- `fontMetrics` can pin the grid to a font's own tables, making it independent
  of browser and platform font APIs; `isFontAvailable` / `isMonospaceFont`
  detect missing or proportional fallbacks instead of rendering text with gaps.
- Covering glyphs, faint/inverse handling, cursor geometry (`cursor-opacity`,
  bar/underline shapes) and decoration geometry follow Ghostty.

**Configuration**

- `parseGhosttyConfig` / `toTerminalOptions` / `loadGhosttyConfig` convert a
  native Ghostty config (font, theme, palette, cursor, padding, `adjust-*`)
  into terminal options.

**Demo**

- Ships Maple Mono as woff2 (SIL OFL 1.1) plus pinned metrics, a checked-in
  default config, and a local-config overlay.
- Window title is `crafter`; the terminal scrollbar is thinner, rounded, has no
  track, and hides shortly after scrolling stops.

**Removed**

- release-please, the AI release-notes generator and the automated publish
  workflow (this fork publishes manually).
