/**
 * The typeset page, as SVG, with every glyph clickable. A click on a glyph that belongs to a
 * field reports the field and the character the click landed on.
 *
 * A locked part of an imported resume, kept as the upload had it, is no field (decision 0041): a
 * click on it reports nothing, so that neither the plain overlay nor the rich editor opens there;
 * the pointer over it shows a lock, and one line that says what the part is and where it is
 * changed, over the part's blocks; and nothing of it, or of its lock, takes the focus, so that the
 * keyboard passes it by.
 */

import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { PageSize } from "../tex/svg";
import type { Box, LockedRegion } from "./locked";

/** What the lock over a locked part says. */
export const LOCKED_TIP = "Kept as it was; remove or move it from the side panel";

export interface PageProps {
  svg: string;
  onField?: (field: string, offset: number) => void;
  /** The page's locked parts, by id (`DrawnPage.locked`), whose blocks the lock shows over. */
  locked?: ReadonlyMap<string, Pick<LockedRegion, "blocks">>;
  /** The page's size, in TeX points, which places the lock where the SVG draws the part. */
  size?: PageSize;
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

/** What a click on the page does: report the field and character under it, if there is one. */
export function onPageClick(onField?: PageProps["onField"]) {
  return (event: { target: EventTarget | null }) => {
    const hit = fieldAt(event.target as Element | null);
    if (hit) onField?.(hit.field, hit.offset);
  };
}

/** The page's own element, which the lock is placed in. */
const HOST = { position: "relative" } as const;

export function Page({ svg, onField, locked, size }: PageProps) {
  const host = useRef<HTMLDivElement>(null);
  // The locked part the pointer is over, by id.
  const [over, setOver] = useState<string>();
  const part = over === undefined ? undefined : locked?.get(over);
  return (
    <div
      ref={host}
      className="page"
      style={HOST}
      onClick={onPageClick(onField)}
      onPointerOver={(event) => setOver(lockedAt(event.target as Element | null))}
      onPointerLeave={() => setOver(undefined)}
    >
      {/* The SVG is built by src/tex/svg.ts from the engine's output, with every string escaped. */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      {part && size && <Lock host={host} svg={svg} size={size} blocks={part.blocks} />}
    </div>
  );
}

/** Where the page's SVG is drawn in its host: its top-left corner, and CSS pixels per TeX point. */
interface Frame {
  x: number;
  y: number;
  scale: number;
}

/** The lock's look: a line of plain words on dark, which takes no pointer and no focus. */
const TIP = {
  position: "absolute",
  zIndex: 2,
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
 * `LOCKED_TIP`. Placed where the page's SVG is drawn now, read again with each new page: the SVG
 * is scaled to its container, so its box against the page's size in TeX points gives the scale.
 */
function Lock({
  host,
  svg,
  size,
  blocks,
}: {
  host: RefObject<HTMLDivElement | null>;
  svg: string;
  size: PageSize;
  blocks: readonly Box[];
}) {
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
  const [first] = blocks;
  if (frame === undefined || first === undefined) return null;
  const placed = (block: Box) => ({
    left: frame.x + block.left * frame.scale,
    top: frame.y + block.top * frame.scale,
    width: (block.right - block.left) * frame.scale,
    height: (block.bottom - block.top) * frame.scale,
  });
  const { left, top } = placed(first);
  return (
    <>
      {blocks.map((block, index) => (
        // A part's blocks are its own, in the page's order, and change only with a new page.
        <div key={index} className="locked-block" style={{ ...BLOCK, ...placed(block) }} />
      ))}
      <div className="locked-tip" role="tooltip" style={{ ...TIP, left, top: top - 2 }}>
        <Padlock />
        {LOCKED_TIP}
      </div>
    </>
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
