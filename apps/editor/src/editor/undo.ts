/**
 * Undo and redo from the keyboard (item 12). The app takes the keys wherever the focus is, since
 * the browser's own undo would fight the app's history where the browser keeps one of its own: in
 * the overlay, whose rows are drawn anew on every input, so that the browser's record of them is
 * wrong, and in the panel's inputs, whose typing reaches the document only at a pause. What the
 * user is typing in loses the focus first, which ends the visit to it (`holdsTyping`), and then the
 * history takes back a step, a visit to a field rather than a keystroke (`History`, `document.ts`).
 */

import { useEffect, useLayoutEffect, useRef } from "react";

/** Which way through the history an undo or a redo goes. */
export type Way = "undo" | "redo";

/** What a key press says about whether it asks for an undo or a redo: `KeyboardEvent`'s own. */
export type KeyPress = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing"
>;

/**
 * The letter a key press gives a shortcut: the Latin letter it types, or, on a layout that types a
 * letter of another script there, such as a Cyrillic or Greek one, the letter at the key's place on
 * a US keyboard, which is how the system reads shortcuts on such a layout. A key that types another
 * character in ASCII gives none, so that Dvorak's semicolon, at the place of QWERTY's Z, is not Z.
 */
function letterOf({ key, code }: Pick<KeyPress, "key" | "code">): string | undefined {
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  if (key.charCodeAt(0) <= 0x7f) return undefined;
  return /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase();
}

/**
 * The way a key press asks the history to go, if it asks: Cmd or Ctrl with Z undoes, and with Shift
 * as well redoes, and Ctrl with Y redoes, as on Windows. Cmd and Ctrl count alike on every system,
 * which spares telling the systems apart; Cmd with Y stays the browser's, which shows its history
 * with it on a Mac. A press with Alt or Option is neither, since Windows reports AltGr as Ctrl with
 * Alt, and AltGr with Z types a letter on some layouts, ż on the Polish; and neither is a press
 * while an input method composes, which is the input method's.
 */
export function historyKey(press: KeyPress): Way | undefined {
  if (press.isComposing || press.altKey) return undefined;
  const letter = letterOf(press);
  if (letter === "z" && (press.metaKey || press.ctrlKey)) return press.shiftKey ? "redo" : "undo";
  if (letter === "y" && press.ctrlKey && !press.metaKey && !press.shiftKey) return "redo";
  return undefined;
}

/** The input types that take typing, whose text the browser keeps an undo of its own for. */
const TYPED = new Set(["text", "search", "email", "tel", "url", "password", "number"]);

/**
 * Whether an element takes typing, as the overlay and the panel's inputs do, so that the browser
 * keeps an undo of its own for it. The app's undo takes the focus out of such an element first,
 * which sends what a panel input holds back for a pause and ends the visit to it. Anything else,
 * such as a button, a menu or a slider, holds nothing an undo has to take in first, and keeps the
 * focus, so that Undo can be pressed again from the keyboard.
 */
export function holdsTyping(
  element: Pick<HTMLElement, "tagName" | "isContentEditable"> & { type?: string },
): boolean {
  if (element.isContentEditable || element.tagName === "TEXTAREA") return true;
  return element.tagName === "INPUT" && TYPED.has(element.type ?? "text");
}

/**
 * Give the undo and redo keys, pressed anywhere in the page, to `take`, the one from the latest
 * render, which says whether it took the key. A key taken does nothing more, so that the browser's
 * own undo never runs on the overlay's rows or a panel input's text; a key another listener has
 * taken already, and prevented the browser's action for, is left to that listener.
 */
export function useHistoryKeys(take: (way: Way) => boolean): void {
  const latest = useRef(take);
  useLayoutEffect(() => {
    latest.current = take;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const way = historyKey(event);
      if (way !== undefined && !event.defaultPrevented && latest.current(way))
        event.preventDefault();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
