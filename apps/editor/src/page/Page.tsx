/**
 * The typeset page, as SVG, with every glyph clickable. A click on a glyph that belongs to a
 * field reports the field and the character the click landed on.
 */

import type { MouseEvent } from "react";

export interface PageProps {
  svg: string;
  onField?: (field: string, offset: number) => void;
}

/** The field and character offset of the glyph a click landed on, from its data attributes. */
export function fieldAt(target: Element | null): { field: string; offset: number } | undefined {
  const glyph = target?.closest("[data-field]");
  const field = glyph?.getAttribute("data-field");
  const offset = glyph?.getAttribute("data-offset");
  return field && offset && /^\d+$/.test(offset) ? { field, offset: Number(offset) } : undefined;
}

export function Page({ svg, onField }: PageProps) {
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const hit = fieldAt(event.target as Element);
    if (hit) onField?.(hit.field, hit.offset);
  };
  return (
    // The SVG is built by src/tex/svg.ts from the engine's output, with every string escaped.
    <div className="page" onClick={click} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
