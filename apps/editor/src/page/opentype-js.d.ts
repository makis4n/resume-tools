// The parts of opentype.js 2 the editor uses: the reader, for XeTeX's native fonts in the spike,
// and the writer, for the overlay's web fonts (`webfont.ts`). The package ships no declarations.
declare module "opentype.js" {
  export interface BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "Z" };

  export class Path {
    commands: PathCommand[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    quadTo(x1: number, y1: number, x: number, y: number): void;
    close(): void;
    getBoundingBox(): BoundingBox;
    toPathData(decimalPlaces?: number): string;
  }

  export interface GlyphOptions {
    name: string;
    unicodes?: number[];
    advanceWidth: number;
    leftSideBearing?: number;
    path: Path;
  }

  export class Glyph {
    constructor(options: GlyphOptions);
    name: string | null;
    unicode: number | undefined;
    unicodes: number[];
    advanceWidth: number;
    path: Path;
  }

  export interface FontOptions {
    familyName: string;
    styleName: string;
    postScriptName?: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: Glyph[];
    /** Values for the tables the writer makes, which win over the ones it works out. */
    tables?: { os2?: Record<string, number> };
  }

  export class Font {
    constructor(options: FontOptions);
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: { length: number; get(index: number): Glyph | undefined };
    tables: Record<string, Record<string, unknown> | undefined>;
    charToGlyphIndex(char: string): number;
    getEnglishName(name: string): string | undefined;
    toArrayBuffer(): ArrayBuffer;
  }

  export function parse(buffer: ArrayBuffer): Font;
}
