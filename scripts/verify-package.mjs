#!/usr/bin/env node
/**
 * Pre-pack guard.
 *
 * `npm publish`/`npm pack` do not fail when a file listed in `files` is
 * missing: the file is silently skipped. A package without the WASM binary (or
 * with `exports` pointing at renamed files) installs fine and then breaks at
 * runtime, so assert the artifacts here instead.
 *
 * Runs from `prepack`, after `prepublishOnly` has built everything.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Entry points must exist and have real content. */
const entryPoints = [
  pkg.main,
  pkg.module,
  pkg.types,
  pkg.exports?.['.']?.types,
  pkg.exports?.['.']?.import,
  pkg.exports?.['.']?.require,
  pkg.exports?.['./ghostty-vt.wasm'],
].filter(Boolean);

/** Artifacts that must ship, with a minimum plausible size in bytes. */
const required = [
  ...entryPoints.map((path) => [path, 1024]),
  // The WASM binary is the emulator itself; an empty or missing one means the
  // published package cannot parse anything.
  ['ghostty-vt.wasm', 300 * 1024],
];

const problems = [];
for (const [path, minSize] of required) {
  const file = join(root, path);
  if (!existsSync(file)) {
    problems.push(`missing: ${path}`);
    continue;
  }
  const { size } = statSync(file);
  if (size < minSize) {
    problems.push(`too small (${size} bytes, expected >= ${minSize}): ${path}`);
  }
}

// CI caps the WASM at 512 KiB; keep the same ceiling here.
const wasmSize = existsSync(join(root, 'ghostty-vt.wasm'))
  ? statSync(join(root, 'ghostty-vt.wasm')).size
  : 0;
if (wasmSize > 512 * 1024) {
  problems.push(`ghostty-vt.wasm is ${wasmSize} bytes, over the 512 KiB budget`);
}

if (problems.length > 0) {
  console.error('refusing to pack, package would be broken:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nRun `bun run build` first (it needs Zig to build the WASM).');
  process.exit(1);
}

console.log(`package check ok (${required.length} artifacts, wasm ${wasmSize} bytes)`);
