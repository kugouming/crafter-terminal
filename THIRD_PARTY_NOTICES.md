# Third-party notices

The published package (`@becrafter/ghostty-web`) redistributes the following third-party software. The full
license text of each is included below or alongside the files in this
repository.

## Ghostty (compiled to WebAssembly)

The published package ships `ghostty-vt.wasm`, built from the Ghostty source
tree, and inlines the same binary into the JavaScript bundles under `dist/`.

- Project: https://github.com/ghostty-org/ghostty
- License: MIT
- Copyright: Ghostty contributors, including Mitchell Hashimoto

The build applies the patch in `patches/ghostty-wasm-api.patch` to expose the
terminal API used here; the resulting binary is a derivative work of Ghostty.

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ghostty-web (original project)

@becrafter/ghostty-web is a fork of coder/ghostty-web, which is MIT licensed
(Copyright (c) 2025 Coder). See `LICENSE`.

- Project: https://github.com/coder/ghostty-web

## Maple Mono (demo only, not published to npm)

The demo bundles Maple Mono as woff2 files under `demo/fonts/`, together with
its license in `demo/fonts/LICENSE.txt`.

- Project: https://github.com/subframe7536/maple-font
- License: SIL Open Font License 1.1
- Copyright: 2022 The Maple Mono Project Authors

The font files are redistributed unmodified, keep their original names, and are
never sold on their own.
