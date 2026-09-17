// The parts of opentype.js 2 the spike uses; the package ships no type declarations.
declare module "opentype.js" {
  export interface Path {
    toPathData(decimalPlaces?: number): string;
  }
  export interface Glyph {
    path?: Path;
  }
  export interface Font {
    unitsPerEm: number;
    glyphs: { get(index: number): Glyph | undefined };
  }
  export function parse(buffer: ArrayBuffer): Font;
}
