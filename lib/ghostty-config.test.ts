/**
 * Tests for the Ghostty config bridge
 */

import { describe, expect, test } from 'bun:test';
import {
  mergeGhosttyConfigs,
  normalizeColor,
  parseConfigLine,
  parseGhosttyConfig,
  resolveTheme,
  toTerminalOptions,
} from './ghostty-config';
import { DEFAULT_FONT_FAMILY, GHOSTTY_DEFAULT_THEME } from './renderer';

describe('parseConfigLine', () => {
  test('parses simple key/value pairs', () => {
    expect(parseConfigLine('font-size = 14')).toEqual(['font-size', '14']);
    expect(parseConfigLine('  font-size=14  ')).toEqual(['font-size', '14']);
  });

  test('ignores comment lines, including indented ones', () => {
    expect(parseConfigLine('# a comment')).toBeNull();
    expect(parseConfigLine('   # an indented comment')).toBeNull();
    expect(parseConfigLine('')).toBeNull();
  });

  test('keeps # in values, since Ghostty has no trailing comments', () => {
    expect(parseConfigLine('background = #282c34')).toEqual(['background', '#282c34']);
    expect(parseConfigLine('palette = 0=#1d1f21')).toEqual(['palette', '0=#1d1f21']);
  });

  test('strips surrounding quotes from values', () => {
    expect(parseConfigLine('font-family = "Maple Mono NF CN"')).toEqual([
      'font-family',
      'Maple Mono NF CN',
    ]);
  });

  test('returns null for lines without a value', () => {
    expect(parseConfigLine('just-a-key')).toBeNull();
    expect(parseConfigLine('= value')).toBeNull();
  });
});

describe('normalizeColor', () => {
  test('normalizes hex colors', () => {
    expect(normalizeColor('#282C34')).toBe('#282c34');
    expect(normalizeColor('282c34')).toBe('#282c34');
    expect(normalizeColor('#fff')).toBe('#ffffff');
  });

  test('rejects non-hex colors', () => {
    expect(normalizeColor('red')).toBeUndefined();
    expect(normalizeColor('')).toBeUndefined();
  });
});

describe('parseGhosttyConfig', () => {
  test('parses a realistic config', () => {
    const config = parseGhosttyConfig(`
# Typography
font-family = "Maple Mono NF CN"
font-size = 14
font-thicken = true
adjust-cell-height = 2

# Theme
theme = Catppuccin Mocha
palette = 0=#45475a
palette = 8=#585b70

# Cursor
cursor-style = bar
cursor-style-blink = true
cursor-opacity = 0.8

# Window
background-opacity = 0.85
window-padding-x = 10
window-padding-y = 8
`);

    expect(config.fontFamily).toEqual(['Maple Mono NF CN']);
    expect(config.fontSize).toBe(14);
    expect(config.fontThicken).toBe(true);
    expect(config.adjustments.cellHeight).toBe('2');
    expect(config.themes).toEqual(['Catppuccin Mocha']);
    expect(config.palette[0]).toBe('#45475a');
    expect(config.palette[8]).toBe('#585b70');
    expect(config.cursorStyle).toBe('bar');
    expect(config.cursorStyleBlink).toBe(true);
    expect(config.cursorOpacity).toBe(0.8);
    expect(config.backgroundOpacity).toBe(0.85);
    expect(config.windowPaddingX).toEqual({ topLeft: 10, bottomRight: 10 });
    expect(config.windowPaddingY).toEqual({ topLeft: 8, bottomRight: 8 });
  });

  test('accumulates repeated font-family entries as fallbacks', () => {
    const config = parseGhosttyConfig(`
font-family = Maple Mono NF CN
font-family = Menlo
`);
    expect(config.fontFamily).toEqual(['Maple Mono NF CN', 'Menlo']);
  });

  test('an empty font-family resets the list', () => {
    const config = parseGhosttyConfig(`
font-family = Menlo
font-family = ""
font-family = Maple Mono NF CN
`);
    expect(config.fontFamily).toEqual(['Maple Mono NF CN']);
    expect(config.fontFamilyReset).toBe(true);
  });

  test('prefers the dark variant of an auto theme', () => {
    const config = parseGhosttyConfig('theme = light:Catppuccin Latte,dark:Catppuccin Mocha');
    expect(config.themes[0]).toBe('Catppuccin Mocha');
    expect(config.themes).toContain('Catppuccin Latte');
  });

  test('parses 256-color palette entries and ignores invalid ones', () => {
    const config = parseGhosttyConfig(`
palette = 16=#123456
palette = 999=#123456
palette = not-a-number=#123456
`);
    expect(config.palette[16]).toBe('#123456');
    expect(config.palette[999]).toBeUndefined();
  });
});

describe('mergeGhosttyConfigs', () => {
  test('later values win and repeatable keys accumulate', () => {
    const a = parseGhosttyConfig('font-size = 12\nfont-family = Menlo\npalette = 0=#111111');
    const b = parseGhosttyConfig('font-size = 14\npalette = 1=#222222');

    const merged = mergeGhosttyConfigs([a, b]);
    expect(merged.fontSize).toBe(14);
    expect(merged.fontFamily).toEqual(['Menlo']);
    expect(merged.palette[0]).toBe('#111111');
    expect(merged.palette[1]).toBe('#222222');
  });

  test('a reset in a later config clears earlier font families', () => {
    const a = parseGhosttyConfig('font-family = Menlo');
    const b = parseGhosttyConfig('font-family = ""\nfont-family = Maple Mono NF CN');

    expect(mergeGhosttyConfigs([a, b]).fontFamily).toEqual(['Maple Mono NF CN']);
  });
});

describe('resolveTheme', () => {
  test('falls back to Ghostty defaults', () => {
    const theme = resolveTheme(parseGhosttyConfig(''));
    expect(theme).toEqual(GHOSTTY_DEFAULT_THEME);
  });

  test('theme file provides colors, config overrides them', () => {
    const themeText = `
palette = 0=#45475a
palette = 1=#f38ba8
background = #1e1e2e
foreground = #cdd6f4
cursor-color = #f5e0dc
cursor-text = #1e1e2e
selection-background = #585b70
selection-foreground = #cdd6f4
`;
    const config = parseGhosttyConfig(`
theme = Catppuccin Mocha
palette = 1=#ff0000
`);
    const theme = resolveTheme(config, { themeText });

    expect(theme.black).toBe('#45475a');
    expect(theme.red).toBe('#ff0000'); // config wins over the theme file
    expect(theme.background).toBe('#1e1e2e');
    expect(theme.foreground).toBe('#cdd6f4');
    expect(theme.cursor).toBe('#f5e0dc');
    expect(theme.cursorAccent).toBe('#1e1e2e');
    expect(theme.selectionBackground).toBe('#585b70');
    // untouched colors keep Ghostty's defaults
    expect(theme.brightGreen).toBe(GHOSTTY_DEFAULT_THEME.brightGreen);
  });
});

describe('toTerminalOptions', () => {
  test('maps font, cursor and metric options', () => {
    const config = parseGhosttyConfig(`
font-family = "Maple Mono NF CN"
font-size = 14
adjust-cell-height = 2
adjust-cell-width = 1
cursor-style = bar
cursor-style-blink = true
cursor-opacity = 0.8
`);
    const { options } = toTerminalOptions(config);

    // The configured family comes first, followed by a monospace fallback so a
    // missing font never degrades to a proportional one.
    expect(options.fontFamily).toBe(`"Maple Mono NF CN", ${DEFAULT_FONT_FAMILY}`);
    expect(options.fontSize).toBe(14);
    expect(options.adjustments).toEqual({ cellHeight: '2', cellWidth: '1' });
    expect(options.cursorStyle).toBe('bar');
    expect(options.cursorBlink).toBe(true);
    expect(options.cursorOpacity).toBe(0.8);
  });

  test('builds a CSS font stack from repeated families', () => {
    const config = parseGhosttyConfig('font-family = Menlo\nfont-family = "Maple Mono NF CN"');
    const { options } = toTerminalOptions(config);
    expect(options.fontFamily).toBe(`Menlo, "Maple Mono NF CN", ${DEFAULT_FONT_FAMILY}`);
  });

  test('defaults the cursor to blinking, like Ghostty', () => {
    const { options } = toTerminalOptions(parseGhosttyConfig(''));
    expect(options.cursorBlink).toBe(true);
    expect(options.cursorStyle).toBeUndefined(); // renderer default (block)
  });

  test('warns about options without an exact equivalent', () => {
    const config = parseGhosttyConfig('cursor-style = block_hollow\nfont-thicken = true');
    const { options, warnings } = toTerminalOptions(config);
    expect(options.cursorStyle).toBe('block');
    expect(warnings.length).toBe(2);
  });
});
