/**
 * The typeset pages, as SVG, one under the other, with every glyph clickable. A click on a glyph
 * that belongs to a field reports the field and the character the click landed on, whatever page
 * it is on (decision 0046).
 *
 * A locked part of an imported resume, kept as the upload had it, is no field (decision 0041): a
 * click on it reports nothing, so that neither the plain overlay nor the rich editor opens there;
 * the pointer over it shows a lock, and one line that says what the part is and where it is
 * changed, over the part's blocks, on every page it is on; and nothing of it, or of its lock, takes
 * the focus, so that the keyboard passes it by. A part whose words can be retyped (milestone 3 item
 * 16, decision 0042) says so in its lock's line, and a click on it reports it, so that the app opens
 * its small editor, which the page places under the part's first block.
 */

import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { PageSize } from "../tex/svg";
import type { DrawnPage } from "./draw";
import type { Box, LockedRegion } from "./locked";

/** What the lock over a locked part says. */
export const LOCKED_TIP = "Kept as it was; remove or move it from the side panel";

/**
 * What the lock over a locked part says when its words can be retyped (decision 0042): a click on
 * it opens its small editor.
 */
export const RETYPE_TIP =
  "Kept as it was; click to change its words, or remove or move it from the side panel";

export interface PageProps {
  svg: string;
  onField?: (field: string, offset: number) => void;
  /** The page's locked parts, by id (`DrawnPage.locked`), whose blocks the lock shows over. */
  locked?: ReadonlyMap<string, Pick<LockedRegion, "blocks">>;
  /** The page's size, in TeX points, which places the lock where the SVG draws the part. */
  size?: PageSize;
  /** The page's index among the document's, which its element carries (`pageSvg`). */
  index?: number;
  /**
   * The locked part the pointer is over, by id, on this page or another, and what the page says
   * when the pointer comes over a part of its own or leaves it: given by `Pages`, which shows a
   * part's lock on every page it is on. Without them the page keeps its own.
   */
  over?: string;
  onOver?: (part: string | undefined) => void;
  /** Whether the page shows the lock's line over its first block of the part; it does by default. */
  tip?: boolean;
  /**
   * The locked parts whose words can be retyped (decision 0042), whose lock's line says so
   * (`RETYPE_TIP`), and a click on which reports the part (`onLocked`).
   */
  retypable?: ReadonlySet<string>;
  onLocked?: (part: string) => void;
  /**
   * The small editor of the part being retyped, by its id, which this page places under the part's
   * first block; given only to the page where the part starts.
   */
  editing?: { part: string; editor: ReactNode };
}

/** The field and character offset of the glyph a click landed on, from its data attributes. */
export function fieldAt(target: Element | null): { field: string; offset: number } | undefined {
  const glyph = target?.closest("[data-field]");
  const field = glyph?.getAttribute("data-field");
  const offset = glyph?.getAttribute("data-offset");
  return field && offset && /^\d+$/.test(offset) ? { field, offset: Number(offset) } : undefined;
}

/**
 * The locked part the pointer is over, from the element under it: a glyph of the part, or one of
 * the boxes the SVG draws under its blocks; undefined over anything else, and over a field's glyph,
 * which is the field's, whatever lies under it.
 */
export function lockedAt(target: Element | null): string | undefined {
  if (typeof target?.closest !== "function" || target.closest("[data-field]")) return undefined;
  return target.closest("[data-locked]")?.getAttribute("data-locked") || undefined;
}

/**
 * What a click on the page does: report the field and character under it, if there is one; else
 * the locked part under it, where its words can be retyped (`retypable`), so that its editor opens.
 */
export function onPageClick(
  onField?: PageProps["onField"],
  onLocked?: PageProps["onLocked"],
  retypable?: ReadonlySet<string>,
) {
  return (event: { target: EventTarget | null }) => {
    const target = event.target as Element | null;
    const hit = fieldAt(target);
    if (hit) {
      onField?.(hit.field, hit.offset);
      return;
    }
    const part = lockedAt(target);
    if (part !== undefined && retypable?.has(part)) onLocked?.(part);
  };
}

/** The page's own element, which the lock is placed in. */
const HOST = { position: "relative" } as const;
/** The SVG's own element, which sets no line around it, so that the page ends where the SVG does. */
const DRAWN = { lineHeight: 0 } as const;

export function Page({
  svg,
  onField,
  locked,
  size,
  index,
  over,
  onOver,
  tip = true,
  retypable,
  onLocked,
  editing,
}: PageProps) {
  const host = useRef<HTMLDivElement>(null);
  // The locked part the pointer is over, by id, when no `Pages` keeps it for every page.
  const [own, setOwn] = useState<string>();
  const shared = onOver !== undefined;
  const hovered = shared ? over : own;
  const setOver = shared ? onOver : setOwn;
  const part = hovered === undefined ? undefined : locked?.get(hovered);
  const edited = editing === undefined ? undefined : locked?.get(editing.part)?.blocks[0];
  // A part whose words can be retyped takes a click, as a field does.
  const clickable = hovered !== undefined && retypable?.has(hovered) === true;
  return (
    <div
      ref={host}
      className="page"
      data-page={index}
      style={clickable ? { ...HOST, cursor: "pointer" } : HOST}
      onClick={onPageClick(onField, onLocked, retypable)}
      onPointerOver={(event) => setOver(lockedAt(event.target as Element | null))}
      onPointerLeave={() => setOver(undefined)}
    >
      {/* The SVG is built by src/tex/svg.ts from the engine's output, with every string escaped. */}
      <div style={DRAWN} dangerouslySetInnerHTML={{ __html: svg }} />
      {part && size && part.blocks.length > 0 && (
        <Lock
          host={host}
          svg={svg}
          size={size}
          blocks={part.blocks}
          tip={tip}
          line={hovered !== undefined && retypable?.has(hovered) ? RETYPE_TIP : LOCKED_TIP}
        />
      )}
      {editing && edited && size && (
        <Below host={host} svg={svg} size={size} block={edited}>
          {editing.editor}
        </Below>
      )}
    </div>
  );
}

/** Pages one under the other, apart by this much, each with an edge, so that a page break shows. */
const STACK = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "16px",
} as const;
const SHEET = { boxShadow: "0 0 0 1px #ddd" } as const;

export interface PagesProps {
  /** Every page of the document, in order (`Shown.pages`). */
  pages: readonly Pick<DrawnPage, "svg" | "locked" | "size">[];
  onField?: PageProps["onField"];
  /** The locked parts whose words can be retyped, and what a click on one does (`Page`). */
  retypable?: PageProps["retypable"];
  onLocked?: PageProps["onLocked"];
  /** The small editor of the part being retyped, placed on the page where the part starts. */
  editing?: PageProps["editing"];
}

/**
 * Every page of a document, one under the other (decision 0046), each drawn as `Page` draws one.
 * The pointer over a locked part shows its lock over its blocks on every page that holds them, so
 * that a part a page breaks shows whole, and the lock's line over the first of them. A click on a
 * field's glyph, on any page, reports the field as on the first. A page whose SVG is the one it had
 * is not drawn again: React leaves its element as it is.
 */
export function Pages({ pages, onField, retypable, onLocked, editing }: PagesProps) {
  const [over, setOver] = useState<string>();
  /** The first page that holds a block of a part, which shows its lock's line and its editor. */
  const startOf = (part: string | undefined) =>
    part === undefined
      ? -1
      : pages.findIndex((page) => (page.locked.get(part)?.blocks.length ?? 0) > 0);
  const first = startOf(over);
  const edited = startOf(editing?.part);
  return (
    <div className="pages" style={STACK}>
      {pages.map((page, index) => (
        // A page is the document's page at its index, whatever compile drew it.
        <div key={index} style={SHEET}>
          <Page
            svg={page.svg}
            locked={page.locked}
            size={page.size}
            index={index}
            onField={onField}
            over={over}
            onOver={setOver}
            tip={index === first}
            retypable={retypable}
            onLocked={onLocked}
            {...(index === edited && editing !== undefined ? { editing } : {})}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The SVG of the page `index` among those drawn in `container` (`Pages`), which a field opened on
 * that page is placed over; the container's first SVG for the first page where its pages carry no
 * index, as a lone `Page` does not.
 */
export function pageSvg(container: ParentNode, index: number): SVGSVGElement | null {
  const drawn = container.querySelector<SVGSVGElement>(`[data-page="${index}"] svg`);
  if (drawn !== null || index !== 0) return drawn;
  return container.querySelector<SVGSVGElement>("svg");
}

/** Where the page's SVG is drawn in its host: its top-left corner, and CSS pixels per TeX point. */
interface Frame {
  x: number;
  y: number;
  scale: number;
}

/**
 * The lock's look: a line of plain words on dark, which takes no pointer and no focus, and lies
 * under a field's open overlay, its bar and its pickers, which come after the page at the same
 * height (`zIndex` 1), so that it never covers what is being edited.
 */
const TIP = {
  position: "absolute",
  zIndex: 1,
  transform: "translateY(-100%)",
  display: "flex",
  alignItems: "center",
  gap: "0.35em",
  padding: "2px 6px",
  borderRadius: "3px",
  background: "#333",
  color: "#fff",
  font: "12px system-ui, sans-serif",
  whiteSpace: "nowrap",
  pointerEvents: "none",
} as const;

/** A locked part's block while the pointer is over the part: marked, never as a field's overlay. */
const BLOCK = {
  position: "absolute",
  outline: "1px dashed #888",
  background: "rgba(0, 0, 0, 0.04)",
  pointerEvents: "none",
} as const;

/**
 * The lock over a locked part: each of its blocks marked, and above the first a padlock and
 * `LOCKED_TIP`, moved left as far as it takes to end within the page, unless the line is another
 * page's to show (`tip`), where the part starts on an earlier one. Placed where the page's SVG
 * is drawn now, read again with each new page: the SVG is scaled to its container, so its box
 * against the page's size in TeX points gives the scale.
 */
function Lock({
  host,
  svg,
  size,
  blocks,
  tip: line,
  line: words,
}: {
  host: RefObject<HTMLDivElement | null>;
  svg: string;
  size: PageSize;
  blocks: readonly Box[];
  tip: boolean;
  /** What the line says: `LOCKED_TIP`, or `RETYPE_TIP` for a part whose words can be retyped. */
  line: string;
}) {
  const frame = useFrame(host, svg, size);
  const tip = useRef<HTMLDivElement>(null);
  const [overrun, setOverrun] = useState(0);
  const [first] = blocks;
  const start = frame && first && placed(first, frame);
  // How far the line, at the first block's left, would run past the page's right edge.
  useLayoutEffect(() => {
    const line = tip.current;
    if (!line || !frame || !start) return;
    const pageRight = frame.x + size.width * frame.scale;
    setOverrun(Math.max(0, start.left + line.getBoundingClientRect().width - pageRight));
  }, [frame, start?.left, size]);
  if (frame === undefined || start === undefined) return null;
  return (
    <>
      {blocks.map((block, index) => (
        // A part's blocks are its own, in the page's order, and change only with a new page.
        <div key={index} className="locked-block" style={{ ...BLOCK, ...placed(block, frame) }} />
      ))}
      {line && (
        <div
          ref={tip}
          className="locked-tip"
          role="tooltip"
          style={{ ...TIP, left: Math.max(frame.x, start.left - overrun), top: start.top - 2 }}
        >
          <Padlock />
          {words}
        </div>
      )}
    </>
  );
}

/**
 * Where the page's SVG is drawn in its host, read again with each new page: the SVG is scaled to
 * its container, so its box against the page's size in TeX points gives the scale.
 */
function useFrame(
  host: RefObject<HTMLDivElement | null>,
  svg: string,
  size: PageSize,
): Frame | undefined {
  const [frame, setFrame] = useState<Frame>();
  // Measured again with each page, whose SVG is drawn anew.
  useLayoutEffect(() => {
    const element = host.current;
    const drawn = element?.querySelector("svg");
    if (!element || !drawn) {
      setFrame(undefined);
      return;
    }
    const page = drawn.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const scale = size.width > 0 ? page.width / size.width : 0;
    setFrame({ x: page.left - box.left, y: page.top - box.top, scale });
  }, [host, svg, size]);
  return frame;
}

/** A box on the page where the SVG draws it, in CSS pixels from the host's corner. */
const placed = (block: Box, at: Frame) => ({
  left: at.x + block.left * at.scale,
  top: at.y + block.top * at.scale,
  width: (block.right - block.left) * at.scale,
  height: (block.bottom - block.top) * at.scale,
});

/**
 * The retype editor's place: under a part's first block, from its left edge, over what follows it
 * on the page and over the lock's line, as a field's overlay lies over the page.
 */
const BELOW = { position: "absolute", zIndex: 2 } as const;

/** What is given, placed under `block` where the page's SVG draws it (`useFrame`). */
function Below({
  host,
  svg,
  size,
  block,
  children,
}: {
  host: RefObject<HTMLDivElement | null>;
  svg: string;
  size: PageSize;
  block: Box;
  children: ReactNode;
}) {
  const frame = useFrame(host, svg, size);
  if (frame === undefined) return null;
  const at = placed(block, frame);
  return (
    <div className="retype-place" style={{ ...BELOW, left: at.left, top: at.top + at.height + 4 }}>
      {children}
    </div>
  );
}

/** A padlock, drawn, which says nothing to a screen reader: the line beside it says it all. */
function Padlock() {
  return (
    <svg width="9" height="11" viewBox="0 0 9 11" aria-hidden="true" focusable="false">
      <path d="M2 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="0.5" y="5" width="8" height="5.5" rx="1" fill="currentColor" />
    </svg>
  );
}
