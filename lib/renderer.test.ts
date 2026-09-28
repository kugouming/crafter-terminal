/**
 * Tests for Canvas Renderer
 *
 * Note: Most renderer tests are visual and require a browser environment.
 * These tests verify non-visual aspects like theme configuration.
 * Full visual tests are in examples/renderer-demo.html
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_THEME, GHOSTTY_DEFAULT_THEME, isCovering, parseHexColor } from './renderer';

describe('CanvasRenderer', () => {
  describe('Default Theme', () => {
    test('matches Ghostty default style ANSI colors', () => {
      expect(DEFAULT_THEME.black).toBe('#1d1f21');
      expect(DEFAULT_THEME.red).toBe('#cc6666');
      expect(DEFAULT_THEME.green).toBe('#b5bd68');
      expect(DEFAULT_THEME.yellow).toBe('#f0c674');
      expect(DEFAULT_THEME.blue).toBe('#81a2be');
      expect(DEFAULT_THEME.magenta).toBe('#b294bb');
      expect(DEFAULT_THEME.cyan).toBe('#8abeb7');
      expect(DEFAULT_THEME.white).toBe('#c5c8c6');
    });

    test('has all bright ANSI colors', () => {
      expect(DEFAULT_THEME.brightBlack).toBe('#666666');
      expect(DEFAULT_THEME.brightRed).toBe('#d54e53');
      expect(DEFAULT_THEME.brightGreen).toBe('#b9ca4a');
      expect(DEFAULT_THEME.brightYellow).toBe('#e7c547');
      expect(DEFAULT_THEME.brightBlue).toBe('#7aa6da');
      expect(DEFAULT_THEME.brightMagenta).toBe('#c397d8');
      expect(DEFAULT_THEME.brightCyan).toBe('#70c0b1');
      expect(DEFAULT_THEME.brightWhite).toBe('#eaeaea');
    });

    test('has foreground and background colors', () => {
      expect(DEFAULT_THEME.foreground).toBe('#ffffff');
      expect(DEFAULT_THEME.background).toBe('#282c34');
    });

    test('has cursor colors', () => {
      // Ghostty defaults the cursor to the window foreground and the text
      // under it to the window background.
      expect(DEFAULT_THEME.cursor).toBe('#ffffff');
      expect(DEFAULT_THEME.cursorAccent).toBe('#282c34');
    });

    test('has selection colors', () => {
      // Ghostty's default selection inverts the window fg/bg.
      expect(DEFAULT_THEME.selectionBackground).toBe('#ffffff');
      expect(DEFAULT_THEME.selectionForeground).toBe('#282c34');
    });

    test('DEFAULT_THEME is an alias of GHOSTTY_DEFAULT_THEME', () => {
      expect(DEFAULT_THEME).toBe(GHOSTTY_DEFAULT_THEME);
    });
  });

  describe('Theme Color Format', () => {
    test('all colors are valid hex strings', () => {
      const hexPattern = /^#[0-9a-f]{6}$/i;

      expect(DEFAULT_THEME.black).toMatch(hexPattern);
      expect(DEFAULT_THEME.foreground).toMatch(hexPattern);
      expect(DEFAULT_THEME.background).toMatch(hexPattern);
      expect(DEFAULT_THEME.cursor).toMatch(hexPattern);
    });
  });

  describe('parseHexColor', () => {
    test('parses long and short hex, with or without a leading #', () => {
      expect(parseHexColor('#282c34')).toEqual({ r: 0x28, g: 0x2c, b: 0x34 });
      expect(parseHexColor('282c34')).toEqual({ r: 0x28, g: 0x2c, b: 0x34 });
      expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    test('returns null for invalid input', () => {
      expect(parseHexColor(undefined)).toBeNull();
      expect(parseHexColor('not-a-color')).toBeNull();
    });
  });

  describe('isCovering', () => {
    test('matches full block, like Ghostty', () => {
      expect(isCovering(0x2588)).toBe(true);
      expect(isCovering(0x2580)).toBe(false);
      expect(isCovering('a'.codePointAt(0)!)).toBe(false);
    });
  });
});
