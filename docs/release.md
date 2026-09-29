# Release runbook

This fork publishes manually — there is no release-please or automated publish
workflow (they were removed in `0.5.0`).

## Preparing a release

1. Make sure `main` is green in CI (`fmt`, `lint`, `typecheck`, `test`, `build`).
2. Decide the version and update it in:
   - `package.json` (`version`)
   - `flake.nix` (`version`)
   - `demo/package.json` (`version`, and the `@kugouming/ghostty-web` dependency if
     you also publish the demo)
3. Move the `CHANGELOG.md` entries under the new version heading.
4. Commit (`chore(release): vX.Y.Z`).

## Publishing

```bash
bun run fmt && bun run lint && bun run typecheck && bun test

# The WASM binary is not committed. Fetch the one CI built and tested:
# Run this from the repo root. A single-file artifact is written to the
# current directory, so this creates ./ghostty-vt.wasm directly.
gh run download -R kugouming/crafter-terminal -n ghostty-vt.wasm

# Build the library and stage the WASM into dist (no local Zig needed)
bun run build:publish

# Check the tarball contents before pushing anything to the registry.
npm pack --dry-run
#   package/dist/ghostty-web.js
#   package/dist/ghostty-web.umd.cjs
#   package/dist/index.d.ts
#   package/ghostty-vt.wasm
#   package/README.md, package/LICENSE, package/THIRD_PARTY_NOTICES.md

npm publish          # runs prepublishOnly (build:publish) and prepack (verify)
npm view @kugouming/ghostty-web version
```

`npm publish` cannot be undone (a version number is taken permanently), so do
not skip the `npm pack` check. `scripts/verify-package.mjs` runs from `prepack`
and refuses to pack when an entry point or the WASM binary is missing, because
npm silently skips missing `files` entries.

### Building the WASM locally

`bun run build` compiles the WASM from the `ghostty` submodule and therefore
needs Zig 0.15.2. Note that Zig 0.15.2 cannot link on macOS 26 or newer
(`undefined symbol: _sigaction` and friends), which is why the release flow
above uses the artifact CI builds on Linux instead. On a machine where Zig
works:

```bash
git submodule update --init --recursive
bun run build
```

## Tagging

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --generate-notes
```

Do not push upstream's tags: upstream already owns `v0.1.0`…`v0.4.0`, and
pushing them here would collide with this fork's own version tags. Fetch them
when needed with `git fetch upstream --tags`.

## Demo package

The `crafter-terminal` demo package is **not** published by default. If you
decide to publish it, pin its `@kugouming/ghostty-web` dependency to a released
version (currently `^0.5.0`) and run `cd demo && bun install` to refresh
`demo/bun.lock`.
