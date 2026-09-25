/**
 * Undo and redo from the keyboard (item 12). The app takes the keys wherever the focus is, since
 * the browser's own undo would fight the app's history where the browser keeps one of its own: in
 * the overlay, whose rows are drawn anew on every input, so that the browser's record of them is
 * wrong, and in the panel's inputs, whose typing reaches the document only at a pause. What the
 * user is typing in loses the focus first, which ends the visit to it (`holdsTyping`), and then the
 * history takes back a step, a visit to a field rather than a keystroke (`History`, `document.ts`).
 * Only inside an element marked `NATIVE_UNDO`, as the link popover is, do the keys stay the
 * browser's: what is typed there reaches the document only when it is applied, so the history has
 * none of it to take back, and taking the focus out of it would close the rich editor and lose it.
 *
 * The keys are taken before any element sees them, in the capture phase on the window, since the
 * rich editor would otherwise stop them: ProseMirror prevents the browser's action for Mod with Z
 * or Y as they reach its editor, whether or not it binds them, and the rich fields bind neither,
 * so a listener after it would find the key spent and nothing done.
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
 * The attribute that marks an element whose typing keeps the browser's own undo and redo, as the
 * link popover's does (`RichOverlay.tsx`): the keys pressed anywhere inside it are the browser's,
 * which undoes and redoes the typing in the input that has the focus.
 */
export const NATIVE_UNDO = "data-native-undo";

/**
 * Whether a key was pressed at or inside an element marked `NATIVE_UNDO`. A key goes to the
 * element with the focus, or else to the body; one sent to the document or the window, which
 * have no `closest`, is in no element.
 */
function inNativeUndo(target: EventTarget | null): boolean {
  const element = target as Partial<Pick<Element, "closest">> | null;
  return typeof element?.closest === "function" && element.closest(`[${NATIVE_UNDO}]`) !== null;
}

/** Where the keys are listened for: the window, or a stand-in for it. */
export type KeyTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** The listener's phase: the capture phase, before any element under the window sees a key. */
const CAPTURE = { capture: true } as const;

/**
 * Listen on `target`, the window, for the undo and redo keys pressed anywhere in the page, and
 * give each to `take`, which says whether it took the key; returns what stops the listening. The
 * listener runs in the capture phase, after only the window's own capture listeners, so that no
 * element, the rich editor least of all, spends the key before it. A key taken is stopped there:
 * neither the browser's undo nor anything under the window acts on it. A key a capture listener
 * on the window has prevented already is left to that listener, a key pressed inside an element
 * marked `NATIVE_UNDO` is left to the browser without asking `take`, and a key not taken, as while
 * no document is open, goes on as if the listener were not there.
 */
export function listenForHistoryKeys(target: KeyTarget, take: (way: Way) => boolean): () => void {
  const listener = (event: Event) => {
    const press = event as KeyboardEvent;
    const way = historyKey(press);
    if (way === undefined || press.defaultPrevented || inNativeUndo(press.target)) return;
    if (!take(way)) return;
    press.preventDefault();
    press.stopPropagation();
  };
  target.addEventListener("keydown", listener, CAPTURE);
  return () => target.removeEventListener("keydown", listener, CAPTURE);
}

/**
 * Give the undo and redo keys, pressed anywhere in the page but inside an element that keeps the
 * browser's own (`NATIVE_UNDO`), to `take`, the one from the latest render, which says whether it
 * took the key (`listenForHistoryKeys`).
 */
export function useHistoryKeys(take: (way: Way) => boolean): void {
  const latest = useRef(take);
  useLayoutEffect(() => {
    latest.current = take;
  });
  useEffect(() => listenForHistoryKeys(window, (way) => latest.current(way)), []);
}
