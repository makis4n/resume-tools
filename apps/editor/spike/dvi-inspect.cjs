// Minimal DVI/XDV opcode walker: lists fonts, specials, page count. Spike diagnostic only.
const fs = require("fs");
const d = fs.readFileSync(process.argv[2]);
let p = 0;
const u8 = () => d[p++];
const uN = (n) => {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + d[p++];
  return v;
};
const sN = (n) => {
  let v = uN(n);
  const lim = 2 ** (8 * n - 1);
  return v >= lim ? v - 2 * lim : v;
};
const fonts = {},
  specials = [],
  native = [];
let pages = 0,
  chars = 0,
  rules = 0,
  glyphRuns = 0;
const id = d[1];
console.log(
  `pre: id=${id} (2=DVI, 7=XDV) num=${d.readUInt32BE(2)} den=${d.readUInt32BE(6)} mag=${d.readUInt32BE(10)} comment="${d.subarray(15, 15 + d[14]).toString()}"`,
);
p = 15 + d[14];
outer: while (p < d.length) {
  const op = u8();
  if (op <= 127) {
    chars++;
    continue;
  }
  if (op >= 171 && op <= 234) continue;
  switch (true) {
    case op >= 128 && op <= 131:
      uN(op - 127);
      chars++;
      break;
    case op >= 133 && op <= 136:
      uN(op - 132);
      chars++;
      break;
    case op === 132 || op === 137:
      sN(4);
      sN(4);
      rules++;
      break;
    case op === 138 ||
      op === 141 ||
      op === 142 ||
      op === 147 ||
      op === 152 ||
      op === 161 ||
      op === 166:
      break;
    case op === 139:
      pages++;
      p += 44;
      break;
    case op === 140:
      break;
    case op >= 143 && op <= 146:
      sN(op - 142);
      break;
    case op >= 148 && op <= 151:
      sN(op - 147);
      break;
    case op >= 153 && op <= 156:
      sN(op - 152);
      break;
    case op >= 157 && op <= 160:
      sN(op - 156);
      break;
    case op >= 162 && op <= 165:
      sN(op - 161);
      break;
    case op >= 167 && op <= 170:
      sN(op - 166);
      break;
    case op >= 235 && op <= 238:
      uN(op - 234);
      break;
    case op >= 239 && op <= 242: {
      const k = uN(op - 238);
      specials.push(d.subarray(p, p + k).toString("latin1"));
      p += k;
      break;
    }
    case op >= 243 && op <= 246: {
      const k = uN(op - 242);
      p += 4 + 4 + 4;
      const a = u8(),
        l = u8();
      const name = d.subarray(p, p + a + l).toString();
      p += a + l;
      fonts[k] = name;
      break;
    }
    case op === 247:
      throw new Error("pre inside");
    case op === 248: {
      break outer;
    }
    case op === 252: {
      // XDV define native font
      const k = uN(4);
      const size = sN(4);
      const flags = uN(2);
      const l = u8();
      const name = d.subarray(p, p + l).toString();
      p += l;
      const idx = uN(4);
      if (flags & 0x200) {
        p += 4;
      }
      if (flags & 0x1000) {
        p += 4;
      }
      if (flags & 0x2000) {
        p += 4;
      }
      if (flags & 0x4000) {
        p += 4;
      }
      native.push(
        `${k}: ${name}[${idx}] size=${(size / 65536).toFixed(2)}pt flags=0x${flags.toString(16)}`,
      );
      break;
    }
    case op === 253: {
      sN(4);
      const n = uN(2);
      p += n * 8 + n * 2;
      glyphRuns++;
      break;
    }
    case op === 254: {
      const l = uN(2);
      p += l * 2;
      sN(4);
      const n = uN(2);
      p += n * 8 + n * 2;
      glyphRuns++;
      break;
    }
    default:
      throw new Error(`unknown opcode ${op} at ${p - 1}`);
  }
}
console.log(`pages=${pages} chars=${chars} rules=${rules} glyphRuns=${glyphRuns}`);
console.log(`tfm fonts (${Object.keys(fonts).length}):`, Object.values(fonts).join(" "));
if (native.length) console.log(`native fonts (${native.length}):\n  ${native.join("\n  ")}`);
const kinds = {};
for (const s of specials) {
  const k = s.split(/[ :]/)[0];
  kinds[k] = (kinds[k] || 0) + 1;
}
console.log(
  `specials (${specials.length}):`,
  JSON.stringify(kinds),
  "\n  e.g.",
  specials
    .slice(0, 4)
    .map((s) => s.slice(0, 80))
    .join("\n  "),
);
