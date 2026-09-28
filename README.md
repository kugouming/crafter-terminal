# ghostty-web

[![NPM Version](https://img.shields.io/npm/v/ghostty-web)](https://npmjs.com/package/ghostty-web) [![NPM Downloads](https://img.shields.io/npm/dw/ghostty-web)](https://npmjs.com/package/ghostty-web) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/ghostty-web)](https://npmjs.com/package/ghostty-web) [![license](https://img.shields.io/github/license/coder/ghostty-web)](./LICENSE)

[Ghostty](https://github.com/ghostty-org/ghostty) for the web with [xterm.js](https://github.com/xtermjs/xterm.js) API compatibility — giving you a proper VT100 implementation in the browser.

- Migrate from xterm by changing your import: `@xterm/xterm` → `ghostty-web`
- WASM-compiled parser from Ghostty—the same code that runs the native app
- Zero runtime dependencies, ~400KB WASM bundle

Originally created for [Mux](https://github.com/coder/mux) (a desktop app for isolated, parallel agentic development), but designed to be used anywhere.

## Try It

- [Live Demo](https://ghostty.ondis.co) on an ephemeral VM (thank you to Greg from [disco.cloud](https://disco.cloud) for hosting).

- On your computer:

  ```bash
  npx @ghostty-web/demo@next
  ```

  This starts a loopback-only HTTP server with a real shell on `http://127.0.0.1:8080`. The demo protects `/ws` with a per-run same-origin token and rejects cross-origin WebSocket handshakes. Works best on Linux and macOS.

  To intentionally bind somewhere else, set `HOST=<host>`. If you serve the demo through extra hostnames or a wildcard bind such as `HOST=0.0.0.0`, also set `GHOSTTY_ALLOWED_HOSTS=host1,host2`. Avoid remote exposure unless you understand the risk: the demo starts a real local shell.

![ghostty](https://github.com/user-attachments/assets/aceee7eb-d57b-4d89-ac3d-ee1885d0187a)

## Comparison with xterm.js

xterm.js is everywhere—VS Code, Hyper, countless web terminals. But it has fundamental issues:

| Issue                                    | xterm.js                                                         | ghostty-web                |
| ---------------------------------------- | ---------------------------------------------------------------- | -------------------------- |
| **Complex scripts** (Devanagari, Arabic) | Rendering issues                                                 | ✓ Proper grapheme handling |
| **XTPUSHSGR/XTPOPSGR**                   | [Not supported](https://github.com/xtermjs/xterm.js/issues/2570) | ✓ Full support             |

xterm.js reimplements terminal emulation in JavaScript. Every escape sequence, every edge case, every Unicode quirk—all hand-coded. Ghostty's emulator is the same battle-tested code that runs the native Ghostty app.

## Installation

```bash
npm install ghostty-web
```

## Usage

ghostty-web aims to be API-compatible with the xterm.js API.

```javascript
import { init, Terminal } from 'ghostty-web';

await init();

const term = new Terminal({
  fontSize: 14,
  theme: {
    background: '#1a1b26',
    foreground: '#a9b1d6',
  },
});

term.open(document.getElementById('terminal'));
term.onData((data) => websocket.send(data));
websocket.onmessage = (e) => term.write(e.data);
```

For a comprehensive client <-> server example, refer to the [demo](./demo/index.html#L141).

## Matching your native Ghostty terminal

The defaults match Ghostty's defaults (theme, font size, cursor, cell metrics),
and box-drawing/block characters are drawn with Ghostty's own sprite geometry so
TUI borders and bars line up with the grid.

To make a web terminal look exactly like the terminal on your machine, feed it
your Ghostty config:

```typescript
import { Terminal, parseGhosttyConfig, toTerminalOptions } from 'ghostty-web';

// In the browser, fetch the config from your server (see demo/bin/demo.js,
// which serves the local config at /ghostty-config.json).
const { configText, themeText } = await (await fetch('/ghostty-config.json')).json();

const config = parseGhosttyConfig(configText);
const { options, theme } = toTerminalOptions(config, { themeText });

const term = new Terminal({ ...options, theme });
```

In Node/Bun you can read it directly:

```typescript
import { loadGhosttyConfig, toTerminalOptions } from 'ghostty-web';

const { config, themeText } = await loadGhosttyConfig();
const { options, theme } = toTerminalOptions(config, { themeText });
```

What is mirrored: `font-family`, `font-size`, `theme`, `palette`, `background`,
`foreground`, `cursor-*`, `selection-*`, `window-padding-x/y`,
`background-opacity`, and every `adjust-*` metric option.

### Pinning the appearance in your repo

Config alone is not enough to reproduce a terminal elsewhere: the font has to be
available, and the cell grid has to be independent of the browser. The demo
shows the pattern:

- **Bundle the font.** `demo/fonts/` ships [Maple Mono](https://github.com/subframe7536/maple-font)
  as woff2 (~320 KB for four faces, SIL OFL 1.1) and declares it with
  `@font-face`.
- **Pin the metrics from the font's tables.** `demo/fonts/MapleMono-metrics.json`
  is generated by `scripts/build-font-metrics.py` (`bun run build:font-metrics`)
  and passed to `Terminal` as `fontMetrics`. The grid is then computed from the
  font file rather than from `fontBoundingBox*` / `line-height: normal`, which
  come from the platform font backend and can differ between browsers and
  operating systems. The renderer ignores the pinned metrics if a different
  font ends up being used (for example when the user's own font is installed).
- **Check in a default config.** `demo/ghostty.config` pins font, size, theme
  (inlined palette), cursor and padding. The demo applies it first and layers
  `~/.config/ghostty/config` on top when it exists, so it mirrors your terminal
  locally while staying reproducible in CI, on a VM, or on a colleague's
  machine.
- **Load the font before measuring.** `await document.fonts.load(...)` before
  constructing the `Terminal` (the terminal also re-measures on
  `document.fonts.ready` as a safety net).
- **Keep a monospace fallback in the stack.** A missing family would otherwise
  fall back to a proportional font; the renderer detects that and switches to
  the default monospace stack.

With all of that, the grid is identical on every machine at a given device pixel
ratio (rounding happens in device pixels, so a 2x display gets a half-pixel
wider cell - exactly like the native app). Glyphs that the bundled font does not
cover (CJK, Nerd Font icons, emoji) still come from system fonts, so those differ
per platform.

The runnable demo does all of this: `bun run demo:dev` renders the web terminal
with the bundled font, pinned metrics and theme, plus your local Ghostty config
when present (`GHOSTTY_CONFIG=<path>` to use a different one).

### Fidelity notes

| Area                                                             | Status                                                                                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme colors, default palette, selection, cursor colors          | Matches Ghostty's defaults                                                                                                                                                          |
| Cell width/height, baseline, underline/strikethrough geometry    | Computed with Ghostty's algorithm (`lib/metrics.ts`), including `adjust-*`; `fontMetrics` pins the inputs to the font's own tables so the grid does not depend on browser font APIs |
| Missing font family                                              | Falls back to the default monospace stack and logs a warning, instead of letting the browser pick a proportional font (which renders text with gaps)                                |
| Box drawing (U+2500–U+257F), block elements (U+2580–U+259F)      | Drawn as sprites like Ghostty; dashed lines, arcs and diagonals (U+2504–U+250B, U+256D–U+2570, U+2571–U+2573) still use the font glyph                                              |
| Faint (`SGR 2`), inverse, bold, italic, underline, strikethrough | Supported                                                                                                                                                                           |
| Underline thickness/position                                     | Uses Ghostty's fallback heuristic (15% of the x-height) because the browser can't read a font's `post` table; override with `adjust-underline-*` or the `metrics` option            |
| Ligatures                                                        | Not supported (canvas draws cell by cell)                                                                                                                                           |
| `font-thicken`                                                   | macOS text smoothing has no canvas equivalent                                                                                                                                       |
| Cursor shape from `DECSCUSR`                                     | The WASM applies it, but the current WASM API doesn't expose the shape; `cursorStyle` is a static option                                                                            |
| `cursor-style = block_hollow`, `bold-color = bright`             | Not implemented                                                                                                                                                                     |

## Development

ghostty-web builds from Ghostty's source with a [patch](./patches/ghostty-wasm-api.patch) to expose additional
functionality.

> Requires Zig and Bun.

```bash
bun run build
```

Mitchell Hashimoto (author of Ghostty) has [been working](https://mitchellh.com/writing/libghostty-is-coming) on `libghostty` which makes this all possible. The patches are very minimal thanks to the work the Ghostty team has done, and we expect them to get smaller.

This library will eventually consume a native Ghostty WASM distribution once available, and will continue to provide an xterm.js compatible API.

At Coder we're big fans of Ghostty, so kudos to that team for all the amazing work.

## License

[MIT](./LICENSE)
