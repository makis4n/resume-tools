/**
 * Type 1 fonts: the PFB/PFA container, eexec decryption, and an interpreter for Type 1
 * charstrings that turns each glyph into SVG path data.
 *
 * TeX Live ships Computer Modern and most other TeX fonts as Type 1, so reading them
 * here means the page can be drawn from the same files the engine's PDF driver embeds,
 * with no conversion step outside the browser. The output is the `FontOutlines` shape
 * the renderer already consumes: a 1000-unit em, y pointing up, one path per glyph.
 */

import type { FontOutlines, GlyphOutline } from "./glyphs";

/** A Type 1 font's programs, decrypted but not yet interpreted. */
export interface Type1Font {
  name: string;
  fontMatrix: number[];
  /** Glyph name for each of the 256 codes of the built-in encoding; ".notdef" where empty. */
  encoding: string[];
  /** Decrypted charstrings by glyph name, with the lenIV prefix removed. */
  charstrings: Map<string, Uint8Array>;
  subrs: Uint8Array[];
}

const EEXEC_KEY = 55665;
const CHARSTRING_KEY = 4330;

function decrypt(bytes: Uint8Array, key: number, skip: number): Uint8Array {
  let r = key;
  const out = new Uint8Array(Math.max(0, bytes.length - skip));
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i] as number;
    const plain = c ^ (r >> 8);
    r = ((c + r) * 52845 + 22719) & 0xffff;
    if (i >= skip) out[i - skip] = plain;
  }
  return out;
}

const isHex = (b: number) => (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102);
const isSpace = (b: number) => b === 32 || b === 10 || b === 13 || b === 9 || b === 12 || b === 0;
const isDelimiter = (b: number) =>
  b === 0x2f || b === 0x5b || b === 0x5d || b === 0x7b || b === 0x7d || b === 0x28 || b === 0x29;

/** Split a font file into its clear-text and its decrypted private portion. */
function splitFont(bytes: Uint8Array): { clear: string; priv: Uint8Array } {
  let clear: Uint8Array;
  let encrypted: Uint8Array;
  if (bytes[0] === 0x80) {
    // PFB: segments of (0x80, type, length LE32, data); type 1 text, 2 binary, 3 end.
    const parts: { type: number; data: Uint8Array }[] = [];
    let pos = 0;
    while (pos + 6 <= bytes.length && bytes[pos] === 0x80) {
      const type = bytes[pos + 1] as number;
      if (type === 3) break;
      const view = new DataView(bytes.buffer, bytes.byteOffset + pos + 2, 4);
      const length = view.getUint32(0, true);
      parts.push({ type, data: bytes.subarray(pos + 6, pos + 6 + length) });
      pos += 6 + length;
    }
    const first = parts[0];
    const second = parts[1];
    if (!first || !second) throw new Error("PFB file has fewer than two segments");
    clear = first.data;
    encrypted = second.data;
  } else {
    // PFA: clear text up to "eexec", then the encrypted portion, in hex or binary.
    const text = latin1(bytes);
    const at = text.indexOf("currentfile eexec");
    if (at < 0) throw new Error("not a Type 1 font: no eexec section");
    let start = at + "currentfile eexec".length;
    while (start < bytes.length && isSpace(bytes[start] as number)) start++;
    clear = bytes.subarray(0, start);
    const rest = bytes.subarray(start);
    const hex = rest.subarray(0, 4).every(isHex);
    encrypted = hex ? decodeHex(rest) : rest;
  }
  return { clear: latin1(clear), priv: decrypt(encrypted, EEXEC_KEY, 4) };
}

function decodeHex(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length >> 1);
  let n = 0;
  let high = -1;
  for (const b of bytes) {
    if (!isHex(b)) continue;
    const v = Number.parseInt(String.fromCharCode(b), 16);
    if (high < 0) high = v;
    else {
      out[n++] = (high << 4) | v;
      high = -1;
    }
  }
  return out.subarray(0, n);
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  return s;
}

/** Read the clear-text encoding: either StandardEncoding or a list of `dup code /name put`. */
function parseEncoding(clear: string): string[] {
  const encoding: string[] = new Array(256).fill(".notdef");
  const at = clear.indexOf("/Encoding");
  if (at < 0) return encoding;
  const head = clear.slice(at, at + 40);
  if (/^\/Encoding\s+StandardEncoding\s+def/.test(head)) return [...STANDARD_ENCODING];
  const end = clear.indexOf(" def", at);
  const section = clear.slice(at, end < 0 ? undefined : end);
  for (const m of section.matchAll(/dup\s+(\d+)\s*\/(\S+)\s+put/g)) {
    const code = Number(m[1]);
    if (code >= 0 && code < 256 && m[2]) encoding[code] = m[2];
  }
  return encoding;
}

/** A cursor over the decrypted private portion, which mixes PostScript tokens and binary. */
class Cursor {
  pos = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  find(needle: string, from = this.pos): number {
    const first = needle.charCodeAt(0);
    outer: for (let i = from; i <= this.bytes.length - needle.length; i++) {
      if (this.bytes[i] !== first) continue;
      for (let j = 1; j < needle.length; j++)
        if (this.bytes[i + j] !== needle.charCodeAt(j)) continue outer;
      return i;
    }
    return -1;
  }
  token(): string {
    while (this.pos < this.bytes.length && isSpace(this.bytes[this.pos] as number)) this.pos++;
    const start = this.pos;
    if (this.pos < this.bytes.length && isDelimiter(this.bytes[this.pos] as number)) {
      this.pos++;
      // A name: the slash and what follows it form one token.
      if (this.bytes[start] === 0x2f)
        while (
          this.pos < this.bytes.length &&
          !isSpace(this.bytes[this.pos] as number) &&
          !isDelimiter(this.bytes[this.pos] as number)
        )
          this.pos++;
      return latin1(this.bytes.subarray(start, this.pos));
    }
    while (
      this.pos < this.bytes.length &&
      !isSpace(this.bytes[this.pos] as number) &&
      !isDelimiter(this.bytes[this.pos] as number)
    )
      this.pos++;
    return latin1(this.bytes.subarray(start, this.pos));
  }
  /** `length RD <one space> <length bytes>`: the RD token is read, then the binary. */
  binary(length: number): Uint8Array {
    this.token(); // RD or -|
    this.pos++; // exactly one space
    if (!Number.isInteger(length) || length < 0 || this.pos + length > this.bytes.length)
      throw new Error(`Type 1 font is malformed or truncated: bad charstring length ${length}`);
    const data = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return data;
  }
}

/** Decrypt and split a Type 1 font into its glyph programs. */
export function readType1(bytes: Uint8Array): Type1Font {
  const { clear, priv } = splitFont(bytes);
  const name = /\/FontName\s*\/(\S+)/.exec(clear)?.[1] ?? "";
  const matrix = /\/FontMatrix\s*\[([^\]]*)\]/.exec(clear)?.[1];
  const fontMatrix = matrix ? matrix.trim().split(/\s+/).map(Number) : [0.001, 0, 0, 0.001, 0, 0];
  const encoding = parseEncoding(clear);

  const cursor = new Cursor(priv);
  const lenIVAt = cursor.find("/lenIV");
  let lenIV = 4;
  if (lenIVAt >= 0) {
    cursor.pos = lenIVAt;
    cursor.token();
    lenIV = Number(cursor.token());
  }

  const subrs: Uint8Array[] = [];
  const subrsAt = cursor.find("/Subrs");
  if (subrsAt >= 0) {
    cursor.pos = subrsAt;
    cursor.token();
    const count = Number(cursor.token());
    // Each entry takes at least a dozen bytes, so a count beyond that is not a font.
    if (!Number.isInteger(count) || count < 0 || count > priv.length / 8)
      throw new Error(`Type 1 font is malformed: ${count} subrs declared`);
    for (let i = 0; i < count; i++) {
      // dup <index> <length> RD <binary> NP
      let t = cursor.token();
      while (t !== "dup" && t !== "") t = cursor.token();
      if (t === "") throw new Error("Type 1 font is truncated inside its subrs");
      const index = Number(cursor.token());
      const length = Number(cursor.token());
      if (!Number.isInteger(index) || index < 0 || index >= count)
        throw new Error(`Type 1 font is malformed: subr index ${index}`);
      subrs[index] = decrypt(cursor.binary(length), CHARSTRING_KEY, lenIV);
      cursor.token(); // NP or |
    }
  }

  const charstrings = new Map<string, Uint8Array>();
  const charsAt = cursor.find("/CharStrings");
  if (charsAt < 0) throw new Error("Type 1 font has no CharStrings");
  cursor.pos = charsAt;
  cursor.token();
  cursor.token(); // count
  // The dictionary ends with `end`; running out of bytes first means the file is cut short.
  for (;;) {
    const t = cursor.token();
    if (t === "end") break;
    if (t === "") throw new Error("Type 1 font is truncated inside its charstrings");
    if (!t.startsWith("/")) continue;
    const length = Number(cursor.token());
    if (!Number.isFinite(length)) continue;
    charstrings.set(t.slice(1), decrypt(cursor.binary(length), CHARSTRING_KEY, lenIV));
    cursor.token(); // ND or |-
  }
  return { name, fontMatrix, encoding, charstrings, subrs };
}

/** Number formatting for path data: integers stay integers, fractions keep three places. */
const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
};

/** Cubic Bézier bounds, from the end points and the interior extrema. */
function cubicBounds(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  extend: (x: number, y: number) => void,
) {
  extend(p0[0], p0[1]);
  extend(p3[0], p3[1]);
  for (const axis of [0, 1] as const) {
    const a = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
    const b = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]);
    const c = -p0[axis] + p1[axis];
    const roots: number[] = [];
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) roots.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
      }
    }
    for (const t of roots) {
      if (t <= 0 || t >= 1) continue;
      const u = 1 - t;
      const point = (i: 0 | 1) =>
        u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
      extend(point(0), point(1));
    }
  }
}

/** Collects a glyph's outline as SVG path data and its bounding box. */
class PathBuilder {
  private parts: string[] = [];
  private open = false;
  private bounds: [number, number, number, number] | null = null;
  x = 0;
  y = 0;

  private extend = (x: number, y: number) => {
    if (!this.bounds) this.bounds = [x, y, x, y];
    else {
      const b = this.bounds;
      b[0] = Math.min(b[0], x);
      b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x);
      b[3] = Math.max(b[3], y);
    }
  };

  moveTo(x: number, y: number) {
    this.open = true;
    this.parts.push(`M${num(x)} ${num(y)}`);
    this.x = x;
    this.y = y;
  }
  lineTo(x: number, y: number) {
    if (!this.open) this.moveTo(this.x, this.y);
    if (x === this.x && y === this.y) return;
    this.extend(this.x, this.y);
    this.extend(x, y);
    this.parts.push(`L${num(x)} ${num(y)}`);
    this.x = x;
    this.y = y;
  }
  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    if (!this.open) this.moveTo(this.x, this.y);
    cubicBounds([this.x, this.y], [x1, y1], [x2, y2], [x, y], this.extend);
    this.parts.push(`C${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)}`);
    this.x = x;
    this.y = y;
  }
  closePath() {
    if (!this.open) return;
    this.parts.push("Z");
    this.open = false;
  }
  endPath() {
    this.open = false;
  }
  result(): { d: string; b: [number, number, number, number] | null } {
    return { d: this.parts.join(""), b: this.bounds };
  }
}

/**
 * Run a Type 1 charstring. Hints are skipped, flex is turned into its two curves, and
 * `seac` draws the base and accent glyphs by name through `draw`. A component drawn
 * for `seac` may not itself be a composite, as the specification requires.
 */
function interpret(
  program: Uint8Array,
  font: Type1Font,
  path: PathBuilder,
  offset: [number, number],
  draw: (name: string, path: PathBuilder, offset: [number, number]) => void,
  component = false,
): { width: number } {
  const stack: number[] = [];
  const psStack: number[] = [];
  let width = 0;
  let sbx = 0;
  let flexPoints: number[] | null = null;
  let flexStart: [number, number] = [0, 0];
  let done = false;

  const moveTo = (dx: number, dy: number) => {
    if (flexPoints) {
      // Inside flex the moves only collect points; the curves come at its end.
      path.x += dx;
      path.y += dy;
      flexPoints.push(path.x, path.y);
      return;
    }
    path.endPath();
    path.moveTo(path.x + dx, path.y + dy);
  };
  const curveTo = (
    dx1: number,
    dy1: number,
    dx2: number,
    dy2: number,
    dx3: number,
    dy3: number,
  ) => {
    const x1 = path.x + dx1;
    const y1 = path.y + dy1;
    const x2 = x1 + dx2;
    const y2 = y1 + dy2;
    path.curveTo(x1, y1, x2, y2, x2 + dx3, y2 + dy3);
  };

  const run = (code: Uint8Array, depth: number) => {
    if (depth > 30) throw new Error("charstring subroutine nesting too deep");
    let i = 0;
    while (i < code.length && !done) {
      const v = code[i++] as number;
      if (v >= 32) {
        if (v <= 246) stack.push(v - 139);
        else if (v <= 250) stack.push((v - 247) * 256 + (code[i++] as number) + 108);
        else if (v <= 254) stack.push(-(v - 251) * 256 - (code[i++] as number) - 108);
        else {
          const view = new DataView(code.buffer, code.byteOffset + i, 4);
          stack.push(view.getInt32(0));
          i += 4;
        }
        continue;
      }
      switch (v) {
        case 13: {
          // hsbw: sidebearing x, width
          sbx = (stack[0] ?? 0) + offset[0];
          width = stack[1] ?? 0;
          path.x = sbx;
          path.y = offset[1];
          stack.length = 0;
          break;
        }
        case 9:
          path.closePath();
          stack.length = 0;
          break;
        case 1:
        case 3:
          stack.length = 0; // hstem, vstem
          break;
        case 21:
          moveTo(stack[0] ?? 0, stack[1] ?? 0);
          stack.length = 0;
          break;
        case 22:
          moveTo(stack[0] ?? 0, 0);
          stack.length = 0;
          break;
        case 4:
          moveTo(0, stack[0] ?? 0);
          stack.length = 0;
          break;
        case 5:
          path.lineTo(path.x + (stack[0] ?? 0), path.y + (stack[1] ?? 0));
          stack.length = 0;
          break;
        case 6:
          path.lineTo(path.x + (stack[0] ?? 0), path.y);
          stack.length = 0;
          break;
        case 7:
          path.lineTo(path.x, path.y + (stack[0] ?? 0));
          stack.length = 0;
          break;
        case 8: {
          const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = stack;
          curveTo(a, b, c, d, e, f);
          stack.length = 0;
          break;
        }
        case 30: {
          // vhcurveto dy1 dx2 dy2 dx3
          const [a = 0, b = 0, c = 0, d = 0] = stack;
          curveTo(0, a, b, c, d, 0);
          stack.length = 0;
          break;
        }
        case 31: {
          // hvcurveto dx1 dx2 dy2 dy3
          const [a = 0, b = 0, c = 0, d = 0] = stack;
          curveTo(a, 0, b, c, 0, d);
          stack.length = 0;
          break;
        }
        case 10: {
          const index = stack.pop() ?? 0;
          const subr = font.subrs[index];
          if (!subr) throw new Error(`charstring calls missing subr ${index}`);
          run(subr, depth + 1);
          break;
        }
        case 11:
          return;
        case 14:
          // endchar ends the path without closing it, as fontTools does; SVG fills it anyway.
          path.endPath();
          done = true;
          return;
        case 12: {
          const w = code[i++] as number;
          switch (w) {
            case 0: // dotsection
            case 1: // vstem3
            case 2: // hstem3
              stack.length = 0;
              break;
            case 6: {
              // seac: asb adx ady bchar achar
              if (component) throw new Error("Type 1 font is malformed: nested seac");
              const [asb = 0, adx = 0, ady = 0, bchar = 0, achar = 0] = stack;
              stack.length = 0;
              const base = STANDARD_ENCODING[bchar];
              const accent = STANDARD_ENCODING[achar];
              if (base) draw(base, path, [offset[0], offset[1]]);
              if (accent) draw(accent, path, [sbx - asb + adx, offset[1] + ady]);
              done = true;
              return;
            }
            case 7: {
              // sbw: sbx sby wx wy
              sbx = (stack[0] ?? 0) + offset[0];
              width = stack[2] ?? 0;
              path.x = sbx;
              path.y = (stack[1] ?? 0) + offset[1];
              stack.length = 0;
              break;
            }
            case 12: {
              const b = stack.pop() ?? 1;
              const a = stack.pop() ?? 0;
              stack.push(a / b);
              break;
            }
            case 16: {
              // callothersubr
              const which = stack.pop() ?? 0;
              const n = stack.pop() ?? 0;
              const args = stack.splice(Math.max(0, stack.length - n), n);
              if (which === 1) {
                flexPoints = [];
                flexStart = [path.x, path.y];
              } else if (which === 0 && flexPoints) {
                // Seven collected points: a reference point, then the two curves' control
                // and end points, all absolute. The curves start where flex began.
                const [, , x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0] = flexPoints;
                const [x4 = 0, y4 = 0, x5 = 0, y5 = 0, x6 = 0, y6 = 0] = flexPoints.slice(8);
                flexPoints = null;
                [path.x, path.y] = flexStart;
                path.curveTo(x1, y1, x2, y2, x3, y3);
                path.curveTo(x4, y4, x5, y5, x6, y6);
                // The two `pop`s that follow retrieve the end point for setcurrentpoint.
                psStack.length = 0;
                psStack.push(path.y, path.x);
              } else if (which === 3) {
                psStack.length = 0;
                psStack.push(3);
              } else {
                psStack.length = 0;
                for (let k = args.length - 1; k >= 0; k--) psStack.push(args[k] as number);
              }
              break;
            }
            case 17:
              stack.push(psStack.pop() ?? 0);
              break;
            case 33: {
              // setcurrentpoint
              path.x = stack[0] ?? path.x;
              path.y = stack[1] ?? path.y;
              stack.length = 0;
              break;
            }
            default:
              throw new Error(`unknown charstring escape 12 ${w}`);
          }
          break;
        }
        default:
          throw new Error(`unknown charstring operator ${v}`);
      }
    }
  };
  run(program, 0);
  return { width };
}

/** Interpret every glyph of a decrypted font into outlines the renderer can draw. */
export function type1Outlines(font: Type1Font): FontOutlines {
  const glyphs: Record<string, GlyphOutline> = {};
  const draw = (name: string, path: PathBuilder, offset: [number, number]) => {
    const program = font.charstrings.get(name);
    if (program) interpret(program, font, path, offset, draw, true);
  };
  for (const [name, program] of font.charstrings) {
    const path = new PathBuilder();
    const { width } = interpret(program, font, path, [0, 0], draw);
    const { d, b } = path.result();
    glyphs[name] = { w: width, d, b };
  }
  return { name: font.name, encoding: font.encoding, glyphs };
}

/** Read a PFB or PFA file into outlines the renderer can draw. */
export function parseType1(bytes: Uint8Array): FontOutlines {
  return type1Outlines(readType1(bytes));
}

/** Adobe StandardEncoding, which `seac` uses to name its component glyphs. */
const STANDARD_ENCODING: string[] = (() => {
  const e: string[] = new Array(256).fill(".notdef");
  const names =
    "space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde".split(
      " ",
    );
  names.forEach((n, i) => {
    e[32 + i] = n;
  });
  const high: Record<number, string> = {
    161: "exclamdown",
    162: "cent",
    163: "sterling",
    164: "fraction",
    165: "yen",
    166: "florin",
    167: "section",
    168: "currency",
    169: "quotesingle",
    170: "quotedblleft",
    171: "guillemotleft",
    172: "guilsinglleft",
    173: "guilsinglright",
    174: "fi",
    175: "fl",
    177: "endash",
    178: "dagger",
    179: "daggerdbl",
    180: "periodcentered",
    182: "paragraph",
    183: "bullet",
    184: "quotesinglbase",
    185: "quotedblbase",
    186: "quotedblright",
    187: "guillemotright",
    188: "ellipsis",
    189: "perthousand",
    191: "questiondown",
    193: "grave",
    194: "acute",
    195: "circumflex",
    196: "tilde",
    197: "macron",
    198: "breve",
    199: "dotaccent",
    200: "dieresis",
    202: "ring",
    203: "cedilla",
    205: "hungarumlaut",
    206: "ogonek",
    207: "caron",
    208: "emdash",
    225: "AE",
    227: "ordfeminine",
    232: "Lslash",
    233: "Oslash",
    234: "OE",
    235: "ordmasculine",
    241: "ae",
    245: "dotlessi",
    248: "lslash",
    249: "oslash",
    250: "oe",
    251: "germandbls",
  };
  for (const [code, n] of Object.entries(high)) e[Number(code)] = n;
  return e;
})();
