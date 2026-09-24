/**
 * The typeset page, as SVG, with every glyph clickable. A click on a glyph that belongs to a
 * field reports the field and the character the click landed on.
 */

import type { MouseEvent } from "react";

export interface PageProps {
  svg: string;
  onField?: (field: string, offset: number) => void;
}

export function Page({ svg, onField }: PageProps) {
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const glyph = (event.target as Element).closest("[data-field]");
    if (!glyph || !onField) return;
    onField(glyph.getAttribute("data-field") ?? "", Number(glyph.getAttribute("data-offset")));
  };
  return (
    // The SVG is built by src/tex/svg.ts from the engine's output, with every string escaped.
    <div className="page" onClick={click} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
