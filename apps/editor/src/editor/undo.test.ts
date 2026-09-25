import { describe, expect, it } from "vitest";
import { historyKey, holdsTyping, type KeyPress } from "./undo";

/** A press of QWERTY's Z with no modifier, changed by `press`. */
const pressed = (press: Partial<KeyPress>): KeyPress => ({
  key: "z",
  code: "KeyZ",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  ...press,
});

describe("historyKey", () => {
  it("undoes with Cmd or Ctrl and Z, and redoes with Shift as well", () => {
    expect(historyKey(pressed({ metaKey: true }))).toBe("undo");
    expect(historyKey(pressed({ ctrlKey: true }))).toBe("undo");
    // Shift gives the capital, or on a Mac with Cmd held the small letter.
    expect(historyKey(pressed({ key: "Z", metaKey: true, shiftKey: true }))).toBe("redo");
    expect(historyKey(pressed({ key: "z", metaKey: true, shiftKey: true }))).toBe("redo");
    expect(historyKey(pressed({ key: "Z", ctrlKey: true, shiftKey: true }))).toBe("redo");
  });

  it("redoes with Ctrl and Y, and leaves Cmd and Y to the browser", () => {
    const y = { key: "y", code: "KeyY" };
    expect(historyKey(pressed({ ...y, ctrlKey: true }))).toBe("redo");
    expect(historyKey(pressed({ ...y, metaKey: true }))).toBeUndefined();
    expect(historyKey(pressed({ ...y, key: "Y", ctrlKey: true, shiftKey: true }))).toBeUndefined();
  });

  it("takes no letter alone or another letter, nothing with Alt, and nothing while composing", () => {
    expect(historyKey(pressed({}))).toBeUndefined();
    expect(historyKey(pressed({ key: "Z", shiftKey: true }))).toBeUndefined();
    expect(historyKey(pressed({ key: "x", code: "KeyX", metaKey: true }))).toBeUndefined();
    // Windows reports AltGr as Ctrl with Alt, and AltGr with Z types ż on the Polish layout.
    expect(historyKey(pressed({ key: "ż", ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(historyKey(pressed({ key: "Ω", metaKey: true, altKey: true }))).toBeUndefined();
    expect(historyKey(pressed({ metaKey: true, isComposing: true }))).toBeUndefined();
  });

  it("reads a Latin layout by its letters, and another script's by the US keyboard's", () => {
    // AZERTY types W at QWERTY's Z, and Z at its W.
    expect(historyKey(pressed({ key: "w", metaKey: true }))).toBeUndefined();
    expect(historyKey(pressed({ key: "z", code: "KeyW", metaKey: true }))).toBe("undo");
    // Dvorak types a semicolon at QWERTY's Z, and Z at its slash.
    expect(historyKey(pressed({ key: ";", ctrlKey: true }))).toBeUndefined();
    expect(historyKey(pressed({ key: "z", code: "Slash", ctrlKey: true }))).toBe("undo");
    // The Russian layout types я at QWERTY's Z and н at its Y.
    expect(historyKey(pressed({ key: "я", metaKey: true }))).toBe("undo");
    expect(historyKey(pressed({ key: "Я", metaKey: true, shiftKey: true }))).toBe("redo");
    expect(historyKey(pressed({ key: "н", code: "KeyY", ctrlKey: true }))).toBe("redo");
    expect(historyKey(pressed({ key: "н", code: "KeyY", metaKey: true }))).toBeUndefined();
  });
});

describe("holdsTyping", () => {
  const element = (tagName: string, more: { type?: string; isContentEditable?: boolean } = {}) => ({
    tagName,
    isContentEditable: false,
    ...more,
  });

  it("holds for text inputs, text areas and editable content such as the overlay's rows", () => {
    for (const type of ["text", "search", "email", "tel", "url", "password", "number"])
      expect(holdsTyping(element("INPUT", { type })), type).toBe(true);
    expect(holdsTyping(element("TEXTAREA"))).toBe(true);
    expect(holdsTyping(element("DIV", { isContentEditable: true }))).toBe(true);
  });

  it("does not for buttons, menus, sliders, pickers and boxes, which keep the focus", () => {
    for (const type of ["range", "color", "radio", "checkbox", "month", "button"])
      expect(holdsTyping(element("INPUT", { type })), type).toBe(false);
    for (const tagName of ["BUTTON", "SELECT", "BODY", "DIV"])
      expect(holdsTyping(element(tagName)), tagName).toBe(false);
  });
});
