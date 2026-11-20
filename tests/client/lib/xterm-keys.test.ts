import { describe, expect, it } from "vite-plus/test";
import { classifyKey, type KeyLike } from "@/lib/xterm";

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  type: "keydown",
  code,
  key: code.replace(/^Key/, "").toLowerCase(),
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("classifyKey on Windows/Linux", () => {
  const pc = (event: KeyLike, selection = false) => classifyKey(event, false, selection);

  it("lets every paste chord through to the browser's paste event", () => {
    expect(pc(key("KeyV", { ctrlKey: true }))).toBe("native-paste");
    expect(pc(key("KeyV", { ctrlKey: true, shiftKey: true }))).toBe("native-paste");
    expect(pc(key("Insert", { shiftKey: true }))).toBe("native-paste");
  });

  it("keeps Ctrl+C an interrupt unless there is a selection to copy", () => {
    expect(pc(key("KeyC", { ctrlKey: true }))).toBe("pass");
    expect(pc(key("KeyC", { ctrlKey: true }), true)).toBe("copy");
  });

  it("always takes Ctrl+Shift+C (copy, never Chrome's inspector or ^C)", () => {
    expect(pc(key("KeyC", { ctrlKey: true, shiftKey: true }))).toBe("copy");
    expect(pc(key("KeyC", { ctrlKey: true, shiftKey: true }), true)).toBe("copy");
  });

  it("steps the font with Ctrl + = / - / 0", () => {
    expect(pc(key("Equal", { ctrlKey: true }))).toBe("font-up");
    expect(pc(key("Minus", { ctrlKey: true }))).toBe("font-down");
    expect(pc(key("Digit0", { ctrlKey: true }))).toBe("font-reset");
  });

  it("leaves terminal chords alone", () => {
    for (const code of ["KeyA", "KeyD", "KeyR", "KeyZ", "KeyL", "KeyW"]) {
      expect(pc(key(code, { ctrlKey: true }))).toBe("pass");
    }
    expect(pc(key("KeyV", { ctrlKey: true, altKey: true }))).toBe("pass");
    expect(pc(key("KeyV"))).toBe("pass");
    expect(pc(key("KeyV", { type: "keyup", ctrlKey: true }))).toBe("pass");
  });
});

describe("classifyKey on macOS", () => {
  const mac = (event: KeyLike, selection = false) => classifyKey(event, true, selection);

  it("pastes with Cmd+V and keeps Ctrl+V as ^V", () => {
    expect(mac(key("KeyV", { metaKey: true }))).toBe("native-paste");
    expect(mac(key("KeyV", { ctrlKey: true }))).toBe("pass");
  });

  it("copies with Cmd+C when there is a selection; Ctrl+C is always ^C", () => {
    expect(mac(key("KeyC", { metaKey: true }), true)).toBe("copy");
    expect(mac(key("KeyC", { metaKey: true }))).toBe("pass");
    expect(mac(key("KeyC", { ctrlKey: true }), true)).toBe("pass");
  });

  it("steps the font with Cmd", () => {
    expect(mac(key("Equal", { metaKey: true }))).toBe("font-up");
    expect(mac(key("Equal", { ctrlKey: true }))).toBe("pass");
  });
});
