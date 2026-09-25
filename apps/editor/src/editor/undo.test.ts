import { describe, expect, it } from "vitest";
import {
  historyKey,
  holdsTyping,
  type KeyPress,
  type KeyTarget,
  listenForHistoryKeys,
  NATIVE_UNDO,
  refuseNativeUndo,
  type Way,
} from "./undo";

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

describe("listenForHistoryKeys and refuseNativeUndo", () => {
  /**
   * An event as the listeners on its way see it, which they can prevent and stop, with the place it
   * happened at once it is dispatched.
   */
  interface Dispatched {
    type: string;
    target: Place | null;
    defaultPrevented: boolean;
    stopped: boolean;
    preventDefault(): void;
    stopPropagation(): void;
  }
  /** A key press, as `keydown` gives it. */
  type Press = KeyPress & Dispatched;
  /** An input the browser is about to make, as `beforeinput` gives it. */
  type Input = Dispatched & { inputType: string };

  /** A new event of `type`, with `details`, not yet dispatched. */
  function newEvent<Details extends object>(type: string, details: Details): Details & Dispatched {
    const event: Details & Dispatched = {
      ...details,
      type,
      target: null,
      defaultPrevented: false,
      stopped: false,
      preventDefault: () => {
        event.defaultPrevented = true;
      },
      stopPropagation: () => {
        event.stopped = true;
      },
    };
    return event;
  }
  const keydown = (press: Partial<KeyPress>): Press => newEvent("keydown", pressed(press));
  const beforeinput = (inputType: string): Input => newEvent("beforeinput", { inputType });

  type Listener = (event: Dispatched) => void;

  /**
   * A stand-in for a node of the page, in `parent`: its listeners in the order they were added,
   * and the attributes it has, which `closest` looks for as the DOM's does, at the place and then
   * at each place it is in.
   */
  class Place implements KeyTarget {
    readonly listeners: { type: string; listener: Listener; capture: boolean }[] = [];
    constructor(
      readonly parent?: Place,
      readonly attributes: readonly string[] = [],
    ) {}
    closest(selector: string): Place | null {
      if (this.attributes.some((name) => selector === `[${name}]`)) return this;
      return this.parent?.closest(selector) ?? null;
    }
    addEventListener(type: string, listener: unknown, options?: boolean | { capture?: boolean }) {
      const capture = typeof options === "boolean" ? options : options?.capture === true;
      this.listeners.push({ type, listener: listener as Listener, capture });
    }
    removeEventListener(
      type: string,
      listener: unknown,
      options?: boolean | { capture?: boolean },
    ) {
      const capture = typeof options === "boolean" ? options : options?.capture === true;
      const at = this.listeners.findIndex(
        (each) => each.type === type && each.listener === listener && each.capture === capture,
      );
      if (at >= 0) this.listeners.splice(at, 1);
    }
  }

  /**
   * An event at `target`, dispatched as the DOM dispatches it: to the capture listeners for its
   * type from the window down to the target, then to the others from the target up to the window,
   * a place's listeners in order. Once one stops the event, no place after it hears it.
   */
  function dispatch(target: Place, event: Dispatched) {
    const path: Place[] = [];
    for (let place: Place | undefined = target; place; place = place.parent) path.unshift(place);
    event.target = target;
    const invoke = (place: Place, capture: boolean) => {
      if (event.stopped) return;
      for (const each of [...place.listeners])
        if (each.type === event.type && each.capture === capture) each.listener(event);
    };
    for (const place of path) invoke(place, true);
    for (const place of [...path].reverse()) invoke(place, false);
  }

  /**
   * The page with a rich field open, and the app listening on its window as `useHistoryKeys` does:
   * the window, the document, the body, the rich editor, which holds ProseMirror's editor and the
   * link popover, and an input of the side panel. ProseMirror's keydown listener does what
   * prosemirror-view's does: it prevents the browser's action for Mod with B, I, Y or Z and no
   * other modifier, Mod being Cmd on a Mac and Ctrl elsewhere, whether or not the editor binds the
   * key (`captureKeyDown`). A key is pressed in ProseMirror's editor, unless at another place.
   */
  function richField(mac: boolean) {
    const window = new Place();
    const body = new Place(new Place(window));
    const wrapper = new Place(body);
    const editor = new Place(wrapper);
    // The popover, marked as `RichOverlay.tsx` marks it, and the address's input in its label.
    const address = new Place(new Place(new Place(wrapper, [NATIVE_UNDO])));
    // A text input of the side panel, in its column beside the page.
    const panel = new Place(new Place(body));
    const heard: string[] = [];
    editor.addEventListener("keydown", (press: Press) => {
      heard.push(press.key);
      const mod = mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
      if (mod && !press.altKey && !press.shiftKey && /^[biyz]$/.test(press.key))
        press.preventDefault();
    });
    const ways: Way[] = [];
    const taking = { documentOpen: true };
    const stopKeys = listenForHistoryKeys(window, (way) => {
      ways.push(way);
      return taking.documentOpen;
    });
    const stopRefusing = refuseNativeUndo(window, () => taking.documentOpen);
    const stop = () => {
      stopKeys();
      stopRefusing();
    };
    const press = (keys: Partial<KeyPress>, at: Place = editor) => {
      const event = keydown(keys);
      dispatch(at, event);
      return event;
    };
    /** The browser about to make an input of `inputType` at `at`. */
    const input = (inputType: string, at: Place) => {
      const event = beforeinput(inputType);
      dispatch(at, event);
      return event;
    };
    return { window, address, panel, heard, ways, taking, stop, press, input };
  }

  it("takes Cmd+Z in a rich field before ProseMirror, which would spend it, and stops it there", () => {
    const field = richField(true);
    const z = field.press({ metaKey: true });
    expect(field.ways).toEqual(["undo"]);
    expect(z.defaultPrevented).toBe(true);
    expect(field.heard).toEqual([]);
    field.press({ key: "Z", metaKey: true, shiftKey: true });
    expect(field.ways).toEqual(["undo", "redo"]);
    expect(field.heard).toEqual([]);
    // Once the app stops listening, the key is ProseMirror's again.
    field.stop();
    expect(field.window.listeners).toEqual([]);
    field.press({ metaKey: true });
    expect(field.ways).toEqual(["undo", "redo"]);
    expect(field.heard).toEqual(["z"]);
  });

  it("takes Ctrl+Z and Ctrl+Y in a rich field on Windows and Linux in the same way", () => {
    const field = richField(false);
    const z = field.press({ ctrlKey: true });
    const y = field.press({ key: "y", code: "KeyY", ctrlKey: true });
    expect(field.ways).toEqual(["undo", "redo"]);
    expect([z.defaultPrevented, y.defaultPrevented]).toEqual([true, true]);
    expect(field.heard).toEqual([]);
  });

  it("leaves alone a key it does not take: the field's own, one no document takes, one taken", () => {
    const field = richField(true);
    for (const key of ["b", "i", "k", "Enter", "Escape"])
      field.press({ key, code: "", metaKey: key.length === 1 });
    expect(field.heard).toEqual(["b", "i", "k", "Enter", "Escape"]);
    expect(field.ways).toEqual([]);
    // Asked, but not taken, as while the document list shows: ProseMirror hears it, as if the
    // listener were not there.
    field.taking.documentOpen = false;
    const z = field.press({ metaKey: true });
    expect(field.ways).toEqual(["undo"]);
    expect(field.heard.at(-1)).toBe("z");
    expect(z.stopped).toBe(false);
    // A capture listener on the window before it, which has prevented the key, has taken it.
    const window = new Place();
    window.addEventListener("keydown", (press: Press) => press.preventDefault(), true);
    const ways: Way[] = [];
    listenForHistoryKeys(window, (way) => ways.push(way) > 0);
    const prevented = keydown({ metaKey: true });
    dispatch(new Place(window), prevented);
    expect(ways).toEqual([]);
    expect(prevented.stopped).toBe(false);
  });

  it("leaves the keys in the link popover to the browser, which undoes the typing there", () => {
    const field = richField(true);
    const typed: string[] = [];
    field.address.addEventListener("keydown", (press: Press) => typed.push(press.key));
    const presses = [
      { metaKey: true },
      { ctrlKey: true },
      { key: "Z", metaKey: true, shiftKey: true },
      { key: "y", code: "KeyY", ctrlKey: true },
    ].map((keys) => field.press(keys, field.address));
    // Not taken, not prevented and not stopped: the address's input hears each, and the browser
    // undoes or redoes what was typed in it.
    expect(field.ways).toEqual([]);
    expect(presses.map((press) => [press.defaultPrevented, press.stopped])).toEqual(
      presses.map(() => [false, false]),
    );
    expect(typed).toEqual(["z", "z", "Z", "y"]);
    // Outside the popover, in the field's text beside it, the app takes the key still.
    const z = field.press({ metaKey: true });
    expect(field.ways).toEqual(["undo"]);
    expect(z.defaultPrevented).toBe(true);
    expect(field.heard).toEqual([]);
  });

  it("refuses the browser's undo and redo outside the popover while a document is open", () => {
    const field = richField(true);
    // The browser's undo goes to the element whose typing it takes back: after the address's own
    // typing, a panel input's, which it would change and move the focus to, as its Edit menu would.
    const refused = ["historyUndo", "historyRedo"].map((type) => field.input(type, field.panel));
    expect(refused.map((input) => input.defaultPrevented)).toEqual([true, true]);
    expect(refused.map((input) => input.stopped)).toEqual([false, false]);
    // In the address, the browser takes back and makes again what was typed there; and typing is
    // typing anywhere.
    const allowed = [
      field.input("historyUndo", field.address),
      field.input("historyRedo", field.address),
      field.input("insertText", field.panel),
    ];
    expect(allowed.map((input) => input.defaultPrevented)).toEqual([false, false, false]);
    // With no document open, as while the list shows, and once the app stops listening, the
    // browser's undo is its own again.
    field.taking.documentOpen = false;
    expect(field.input("historyUndo", field.panel).defaultPrevented).toBe(false);
    field.taking.documentOpen = true;
    field.stop();
    expect(field.window.listeners).toEqual([]);
    expect(field.input("historyUndo", field.panel).defaultPrevented).toBe(false);
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
