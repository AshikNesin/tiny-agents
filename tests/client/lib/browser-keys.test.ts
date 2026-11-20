/**
 * @vitest-environment jsdom
 *
 * Mac chords for the remote Linux Chrome (issue #24): Cmd shortcuts become
 * Ctrl shortcuts, and Cmd+Arrow becomes the Linux line/page motion.
 */
import { describe, expect, it } from "vite-plus/test";
import { keysymFor, remapMetaChord } from "@/lib/browser-keys";

const CONTROL_L = 0xffe3;
const SHIFT_L = 0xffe1;
const ALT_L = 0xffe9;

const chord = (key: string, extra: Partial<{ shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
  shiftKey: false,
  altKey: false,
  ...extra,
});

const summary = (strokes: ReturnType<typeof remapMetaChord>) =>
  strokes?.map((s) => `${s.down ? "+" : "-"}${s.keysym.toString(16)}`);

describe("browser keys", () => {
  it("maps keys to X11 keysyms", () => {
    expect(keysymFor("a")).toBe(0x61);
    expect(keysymFor("Enter")).toBe(0xff0d);
    expect(keysymFor("Backspace")).toBe(0xff08);
    expect(keysymFor("€")).toBe(0x01000000 + 0x20ac);
    expect(keysymFor("Unidentified")).toBeUndefined();
  });

  it("turns Cmd+letter into Ctrl+letter", () => {
    expect(summary(remapMetaChord(chord("c")))).toEqual([
      `+${CONTROL_L.toString(16)}`,
      "+63",
      "-63",
      `-${CONTROL_L.toString(16)}`,
    ]);
  });

  it("keeps Shift and Alt around the Ctrl chord and releases in reverse", () => {
    const strokes = remapMetaChord(chord("t", { shiftKey: true, altKey: true }))!;
    expect(strokes.filter((s) => s.down).map((s) => s.keysym)).toEqual([
      SHIFT_L,
      ALT_L,
      CONTROL_L,
      0x74,
    ]);
    expect(strokes.filter((s) => !s.down).map((s) => s.keysym)).toEqual([
      0x74,
      CONTROL_L,
      ALT_L,
      SHIFT_L,
    ]);
  });

  it("uses the physical key when Option changes the glyph", () => {
    const strokes = remapMetaChord({ key: "ç", code: "KeyC", shiftKey: false, altKey: true })!;
    expect(strokes.some((s) => s.keysym === 0x63)).toBe(true);
  });

  it("maps Cmd+Left/Right to Home/End without Ctrl", () => {
    expect(summary(remapMetaChord(chord("ArrowLeft")))).toEqual(["+ff50", "-ff50"]);
    expect(summary(remapMetaChord(chord("ArrowRight")))).toEqual(["+ff57", "-ff57"]);
  });

  it("maps Cmd+Up/Down to Ctrl+Home/End", () => {
    expect(summary(remapMetaChord(chord("ArrowUp")))).toEqual([
      `+${CONTROL_L.toString(16)}`,
      "+ff50",
      "-ff50",
      `-${CONTROL_L.toString(16)}`,
    ]);
    expect(summary(remapMetaChord(chord("ArrowDown")))?.[1]).toBe("+ff57");
  });

  it("sends nothing for a key with no keysym", () => {
    expect(remapMetaChord(chord("Dead"))).toBeNull();
  });
});
