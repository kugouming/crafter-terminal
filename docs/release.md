# Release runbook

This fork publishes manually — there is no release-please or automated publish
workflow (they were removed in `0.1.0`).

## Preparing a release

1. Make sure `main` is green in CI (`fmt`, `lint`, `typecheck`, `test`, `build`).
2. Decide the version and update it in:
   - `package.json` (`version`)
   - `flake.nix` (`version`)
   - `demo/package.json` (`version`, and the `crafter-terminal` dependency if
     you also publish the demo)
3. Move the `CHANGELOG.md` entries under the new version heading.
4. Commit (`chore(release): vX.Y.Z`).

## Publishing

```bash
bun run fmt && bun run lint && bun run typecheck && bun test

# The WASM binary is not committed: this rebuilds it (requires Zig 0.15.2).
rm -rf dist && bun run build

# Check the tarball contents before pushing anything to the registry.
npm pack --dry-run
#   package/dist/crafter-terminal.js
#   package/dist/crafter-terminal.umd.cjs
#   package/dist/index.d.ts
#   package/ghostty-vt.wasm
#   package/README.md, package/LICENSE, package/THIRD_PARTY_NOTICES.md

# Optional but recommended for a first release: install the tarball in a
# scratch project and check that Ghostty.load() works.

npm publish          # runs prepublishOnly (build) and prepack (verify)
npm view crafter-terminal version
```

`npm publish` cannot be undone (a version number is taken permanently), so do
not skip the `npm pack` check. `scripts/verify-package.mjs` runs from `prepack`
and refuses to pack when an entry point or the WASM binary is missing, because
npm silently skips missing `files` entries.

## Tagging

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --generate-notes
```

Do not push upstream's tags: upstream already owns `v0.1.0`…`v0.4.0`, and
pushing them here would collide with this fork's own version tags. Fetch them
when needed with `git fetch upstream --tags`.

## Demo package

`crafter-terminal-demo` is **not** published by default. If you decide to
publish it, pin its `crafter-terminal` dependency to the exact released version
first, then `cd demo && bun install` to regenerate the lockfile (it was removed
because it pinned the old upstream package).
