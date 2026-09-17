/**
 * Spike: outlines for XeTeX's native fonts through opentype.js, which reads both CFF and
 * TrueType glyphs. Only the adapter lives here; the renderer sees `NativeOutlines`.
 */

import { parse } from "opentype.js";
import type { NativeOutlines } from "../tex/svg";

export function nativeOutlines(fontFile: ArrayBuffer): NativeOutlines {
  const font = parse(fontFile);
  const paths = new Map<number, string | undefined>();
  return {
    unitsPerEm: font.unitsPerEm,
    pathOf: (id) => {
      if (!paths.has(id)) {
        // Glyph outlines parse lazily, so a corrupt glyph surfaces here; it is left out.
        let d = "";
        try {
          d = font.glyphs.get(id)?.path?.toPathData(2) ?? "";
        } catch {
          d = "";
        }
        paths.set(id, d === "" ? undefined : d);
      }
      return paths.get(id);
    },
  };
}
